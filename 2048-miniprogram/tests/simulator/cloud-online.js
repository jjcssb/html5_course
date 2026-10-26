/**
 * 真实云环境在线验证（需要先填写 config/cloud.js 的 ENV_ID 并部署 api 云函数）。
 *
 * 覆盖：登录、每日挑战服务端种子、BFS 求解并提交、云端排行榜/我的排名。
 * 运行前确保：
 *   1. config/cloud.js 已填 ENV_ID；
 *   2. cloudfunctions/api 已部署；
 *   3. 开发者工具已 auto 并监听 9421。
 */
const assert = require('node:assert/strict')
const automator = require('miniprogram-automator')
const { moveBySwipe, isSolved, createSolvedBoard } = require('../../utils/klotski')
const { createGameState, applyMove } = require('../../cloudfunctions/api/engine')
const { createSeededRandom } = require('../../cloudfunctions/api/random')

const WS = process.env.AUTOMATOR_WS || 'ws://127.0.0.1:9421'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
const errors = []

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

/** 3×3 BFS 求解，返回滑动方向数组（方向 = 数字移动方向，和页面一致）。 */
function solve3(board) {
  const goal = createSolvedBoard(3).join(',')
  const start = board.join(',')
  if (start === goal) return []
  const queue = [board.slice()]
  const paths = [[]]
  const seen = new Set([start])
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    const path = paths[head]
    for (const direction of ['left', 'right', 'up', 'down']) {
      const result = moveBySwipe(current, direction)
      if (!result.moved) continue
      const key = result.board.join(',')
      if (seen.has(key)) continue
      const nextPath = path.concat(direction)
      if (key === goal) return nextPath
      seen.add(key)
      queue.push(result.board)
      paths.push(nextPath)
    }
  }
  throw new Error('3×3 无解')
}

/** 生成一局真实结束的 2048，用于服务端重放验证。 */
function make2048Run(seed) {
  const rng = createSeededRandom(seed)
  const chooser = createSeededRandom((seed ^ 0x9e3779b9) >>> 0)
  const directions = []
  let state = createGameState({ random: rng, best: 0, now: () => 0 })
  let guard = 0
  while (state.status === 'playing' && guard < 5000) {
    guard += 1
    const direction = ['left', 'right', 'up', 'down'][Math.floor(chooser() * 4)]
    const applied = applyMove(state, direction, { random: rng, now: () => 0 })
    if (applied.result.moved) {
      directions.push(direction)
      state = applied.state
    }
  }
  if (state.status === 'playing') throw new Error('2048 测试局未结束')
  return { seed, directions, score: state.score, moves: state.moves }
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
  const waitForData = async function (predicate, timeoutMs) {
    const limit = timeoutMs || 12000
    const started = Date.now()
    let last = null
    while (Date.now() - started < limit) {
      last = await getData()
      if (predicate(last)) return last
      await sleep(300)
    }
    throw new Error('等待页面数据超时，最后状态：' + JSON.stringify(last))
  }
  const call = (method, ...args) =>
    invoke(function (name, methodArgs) {
      const page = getCurrentPages().slice(-1)[0]
      const value = page[name].apply(page, methodArgs)
      return value === undefined ? true : value
    }, method, args)

  try {
    await miniProgram.reLaunch('/pages/home/index')
    await sleep(3000)

    await step('首次进入：创建玩家档案（头像/昵称/性别）', async () => {
      let route = await getPath()
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (route === 'pages/onboarding/index' || route === 'pages/home/index') break
        await sleep(500)
        route = await getPath()
      }
      if (route === 'pages/onboarding/index') {
        await invoke(function () {
          const page = getCurrentPages().slice(-1)[0]
          page.setData({ nickname: '测试玩家', gender: 'female', avatar: 'a3', avatarEmoji: '🐼' })
          page.onSubmit()
          return true
        })
        await sleep(2500)
        await miniProgram.reLaunch('/pages/home/index')
        await sleep(2500)
        return '已创建档案'
      }
      return '已有档案，跳过'
    })

    await step('云登录：首页显示云端玩家与已同步', async () => {
      let data = await getData()
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (data.cloudReady || (!data.cloudLoading && data.cloudError)) break
        await sleep(1000)
        data = await getData()
      }
      assert.equal(data.cloudReady, true, 'cloudReady=false：' + (data.cloudError || '仍在连接'))
      assert.ok(data.nickname)
      return '昵称=' + data.nickname
    })

    await step('每日挑战：拿到服务端日期/种子并进入棋盘', async () => {
      await call('onDailyTap')
      await sleep(3500)
      assert.equal(await getPath(), 'pages/klotski/game/index')
      let data = await getData()
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(data.dailyKey)) break
        await sleep(1000)
        data = await getData()
      }
      assert.equal(data.daily, true)
      assert.match(data.dailyKey, /^\d{4}-\d{2}-\d{2}$/)
      const internal = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        return { board: page.board, seed: page.seed, directions: page.directions }
      })
      assert.equal(internal.board.length, 9)
      assert.equal(internal.directions.length, 0)
      assert.ok(internal.seed >= 0)
      return '日期=' + data.dailyKey
    })

    await step('每日挑战：BFS 求解并提交云端', async () => {
      const internal = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        return { board: page.board, seed: page.seed, directions: page.directions.slice() }
      })
      const solution = solve3(internal.board)
      // 模拟真实游玩 26 秒，避免自动化瞬间完成导致 timeMs=0
      await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        page.startedAt = Date.now() - 5000
        page.setData({ elapsedText: '00:05' })
        return true
      })
      const final = await invoke(function (directions) {
        const page = getCurrentPages().slice(-1)[0]
        for (const direction of directions) page.onSwipeMove(direction)
        return { moves: page.moves, status: page.data.status, directions: page.directions.length }
      }, solution)
      await sleep(2500)
      const data = await getData()
      assert.equal(final.status, 'won')
      assert.equal(final.moves, solution.length)
      assert.match(data.cloudMessage, /上传|最佳|第|云端/)
      assert.ok(!/失败|未连接|未配置/.test(data.cloudMessage), data.cloudMessage)
      return '解=' + solution.length + ' 步，' + data.cloudMessage
    })

    await step('排行榜：总榜能看到自己', async () => {
      await miniProgram.navigateTo('/pages/leaderboard/index?game=klotski3&period=all')
      await sleep(3000)
      assert.equal(await getPath(), 'pages/leaderboard/index')
      const data = await getData()
      assert.equal(data.loading, false)
      assert.equal(data.error, '')
      assert.ok(Array.isArray(data.list))
      assert.ok(data.list.some((row) => row.isMe), '总榜应包含当前用户')
      assert.ok(data.myRank >= 1)
      return '我的排名=' + data.myRank + '，榜单=' + data.list.length + ' 条'
    })

    await step('2048 成绩上传与总榜', async () => {
      await miniProgram.navigateTo('/pages/index/index')
      await sleep(2500)
      const run = make2048Run(20261026)
      await invoke(function (testRun) {
        const page = getCurrentPages().slice(-1)[0]
        page.daily = false
        page.seed = testRun.seed
        page.directions = testRun.directions.slice()
        page.gameState = {
          score: testRun.score,
          moves: testRun.moves,
          startedAt: Date.now() - 120000,
          status: 'over',
        }
        page.lastCloudScore = 0
        page.submitCloudScore()
        return true
      }, run)
      await sleep(2500)
      const game = await getData()
      assert.match(game.cloudSavedText, /云端|同步|最佳/)
      await miniProgram.navigateTo('/pages/leaderboard/index?game=2048&period=all')
      await sleep(3000)
      const data = await getData()
      assert.equal(data.loading, false)
      assert.equal(data.error, '')
      assert.ok(data.list.some((row) => row.isMe), '2048 总榜应包含当前用户')
      return '2048 总榜包含当前用户，排名=' + data.myRank
    })

    await step('2048 每日挑战：固定种子、重放提交、今日榜', async () => {
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(2500)
      await invoke(function () {
        getCurrentPages().slice(-1)[0].onDailyGameTap({ currentTarget: { dataset: { game: '2048' } } })
        return true
      })
      const data = await waitForData(function (current) {
        return current.daily === true && /^\d{4}-\d{2}-\d{2}$/.test(current.dailyKey || '')
      })
      const internal = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        return { seed: page.seed, dailyKey: page.dailyKey }
      })
      assert.ok(internal.seed > 0)
      const run = make2048Run(internal.seed)
      await invoke(function (testRun) {
        const page = getCurrentPages().slice(-1)[0]
        page.gameState = {
          score: testRun.score,
          moves: testRun.moves,
          startedAt: Date.now() - 120000,
          status: 'over',
        }
        page.seed = testRun.seed
        page.directions = testRun.directions.slice()
        page.daily = true
        page.dailyKey = testRun.dailyKey
        page.lastCloudScore = 0
        page.submitCloudScore()
        return true
      }, Object.assign({ dailyKey: internal.dailyKey }, run))
      await sleep(2500)
      const after = await getData()
      assert.match(after.cloudSavedText, /云端|同步|最佳/)
      await miniProgram.navigateTo('/pages/leaderboard/index?game=2048&period=all')
      await sleep(3000)
      const board = await getData()
      assert.equal(board.error, '')
      assert.ok(board.list.some((row) => row.isMe), '2048 今日榜应包含当前用户')
      return '2048 每日挑战提交成功，今日榜排名=' + board.myRank
    })

    await step('4×4 每日挑战：服务端种子进入 4×4', async () => {
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(2500)
      await invoke(function () {
        getCurrentPages().slice(-1)[0].onDailyGameTap({ currentTarget: { dataset: { game: 'klotski4' } } })
        return true
      })
      const data = await waitForData(function (current) {
        return current.daily === true && current.size === 4 && current.tiles && current.tiles.length === 15
      })
      assert.equal(data.cells.length, 16)
      assert.match(data.dailyKey, /^\d{4}-\d{2}-\d{2}$/)
      return '4×4 每日挑战棋盘正常'
    })

    await step('成就：完成挑战后首页成就数增加', async () => {
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(3000)
      const data = await getData()
      assert.ok(data.achievementCount >= 2, '应至少解锁 3×3 + 每日挑战成就')
      assert.equal(data.achievementTotal, 6)
      return '已解锁 ' + data.achievementCount + '/' + data.achievementTotal
    })

    await step('云端存档：退出保存、首页继续、恢复步数', async () => {
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(2500)
      await miniProgram.navigateTo('/pages/klotski/game/index?size=3')
      await sleep(3000)
      await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        const directions = ['left', 'right', 'up', 'down']
        for (const direction of directions) {
          page.onSwipeMove(direction)
          if (page.moves > 0) break
        }
        return true
      })
      await sleep(700)
      await invoke(function () {
        getCurrentPages().slice(-1)[0].saveCurrentState()
        return true
      })
      await sleep(1800)
      await miniProgram.reLaunch('/pages/home/index')
      const home = await waitForData(function (current) {
        return current.savedGame && /3×3/.test(current.savedGameText || '')
      })
      await invoke(function () {
        getCurrentPages().slice(-1)[0].onResumeTap()
        return true
      })
      const resumed = await waitForData(function (current) {
        return current.status === 'playing' && current.moves >= 1
      })
      return '已保存并在新页面恢复到 ' + resumed.moves + ' 步'
    })

    await step('2048 云端存档：退出保存、继续后恢复分数/步数', async () => {
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(2500)
      await miniProgram.navigateTo('/pages/index/index')
      await sleep(3000)
      await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        const directions = ['left', 'right', 'up', 'down']
        for (const direction of directions) {
          page.move(direction)
          if (page.gameState && page.gameState.moves > 0) break
        }
        return true
      })
      await sleep(1200)
      const before = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        page.saveCurrentState()
        return { score: page.gameState.score, moves: page.gameState.moves }
      })
      await sleep(1800)
      const saveDebug = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        return {
          debug: page.saveDebug,
          text: page.data.cloudSavedText,
          moves: page.gameState && page.gameState.moves,
          board: page.gameState && page.gameState.board,
          seed: page.seed,
          directions: page.directions,
        }
      })
      assert.equal(saveDebug.debug && saveDebug.debug.result, 'ok', JSON.stringify(saveDebug))
      await miniProgram.reLaunch('/pages/home/index')
      const home = await waitForData(function (current) {
        return current.savedGame && current.savedGame.game === '2048'
      })
      await invoke(function () {
        getCurrentPages().slice(-1)[0].onResumeTap()
        return true
      })
      const resumed = await waitForData(function (current) {
        return current.status === 'playing' && current.cloudSavedText === '已恢复上局进度'
      })
      const resumedState = await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        return { moves: page.gameState.moves, score: page.gameState.score }
      })
      assert.equal(resumedState.moves, before.moves)
      assert.equal(resumedState.score, before.score)
      return '2048 恢复到 ' + before.moves + ' 步 / ' + before.score + ' 分'
    })

    await step('我的资料：自定义昵称保存并首页回显', async () => {
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(2500)
      await miniProgram.navigateTo('/pages/profile/index')
      await sleep(2500)
      assert.equal(await getPath(), 'pages/profile/index')
      const before = await getData()
      assert.ok(Array.isArray(before.achievements))
      await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        page.setData({ nickname: '测试玩家二号', initial: '测' })
        page.onSave()
        return true
      })
      await sleep(2500)
      const saved = await getData()
      assert.equal(saved.nickname, '测试玩家二号')
      assert.equal(saved.nicknameSet, true)
      await miniProgram.reLaunch('/pages/home/index')
      await sleep(3000)
      const home = await getData()
      assert.equal(home.nickname, '测试玩家二号')
      assert.equal(home.nicknameSet, true)
      return '昵称已保存并在首页回显'
    })

    await step('Console / 异常检查', async () => {
      assert.deepEqual(errors, [])
      return '无异常、无 error 日志'
    })

    const passed = results.filter((item) => item.ok).length
    console.log('\n========== 云开发在线验证：' + passed + '/' + results.length + ' 通过 ==========')
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
