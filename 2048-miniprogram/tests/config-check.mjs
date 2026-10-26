/**
 * 小程序工程静态检查（无需微信开发者工具）：
 * 多页面文件完整性、JSON 配置、WXML 事件绑定、结构、资源与隐私检查。
 */
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const checks = []

async function check(name, fn) {
  try {
    const detail = await fn()
    checks.push({ name, ok: true, detail })
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    checks.push({ name, ok: false, error })
    console.error(`✖ ${name}\n  ${error.message}`)
  }
}

const read = (relative) => readFile(path.join(ROOT, relative), 'utf8')
const readBuffer = (relative) => readFile(path.join(ROOT, relative))
const exists = async (relative) => {
  await access(path.join(ROOT, relative))
  return true
}

const appJson = JSON.parse(await read('app.json'))
const pages = appJson.pages
const pageFiles = []
for (const page of pages) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    pageFiles.push(page + extension)
  }
}

await check('必要文件齐全', async () => {
  const required = [
    'app.js',
    'app.json',
    'app.wxss',
    'project.config.json',
    'sitemap.json',
    ...pageFiles,
    'utils/board.js',
    'utils/engine.js',
    'utils/gesture.js',
    'utils/storage.js',
    'utils/tiles.js',
    'utils/sound.js',
    'utils/random.js',
    'utils/theme.js',
    'utils/klotski.js',
    'utils/klotski-storage.js',
    'utils/cloud.js',
    'utils/cloud-utils.js',
    'config/cloud.js',
    'cloudfunctions/api/index.js',
    'cloudfunctions/api/package.json',
    'cloudfunctions/api/klotski.js',
    'cloudfunctions/api/random.js',
    'cloudfunctions/api/verify.js',
    'cloudfunctions/api/board.js',
    'cloudfunctions/api/engine.js',
    'cloudfunctions/api/achievements.js',
    'cloudfunctions/api/profile.js',
    'assets/merge.wav',
    'assets/win.wav',
    'assets/over.wav',
  ]
  for (const file of required) await exists(file)
  return `${required.length} 个文件`
})

await check('页面路由与 JSON 配置', async () => {
  assert.deepEqual(pages, [
    'pages/home/index',
    'pages/onboarding/index',
    'pages/index/index',
    'pages/klotski/index',
    'pages/klotski/game/index',
    'pages/leaderboard/index',
    'pages/profile/index',
  ])
  assert.equal(appJson.window.navigationBarTitleText, '小游戏合集')
  assert.equal(appJson.sitemapLocation, 'sitemap.json')

  for (const page of pages) {
    const config = JSON.parse(await read(page + '.json'))
    assert.ok(config && typeof config === 'object')
  }
  JSON.parse(await read('sitemap.json'))
  const project = JSON.parse(await read('project.config.json'))
  assert.equal(project.compileType, 'miniprogram')
  assert.equal(project.cloudfunctionRoot, 'cloudfunctions/')
  assert.match(
    project.appid,
    /^wx[0-9a-f]{16}$/,
    'project.config.json 需要真实的小程序 AppID（wx + 16 位十六进制）',
  )
  assert.doesNotMatch(JSON.stringify(project).toLowerCase(), /secret/, '项目配置不应包含密钥')
  return '7 个页面；云函数目录已配置；AppID 已配置（不在文档中展示）'
})

await check('WXML 事件绑定在对应页面 JS 中都有方法', async () => {
  const regex = /(?:bind|catch)(?:tap|touchstart|touchmove|touchend|touchcancel|longpress)="([A-Za-z0-9_]+)"/g
  const summary = []
  for (const page of pages) {
    const wxml = await read(page + '.wxml')
    const js = await read(page + '.js')
    const handlers = new Set()
    let match
    while ((match = regex.exec(wxml)) !== null) handlers.add(match[1])
    for (const handler of handlers) {
      assert.ok(js.includes(handler + '('), `${page}.wxml 绑定了 ${handler}，但页面 JS 中不存在`)
    }
    assert.ok(handlers.size > 0, `${page} 没有事件绑定`)
    summary.push(page + ':' + handlers.size)
  }
  return summary.join(', ')
})

await check('WXML 结构：view 标签配对、关键节点存在', async () => {
  const expectations = {
    'pages/home/index': ['on2048Tap', 'onKlotskiTap', 'game-card'],
    'pages/index/index': ['wx:for="{{cells}}"', 'wx:for="{{tiles}}"', 'dialog-mask', 'history', 'onTouchStart'],
    'pages/klotski/index': ['onSelectSize', 'preview-grid', 'wx:for="{{sizes}}"'],
    'pages/klotski/game/index': ['wx:for="{{cells}}"', 'wx:for="{{tiles}}"', 'dialog-mask', 'onTouchStart', 'onTouchEnd', 'cloudMessage'],
    'pages/leaderboard/index': ['onGameTap', 'onPeriodTap', 'rank-list', 'my-card'],
    'pages/profile/index': ['nickname-input', 'onSave', 'achievement-list', 'onClearCloud'],
    'pages/onboarding/index': ['avatar-grid', 'nickname-box', 'gender-grid', 'onSubmit'],
  }
  const summary = []
  for (const page of pages) {
    const wxml = await read(page + '.wxml')
    const opens = (wxml.match(/<view[\s>]/g) || []).length
    const closes = (wxml.match(/<\/view>/g) || []).length
    assert.equal(opens, closes, `${page}: view 开闭标签数量不一致 ${opens}/${closes}`)
    for (const marker of expectations[page] || []) {
      assert.ok(wxml.includes(marker), `${page}: 缺少节点标记 ${marker}`)
    }
    summary.push(page + ':' + opens)
  }
  return summary.join(', ')
})

await check('无外部网络资源依赖（WXML/WXSS/JS）', async () => {
  const files = [
    'app.js',
    'app.json',
    'app.wxss',
    ...pages.flatMap((page) => [page + '.js', page + '.wxml', page + '.wxss']),
    ...(await (async () => {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(path.join(ROOT, 'utils'))
      return entries.filter((name) => name.endsWith('.js')).map((name) => 'utils/' + name)
    })()),
  ]
  const hits = []
  for (const file of files) {
    const content = await read(file)
    if (/https?:\/\//.test(content)) hits.push(file)
  }
  assert.deepEqual(hits, [], `发现外部链接：${hits.join(', ')}`)
  return `${files.length} 个文件`
})

await check('本地音效资源为有效 WAV 文件', async () => {
  for (const name of ['merge.wav', 'win.wav', 'over.wav']) {
    const buffer = await readBuffer('assets/' + name)
    assert.ok(buffer.length > 1000, `${name} 过小`)
    assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WAVE')
  }
  return '3 个 WAV'
})

await check('源码隐私检查：无个人路径 / 账号 / 密钥', async () => {
  const files = [
    'app.js',
    'app.json',
    'project.config.json',
    ...pages.flatMap((page) => [page + '.js', page + '.wxml', page + '.wxss']),
    ...(await (async () => {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(path.join(ROOT, 'utils'))
      return entries.filter((name) => name.endsWith('.js')).map((name) => 'utils/' + name)
    })()),
  ]
  const forbidden = [/C:\\\\Users\\\\/i, /HuaweiMoveData/i, /86138/, /secret/i, /password/i]
  const hits = []
  for (const file of files) {
    const content = await read(file)
    for (const pattern of forbidden) {
      if (pattern.test(content)) hits.push(`${file} :: ${pattern}`)
    }
  }
  assert.deepEqual(hits, [])
  return `${files.length} 个文件`
})

await check('云函数纯逻辑与客户端保持同步', async () => {
  const pairs = [
    ['utils/klotski.js', 'cloudfunctions/api/klotski.js'],
    ['utils/random.js', 'cloudfunctions/api/random.js'],
    ['utils/board.js', 'cloudfunctions/api/board.js'],
    ['utils/engine.js', 'cloudfunctions/api/engine.js'],
    ['utils/achievements.js', 'cloudfunctions/api/achievements.js'],
    ['utils/profile.js', 'cloudfunctions/api/profile.js'],
  ]
  for (const [clientFile, cloudFile] of pairs) {
    assert.equal(
      await read(clientFile),
      await read(cloudFile),
      `${clientFile} 与 ${cloudFile} 不一致，请重新同步云函数 lib`,
    )
  }
  return `${pairs.length} 组文件一致`
})

await check('测试脚本与 Node 环境', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.match(pkg.scripts.test, /node --test/)
  assert.match(pkg.scripts['test:config'], /config-check/)
  const [major, minor] = process.versions.node.split('.').map(Number)
  assert.ok(major >= 20, `当前 Node ${process.versions.node}`)
  return `Node v${process.versions.node}`
})

const passed = checks.filter((item) => item.ok).length
console.log(`\n========== 小程序配置检查：${passed}/${checks.length} 通过 ==========`)
if (passed !== checks.length) process.exitCode = 1
