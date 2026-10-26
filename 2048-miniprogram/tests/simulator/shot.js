/**
 * 逐场景截图脚本（需微信开发者工具自动化端口 + miniprogram-automator）。
 *
 * 已知限制：App.captureScreenshot 每次页面加载只能成功一次，
 * 因此每个场景单独启动一个进程、只截一张图。
 *
 * 用法：node tests/simulator/shot.js <scenario>
 * 场景：initial | swipe | restart-confirm | dark | retro | history | win | over
 *
 * 截图输出到项目 screenshots/ 目录。
 */
const automator = require('miniprogram-automator')
const path = require('node:path')
const fs = require('node:fs')
const { moveBySwipe, isSolved, createSolvedBoard } = require('../../utils/klotski')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SHOTS = path.join(PROJECT_ROOT, 'screenshots')
const WS = process.env.AUTOMATOR_WS || 'ws://127.0.0.1:9421'
const scenario = process.argv[2]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((resolve, reject) => setTimeout(() => reject(new Error('TIMEOUT: ' + label)), ms))])

/** 3×3 BFS，用于真实完成每日挑战后截图。 */
function solve3(board) {
  const goal = createSolvedBoard(3).join(',')
  const start = board.join(',')
  if (start === goal) return []
  const queue = [board.slice()]
  const seen = new Set([start])
  const parents = new Map()
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    const currentKey = current.join(',')
    for (const direction of ['left', 'right', 'up', 'down']) {
      const result = moveBySwipe(current, direction)
      if (!result.moved) continue
      const key = result.board.join(',')
      if (seen.has(key)) continue
      parents.set(key, { from: currentKey, direction })
      if (key === goal) {
        const path = []
        let cursor = goal
        while (cursor !== start) {
          const node = parents.get(cursor)
          path.push(node.direction)
          cursor = node.from
        }
        return path.reverse()
      }
      seen.add(key)
      queue.push(result.board)
    }
  }
  throw new Error('3×3 无解')
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const miniProgram = await withTimeout(automator.connect({ wsEndpoint: WS }), 15000, 'connect')
  const invoke = (fn, ...args) => withTimeout(miniProgram.evaluate(fn, ...args), 12000, 'evaluate')

  async function relaunch() {
    await miniProgram.reLaunch('/pages/index/index?standalone=1')
    await sleep(1400)
  }

  async function openHome() {
    await miniProgram.reLaunch('/pages/home/index')
    await sleep(1600)
  }

  async function openKlotski(size) {
    await openHome()
    await miniProgram.navigateTo('/pages/klotski/index')
    await sleep(2000)
    if (size) {
      await invoke(function (targetSize) {
        getCurrentPages().slice(-1)[0].onSelectSize({ currentTarget: { dataset: { size: targetSize } } })
        return true
      }, size)
      await sleep(3500)
    }
  }

  async function shoot(file) {
    try {
      await withTimeout(miniProgram.screenshot({ path: path.join(SHOTS, file) }), 20000, 'screenshot')
    } catch (error) {
      await relaunch()
      await withTimeout(miniProgram.screenshot({ path: path.join(SHOTS, file) }), 20000, 'screenshot-retry')
    }
    console.log('SHOT ' + file)
  }

  if (scenario === 'initial') {
    await miniProgram.callWxMethod('clearStorageSync')
    await relaunch()
    await shoot('01-initial.png')
  } else if (scenario === 'swipe') {
    await relaunch()
    await invoke(function () {
      const page = getCurrentPages()[0]
      page.onTouchStart({ touches: [{ clientX: 150, clientY: 150 }] })
      page.onTouchEnd({ changedTouches: [{ clientX: 30, clientY: 150 }] })
      return true
    })
    await sleep(700)
    await shoot('02-after-swipe.png')
  } else if (scenario === 'restart-confirm') {
    await relaunch()
    await invoke(function () {
      getCurrentPages()[0].onRestartTap()
      return true
    })
    await sleep(600)
    await shoot('03-restart-confirm.png')
  } else if (scenario === 'dark' || scenario === 'retro') {
    await miniProgram.callWxMethod('setStorageSync', 'g2048.theme.v1', scenario)
    await relaunch()
    await shoot(scenario === 'dark' ? '04-theme-dark.png' : '05-theme-retro.png')
  } else if (scenario === 'history') {
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
    await invoke(function () {
      getCurrentPages()[0].onToggleHistory()
      return true
    })
    await sleep(600)
    await shoot('06-history.png')
  } else if (scenario === 'win') {
    await relaunch()
    await invoke(function () {
      getCurrentPages()[0].setData({
        status: 'won',
        score: 4048,
        best: 4048,
        winMessage: '成功合成 2048！当前得分 4048 分，继续游戏可以挑战更大的数字。',
      })
      return true
    })
    await sleep(700)
    await shoot('07-win-dialog.png')
  } else if (scenario === 'over') {
    await relaunch()
    await invoke(function () {
      getCurrentPages()[0].setData({
        status: 'over',
        score: 1008,
        best: 1088,
        overMessage: '本局得分 1008 分，最大数字 128。',
      })
      return true
    })
    await sleep(700)
    await shoot('08-gameover-dialog.png')
  } else if (scenario === 'home') {
    await miniProgram.callWxMethod('clearStorageSync')
    await openHome()
    await sleep(2500)
    await shoot('09-home.png')
  } else if (scenario === 'klotski-size') {
    await miniProgram.callWxMethod('clearStorageSync')
    await openKlotski(null)
    await shoot('10-klotski-size.png')
  } else if (scenario === 'klotski-3') {
    await miniProgram.callWxMethod('clearStorageSync')
    await openKlotski(3)
    await shoot('11-klotski-3x3.png')
  } else if (scenario === 'klotski-4') {
    await miniProgram.callWxMethod('clearStorageSync')
    await openKlotski(4)
    await shoot('12-klotski-4x4.png')
  } else if (scenario === 'klotski-win') {
    // 每日挑战：服务端种子 → BFS 求解 → 真实提交，截图带云端排名
    await miniProgram.callWxMethod('clearStorageSync')
    await openHome()
    await miniProgram.navigateTo('/pages/klotski/game/index?size=3&daily=1')
    await sleep(3500)
    const board = await invoke(function () {
      return getCurrentPages().slice(-1)[0].board
    })
    const solution = solve3(board)
    await invoke(function () {
      const page = getCurrentPages().slice(-1)[0]
      page.stopTimer()
      page.startedAt = Date.now() - 26000
      page.setData({ elapsedText: '00:26' })
      return true
    })
    await invoke(function (directions) {
      const page = getCurrentPages().slice(-1)[0]
      for (const direction of directions) page.onSwipeMove(direction)
      return true
    }, solution)
    await sleep(2500)
    await shoot('13-klotski-win.png')
  } else if (scenario === 'leaderboard') {
    await openHome()
    await miniProgram.navigateTo('/pages/leaderboard/index?game=klotski3')
    await sleep(3000)
    await shoot('14-leaderboard.png')
  } else if (scenario === 'daily') {
    await miniProgram.callWxMethod('clearStorageSync')
    await openHome()
    await miniProgram.navigateTo('/pages/klotski/game/index?size=3&daily=1')
    await sleep(3500)
    await shoot('15-daily-challenge.png')
  } else if (scenario === 'klotski-hint') {
    await openKlotski(3)
    await invoke(function () {
      getCurrentPages().slice(-1)[0].onHintTap()
      return true
    })
    await sleep(2200)
    await shoot('16-klotski-hint.png')
  } else if (scenario === 'daily-4x4') {
    await openHome()
    await miniProgram.navigateTo('/pages/klotski/game/index?size=4&daily=1')
    await sleep(3500)
    await shoot('17-daily-4x4.png')
  } else if (scenario === 'profile') {
    await openHome()
    await miniProgram.navigateTo('/pages/profile/index')
    await sleep(3000)
    await shoot('18-profile.png')
  } else if (scenario === 'klotski-4x4-hint') {
    await openKlotski(4)
    await invoke(function () {
      getCurrentPages().slice(-1)[0].onHintTap()
      return true
    })
    await sleep(2200)
    await shoot('19-klotski-4x4-hint.png')
  } else if (scenario === 'home-resume') {
    await openHome()
    await sleep(2500)
    await shoot('20-home-resume.png')
  } else if (scenario === 'onboarding') {
    await miniProgram.reLaunch('/pages/onboarding/index')
    await sleep(3000)
    await shoot('21-onboarding.png')
  } else {
    throw new Error('未知场景：' + scenario)
  }

  await withTimeout(miniProgram.disconnect(), 5000, 'disconnect')
  setTimeout(() => process.exit(0), 300)
}

main().catch((error) => {
  console.error('截图失败：', error && (error.message || error))
  process.exit(1)
})
