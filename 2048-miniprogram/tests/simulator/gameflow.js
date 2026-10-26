/**
 * 页面级胜负流程验证（微信开发者工具模拟器 + miniprogram-automator）。
 *
 * 说明：通过 automator 向页面注入测试局面，然后调用页面真实的
 * move / onContinueTap / onRestartOverlayTap 等方法，验证：
 * 胜利弹窗、继续游戏、不重复弹窗、游戏结束、结束后拒绝移动、重开保留最高分。
 * 注入仅发生在测试运行时，不会写入交付代码。
 *
 * 运行（需先开启开发者工具服务端口与 automation）：
 *   NODE_PATH=<automator node_modules> node tests/simulator/gameflow.js
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

const EMPTY_ROW = [0, 0, 0, 0]

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
  const getInternal = () =>
    invoke(function () {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      return {
        status: page.gameState.status,
        winAcknowledged: page.gameState.winAcknowledged,
        score: page.gameState.score,
        best: page.gameState.best,
        moves: page.gameState.moves,
      }
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
  const setGame = (board, options) =>
    invoke(
      function (testBoard, testOptions) {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page.animationTimer) clearTimeout(page.animationTimer)
        if (page.effectTimer) clearTimeout(page.effectTimer)
        page.animationTimer = null
        page.effectTimer = null
        page.animating = false
        page.pendingDirection = null
        page.pendingMove = null
        page.overRecorded = false

        const boardCopy = testBoard.map(function (row) {
          return row.slice()
        })
        let maxTile = 0
        boardCopy.forEach(function (row) {
          row.forEach(function (value) {
            if (value > maxTile) maxTile = value
          })
        })
        page.gameState = {
          board: boardCopy,
          score: testOptions.score || 0,
          best: testOptions.best || 0,
          status: 'playing',
          winAcknowledged: Boolean(testOptions.winAcknowledged),
          moves: testOptions.moves || 0,
          maxTile,
          startedAt: Date.now(),
          lastSpawned: [],
        }
        let id = 1
        page.tiles = []
        boardCopy.forEach(function (row, rowIndex) {
          row.forEach(function (value, colIndex) {
            if (value) {
              page.tiles.push({
                id: id++,
                value,
                row: rowIndex,
                col: colIndex,
                isNew: false,
                merged: false,
              })
            }
          })
        })
        page.setData({
          tiles: page.toViewTiles(page.tiles),
          score: page.gameState.score,
          best: page.gameState.best,
          status: 'playing',
          winMessage: '',
          overMessage: '',
          modal: '',
          shake: false,
        })
        return true
      },
      board,
      options || {},
    )

  try {
    await step('准备：清空存储并重载页面', async () => {
      await miniProgram.callWxMethod('clearStorageSync')
      await miniProgram.callWxMethod('setStorageSync', 'g2048.onboarding.skipped', true)
      await relaunch()
      const data = await getData()
      assert.equal(data.status, 'playing')
      assert.equal(data.tiles.length, 2)
      return '通过'
    })

    await step('胜利流程：注入 1024+1024，move 后进入 won 并显示弹窗', async () => {
      await setGame(
        [
          [1024, 1024, 0, 0],
          EMPTY_ROW.slice(),
          EMPTY_ROW.slice(),
          EMPTY_ROW.slice(),
        ],
        { score: 0, best: 0 },
      )
      await call('move', 'left')
      await sleep(800)
      const data = await getData()
      const internal = await getInternal()
      assert.equal(data.status, 'won')
      assert.match(data.winMessage, /2048/)
      assert.equal(internal.winAcknowledged, false)
      assert.ok(internal.score >= 2048)
      assert.ok(internal.best >= 2048)
      return 'status=won, score=' + internal.score
    })

    await step('继续游戏：保留棋盘/分数，winAcknowledged=true', async () => {
      await call('onContinueTap')
      await sleep(400)
      const data = await getData()
      const internal = await getInternal()
      assert.equal(data.status, 'playing')
      assert.equal(internal.winAcknowledged, true)
      assert.ok(internal.score >= 2048)
      return '继续后 status=playing，分数保留'
    })

    await step('不重复弹窗：继续后再合成 2048 不再进入 won', async () => {
      await setGame(
        [
          [2048, 1024, 1024, 0],
          EMPTY_ROW.slice(),
          EMPTY_ROW.slice(),
          EMPTY_ROW.slice(),
        ],
        { score: 4048, best: 4048, winAcknowledged: true },
      )
      await call('move', 'left')
      await sleep(800)
      const data = await getData()
      const internal = await getInternal()
      assert.equal(data.status, 'playing')
      assert.equal(internal.winAcknowledged, true)
      assert.equal(
        data.tiles.filter(function (tile) {
          return tile.value === 2048
        }).length,
        2,
      )
      return '合成第二个 2048 后仍为 playing'
    })

    await step('结束流程：满盘无可合并时进入 over、记录战绩、拒绝后续移动', async () => {
      const nearOver = [
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 8],
        [4, 2, 4, 4],
      ]
      await setGame(nearOver, { score: 1000, best: 2048, moves: 10 })
      await call('move', 'left')
      await sleep(800)
      const data = await getData()
      const internal = await getInternal()
      assert.equal(data.status, 'over')
      assert.match(data.overMessage, /本局得分/)
      assert.equal(internal.score, 1008)
      assert.ok(data.history.length >= 1)
      assert.equal(data.history[0].score, 1008)

      const movesBefore = internal.moves
      await call('move', 'left')
      await sleep(400)
      const after = await getInternal()
      assert.equal(after.status, 'over')
      assert.equal(after.moves, movesBefore)
      return 'status=over, score=1008, 战绩 ' + data.history.length + ' 条'
    })

    await step('结束弹窗重开：重置本局并保留最高分', async () => {
      await call('onRestartOverlayTap')
      await sleep(800)
      const data = await getData()
      const internal = await getInternal()
      assert.equal(internal.status, 'playing')
      assert.equal(data.tiles.length, 2)
      assert.equal(data.score, 0)
      assert.ok(data.best >= 2048)
      return '重开后 best=' + data.best
    })

    await step('Console / 异常检查', async () => {
      assert.deepEqual(exceptions, [], '页面异常：\n' + exceptions.join('\n'))
      assert.deepEqual(consoleErrors, [], '控制台错误：\n' + consoleErrors.join('\n'))
      return '无异常、无 error 日志'
    })

    const passed = results.filter((r) => r.ok).length
    console.log('\n========== 小程序页面级胜负流程：' + passed + '/' + results.length + ' 通过 ==========')
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
