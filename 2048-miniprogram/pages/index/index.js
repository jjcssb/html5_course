/**
 * 2048 小程序页面层：
 * - 负责触摸事件、WXML 数据更新、弹窗与 wx 存储/音效调用；
 * - 棋盘规则、状态机、动画数据全部来自 utils/ 下的纯函数，便于独立测试。
 */
const engine = require('../../utils/engine')
const storageModule = require('../../utils/storage')
const tilesUtil = require('../../utils/tiles')
const gesture = require('../../utils/gesture')
const soundUtil = require('../../utils/sound')
const themeModule = require('../../utils/theme')
const cloud = require('../../utils/cloud')
const cloudUtils = require('../../utils/cloud-utils')
const { createSeededRandom } = require('../../utils/random')

const GAME_STATUS = engine.GAME_STATUS
// 棋盘内层：间隙占 2.4%，每格宽 23.2%，步进 25.6%（与 H5 版一致）
const TILE_SIZE_PERCENT = 23.2
const TILE_STEP_PERCENT = 25.6
const SHAKE_MS = 240

function createSeed() {
  return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

Page({
  data: {
    theme: 'light',
    themes: themeModule.THEME_OPTIONS,
    soundEnabled: true,
    cells: [],
    tiles: [],
    score: 0,
    best: 0,
    status: GAME_STATUS.PLAYING,
    modal: '',
    modalTitle: '',
    modalMessage: '',
    modalPrimary: '',
    history: [],
    historyOpen: false,
    shake: false,
    winMessage: '',
    overMessage: '',
    cloudSavedText: '',
    daily: false,
    dailyKey: '',
  },

  onLoad(query) {
    this.daily = Boolean(query && (String(query.daily) === '1' || query.daily === 'true'))
    this.resume = Boolean(query && (String(query.resume) === '1' || query.resume === 'true'))
    const allowStandalone =
      Boolean(query && (String(query.share) === '1' || String(query.standalone) === '1'))
    this.entryRedirect =
      getCurrentPages().length === 1 && !this.daily && !this.resume && !allowStandalone
    this.dailyKey = (query && query.date) || ''
    this.dailySeed = 0
    this.seed = 0
    this.directions = []
    this.lastSavedMoves = 0
    this.storage = storageModule.createWxStorage()
    this.nextTileId = tilesUtil.createIdGenerator(1)
    this.gameState = null
    this.tiles = []
    this.animating = false
    this.pendingDirection = null
    this.pendingMove = null
    this.overRecorded = false
    this.animationTimer = null
    this.effectTimer = null
    this.shakeTimer = null
    this.savedBest = 0
    this.lastCloudScore = 0

    const best = this.storage.loadBestScore()
    const theme = this.storage.loadTheme()
    const soundEnabled = this.storage.loadSoundEnabled()
    const history = this.decorateHistory(this.storage.loadHistory())
    this.savedBest = best

    this.sound = soundUtil.createSoundPlayer({
      wxApi: wx,
      getEnabled: () => this.data.soundEnabled,
    })
    this.touch = gesture.createTouchTracker({
      minDistance: 22,
      onSwipe: (direction) => this.move(direction),
    })

    const self = this
    this.setData(
      {
        theme,
        soundEnabled,
        best,
        history,
        cells: this.buildCells(),
        daily: this.daily,
        dailyKey: this.dailyKey,
      },
      function afterInit() {
        self.applyNavBar(theme)
        // 二维码/冷启动直接落在 2048 时，回到首页，避免跳过主页
        if (self.entryRedirect) {
          wx.reLaunch({ url: '/pages/home/index' })
          return
        }
        self.ensureOnboarding()
        if (self.resume) self.resumeSavedGame()
        else if (self.daily) self.initDaily()
        else self.startNewGame()
      },
    )
  },

  onShow() {
    // 页面显示时再同步一次导航栏颜色，避免 onLoad 时机导致深色主题不生效
    if (this.data && this.data.theme) this.applyNavBar(this.data.theme)
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

  onUnload() {
    this.saveCurrentState()
    this.clearTimers()
    if (this.sound) this.sound.destroy()
  },

  onHide() {
    // 页面隐藏时若动画未结算，立即结算，避免回来时状态与画面不一致
    if (this.animating && this.pendingMove) this.finishMove()
    this.saveCurrentState()
    if (this.effectTimer) {
      clearTimeout(this.effectTimer)
      this.effectTimer = null
    }
  },

  // ---------- 初始化 ----------

  buildCells() {
    const cells = []
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        cells.push({
          id: 'cell-' + row + '-' + col,
          left: (col * TILE_STEP_PERCENT).toFixed(2) + '%',
          top: (row * TILE_STEP_PERCENT).toFixed(2) + '%',
          size: TILE_SIZE_PERCENT.toFixed(2) + '%',
        })
      }
    }
    return cells
  },

  // ---------- 初始化 / 每日挑战 ----------

  initDaily() {
    const self = this
    cloud
      .getDaily()
      .then(function onDaily(result) {
        const seed = result && result.games ? result.games['2048'] : 0
        self.dailyKey = (result && result.dateKey) || self.dailyKey
        self.dailySeed = Number(seed) >>> 0
        if (!self.dailySeed) throw new Error('每日种子缺失')
        self.setData({ dailyKey: self.dailyKey, cloudSavedText: '' })
        self.startNewGame()
      })
      .catch(function onLocal() {
        const info = cloudUtils.getLocalDailyInfo(null, '2048')
        self.dailyKey = info.dateKey
        self.dailySeed = info.seed
        self.setData({
          dailyKey: info.dateKey,
          cloudSavedText: '云端未连接，今日挑战为本地模式',
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
        if (!saved || saved.game !== '2048') return self.resumeFailed()
        if (saved.daily) {
          const info = cloudUtils.getLocalDailyInfo(null, '2048')
          if (saved.dailyKey && saved.dailyKey !== info.dateKey) {
            self.daily = true
            self.dailySeed = info.seed
            self.dailyKey = info.dateKey
            return self.resumeFailed()
          }
        }
        if (!Array.isArray(saved.directions) || !Number.isInteger(Number(saved.moves))) {
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
    this.random = createSeededRandom(this.seed)
    this.directions = saved.directions.slice()
    this.lastSavedMoves = Number(saved.moves) || 0
    let state = engine.createGameState({
      best: this.data.best,
      random: this.random,
      now: Date.now,
    })
    for (const direction of this.directions) {
      const applied = engine.applyMove(state, direction, {
        random: this.random,
        now: Date.now,
      })
      if (!applied.result.moved) return this.resumeFailed()
      state = applied.state
    }
    state.startedAt = Date.now() - elapsedMs
    this.daily = Boolean(saved.daily)
    this.dailyKey = saved.dailyKey || this.dailyKey
    this.dailySeed = this.daily ? this.seed : 0
    this.gameState = state
    this.overRecorded = false
    this.animating = false
    this.pendingDirection = null
    this.pendingMove = null
    this.lastCloudScore = 0
    this.tiles = tilesUtil.tilesFromBoard(state.board, this.nextTileId, {
      newCells: state.lastSpawned,
    })
    this.setData({
      tiles: this.toViewTiles(this.tiles),
      score: state.score,
      best: state.best,
      status: state.status,
      modal: '',
      shake: false,
      winMessage: '',
      overMessage: '',
      cloudSavedText: '已恢复上局进度',
      daily: this.daily,
      dailyKey: this.dailyKey,
    })
    this.scheduleEffectClear()
    if (this.daily) {
      wx.setNavigationBarTitle({ title: '每日挑战 · 2048', fail() {} })
    }
  },

  saveCurrentState() {
    if (this.savingState) return
    const state = this.gameState
    this.saveDebug = {
      status: state && state.status,
      moves: state && state.moves,
      lastSavedMoves: this.lastSavedMoves,
    }
    if (!state || state.status !== GAME_STATUS.PLAYING || state.moves < 1) return
    if (state.moves <= (this.lastSavedMoves || 0)) return
    const elapsedMs = Math.max(0, Date.now() - state.startedAt)
    const flatBoard = Array.isArray(state.board[0])
      ? state.board.reduce(function flatten(list, row) {
          return list.concat(row)
        }, [])
      : state.board.slice()
    this.lastSavedMoves = state.moves
    this.savingState = true
    const self = this
    cloud
      .saveState({
        game: '2048',
        size: 4,
        seed: this.seed,
        board: flatBoard,
        directions: this.directions.slice(),
        moves: state.moves,
        elapsedMs,
        daily: this.daily,
        dailyKey: this.dailyKey,
        score: state.score,
      })
      .then(function onSaved() {
        self.savingState = false
        self.saveDebug.result = 'ok'
        self.setData({ cloudSavedText: '已保存，可继续上局' })
      })
      .catch(function onError(error) {
        self.savingState = false
        self.lastSavedMoves = 0
        self.saveDebug.result = 'fail:' + (error && (error.message || error.errMsg || error.code))
        self.setData({ cloudSavedText: '存档失败，请稍后重试' })
      })
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

  startNewGame() {
    this.clearTimers()
    this.seed = this.daily ? this.dailySeed >>> 0 : createSeed()
    this.random = createSeededRandom(this.seed)
    this.directions = []
    this.lastSavedMoves = 0
    const state = engine.createGameState({
      best: this.data.best,
      random: this.random,
      now: Date.now,
    })
    this.gameState = state
    this.overRecorded = false
    this.animating = false
    this.pendingDirection = null
    this.pendingMove = null
    this.lastCloudScore = 0
    this.tiles = tilesUtil.tilesFromBoard(state.board, this.nextTileId, {
      newCells: state.lastSpawned,
    })
    this.setData({
      tiles: this.toViewTiles(this.tiles),
      score: state.score,
      best: state.best,
      status: state.status,
      modal: '',
      shake: false,
      winMessage: '',
      overMessage: '',
      cloudSavedText: '',
      daily: this.daily,
      dailyKey: this.dailyKey,
    })
    this.scheduleEffectClear()
    if (this.daily) {
      wx.setNavigationBarTitle({ title: '每日挑战 · 2048', fail() {} })
    }
  },

  // ---------- 数据转换 ----------

  toViewTiles(tiles) {
    return tiles.map(function mapTile(tile) {
      const digits = String(tile.value).length
      return {
        id: tile.id,
        value: tile.value,
        left: (tile.col * TILE_STEP_PERCENT).toFixed(2) + '%',
        top: (tile.row * TILE_STEP_PERCENT).toFixed(2) + '%',
        size: TILE_SIZE_PERCENT.toFixed(2) + '%',
        className: tile.value > 2048 ? 'tile--super' : 'tile--' + tile.value,
        lenClass: 'tile--len' + Math.min(digits, 6),
        isNew: tile.isNew,
        merged: tile.merged,
      }
    })
  },

  decorateHistory(list) {
    return (list || []).map(function decorate(item, index) {
      const minutes = Math.floor(item.durationMs / 60000)
      const seconds = Math.floor((item.durationMs % 60000) / 1000)
      const date = new Date(item.endedAt)
      const pad = function pad2(value) {
        return value < 10 ? '0' + value : String(value)
      }
      return Object.assign({}, item, {
        key: item.endedAt + '-' + index,
        reasonLabel: item.won ? '达成 2048' : item.endedBy === 'restart' ? '主动重开' : '游戏结束',
        durationLabel: minutes + ':' + (seconds < 10 ? '0' : '') + seconds,
        dateLabel: pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()),
      })
    })
  },

  // ---------- 移动与动画 ----------

  move(direction) {
    if (!this.gameState || this.gameState.status !== GAME_STATUS.PLAYING) return
    if (this.animating) {
      this.pendingDirection = direction
      return
    }

    const applied = engine.applyMove(this.gameState, direction, {
      random: this.random,
      now: Date.now,
    })

    if (!applied.result.moved) {
      this.triggerShake()
      this.sound.vibrate('light')
      return
    }

    this.directions.push(direction)
    this.animating = true
    this.pendingDirection = null
    this.tiles = tilesUtil.slideTiles(this.tiles, applied.result.slides)
    this.setData({ tiles: this.toViewTiles(this.tiles) })
    this.pendingMove = applied

    const self = this
    this.animationTimer = setTimeout(function afterSlide() {
      self.finishMove()
    }, tilesUtil.TILE_ANIMATION_MS)
  },

  finishMove() {
    if (this.animationTimer) {
      clearTimeout(this.animationTimer)
      this.animationTimer = null
    }
    const pending = this.pendingMove
    this.pendingMove = null
    if (!pending) return

    const result = pending.result
    const state = pending.state

    this.tiles = tilesUtil.settleTiles(this.tiles, result, this.nextTileId)
    this.gameState = state
    this.animating = false

    const nextData = {
      tiles: this.toViewTiles(this.tiles),
      score: state.score,
      best: state.best,
      status: state.status,
    }
    if (result.won) {
      nextData.winMessage =
        '成功合成 2048！当前得分 ' + state.score + ' 分，继续游戏可以挑战更大的数字。'
    }
    if (result.over) {
      nextData.overMessage =
        '本局得分 ' + state.score + ' 分，最大数字 ' + state.maxTile + '。'
    }
    this.setData(nextData)

    this.persistBest(state.best)
    if (result.won || result.over) {
      this.submitCloudScore()
      this.clearSavedState()
    }
    if (result.gained > 0) {
      this.sound.playMerge()
      this.sound.vibrate('light')
    } else {
      this.sound.vibrate('light')
    }
    if (result.won) this.sound.playWin()
    if (result.over) {
      this.recordGameOver()
      this.sound.playGameOver()
    }

    this.scheduleEffectClear()

    // 动画期间快速滑动只保留最后一个方向，结算后补执行
    const queued = this.pendingDirection
    this.pendingDirection = null
    if (queued && this.gameState.status === GAME_STATUS.PLAYING) this.move(queued)
  },

  scheduleEffectClear() {
    if (this.effectTimer) clearTimeout(this.effectTimer)
    const self = this
    this.effectTimer = setTimeout(function clearEffects() {
      self.tiles.forEach(function clearTile(tile) {
        tile.isNew = false
        tile.merged = false
      })
      self.setData({ tiles: self.toViewTiles(self.tiles) })
      self.effectTimer = null
    }, tilesUtil.TILE_EFFECT_MS)
  },

  triggerShake() {
    if (this.shakeTimer) clearTimeout(this.shakeTimer)
    const self = this
    this.setData({ shake: true })
    this.shakeTimer = setTimeout(function stopShake() {
      self.setData({ shake: false })
      self.shakeTimer = null
    }, SHAKE_MS)
  },

  // ---------- 分数与战绩 ----------

  persistBest(best) {
    if (best > this.savedBest && this.storage.saveBestScore(best)) {
      this.savedBest = best
    }
  },

  recordGameOver() {
    if (this.overRecorded) return
    this.overRecorded = true
    const record = engine.buildRecord(this.gameState, engine.END_REASON.GAME_OVER, Date.now())
    const history = this.storage.addHistory(record)
    this.setData({ history: this.decorateHistory(history) })
  },

  submitCloudScore() {
    const state = this.gameState
    if (!state || state.score <= 0) return
    if (!cloud.isAvailable() || state.score <= this.lastCloudScore) return
    const self = this
    const score = state.score
    this.lastCloudScore = score
    this.setData({ cloudSavedText: '正在同步云端…' })
    cloud
      .submitRun({
        game: '2048',
        score,
        moves: state.moves,
        timeMs: Math.max(1000, Date.now() - state.startedAt),
        seed: this.seed,
        directions: this.directions.slice(),
        daily: this.daily,
        dailyKey: this.dailyKey,
      })
      .then(function onSubmitted(result) {
        const names = (result.newAchievements || []).map(function name(item) {
          return item.name
        })
        const base = result.isBest ? '云端最佳已更新' : '成绩已同步云端'
        self.setData({
          cloudSavedText: base + (names.length ? ' · 解锁成就：' + names.join('、') : ''),
        })
      })
      .catch(function onError() {
        self.setData({ cloudSavedText: '云端未连接，成绩仅保存在本机' })
      })
  },

  // ---------- 胜利 / 重开 / 弹窗 ----------

  onContinueTap() {
    if (!this.gameState || this.gameState.status !== GAME_STATUS.WON) return
    const continued = engine.continueAfterWin(this.gameState, { now: Date.now })
    this.gameState = continued.state
    this.setData({ status: continued.state.status })
    if (continued.result.over) {
      if (!this.overRecorded && continued.result.record) {
        this.overRecorded = true
        const history = this.storage.addHistory(continued.result.record)
        this.setData({
          history: this.decorateHistory(history),
          overMessage:
            '本局得分 ' + continued.state.score + ' 分，最大数字 ' + continued.state.maxTile + '。',
        })
      }
      this.sound.playGameOver()
    }
  },

  onRestartTap() {
    if (this.animating) return
    if (this.gameState && this.gameState.status === GAME_STATUS.PLAYING) {
      this.setData({
        modal: 'restart',
        modalTitle: '重新开始？',
        modalMessage: '当前棋盘和本局得分将清空，历史最高分会保留。',
        modalPrimary: '确认重开',
      })
      return
    }
    this.restartNow()
  },

  onRestartOverlayTap() {
    this.restartNow()
  },

  restartNow() {
    this.clearTimers()
    this.seed = this.daily ? this.dailySeed >>> 0 : createSeed()
    this.random = createSeededRandom(this.seed)
    this.directions = []
    this.lastSavedMoves = 0
    const restarted = engine.restartGame(this.gameState, {
      random: this.random,
      now: Date.now,
    })
    if (restarted.result.abortedRecord) {
      const history = this.storage.addHistory(restarted.result.abortedRecord)
      this.setData({ history: this.decorateHistory(history) })
    }

    this.gameState = restarted.state
    this.overRecorded = false
    this.animating = false
    this.pendingDirection = null
    this.pendingMove = null
    this.lastCloudScore = 0
    this.tiles = tilesUtil.tilesFromBoard(restarted.state.board, this.nextTileId, {
      newCells: restarted.state.lastSpawned,
    })
    this.setData({
      tiles: this.toViewTiles(this.tiles),
      score: restarted.state.score,
      best: restarted.state.best,
      status: restarted.state.status,
      modal: '',
      shake: false,
      winMessage: '',
      overMessage: '',
      cloudSavedText: '',
      daily: this.daily,
      dailyKey: this.dailyKey,
    })
    this.scheduleEffectClear()
  },

  onModalConfirmTap() {
    const action = this.data.modal
    if (action === 'restart') {
      this.restartNow()
    } else if (action === 'clearHistory') {
      this.storage.clearHistory()
      this.setData({ modal: '', history: [] })
    }
  },

  onModalCancelTap() {
    this.setData({ modal: '' })
  },

  onClearHistoryTap() {
    if (this.animating) return
    this.setData({
      modal: 'clearHistory',
      modalTitle: '清空历史战绩？',
      modalMessage: '所有历史战绩都会被删除，历史最高分不受影响。',
      modalPrimary: '确认清空',
    })
  },

  // ---------- 主题 / 音效 / 历史 ----------

  onThemeTap(event) {
    const value = event.currentTarget.dataset.value
    if (!value) return
    this.setData({ theme: value })
    this.storage.saveTheme(value)
    this.applyNavBar(value)
  },

  applyNavBar(theme) {
    const config = themeModule.NAV_BAR_COLOR[theme] || themeModule.NAV_BAR_COLOR.light
    if (typeof wx !== 'undefined' && wx.setNavigationBarColor) {
      wx.setNavigationBarColor({
        frontColor: config.frontColor,
        backgroundColor: config.backgroundColor,
        fail() {},
      })
    }
  },

  onSoundTap() {
    const enabled = !this.data.soundEnabled
    this.setData({ soundEnabled: enabled })
    this.storage.saveSoundEnabled(enabled)
    if (enabled) this.sound.vibrate('light')
  },

  onToggleHistory() {
    this.setData({ historyOpen: !this.data.historyOpen })
  },

  // ---------- 触摸 ----------

  onTouchStart(event) {
    if (!this.gameState || this.gameState.status !== GAME_STATUS.PLAYING) return
    this.touch.touchStart(event.touches)
  },

  onTouchMove() {
    // catchtouchmove 的占位：阻止棋盘滑动时页面滚动
  },

  onTouchEnd(event) {
    if (!this.gameState || this.gameState.status !== GAME_STATUS.PLAYING) {
      this.touch.touchCancel()
      return
    }
    this.touch.touchEnd(event.changedTouches)
  },

  onTouchCancel() {
    this.touch.touchCancel()
  },

  noop() {},

  // ---------- 生命周期清理 ----------

  clearTimers() {
    if (this.animationTimer) {
      clearTimeout(this.animationTimer)
      this.animationTimer = null
    }
    if (this.effectTimer) {
      clearTimeout(this.effectTimer)
      this.effectTimer = null
    }
    if (this.shakeTimer) {
      clearTimeout(this.shakeTimer)
      this.shakeTimer = null
    }
    this.pendingMove = null
    this.pendingDirection = null
  },

  onDailyRankTap() {
    wx.navigateTo({ url: '/pages/leaderboard/index?game=2048&period=daily&from=daily' })
  },

  onBackHome() {
    const goHome = function goHome() {
      wx.reLaunch({ url: '/pages/home/index' })
    }
    if (this.data.status === GAME_STATUS.PLAYING && this.data.score > 0) {
      wx.showModal({
        title: '切换游戏？',
        content: '当前 2048 进度将丢失，最高分会保留。',
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
        ? '今日 2048 挑战，来比比分数？'
        : '2048 小挑战：滑动合并，看你能到多少分？',
      path: this.daily
        ? '/pages/index/index?daily=1'
        : '/pages/index/index?share=1',
    }
  },
})
