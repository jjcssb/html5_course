/**
 * 云端/每日挑战相关的纯函数（客户端与云函数保持同一算法）。
 * 不依赖 wx、不依赖页面，可在 Node 中直接测试。
 */

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

/** 取中国标准时间（UTC+8）的日期部分。 */
function chinaParts(date) {
  const source = date || new Date()
  const shifted = new Date(source.getTime() + 8 * 60 * 60 * 1000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  }
}

/** YYYY-MM-DD（中国时区）。 */
function dateKey(date) {
  const parts = chinaParts(date)
  return parts.year + '-' + pad2(parts.month) + '-' + pad2(parts.day)
}

/** ISO 周：YYYY-Www（中国时区，周一为一周开始）。 */
function weekKey(date) {
  const parts = chinaParts(date)
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const dayNumber = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNumber + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3)
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return target.getUTCFullYear() + '-W' + pad2(week)
}

/** FNV-1a 32 位哈希，保证同一字符串得到同一 seed。 */
function hashSeed(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 每日挑战种子：只和日期、游戏有关。 */
function dailySeed(game, key) {
  return hashSeed(String(game) + '|' + String(key))
}

/** 云端不可用时的本地每日挑战（日期/种子算法与云端一致）。 */
function getLocalDailyInfo(date, game) {
  const key = dateKey(date)
  const target = game || 'klotski3'
  const size = target === 'klotski4' || target === '2048' ? 4 : 3
  return {
    dateKey: key,
    game: target,
    size,
    seed: dailySeed(target, key),
  }
}

/** 三个游戏的每日种子，用于首页/游戏页本地降级。 */
function getLocalDailySeeds(date) {
  const key = dateKey(date)
  return {
    dateKey: key,
    games: {
      '2048': dailySeed('2048', key),
      klotski3: dailySeed('klotski3', key),
      klotski4: dailySeed('klotski4', key),
    },
  }
}

/** 昵称校验：2–12 个字符，去除首尾空格，不允许换行/尖括号。 */
function normalizeNickname(input) {
  const nickname = String(input == null ? '' : input).replace(/\s+/g, ' ').trim()
  if (nickname.length < 2 || nickname.length > 12) {
    return { ok: false, message: '昵称需要 2–12 个字符' }
  }
  if (/[<>\n\r]/.test(nickname)) {
    return { ok: false, message: '昵称包含不支持的字符' }
  }
  return { ok: true, nickname }
}

/** 排行榜展示值。 */
function formatRankValue(game, row, formatDuration) {
  if (!row) return ''
  if (game === '2048') return String(row.score || 0) + ' 分'
  const duration = formatDuration ? formatDuration(row.timeMs || 0) : ''
  return String(row.moves || 0) + ' 步' + (duration ? ' · ' + duration : '')
}

module.exports = {
  dateKey,
  weekKey,
  hashSeed,
  dailySeed,
  getLocalDailyInfo,
  getLocalDailySeeds,
  normalizeNickname,
  formatRankValue,
}
