/**
 * 数字华容道游戏页。
 * 交互：滑动方向 = 数字移动方向（朝空格方向推），每次只移动一个数字。
 * 支持普通模式与每日挑战（每日同一棋盘种子）。
 */
const klotski = require('../../../utils/klotski')
const storageModule = require('../../../utils/storage')
const { createKlotskiStorage } = require('../../../utils/klotski-storage')
const gesture = require('../../../utils/gesture')
const themeModule = require('../../../utils/theme')
const cloud = require('../../../utils/cloud')
const cloudUtils = require('../../../utils/cloud-utils')
const { createSeededRandom } = require('../../../utils/random')
const klotskiSolver = require('../../../utils/klotski-solver')

const GAP_PERCENT = 2.4
const SHAKE_MS = 220
const MOVED_MS = 180

function createSeed() {
  return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

Page({
  data: {
    theme: 'light',
    size: 3,
    maxNumber: 8,
    cells: [],
    tiles: [],
    moves: 0,
    elapsedText: '00:00',
    bestText: '暂无记录',
    status: 'playing',
    shake: false,
    movedValue: 0,
    modal: '',
    modalTitle: '',
    modalMessage: '',
    modalPrimary: '',
    winMessage: '',
    daily: false,
    dailyKey: '',
    cloudMessage: '',
    cloudRank: 0,
    hintText: '',
    hintSteps: 0,
    hintBusy: false,
    demoRunning: false,
  },

  onLoad(query) {
    const requested = Number(query && query.size)
    this.size = requested === 4 ? 4 : 3
    this.daily = Boolean(query && (String(query.daily) === '1' || query.daily === 'true'))
    this.resume = Boolean(query && (String(query.resume) === '1' || query.resume === 'true'))
    this.dailyKey = (query && query.date) || ''
    this.dailySeed = 0
    this.dailyOfflineMessage = ''
    this.seed = 0
    this.directions = []

    this.storage = storageModule.createWxStorage()
    this.klotskiStorage = createKlotskiStorage()
    this.touch = gesture.createTouchTracker({
      minDistance: 20,
      onSwipe: (direction) => this.onSwipeMove(direction),
    })
    this.board = null
    this.moves = 0
    this.lastSavedMoves = 0
    this.startedAt = null
    this.elapsedMs = 0
    this.timer = null
    this.movedTimer = null
    this.shakeTimer = null
    this.hintTimer = null
    this.hintSolution = null
    this.shuffleSolution = null
    this.demoTimer = null

    const self = this
    this.setData(
      {
        size: this.size,
        maxNumber: this.size * this.size - 1,
        cells: this.buildCells(this.size),
        daily: this.daily,
        dailyKey: this.dailyKey,
      },
      function afterReady() {
        self.applyTheme()
        self.ensureOnboarding()
        if (self.resume) self.resumeSavedGame()
        else if (self.daily) self.initDaily()
        else self.startNewGame()
      },
    )
  },

  onShow() {
    if (this.storage) this.applyTheme()
    // 从后台/其他页面回来时恢复计时（onHide 会停止 interval）
    if (this.data.status === 'playing' && this.startedAt && !this.timer) {
      this.startTimer()
    }
  },

  ensureOnboarding() {
    cloud
      .ensureLogin()
      .then(function onLogin(player) {
        if (player.profileCompleted) return
        let skipped = false
        try {
          skipped = Boolean(wx.getStorageSync('g2048.onboarding.skipped'))
        } catch (error) {
          skipped = false
        }
        if (!skipped) wx.reLaunch({ url: '/pages/onboarding/index' })
      })
      .catch(function ignore() {})
  },

  onHide() {
    this.saveCurrentState()
    this.stopTimer()
    if (this.touch) this.touch.touchCancel()
  },

  onUnload() {
    this.saveCurrentState()
    this.stopTimer()
    if (this.movedTimer) clearTimeout(this.movedTimer)
    if (this.shakeTimer) clearTimeout(this.shakeTimer)
    if (this.hintTimer) clearTimeout(this.hintTimer)
    this.stopDemo()
    if (this.touch) this.touch.reset()
  },

  // ---------- 布局与视图数据 ----------

  buildCells(size) {
    const cell = (100 - (size - 1) * GAP_PERCENT) / size
    const step = cell + GAP_PERCENT
    const cells = []
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        cells.push({
          id: 'cell-' + row + '-' + col,
          left: (col * step).toFixed(2) + '%',
          top: (row * step).toFixed(2) + '%',
          size: cell.toFixed(2) + '%',
        })
      }
    }
    return cells
  },

  toViewTiles(board) {
    const size = this.size
    const cell = (100 - (size - 1) * GAP_PERCENT) / size
    const step = cell + GAP_PERCENT
    const groupSize = Math.max(1, Math.ceil((size * size - 1) / 4))
    const tiles = []
    for (let value = 1; value < size * size; value += 1) {
      const index = board.indexOf(value)
      if (index === -1) continue
      const row = Math.floor(index / size)
      const col = index % size
      tiles.push({
        key: 'tile-' + value,
        value,
        left: (col * step).toFixed(2) + '%',
        top: (row * step).toFixed(2) + '%',
        size: cell.toFixed(2) + '%',
        groupClass: 'klotski-tile--g' + Math.min(4, Math.ceil(value / groupSize)),
      })
    }
    return tiles
  },

  // ---------- 每日挑战初始化 ----------

  initDaily() {
    const self = this
    this.setData({ cloudMessage: '正在准备今日挑战…' })
    cloud
      .getDaily()
      .then(function onDaily(info) {
        const game = 'klotski' + self.size
        const seed = info.games && info.games[game] != null ? info.games[game] : info.seed
        self.dailySeed = Number(seed) >>> 0
        self.dailyKey = info.dateKey
        self.dailyOfflineMessage = ''
        self.setData({ dailyKey: info.dateKey, cloudMessage: '' })
        self.startNewGame()
      })
      .catch(function onLocalDaily() {
        const info = cloudUtils.getLocalDailyInfo(null, 'klotski' + self.size)
        self.dailySeed = info.seed
        self.dailyKey = info.dateKey
        self.dailyOfflineMessage = '云端未连接，今日挑战为本地模式'
        self.setData({
          dailyKey: info.dateKey,
          cloudMessage: self.dailyOfflineMessage,
        })
        self.startNewGame()
      })
  },

  // ---------- 云端存档 ----------

  resumeSavedGame() {
    const self = this
    cloud
      .loadState()
      .then(function onLoaded(saved) {
        if (!saved || String(saved.game) !== 'klotski' + self.size) {
          return self.resumeFailed()
        }
        if (saved.daily) {
          const info = cloudUtils.getLocalDailyInfo(null, 'klotski' + self.size)
          if (saved.dailyKey && saved.dailyKey !== info.dateKey) {
            self.daily = true
            self.dailyKey = info.dateKey
            self.dailySeed = info.seed
            return self.resumeFailed()
          }
        }
        if (
          !Array.isArray(saved.board) ||
          saved.board.length !== self.size * self.size ||
          !klotski.isValidBoard(saved.board) ||
          !klotski.isSolvable(saved.board) ||
          !Array.isArray(saved.directions) ||
          !Number.isInteger(Number(saved.moves))
        ) {
          return self.resumeFailed()
        }
        self.applySavedState(saved)
      })
      .catch(function onError() {
        self.resumeFailed()
      })
  },

  resumeFailed() {
    this.clearSavedState()
    if (this.daily) this.initDaily()
    else this.startNewGame()
  },

  applySavedState(saved) {
    const elapsedMs = Math.max(0, Number(saved.elapsedMs) || 0)
    this.seed = Number(saved.seed) >>> 0
    this.daily = Boolean(saved.daily)
    this.dailyKey = saved.dailyKey || this.dailyKey
    this.dailySeed = this.daily ? this.seed : 0
    this.board = saved.board.slice()
    this.directions = saved.directions.slice()
    this.moves = Number(saved.moves)
    this.lastSavedMoves = this.moves
    // startedAt 已经回退到“本局开始时刻”，elapsedMs 不能再重复计入
    this.elapsedMs = 0
    this.startedAt = Date.now() - elapsedMs
    this.shuffleSolution = klotski.shuffleBoardWithPath(
      this.size,
      createSeededRandom(this.seed),
      this.size === 3 ? 200 : 500,
    ).solution
    this.clearHint()
    this.setData({
      tiles: this.toViewTiles(this.board),
      moves: this.moves,
      elapsedText: klotski.formatDuration(elapsedMs),
      status: 'playing',
      modal: '',
      winMessage: '',
      daily: this.daily,
      dailyKey: this.dailyKey,
      cloudMessage: this.daily ? '已恢复今日挑战进度' : '已恢复上局进度',
    })
    if (this.daily) {
      wx.setNavigationBarTitle({ title: '每日挑战 · ' + this.size + '×' + this.size, fail() {} })
    }
    this.startTimer()
  },

  saveCurrentState() {
    if (this.savingState) return
    if (this.data.status !== 'playing' || !this.board || this.moves < 1) return
    if (this.moves <= (this.lastSavedMoves || 0)) return
    const elapsedMs =
      Math.max(0, this.elapsedMs || 0) +
      (this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0)
    this.lastSavedMoves = this.moves
    this.savingState = true
    cloud
      .saveState({
        game: 'klotski' + this.size,
        size: this.size,
        seed: this.seed,
        board: this.board.slice(),
        directions: this.directions.slice(),
        moves: this.moves,
        elapsedMs,
        daily: this.daily,
        dailyKey: this.dailyKey,
        score: 0,
      })
      .catch(function onSaveError() {
        this.lastSavedMoves = 0
      }.bind(this))
      .then(function done() {
        this.savingState = false
      }.bind(this))
  },

  clearSavedState() {
    if (this.clearingState) return
    this.clearingState = true
    cloud
      .clearState()
      .catch(function ignoreClearError() {})
      .then(function done() {
        this.clearingState = false
      }.bind(this))
  },

  // ---------- 游戏流程 ----------

  startNewGame() {
    this.stopTimer()
    this.stopDemo()
    this.clearHint()
    if (this.movedTimer) {
      clearTimeout(this.movedTimer)
      this.movedTimer = null
    }
    this.moves = 0
    this.lastSavedMoves = 0
    this.startedAt = null
    this.elapsedMs = 0
    this.directions = []
    this.seed = this.daily ? this.dailySeed >>> 0 : createSeed()
    const shuffled = klotski.shuffleBoardWithPath(
      this.size,
      createSeededRandom(this.seed),
      this.size === 3 ? 200 : 500,
    )
    this.board = shuffled.board
    this.shuffleSolution = shuffled.solution
    this.setData({
      tiles: this.toViewTiles(this.board),
      moves: 0,
      elapsedText: '00:00',
      status: 'playing',
      modal: '',
      winMessage: '',
      movedValue: 0,
      shake: false,
      daily: this.daily,
      dailyKey: this.dailyKey,
      cloudMessage: this.daily ? this.dailyOfflineMessage : '',
      cloudRank: 0,
    })
    this.updateBestText()
    this.setNavTitle()
  },

  onSwipeMove(direction) {
    if (this.data.status !== 'playing' || this.data.modal) return
    const result = klotski.moveBySwipe(this.board, direction)
    if (!result.moved) {
      this.triggerShake()
      return
    }

    this.board = result.board
    this.directions.push(direction)
    this.moves += 1
    if (!this.demoRunning) this.clearHint()
    if (!this.startedAt) {
      this.startedAt = Date.now()
      this.startTimer()
    }

    this.setData({
      tiles: this.toViewTiles(this.board),
      moves: this.moves,
      movedValue: this.board[result.to],
    })
    this.scheduleMovedClear()

    if (klotski.isSolved(this.board)) this.handleWin()
  },

  handleWin() {
    this.stopDemo()
    this.clearHint()
    this.stopTimer()
    this.clearSavedState()
    this.elapsedMs = this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0
    const record = { moves: this.moves, timeMs: this.elapsedMs }
    const previous = this.klotskiStorage.loadBest(this.size)
    let isNewRecord = klotski.isBetterRecord(previous, record)
    if (isNewRecord && !this.klotskiStorage.saveBest(this.size, record)) {
      isNewRecord = false
    }
    const best = isNewRecord ? record : previous

    this.setData({
      status: 'won',
      elapsedText: klotski.formatDuration(this.elapsedMs),
      bestText: best
        ? best.moves + ' 步 · ' + klotski.formatDuration(best.timeMs)
        : '暂无记录',
      winMessage:
        '用时 ' +
        klotski.formatDuration(this.elapsedMs) +
        '，共 ' +
        this.moves +
        ' 步' +
        (isNewRecord ? '，本机新纪录！' : ''),
      movedValue: 0,
    })
    this.setNavTitle()
    this.submitCloudRun()
  },

  submitCloudRun() {
    const self = this
    if (!cloud.isAvailable()) {
      this.setData({ cloudMessage: '云端未连接，成绩仅保存在本机' })
      return
    }
    this.setData({ cloudMessage: '正在上传成绩…' })
    cloud
      .submitRun({
        game: 'klotski' + this.size,
        size: this.size,
        seed: this.seed,
        directions: this.directions,
        timeMs: this.elapsedMs,
        daily: this.daily,
        dailyKey: this.dailyKey,
      })
      .then(function onSubmit(result) {
        const names = (result.newAchievements || []).map(function name(item) {
          return item.name
        })
        self.setData({
          cloudMessage:
            (result.isBest ? '云端最佳已更新' : '成绩已上传云端') +
            (names.length ? ' · 解锁成就：' + names.join('、') : ''),
          cloudRank: result.rank || 0,
        })
      })
      .catch(function onError(error) {
        self.setData({
          cloudMessage: (error && error.message) || '云端上传失败，成绩仅保存在本机',
        })
      })
  },

  updateBestText() {
    const best = this.klotskiStorage.loadBest(this.size)
    this.setData({
      bestText: best
        ? best.moves + ' 步 · ' + klotski.formatDuration(best.timeMs)
        : '暂无记录',
    })
  },

  // ---------- 计时 ----------

  startTimer() {
    this.stopTimer()
    const self = this
    this.timer = setInterval(function tick() {
      if (!self.startedAt) return
      const text = klotski.formatDuration(Date.now() - self.startedAt)
      if (text !== self.data.elapsedText) self.setData({ elapsedText: text })
    }, 500)
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  // ---------- 触摸 ----------

  onTouchStart(event) {
    if (this.demoRunning) {
      this.stopDemo()
      return
    }
    if (this.data.status !== 'playing' || this.data.modal) return
    this.touch.touchStart(event.touches)
  },

  onTouchMove() {
    // catchtouchmove 的占位：阻止棋盘滑动时页面滚动
  },

  onTouchEnd(event) {
    if (this.data.status !== 'playing' || this.data.modal) {
      this.touch.touchCancel()
      return
    }
    this.touch.touchEnd(event.changedTouches)
  },

  onTouchCancel() {
    this.touch.touchCancel()
  },

  noop() {},

  // ---------- 反馈 ----------

  triggerShake() {
    if (this.shakeTimer) clearTimeout(this.shakeTimer)
    const self = this
    this.setData({ shake: true })
    this.shakeTimer = setTimeout(function stopShake() {
      self.setData({ shake: false })
      self.shakeTimer = null
    }, SHAKE_MS)
  },

  scheduleMovedClear() {
    if (this.movedTimer) clearTimeout(this.movedTimer)
    const self = this
    this.movedTimer = setTimeout(function clearMoved() {
      self.setData({ movedValue: 0 })
      self.movedTimer = null
    }, MOVED_MS)
  },

  // ---------- AI 提示 / 自动演示 ----------

  onHintTap() {
    if (this.data.status !== 'playing' || this.data.modal || this.data.hintBusy) return
    this.stopDemo()
    const self = this
    this.setData({ hintBusy: true, hintText: '正在计算提示…', hintSteps: 0 })
    this.hintTimer = setTimeout(function calculateHint() {
      self.hintTimer = null
      let result = null
      if (self.size === 4 && self.shuffleSolution && self.shuffleSolution.length > 0) {
        // 4×4 棋盘由“完成态随机走步”打乱而来：
        // 当前棋盘 → 初始棋盘（用户步数逆序）→ 完成态（打乱路径逆序）一定是合法解。
        const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }
        const back = self.directions
          .slice()
          .reverse()
          .map(function invert(direction) {
            return opposite[direction]
          })
        result = {
          directions: back.concat(self.shuffleSolution),
          optimal: false,
          guaranteed: true,
        }
      } else {
        result = klotskiSolver.solve(self.board, {
          maxMs: self.size === 4 ? 1200 : 600,
          maxNodes: 120000,
        })
        if (!result && self.shuffleSolution && self.shuffleSolution.length > 0) {
          const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }
          const back = self.directions
            .slice()
            .reverse()
            .map(function invert(direction) {
              return opposite[direction]
            })
          result = {
            directions: back.concat(self.shuffleSolution),
            optimal: false,
            guaranteed: true,
          }
        }
      }
      if (self.data.status !== 'playing') {
        self.setData({ hintBusy: false, hintText: '' })
        return
      }
      if (result && result.directions.length > 0) {
        const labels = { left: '向左滑', right: '向右滑', up: '向上滑', down: '向下滑' }
        self.hintSolution = result.directions
        const lengthText = result.optimal
          ? '最少 ' + result.directions.length + ' 步）'
          : result.guaranteed
            ? '保证解，共 ' + result.directions.length + ' 步，非最优）'
            : '约 ' + result.directions.length + ' 步，非最优）'
        self.setData({
          hintBusy: false,
          hintSteps: result.directions.length,
          hintText: '建议：' + labels[result.directions[0]] + '（' + lengthText,
        })
      } else {
        self.hintSolution = null
        self.setData({
          hintBusy: false,
          hintSteps: 0,
          hintText: self.size === 4 ? '4×4 局面较复杂，暂时算不出提示' : '暂时算不出提示',
        })
      }
    }, 50)
  },

  onDemoTap() {
    if (this.demoRunning || !this.hintSolution || this.hintSolution.length < 1) return
    const solution = this.hintSolution.slice()
    const self = this
    if (solution.length > 80) {
      const seconds = Math.ceil(solution.length * 0.32)
      wx.showModal({
        title: '演示较长',
        content: '这条保证解共 ' + solution.length + ' 步，约 ' + seconds + ' 秒，是否开始？',
        confirmText: '开始演示',
        cancelText: '取消',
        success(res) {
          if (res.confirm) self.startDemo(solution)
        },
      })
      return
    }
    this.startDemo(solution)
  },

  startDemo(solution) {
    if (this.demoRunning || !solution || solution.length < 1) return
    const self = this
    let index = 0
    this.demoRunning = true
    this.setData({ demoRunning: true, hintText: '自动演示中…', hintSteps: solution.length })
    this.demoTimer = setInterval(function demoStep() {
      if (self.data.status !== 'playing') {
        self.stopDemo()
        return
      }
      if (index >= solution.length) {
        self.stopDemo()
        return
      }
      self.onSwipeMove(solution[index])
      index += 1
    }, 320)
  },

  stopDemo() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer)
      this.demoTimer = null
    }
    this.demoRunning = false
    if (this.data && this.data.demoRunning) this.setData({ demoRunning: false })
  },

  clearHint() {
    this.hintSolution = null
    if (this.data && (this.data.hintText || this.data.hintSteps)) {
      this.setData({ hintText: '', hintSteps: 0 })
    }
  },

  // ---------- 重开 / 换尺寸 / 每日排行 ----------

  onRestartTap() {
    if (this.data.status === 'playing' && this.moves > 0) {
      this.setData({
        modal: 'restart',
        modalTitle: this.daily ? '重新挑战？' : '重新打乱？',
        modalMessage: this.daily
          ? '步数会清零，仍使用同一局每日棋盘。'
          : '当前进度将丢失，成绩不会记录。',
        modalPrimary: this.daily ? '确认重来' : '确认打乱',
      })
      return
    }
    this.startNewGame()
  },

  onChangeSizeTap() {
    if (this.daily) {
      this.openDailyRank()
      return
    }
    if (this.data.status === 'playing' && this.moves > 0) {
      this.setData({
        modal: 'changeSize',
        modalTitle: '换尺寸？',
        modalMessage: '当前进度将丢失，成绩不会记录。',
        modalPrimary: '确认切换',
      })
      return
    }
    this.backToSize()
  },

  onModalConfirm() {
    const action = this.data.modal
    if (action === 'restart') {
      this.startNewGame()
    } else if (action === 'changeSize') {
      this.setData({ modal: '' })
      this.backToSize()
    }
  },

  onModalCancel() {
    this.setData({ modal: '' })
  },

  onWinAgain() {
    this.startNewGame()
  },

  onWinChangeSize() {
    if (this.daily) {
      this.openDailyRank()
      return
    }
    this.backToSize()
  },

  openDailyRank() {
    wx.navigateTo({ url: '/pages/leaderboard/index?game=klotski3&period=daily&from=daily' })
  },

  backToSize() {
    this.stopTimer()
    if (this.touch) this.touch.touchCancel()
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.redirectTo({ url: '/pages/klotski/index' })
      },
    })
  },

  // ---------- 主题 / 标题 / 分享 ----------

  applyTheme() {
    const theme = this.storage.loadTheme()
    this.setData({ theme })
    const config = themeModule.NAV_BAR_COLOR[theme] || themeModule.NAV_BAR_COLOR.light
    if (typeof wx !== 'undefined' && wx.setNavigationBarColor) {
      wx.setNavigationBarColor({
        frontColor: config.frontColor,
        backgroundColor: config.backgroundColor,
        fail() {},
      })
    }
    this.setNavTitle()
  },

  setNavTitle() {
    if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) {
      wx.setNavigationBarTitle({
        title: this.daily ? '每日挑战 · ' + this.size + '×' + this.size : '数字华容道 ' + this.size + '×' + this.size,
        fail() {},
      })
    }
  },

  onBackHome() {
    const goHome = function goHome() {
      wx.reLaunch({ url: '/pages/home/index' })
    }
    if (this.data.status === 'playing' && this.data.moves > 0) {
      wx.showModal({
        title: '切换游戏？',
        content: '当前华容道进度将丢失，最佳记录会保留。',
        confirmText: '切换',
        cancelText: '取消',
        success(res) {
          if (res.confirm) goHome()
        },
      })
      return
    }
    goHome()
  },

  onShareAppMessage() {
    return {
      title: this.daily
        ? '今日 3×3 华容道挑战，来比比步数？'
        : '数字华容道 ' + this.size + '×' + this.size + '，来挑战一下？',
      path: this.daily
        ? '/pages/klotski/game/index?size=3&daily=1'
        : '/pages/klotski/game/index?size=' + this.size,
    }
  },
})
