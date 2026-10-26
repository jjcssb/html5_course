/**
 * 数字华容道模拟器验证（微信开发者工具 + miniprogram-automator）。
 *
 * 覆盖：首页导航 → 3×3/4×4 选择 → 棋盘渲染 → 滑动移动/计时 →
 *       一步胜利 → 最佳记录 → 重开确认 → 换尺寸。
 *
 * 前提：开启开发者工具服务端口并执行 cli auto；
 *      项目根目录 npm install --no-save miniprogram-automator
 * 运行：node tests/simulator/klotski.js
 */
const assert = require('node:assert/strict')
const automator = require('miniprogram-automator')
const { moveBySwipe, createSolvedBoard, isValidBoard } = require('../../utils/klotski')

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

function swipeEvent(direction) {
  const start = { clientX: 150, clientY: 150 }
  const delta = {
    left: { clientX: 30, clientY: 150 },
    right: { clientX: 270, clientY: 150 },
    up: { clientX: 150, clientY: 30 },
    down: { clientX: 150, clientY: 270 },
  }[direction]
  return { start, end: delta }
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
  const getInternal = () =>
    invoke(function () {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      return {
        board: page.board,
        moves: page.moves,
        startedAt: page.startedAt,
        status: page.data.status,
      }
    })
  const getPath = () =>
    invoke(function () {
      const pages = getCurrentPages()
      return pages[pages.length - 1].route || pages[pages.length - 1].path || ''
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
  const relaunch = async (url) => {
    await miniProgram.reLaunch(url)
    await sleep(1500)
  }
  const setBoard = (board) =>
    invoke(
      function (testBoard) {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        page.stopTimer()
        page.startedAt = null
        page.elapsedMs = 0
        page.moves = 0
        page.board = testBoard.slice()
        page.setData({
          tiles: page.toViewTiles(page.board),
          moves: 0,
          elapsedText: '00:00',
          status: 'playing',
          modal: '',
          winMessage: '',
          movedValue: 0,
          shake: false,
        })
        return true
      },
      board,
    )

  try {
    await step('首页：显示 2048 / 数字华容道两个入口', async () => {
      await miniProgram.callWxMethod('clearStorageSync')
      await miniProgram.callWxMethod('setStorageSync', 'g2048.onboarding.skipped', true)
      await relaunch('/pages/home/index')
      const path = await getPath()
      assert.equal(path, 'pages/home/index')
      const data = await getData()
      assert.equal(data.preview2048.length, 16)
      assert.equal(data.previewKlotski.length, 9)
      return '首页渲染正常'
    })

    await step('首页点击数字华容道 → 尺寸选择页', async () => {
      await call('onKlotskiTap')
      await sleep(2500)
      assert.equal(await getPath(), 'pages/klotski/index')
      const data = await getData()
      assert.equal(data.sizes.length, 2)
      assert.equal(data.sizes[0].size, 3)
      assert.equal(data.sizes[1].size, 4)
      return '3×3 / 4×4 两个选项'
    })

    await step('选择 3×3：进入棋盘，9 格 8 个数字', async () => {
      await call('onSelectSize', { currentTarget: { dataset: { size: 3 } } })
      await sleep(2500)
      const path = await getPath()
      assert.ok(path.indexOf('pages/klotski/game/index') === 0, '实际路径：' + path)
      const data = await getData()
      assert.equal(data.size, 3)
      assert.equal(data.cells.length, 9)
      assert.equal(data.tiles.length, 8)
      assert.equal(data.maxNumber, 8)
      assert.equal(data.status, 'playing')
      return '棋盘 9 格 / 8 个数字'
    })

    await step('AI 提示：3×3 能给出建议方向', async () => {
      await call('onHintTap')
      await sleep(1800)
      const data = await getData()
      assert.match(data.hintText, /建议/)
      assert.ok(data.hintSteps > 0)
      return data.hintText
    })

    await step('滑动移动：合法方向的触摸滑动会移动数字并开始计时', async () => {
      const internal = await getInternal()
      assert.equal(isValidBoard(internal.board), true)
      let direction = null
      for (const candidate of ['left', 'right', 'up', 'down']) {
        if (moveBySwipe(internal.board, candidate).moved) {
          direction = candidate
          break
        }
      }
      assert.ok(direction, '随机棋盘至少有合法滑动方向')
      const swipe = swipeEvent(direction)
      await invoke(
        function (start, end) {
          const pages = getCurrentPages()
          const page = pages[pages.length - 1]
          page.onTouchStart({ touches: [{ clientX: start.clientX, clientY: start.clientY }] })
          page.onTouchEnd({ changedTouches: [{ clientX: end.clientX, clientY: end.clientY }] })
          return true
        },
        swipe.start,
        swipe.end,
      )
      await sleep(1100)
      const after = await getInternal()
      const data = await getData()
      assert.equal(after.moves, 1)
      assert.equal(data.moves, 1)
      assert.notEqual(data.elapsedText, '00:00')
      assert.equal(after.status, 'playing')
      return '方向=' + direction + '，步数=1，计时已启动'
    })

    await step('3×3 胜利：注入一步可完成局面，滑动后进入 won 并保存最佳记录', async () => {
      const nearSolved = [1, 2, 3, 4, 5, 6, 7, 0, 8]
      await setBoard(nearSolved)
      await call('onSwipeMove', 'left')
      await sleep(800)
      const data = await getData()
      const internal = await getInternal()
      assert.equal(internal.status, 'won')
      assert.equal(data.moves, 1)
      assert.match(data.winMessage, /用时.*步/)
      const raw = await miniProgram.callWxMethod('getStorageSync', 'g2048.klotski.best.3.v1')
      assert.ok(raw, '最佳记录应写入 storage')
      const record = JSON.parse(raw)
      assert.equal(record.moves, 1)
      assert.ok(record.timeMs >= 0)
      return 'won，最佳=' + record.moves + ' 步'
    })

    await step('胜利后“再来一局”：重置棋盘、步数与计时', async () => {
      await call('onWinAgain')
      await sleep(700)
      const data = await getData()
      assert.equal(data.status, 'playing')
      assert.equal(data.moves, 0)
      assert.equal(data.tiles.length, 8)
      assert.equal(data.elapsedText, '00:00')
      return '已重置'
    })

    await step('重新打乱确认：取消保留进度，确认后重置', async () => {
      await invoke(function () {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        page.moves = 3
        page.setData({ moves: 3 })
        return true
      })
      await call('onRestartTap')
      await sleep(400)
      assert.equal((await getData()).modal, 'restart')
      await call('onModalCancel')
      await sleep(300)
      assert.equal((await getData()).moves, 3)
      assert.equal((await getData()).modal, '')

      await call('onRestartTap')
      await sleep(300)
      await call('onModalConfirm')
      await sleep(700)
      assert.equal((await getData()).moves, 0)
      return '取消保持 3 步，确认后 0 步'
    })

    await step('换尺寸：有进度时先确认，取消保留进度', async () => {
      await invoke(function () {
        const page = getCurrentPages().slice(-1)[0]
        page.moves = 2
        page.setData({ moves: 2 })
        return true
      })
      await call('onChangeSizeTap')
      await sleep(400)
      assert.equal((await getData()).modal, 'changeSize')
      await call('onModalCancel')
      await sleep(300)
      assert.equal((await getData()).modal, '')
      assert.equal((await getData()).moves, 2)
      return '确认框与取消逻辑正常'
    })

    await step('打开选择页并选择 4×4（自动化环境用 navigateTo 进入）', async () => {
      // 说明：该版本开发者工具的自动化通道里 navigateBack/redirectTo/reLaunch
      // 不会改变页面栈，因此测试用 navigateTo 进入选择页；真实用户仍走 wx.navigateBack。
      await miniProgram.navigateTo('/pages/klotski/index')
      await sleep(2000)
      assert.equal(await getPath(), 'pages/klotski/index')
      await call('onSelectSize', { currentTarget: { dataset: { size: 4 } } })
      await sleep(4000)
      const data = await getData()
      const path = await getPath()
      assert.ok(path.indexOf('pages/klotski/game/index') === 0)
      assert.equal(data.size, 4)
      assert.equal(data.cells.length, 16)
      assert.equal(data.tiles.length, 15)
      return '4×4：16 格 / 15 个数字'
    })

    await step('4×4 AI 提示：保证解可用', async () => {
      await call('onHintTap')
      await sleep(1800)
      const data = await getData()
      assert.match(data.hintText, /保证解/)
      assert.ok(data.hintSteps > 0)
      return data.hintText
    })

    await step('4×4 胜利：注入一步可完成局面并保存独立最佳记录', async () => {
      const nearSolved = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]
      await setBoard(nearSolved)
      await call('onSwipeMove', 'left')
      await sleep(800)
      const data = await getData()
      assert.equal(data.status, 'won')
      const raw = await miniProgram.callWxMethod('getStorageSync', 'g2048.klotski.best.4.v1')
      assert.ok(raw)
      assert.equal(JSON.parse(raw).moves, 1)
      return '4×4 胜利，最佳记录独立保存'
    })

    await step('Console / 异常检查', async () => {
      assert.deepEqual(exceptions, [], '页面异常：\n' + exceptions.join('\n'))
      assert.deepEqual(consoleErrors, [], '控制台错误：\n' + consoleErrors.join('\n'))
      return '无异常、无 error 日志'
    })

    const passed = results.filter((item) => item.ok).length
    console.log('\n========== 数字华容道模拟器验证：' + passed + '/' + results.length + ' 通过 ==========')
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
