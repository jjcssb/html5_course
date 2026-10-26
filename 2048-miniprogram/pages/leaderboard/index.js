const storageModule = require('../../utils/storage')
const themeModule = require('../../utils/theme')
const cloud = require('../../utils/cloud')
const cloudUtils = require('../../utils/cloud-utils')
const profileOptions = require('../../utils/profile')
const { formatDuration } = require('../../utils/klotski')

const GAMES = [
  { id: '2048', label: '2048' },
  { id: 'klotski3', label: '华容道 3×3' },
  { id: 'klotski4', label: '华容道 4×4' },
]

function periodsFor(game) {
  return [
    { id: 'all', label: '总榜' },
    { id: 'week', label: '本周' },
  ]
}

function valueText(game, row) {
  return cloudUtils.formatRankValue(game, row, formatDuration)
}

function mapRows(game, rows) {
  return (rows || []).map(function mapRow(row) {
    const avatar = profileOptions.avatarById(row.avatar || 'a1')
    return {
      rank: row.rank,
      nickname: row.nickname || '玩家',
      avatarUrl: row.avatarUrl || '',
      avatarEmoji: avatar.emoji,
      isMe: Boolean(row.isMe),
      valueText: valueText(game, row),
    }
  })
}

Page({
  data: {
    theme: 'light',
    games: GAMES,
    periods: periodsFor('2048'),
    activeGame: '2048',
    activePeriod: 'all',
    list: [],
    myBest: null,
    myBestText: '',
    myRank: null,
    loading: true,
    error: '',
    emptyText: '还没有人上榜，来玩一局抢占第一名。',
    page: 1,
    pageSize: 20,
    hasMore: false,
    loadingMore: false,
    gameLabel: '2048',
    totalText: '',
    podium: [],
    rest: [],
    myAvatarUrl: '',
    myAvatarEmoji: '🎮',
  },

  onLoad(query) {
    this.storage = storageModule.createWxStorage()
    const game = query && GAMES.some((item) => item.id === query.game) ? query.game : '2048'
    const periods = periodsFor(game)
    const period =
      query && query.period === 'week' ? 'week' : 'all'
    const gameLabel = (GAMES.find((item) => item.id === game) || GAMES[0]).label
    this.setData({ activeGame: game, periods, activePeriod: period, gameLabel })
    this.applyTheme()
    this.load()
  },

  onShow() {
    if (this.storage) this.applyTheme()
  },

  onPullDownRefresh() {
    this.load(true)
  },

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
  },

  onGameTap(event) {
    const game = event.currentTarget.dataset.game
    if (game === this.data.activeGame) return
    const periods = periodsFor(game)
    const activePeriod = periods.some((item) => item.id === this.data.activePeriod)
      ? this.data.activePeriod
      : 'all'
    const gameLabel = (GAMES.find((item) => item.id === game) || GAMES[0]).label
    this.setData({ activeGame: game, periods, activePeriod, gameLabel })
    this.load()
  },

  onPeriodTap(event) {
    const period = event.currentTarget.dataset.period
    if (period === this.data.activePeriod) return
    this.setData({ activePeriod: period })
    this.load()
  },

  onRetryTap() {
    this.load()
  },

  load(fromPullDown) {
    const self = this
    this.setData({ loading: true, error: '', page: 1 })
    cloud
      .ensureLogin()
      .then(function loginDone() {
        return cloud.getLeaderboard({
          game: self.data.activeGame,
          period: self.data.activePeriod,
          page: 1,
          pageSize: self.data.pageSize,
        })
      })
      .then(function onLoaded(result) {
        const game = self.data.activeGame
        const list = mapRows(game, result.list)
        const best = result.myBest
        const myAvatar = best ? profileOptions.avatarById(best.avatar || 'a1') : null
        self.setData({
          list,
          podium: list.slice(0, 3),
          rest: list.slice(3),
          myBest: best || null,
          myRank: result.myRank || (best && best.rank) || null,
          myBestText: best ? valueText(game, best) : '',
          myAvatarUrl: best ? best.avatarUrl || '' : '',
          myAvatarEmoji: myAvatar ? myAvatar.emoji : '🎮',
          totalText: result.total ? '共 ' + result.total + ' 位玩家' : '等待第一位玩家',
          loading: false,
          error: '',
          page: 1,
          hasMore: Boolean(result.hasMore),
        })
      })
      .catch(function onError(error) {
        self.setData({
          list: [],
          podium: [],
          rest: [],
          totalText: '',
          myBest: null,
          myRank: null,
          loading: false,
          error: (error && error.message) || '云端排行榜加载失败',
          hasMore: false,
        })
      })
      .then(function finish() {
        if (fromPullDown) wx.stopPullDownRefresh()
      })
  },

  onLoadMoreTap() {
    if (!this.data.hasMore || this.data.loadingMore) return
    const self = this
    const nextPage = this.data.page + 1
    this.setData({ loadingMore: true })
    cloud
      .getLeaderboard({
        game: this.data.activeGame,
        period: this.data.activePeriod,
        page: nextPage,
        pageSize: this.data.pageSize,
      })
      .then(function onLoaded(result) {
        const list = self.data.list.concat(mapRows(self.data.activeGame, result.list))
        self.setData({
          list,
          podium: list.slice(0, 3),
          rest: list.slice(3),
          page: nextPage,
          hasMore: Boolean(result.hasMore),
          loadingMore: false,
        })
      })
      .catch(function onError() {
        self.setData({ loadingMore: false })
        wx.showToast({ title: '加载更多失败', icon: 'none' })
      })
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/home/index' })
  },

  onShareAppMessage() {
    return {
      title: '小游戏合集排行榜：看看你排第几？',
      path: '/pages/leaderboard/index',
    }
  },
})
