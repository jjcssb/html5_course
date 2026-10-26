/**
 * 小程序模拟器功能验证（需微信开发者工具 + miniprogram-automator）。
 *
 * 前提：
 *   1. 开发者工具：设置 → 安全设置 → 开启服务端口；
 *   2. 项目根目录执行：npm install --no-save miniprogram-automator
 *   3. 开启自动化：
 *      "D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto \
 *        --project <项目绝对路径> --auto-port 9421 --trust-project
 *   4. 运行：node tests/simulator/functional.js
 *
 * 说明：automator 0.13 与开发者工具 2.02 的 page.callMethod 不兼容，
 * 因此交互通过 miniProgram.evaluate 在页面上下文调用页面方法；
 * 渲染、存储、Console 均为真实模拟器环境。
 */
const assert = require('node:assert/strict')
const automator = require('miniprogram-automator')

const WS = process.env.AUTOMATOR_WS || 'ws://127.0.0.1:9421'
const results = []
const consoleErrors = []
const exceptions = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((resolve, reject) => setTimeout(() => reject(new Error('TIMEOUT: ' + label)), ms))])

async function step(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log('PASS  ' + name + (detail ? '  — ' + detail : ''))
  } catch (error) {
    results.push({ name, ok: false, error })
    console.error('FAIL  ' + name + '\n      ' + (error && (error.message || String(error))))
    throw error
  }
}

async function main() {
  const miniProgram = await withTimeout(automator.connect({ wsEndpoint: WS }), 15000, 'connect')
  miniProgram.on('console', (m) => {
    if (m.type === 'error') consoleErrors.push(JSON.stringify(m.args))
  })
  miniProgram.on('exception', (e) => exceptions.push(JSON.stringify(e)))

  const invoke = (fn, ...args) => withTimeout(miniProgram.evaluate(fn, ...args), 12000, 'evaluate')
  const getData = () =>
    invoke(function () {
      const pages = getCurrentPages()
      return pages[pages.length - 1].data
    })
  const call = (method, ...args) =>
    invoke(
      function (name, methodArgs) {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        const result = page[name].apply(page, methodArgs)
        return result === undefined ? true : result
      },
      method,
      args,
    )
  const relaunch = async () => {
    await miniProgram.reLaunch('/pages/index/index?standalone=1')
    await sleep(1400)
  }
  const tileSignature = (data) => JSON.stringify(data.tiles.map((t) => [t.value, t.left, t.top]))

  try {
    await step('清理存储并重新启动：初始 2 个方块、16 个格子、得分 0', async () => {
      await miniProgram.callWxMethod('clearStorageSync')
      await miniProgram.callWxMethod('setStorageSync', 'g2048.onboarding.skipped', true)
      await relaunch()
      const current = await getData()
      assert.equal(current.score, 0)
      assert.equal(current.best, 0)
      assert.equal(current.tiles.length, 2)
      assert.equal(current.cells.length, 16)
      assert.equal(current.status, 'playing')
      return '通过'
    })

    await step('触摸滑动：触摸事件路径触发一次移动', async () => {
      const before = await getData()
      await invoke(function () {
        const page = getCurrentPages()[0]
        page.onTouchStart({ touches: [{ clientX: 150, clientY: 150 }] })
        page.onTouchEnd({ changedTouches: [{ clientX: 30, clientY: 150 }] })
        return true
      })
      await sleep(600)
      const after = await getData()
      assert.notEqual(tileSignature(after), tileSignature(before))
      return '棋盘发生变化'
    })

    await step('触摸取消与轻触：不触发移动', async () => {
      const before = await getData()
      await invoke(function () {
        const page = getCurrentPages()[0]
        page.onTouchStart({ touches: [{ clientX: 150, clientY: 150 }] })
        page.onTouchCancel()
        page.onTouchEnd({ changedTouches: [{ clientX: 30, clientY: 150 }] })
        page.onTouchStart({ touches: [{ clientX: 100, clientY: 100 }] })
        page.onTouchEnd({ changedTouches: [{ clientX: 108, clientY: 104 }] })
        return true
      })
      await sleep(400)
      const after = await getData()
      assert.equal(tileSignature(after), tileSignature(before))
      return '通过'
    })

    await step('最高分与战绩：写入 wx storage 后重载页面正确恢复', async () => {
      const record = {
        score: 512,
        maxTile: 64,
        moves: 30,
        durationMs: 95000,
        endedBy: 'gameover',
        endedAt: Date.now(),
        won: false,
      }
      await miniProgram.callWxMethod('setStorageSync', 'g2048.bestScore.v1', '88')
      await miniProgram.callWxMethod('setStorageSync', 'g2048.history.v1', JSON.stringify([record]))
      await relaunch()
      const current = await getData()
      assert.equal(current.best, 88)
      assert.equal(current.history.length, 1)
      assert.equal(current.history[0].score, 512)
      assert.equal(current.history[0].reasonLabel, '游戏结束')
      return 'best=88，战绩 1 条'
    })

    await step('重新开始：取消后棋局不变', async () => {
      const before = await getData()
      await call('onRestartTap')
      await sleep(400)
      assert.equal((await getData()).modal, 'restart')
      await call('onModalCancelTap')
      await sleep(300)
      const after = await getData()
      assert.equal(after.modal, '')
      assert.equal(tileSignature(after), tileSignature(before))
      return '通过'
    })

    await step('重新开始：确认后重置本局并保留最高分', async () => {
      const before = await getData()
      await call('onRestartTap')
      await sleep(300)
      await call('onModalConfirmTap')
      await sleep(700)
      const after = await getData()
      assert.equal(after.score, 0)
      assert.equal(after.tiles.length, 2)
      assert.equal(after.best, before.best)
      return 'best=' + after.best
    })

    await step('主题切换与持久化', async () => {
      for (const value of ['dark', 'retro', 'light']) {
        await invoke(function (theme) {
          getCurrentPages()[0].onThemeTap({ currentTarget: { dataset: { value: theme } } })
          return true
        }, value)
        await sleep(300)
        assert.equal((await getData()).theme, value)
      }
      return '浅色/深色/复古均生效'
    })

    await step('音效开关与持久化', async () => {
      await call('onSoundTap')
      await sleep(300)
      assert.equal((await getData()).soundEnabled, false)
      assert.equal(await miniProgram.callWxMethod('getStorageSync', 'g2048.sound.v1'), 'off')
      await call('onSoundTap')
      await sleep(300)
      assert.equal((await getData()).soundEnabled, true)
      return '关闭/开启与 wx storage 一致'
    })

    await step('历史战绩面板展开', async () => {
      await call('onToggleHistory')
      await sleep(400)
      const current = await getData()
      assert.equal(current.historyOpen, true)
      assert.equal(current.history.length, 1)
      return current.history[0].score + ' 分记录'
    })

    await step('Console / 异常检查', async () => {
      assert.deepEqual(exceptions, [], '页面异常：\n' + exceptions.join('\n'))
      assert.deepEqual(consoleErrors, [], '控制台错误：\n' + consoleErrors.join('\n'))
      return '无异常、无 error 日志'
    })

    const passed = results.filter((r) => r.ok).length
    console.log('\n========== 小程序功能验证：' + passed + '/' + results.length + ' 通过 ==========')
    process.exitCode = passed === results.length ? 0 : 1
  } finally {
    try {
      await withTimeout(miniProgram.disconnect(), 5000, 'disconnect')
    } catch (error) {
      // 忽略
    }
    setTimeout(() => process.exit(process.exitCode || 0), 500)
  }
}

main().catch((error) => {
  console.error('执行失败：', error)
  process.exit(1)
})
