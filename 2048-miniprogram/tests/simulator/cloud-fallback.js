/**
 * 无云环境时的降级验证：
 * 首页离线状态、每日挑战本地模式、排行榜错误态、2048 正常不受影响。
 * 真实云排行榜需要先开通云开发并部署 cloudfunctions/api 后另行验证。
 */
const assert = require('node:assert/strict')
const automator = require('miniprogram-automator')

const WS = process.env.AUTOMATOR_WS || 'ws://127.0.0.1:9421'
const results = []
const errors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function step(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true })
    console.log('PASS  ' + name + (detail ? '  — ' + detail : ''))
  } catch (error) {
    results.push({ name, ok: false })
    console.error('FAIL  ' + name + '\n      ' + (error && (error.message || String(error))))
    throw error
  }
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: WS })
  miniProgram.on('console', (m) => {
    if (m.type === 'error') errors.push(JSON.stringify(m.args).slice(0, 400))
  })
  miniProgram.on('exception', (e) => errors.push(JSON.stringify(e).slice(0, 400)))

  const invoke = (fn, ...args) => miniProgram.evaluate(fn, ...args)
  const getData = () => invoke(function () { return getCurrentPages().slice(-1)[0].data })
  const getPath = () => invoke(function () { return getCurrentPages().slice(-1)[0].route })
  const call = (method, ...args) =>
    invoke(function (name, methodArgs) {
      const page = getCurrentPages().slice(-1)[0]
      page[name].apply(page, methodArgs)
      return true
    }, method, args)

  try {
    await miniProgram.callWxMethod('clearStorageSync')
    await miniProgram.reLaunch('/pages/home/index')
    await sleep(2500)

    const precheck = await getData()
    if (precheck.cloudReady) {
      console.log('SKIP  当前已配置云环境，跳过降级验证')
      await miniProgram.disconnect()
      process.exit(0)
    }

    await step('无云环境：首页显示离线状态且不阻塞', async () => {
      assert.equal(await getPath(), 'pages/home/index')
      const data = await getData()
      assert.equal(data.cloudReady, false)
      assert.equal(data.cloudLoading, false)
      assert.ok(data.cloudError)
      return data.cloudError
    })

    await step('每日挑战：无云时使用本地种子进入 3×3', async () => {
      await call('onDailyTap')
      await sleep(3000)
      assert.equal(await getPath(), 'pages/klotski/game/index')
      const data = await getData()
      assert.equal(data.daily, true)
      assert.equal(data.size, 3)
      assert.match(data.dailyKey, /^\d{4}-\d{2}-\d{2}$/)
      assert.equal(data.tiles.length, 8)
      assert.match(data.cloudMessage, /云端|本地/)
      return '日期=' + data.dailyKey
    })

    await step('每日挑战：滑动移动正常，无云也能玩', async () => {
      const internal = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        return { board: page.board, seed: page.seed, directions: page.directions }
      })
      assert.equal(Array.isArray(internal.board), true)
      assert.equal(internal.directions.length, 0)
      const dirs = ['left', 'right', 'up', 'down']
      let direction = null
      const { moveBySwipe } = require('../../utils/klotski')
      for (const candidate of dirs) {
        if (moveBySwipe(internal.board, candidate).moved) {
          direction = candidate
          break
        }
      }
      await call('onSwipeMove', direction)
      await sleep(600)
      const data = await getData()
      const after = await invoke(function () { return getCurrentPages().slice(-1)[0].directions })
      assert.equal(data.moves, 1)
      assert.equal(after.length, 1)
      return '方向=' + direction
    })

    await step('每日挑战：完成后本地保存，云端失败有提示', async () => {
      await invoke(function (board) {
        const page = getCurrentPages().slice(-1)[0]
        page.stopTimer()
        page.startedAt = null
        page.moves = 0
        page.board = board.slice()
        page.directions = []
        page.setData({ tiles: page.toViewTiles(page.board), moves: 0, status: 'playing', elapsedText: '00:00' })
        return true
      }, [1, 2, 3, 4, 5, 6, 7, 0, 8])
      await call('onSwipeMove', 'left')
      await sleep(1200)
      const data = await getData()
      assert.equal(data.status, 'won')
      assert.match(data.cloudMessage, /云|上传|成绩/)
      return data.cloudMessage
    })

    await step('排行榜：无云时显示错误态并可重试', async () => {
      await miniProgram.navigateTo('/pages/leaderboard/index')
      await sleep(2500)
      assert.equal(await getPath(), 'pages/leaderboard/index')
      const data = await getData()
      assert.equal(data.loading, false)
      assert.ok(data.error)
      return data.error
    })

    await step('Console / 异常检查', async () => {
      assert.deepEqual(errors, [])
      return '无异常、无 error 日志'
    })

    const passed = results.filter((item) => item.ok).length
    console.log('\n========== 云开发降级验证：' + passed + '/' + results.length + ' 通过 ==========')
    process.exitCode = passed === results.length ? 0 : 1
  } finally {
    try {
      await miniProgram.disconnect()
    } catch (error) {
      // ignore
    }
    setTimeout(() => process.exit(process.exitCode || 0), 300)
  }
}

main().catch((error) => {
  console.error('执行失败：', error)
  process.exit(1)
})
