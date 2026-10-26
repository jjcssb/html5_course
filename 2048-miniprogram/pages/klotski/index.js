const storageModule = require('../../utils/storage')
const themeModule = require('../../utils/theme')
const { createKlotskiStorage } = require('../../utils/klotski-storage')
const { formatDuration } = require('../../utils/klotski')

const PREVIEW = {
  3: [1, 2, 3, 4, 5, 6, 7, 0, 8],
  4: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0],
}

function buildPreview(size) {
  return PREVIEW[size].map(function mapCell(value, index) {
    return { key: 'c' + index, value, blank: value === 0 }
  })
}

Page({
  data: {
    theme: 'light',
    sizes: [],
  },

  onLoad() {
    this.storage = storageModule.createWxStorage()
    this.klotskiStorage = createKlotskiStorage()
    this.refresh()
  },

  onShow() {
    if (this.storage) this.refresh()
  },

  refresh() {
    const theme = this.storage.loadTheme()
    const best3 = this.klotskiStorage.loadBest(3)
    const best4 = this.klotskiStorage.loadBest(4)
    this.setData({
      theme,
      sizes: [
        {
          size: 3,
          label: '3 × 3',
          tag: '入门',
          desc: '8 个数字，适合快速上手',
          best: this.formatBest(best3),
          preview: buildPreview(3),
        },
        {
          size: 4,
          label: '4 × 4',
          tag: '挑战',
          desc: '15 个数字，更考验耐心与规划',
          best: this.formatBest(best4),
          preview: buildPreview(4),
        },
      ],
    })
    this.applyNavBar(theme)
  },

  formatBest(record) {
    if (!record) return '暂无记录'
    return record.moves + ' 步 · ' + formatDuration(record.timeMs)
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

  onSelectSize(event) {
    const size = Number(event.currentTarget.dataset.size)
    if (size !== 3 && size !== 4) return
    wx.navigateTo({ url: '/pages/klotski/game/index?size=' + size })
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/home/index' })
  },

  onShareAppMessage() {
    return {
      title: '数字华容道：3×3 / 4×4，你能用多少步完成？',
      path: '/pages/klotski/index',
    }
  },
})
