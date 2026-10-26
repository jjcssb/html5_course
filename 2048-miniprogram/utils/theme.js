/** 主题常量（与 H5 版保持一致）。 */
const THEME_OPTIONS = Object.freeze([
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'retro', label: '复古' },
])

const THEME_BACKGROUND = Object.freeze({
  light: '#faf8ef',
  dark: '#121419',
  retro: '#efe0c3',
})

const NAV_BAR_COLOR = Object.freeze({
  light: { backgroundColor: '#faf8ef', frontColor: '#000000' },
  dark: { backgroundColor: '#121419', frontColor: '#ffffff' },
  retro: { backgroundColor: '#efe0c3', frontColor: '#000000' },
})

module.exports = { THEME_OPTIONS, THEME_BACKGROUND, NAV_BAR_COLOR }
