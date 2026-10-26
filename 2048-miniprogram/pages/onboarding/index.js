const cloud = require('../../utils/cloud')
const cloudUtils = require('../../utils/cloud-utils')
const profileOptions = require('../../utils/profile')

const SKIP_KEY = 'g2048.onboarding.skipped'

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    nickname: '',
    avatar: 'a1',
    gender: 'private',
    avatarEmoji: '🎮',
    avatarUrl: '',
    avatarPreview: '',
    uploadingAvatar: false,
    genderLabel: '保密',
    avatars: profileOptions.AVATARS,
    genders: profileOptions.GENDERS,
  },

  onLoad() {
    this.refresh()
  },

  refresh() {
    const self = this
    this.setData({ loading: true, error: '' })
    cloud
      .ensureLogin()
      .then(function onLogin(player) {
        if (player.profileCompleted) {
          wx.reLaunch({ url: '/pages/home/index' })
          return
        }
        const avatar = profileOptions.avatarById(player.avatar || 'a1')
        const gender = profileOptions.genderById(player.gender || 'private')
        self.setData({
          loading: false,
          nickname: player.nickname || '',
          avatar: avatar.id,
          avatarEmoji: avatar.emoji,
          avatarUrl: player.avatarUrl || '',
          avatarPreview: player.avatarUrl || '',
          gender: gender.id,
          genderLabel: gender.label,
        })
      })
      .catch(function onError(error) {
        self.setData({
          loading: false,
          error: (error && error.message) || '云端未连接，暂时无法保存档案',
        })
      })
  },

  onNicknameInput(event) {
    this.setData({ nickname: event.detail.value || '' })
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

  onSubmit() {
    if (this.data.saving || this.data.uploadingAvatar) return
    const checked = cloudUtils.normalizeNickname(this.data.nickname)
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' })
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
      .then(function onSaved() {
        try {
          wx.removeStorageSync(SKIP_KEY)
        } catch (error) {
          // ignore
        }
        wx.showToast({ title: '档案已创建', icon: 'success' })
        setTimeout(function goHome() {
          wx.reLaunch({ url: '/pages/home/index' })
        }, 450)
      })
      .catch(function onError(error) {
        self.setData({ saving: false })
        wx.showToast({ title: (error && error.message) || '保存失败，请重试', icon: 'none' })
      })
  },

  onSkip() {
    try {
      wx.setStorageSync(SKIP_KEY, true)
    } catch (error) {
      // ignore
    }
    wx.reLaunch({ url: '/pages/home/index' })
  },

  onRetry() {
    this.refresh()
  },

  onShareAppMessage() {
    return {
      title: '小游戏合集：2048 + 数字华容道，来建个档案一起玩',
      path: '/pages/home/index',
    }
  },
})
