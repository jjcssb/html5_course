const storageModule = require('../../utils/storage')
const themeModule = require('../../utils/theme')
const cloud = require('../../utils/cloud')
const cloudUtils = require('../../utils/cloud-utils')
const achievements = require('../../utils/achievements')
const profileOptions = require('../../utils/profile')
const { formatDuration } = require('../../utils/klotski')

const ONBOARDING_SKIP_KEY = 'g2048.onboarding.skipped'

function greetingNow() {
  const hour = new Date().getHours()
  if (hour < 6) return '凌晨好'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function savedGameText(saved) {
  if (!saved) return ''
  if (saved.game === '2048') {
    return '2048 · ' + (saved.score || 0) + ' 分 · ' + (saved.moves || 0) + ' 步'
  }
  const size = Number(saved.size) || 3
  return (
    size +
    '×' +
    size +
    ' · ' +
    (saved.moves || 0) +
    ' 步 · ' +
    formatDuration(saved.elapsedMs || 0)
  )
}

const PREVIEW_2048 = [2, 4, 0, 0, 8, 0, 0, 16, 0, 2, 0, 4, 0, 0, 8, 0]
const PREVIEW_KLOTSKI = [1, 2, 3, 4, 5, 6, 7, 0, 8]

Page({
  data: {
    theme: 'light',
    preview2048: [],
    previewKlotski: [],
    cloudReady: false,
    cloudLoading: true,
    cloudError: '',
    nickname: '',
    nicknameSet: false,
    avatarEmoji: '🎮',
    avatarUrl: '',
    genderLabel: '保密',
    greeting: greetingNow(),
    todayLabel: '',
    achievements: [],
    achievementCount: 0,
    achievementTotal: achievements.ACHIEVEMENTS.length,
    savedGame: null,
    savedGameText: '',
  },

  onLoad() {
    this.storage = storageModule.createWxStorage()
    const daily = cloudUtils.getLocalDailyInfo()
    this.setData({
      preview2048: PREVIEW_2048.map(function mapPreview(value, index) {
        return {
          key: 'p' + index,
          value,
          className: value ? 'mini-tile--' + Math.min(value, 16) : '',
        }
      }),
      previewKlotski: PREVIEW_KLOTSKI.map(function mapPreview(value, index) {
        return { key: 'k' + index, value, blank: value === 0 }
      }),
      todayLabel: daily.dateKey.slice(5),
    })
    this.applyTheme()
    this.refreshCloud()
  },

  onShow() {
    if (this.storage) this.applyTheme()
    // 从游戏页返回时刷新成就数/昵称（提交成绩后本地缓存的 player 已更新）
    if (this.data.cloudReady) {
      const player = cloud.getPlayer()
      if (player) this.applyPlayer(player)
      else this.refreshCloud()
    }
  },

  applyPlayer(player) {
    const savedGame = player.savedGame || null
    const avatar = profileOptions.avatarById(player.avatar || 'a1')
    const gender = profileOptions.genderById(player.gender || 'private')
    let skipped = false
    try {
      skipped = Boolean(wx.getStorageSync(ONBOARDING_SKIP_KEY))
    } catch (error) {
      skipped = false
    }
    this.setData({
      cloudReady: true,
      cloudLoading: false,
      cloudError: '',
      nickname: player.nickname || '玩家',
      nicknameSet: Boolean(player.nicknameSet),
      avatarEmoji: avatar.emoji,
      avatarUrl: player.avatarUrl || '',
      genderLabel: gender.label,
      greeting: greetingNow(),
      achievements: player.achievements || [],
      achievementCount: (player.achievements || []).length,
      savedGame,
      savedGameText: savedGameText(savedGame),
    })
    if (!player.profileCompleted && !skipped && !this.onboardingRedirected) {
      this.onboardingRedirected = true
      wx.reLaunch({ url: '/pages/onboarding/index' })
    }
  },

  refreshCloud() {
    const self = this
    this.setData({ cloudLoading: true, cloudError: '' })
    cloud
      .ensureLogin()
      .then(function onLogin(player) {
        self.applyPlayer(player)
      })
      .catch(function onError(error) {
        self.setData({
          cloudReady: false,
          cloudLoading: false,
          cloudError: (error && error.message) || '云端未连接',
        })
      })
  },

  onRetryCloudTap() {
    this.refreshCloud()
  },

  applyTheme() {
    const theme = this.storage.loadTheme()
    this.setData({ theme })
    this.applyNavBar(theme)
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

  on2048Tap() {
    wx.navigateTo({ url: '/pages/index/index' })
  },

  onKlotskiTap() {
    wx.navigateTo({ url: '/pages/klotski/index' })
  },

  onLeaderboardTap() {
    wx.navigateTo({ url: '/pages/leaderboard/index' })
  },

  onResumeTap() {
    const saved = this.data.savedGame
    if (!saved) return
    if (saved.game === '2048') {
      wx.navigateTo({
        url: '/pages/index/index?resume=1' + (saved.daily ? '&daily=1' : ''),
      })
      return
    }
    const size = Number(saved.size) === 4 ? 4 : 3
    wx.navigateTo({
      url:
        '/pages/klotski/game/index?size=' +
        size +
        '&resume=1' +
        (saved.daily ? '&daily=1' : ''),
    })
  },

  onProfileTap() {
    wx.navigateTo({ url: '/pages/profile/index' })
  },

  onDailyTap() {
    wx.navigateTo({ url: '/pages/klotski/game/index?size=3&daily=1' })
  },

  onDailyGameTap(event) {
    const game = event.currentTarget.dataset.game
    if (game === '2048') {
      wx.navigateTo({ url: '/pages/index/index?daily=1' })
      return
    }
    const size = game === 'klotski4' ? 4 : 3
    wx.navigateTo({ url: '/pages/klotski/game/index?size=' + size + '&daily=1' })
  },

  onAchievementsTap() {
    const list = achievements.detailList(this.data.achievements)
    const content = list
      .map(function line(item) {
        return (item.unlocked ? '✓ ' : '○ ') + item.name + '：' + item.desc
      })
      .join('\n')
    wx.showModal({
      title: '我的成就 ' + this.data.achievementCount + '/' + this.data.achievementTotal,
      content,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  onNicknameTap() {
    if (!this.data.cloudReady) {
      wx.showToast({ title: this.data.cloudError || '云端未连接', icon: 'none' })
      return
    }
    const self = this
    wx.showModal({
      title: '修改昵称',
      content: '当前昵称：' + this.data.nickname,
      editable: true,
      placeholderText: '输入 2–12 个字符的新昵称',
      confirmText: '保存',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return
        const checked = cloudUtils.normalizeNickname(res.content)
        if (!checked.ok) {
          wx.showToast({ title: checked.message, icon: 'none' })
          return
        }
        cloud
          .updateNickname(checked.nickname)
          .then(function onUpdated() {
            self.setData({ nickname: checked.nickname })
            wx.showToast({ title: '昵称已更新', icon: 'success' })
          })
          .catch(function onError(error) {
            wx.showToast({ title: (error && error.message) || '保存失败', icon: 'none' })
          })
      },
    })
  },

  onShareAppMessage() {
    return {
      title: '小游戏合集：2048 / 数字华容道，来挑战一下？',
      path: '/pages/home/index',
    }
  },
})
