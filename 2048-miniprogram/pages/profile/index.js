const storageModule = require('../../utils/storage')
const themeModule = require('../../utils/theme')
const cloud = require('../../utils/cloud')
const cloudUtils = require('../../utils/cloud-utils')
const achievementsUtil = require('../../utils/achievements')
const profileOptions = require('../../utils/profile')
const { formatDuration } = require('../../utils/klotski')

function initialOf(nickname) {
  const text = String(nickname || '玩').trim()
  return text ? text.charAt(0) : '玩'
}

function best2048Text(player) {
  const score = (player && player.best2048Score) || 0
  return score > 0 ? score + ' 分' : '暂无'
}

function klotskiText(player, size) {
  const moves = player && player['best' + size + 'Moves']
  const time = player && player['best' + size + 'Time']
  if (!moves) return '暂无'
  return moves + ' 步 · ' + formatDuration(time || 0)
}

Page({
  data: {
    theme: 'light',
    nickname: '',
    initial: '玩',
    avatar: 'a1',
    avatarEmoji: '🎮',
    avatarUrl: '',
    avatarPreview: '',
    uploadingAvatar: false,
    gender: 'private',
    genderLabel: '保密',
    avatars: profileOptions.AVATARS,
    genders: profileOptions.GENDERS,
    nicknameSet: false,
    best2048: '暂无',
    best3: '暂无',
    best4: '暂无',
    achievements: [],
    achievementCount: 0,
    achievementTotal: achievementsUtil.ACHIEVEMENTS.length,
    saving: false,
    loading: true,
    error: '',
  },

  onLoad() {
    this.storage = storageModule.createWxStorage()
    this.applyTheme()
    this.refresh()
  },

  onShow() {
    if (this.storage) this.applyTheme()
  },

  onRetry() {
    this.refresh()
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

  refresh() {
    const self = this
    this.setData({ loading: true, error: '' })
    cloud
      .refreshPlayer()
      .then(function onLogin(player) {
        self.applyPlayer(player)
      })
      .catch(function onError(error) {
        self.setData({
          loading: false,
          error: (error && error.message) || '云端未连接，无法修改昵称',
        })
      })
  },

  applyPlayer(player) {
    const achievements = achievementsUtil.detailList(player.achievements || [])
    const avatar = profileOptions.avatarById(player.avatar || 'a1')
    const gender = profileOptions.genderById(player.gender || 'private')
    this.player = player
    this.setData({
      nickname: player.nickname || '',
      initial: initialOf(player.nickname),
      avatar: avatar.id,
      avatarEmoji: avatar.emoji,
      avatarUrl: player.avatarUrl || '',
      avatarPreview: player.avatarUrl || '',
      gender: gender.id,
      genderLabel: gender.label,
      nicknameSet: Boolean(player.nicknameSet),
      best2048: best2048Text(player),
      best3: klotskiText(player, 3),
      best4: klotskiText(player, 4),
      achievements,
      achievementCount: (player.achievements || []).length,
      loading: false,
      error: '',
    })
  },

  onNicknameInput(event) {
    const nickname = event.detail.value || ''
    this.setData({ nickname, initial: initialOf(nickname) })
  },

  onAvatarTap(event) {
    const avatar = profileOptions.avatarById(event.currentTarget.dataset.avatar)
    this.setData({ avatar: avatar.id, avatarEmoji: avatar.emoji, avatarUrl: '', avatarPreview: '' })
  },

  onChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl
    if (!filePath || this.data.uploadingAvatar) return
    const self = this
    this.setData({ avatarPreview: filePath, uploadingAvatar: true })
    cloud
      .uploadAvatar(filePath)
      .then(function onUploaded(fileID) {
        self.setData({ avatarUrl: fileID, avatarPreview: fileID, uploadingAvatar: false })
      })
      .catch(function onError() {
        self.setData({ avatarUrl: '', avatarPreview: '', uploadingAvatar: false })
        wx.showToast({ title: '头像上传失败，请重试', icon: 'none' })
      })
  },

  onGenderTap(event) {
    const gender = profileOptions.genderById(event.currentTarget.dataset.gender)
    this.setData({ gender: gender.id, genderLabel: gender.label })
  },

  onSave() {
    if (this.data.saving || this.data.uploadingAvatar) return
    const checked = cloudUtils.normalizeNickname(this.data.nickname)
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' })
      return
    }
    if (
      this.player &&
      checked.nickname === this.player.nickname &&
      this.data.avatar === (this.player.avatar || 'a1') &&
      this.data.avatarUrl === (this.player.avatarUrl || '') &&
      this.data.gender === (this.player.gender || 'private') &&
      this.data.nicknameSet
    ) {
      wx.showToast({ title: '资料没有变化', icon: 'none' })
      return
    }
    const self = this
    this.setData({ saving: true })
    cloud
      .updateProfile({
        nickname: checked.nickname,
        avatar: this.data.avatar,
        avatarUrl: this.data.avatarUrl,
        gender: this.data.gender,
      })
      .then(function onSaved(player) {
        self.applyPlayer(player)
        self.setData({ saving: false })
        wx.showToast({ title: '昵称已保存', icon: 'success' })
      })
      .catch(function onError(error) {
        self.setData({ saving: false })
        wx.showToast({ title: (error && error.message) || '保存失败，请重试', icon: 'none' })
      })
  },

  onClearCloud() {
    const self = this
    wx.showModal({
      title: '清空云端记录？',
      content: '会删除你的昵称、最佳成绩、成就和排行榜记录，且无法恢复。',
      confirmText: '确认清空',
      confirmColor: '#d64545',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return
        wx.showLoading({ title: '清理中…' })
        cloud
          .resetMyData()
          .then(function onCleared() {
            wx.hideLoading()
            wx.showToast({ title: '已清空', icon: 'success' })
            setTimeout(function goHome() {
              wx.reLaunch({ url: '/pages/home/index' })
            }, 500)
          })
          .catch(function onError(error) {
            wx.hideLoading()
            wx.showToast({ title: (error && error.message) || '清空失败', icon: 'none' })
          })
      },
    })
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/home/index' })
  },

  onShareAppMessage() {
    return {
      title: '我在小游戏合集的成绩，来挑战我？',
      path: '/pages/home/index',
    }
  },
})
