/**
 * 云函数侧校验：日期/周、每日种子、成绩与棋局重放。
 * 纯函数，不依赖 wx-server-sdk，便于 Node 单元测试。
 */
const {
  isSolved,
  shuffleBoard,
  moveBySwipe,
} = require('./klotski')
const { createSeededRandom } = require('./random')
const { createGameState, applyMove, GAME_STATUS } = require('./engine')

const MAX_TIME_MS = 6 * 60 * 60 * 1000
const MIN_TIME_MS = 1000
const MAX_DIRECTIONS = 5000
const VALID_DIRECTIONS = ['up', 'down', 'left', 'right']
const GAMES = ['2048', 'klotski3', 'klotski4']

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

function chinaParts(date) {
  const shifted = new Date((date || new Date()).getTime() + 8 * 60 * 60 * 1000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  }
}

function dateKey(date) {
  const parts = chinaParts(date)
  return parts.year + '-' + pad2(parts.month) + '-' + pad2(parts.day)
}

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

function hashSeed(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function dailySeed(game, key) {
  return hashSeed(String(game) + '|' + String(key))
}

function dailyInfo(now) {
  const key = dateKey(now)
  const games = {
    '2048': dailySeed('2048', key),
    klotski3: dailySeed('klotski3', key),
    klotski4: dailySeed('klotski4', key),
  }
  return {
    dateKey: key,
    game: 'klotski3',
    size: 3,
    seed: games.klotski3,
    games,
  }
}

function assertTime(timeMs) {
  if (!Number.isInteger(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
    fail('INVALID_TIME', '用时数据不合法（至少 1 秒）')
  }
}

function verifyKlotskiRun(run, now) {
  const size = Number(run.size)
  if (size !== 3 && size !== 4) fail('INVALID_SIZE', '棋盘尺寸不合法')
  const game = 'klotski' + size
  const seed = Number(run.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    fail('INVALID_SEED', '棋盘种子不合法')
  }
  const directions = run.directions
  if (!Array.isArray(directions) || directions.length < 1 || directions.length > MAX_DIRECTIONS) {
    fail('INVALID_MOVES', '步骤数据不合法')
  }
  for (const direction of directions) {
    if (VALID_DIRECTIONS.indexOf(direction) === -1) fail('INVALID_MOVES', '步骤方向不合法')
  }

  const timeMs = Number(run.timeMs)
  assertTime(timeMs)

  // 每日挑战先校验日期/种子，再重放，避免用错误种子重放得到误导性的错误码
  const daily = Boolean(run.daily)
  let dailyKey = ''
  if (daily) {
    const info = dailyInfo(now)
    dailyKey = info.dateKey
    if (run.dailyKey && run.dailyKey !== dailyKey) {
      fail('DAILY_EXPIRED', '每日挑战日期已变化，请重新进入')
    }
    if (seed !== info.games[game]) fail('DAILY_SEED_MISMATCH', '每日挑战种子不匹配')
  }

  const steps = size === 3 ? 200 : 500
  let board = shuffleBoard(size, createSeededRandom(seed), steps)
  for (const direction of directions) {
    const result = moveBySwipe(board, direction)
    if (!result.moved) fail('INVALID_REPLAY', '步骤与棋盘不匹配')
    board = result.board
  }
  if (!isSolved(board)) fail('NOT_SOLVED', '棋局并未完成')

  const moves = directions.length
  if (run.moves != null && Number(run.moves) !== moves) {
    fail('MOVES_MISMATCH', '步数与步骤不一致')
  }

  return { game, size, seed, moves, timeMs, daily, dailyKey }
}

function verify2048Run(run, now) {
  const seed = Number(run.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    fail('INVALID_SEED', '棋盘种子不合法')
  }
  const directions = run.directions
  if (!Array.isArray(directions) || directions.length < 1 || directions.length > 20000) {
    fail('INVALID_MOVES', '步骤数据不合法')
  }
  for (const direction of directions) {
    if (VALID_DIRECTIONS.indexOf(direction) === -1) fail('INVALID_MOVES', '步骤方向不合法')
  }
  const timeMs = Number(run.timeMs)
  assertTime(timeMs)

  const daily = Boolean(run.daily)
  let dailyKey = ''
  if (daily) {
    const info = dailyInfo(now)
    dailyKey = info.dateKey
    if (run.dailyKey && run.dailyKey !== dailyKey) {
      fail('DAILY_EXPIRED', '每日挑战日期已变化，请重新进入')
    }
    if (seed !== info.games['2048']) fail('DAILY_SEED_MISMATCH', '每日挑战种子不匹配')
  }

  const rng = createSeededRandom(seed)
  const nowFn = function fixedNow() {
    return 0
  }
  let state = createGameState({ random: rng, best: 0, now: nowFn })
  for (const direction of directions) {
    const applied = applyMove(state, direction, { random: rng, now: nowFn })
    if (!applied.result.moved) fail('INVALID_REPLAY', '步骤与棋盘不匹配')
    state = applied.state
  }
  if (state.status === GAME_STATUS.PLAYING) {
    fail('NOT_FINISHED', '2048 棋局尚未结束')
  }
  const score = Number(run.score)
  if (!Number.isInteger(score) || score < 0 || score > 100000000) {
    fail('INVALID_SCORE', '分数不合法')
  }
  if (state.score !== score) fail('SCORE_MISMATCH', '分数与步骤不一致')
  const moves = Number(run.moves)
  if (!Number.isInteger(moves) || moves !== state.moves) {
    fail('MOVES_MISMATCH', '步数与步骤不一致')
  }

  return { game: '2048', score, moves, timeMs, daily, dailyKey, seed }
}

function verifyRun(event, now) {
  if (event.game === '2048') return verify2048Run(event, now)
  if (event.game === 'klotski3' || event.game === 'klotski4') return verifyKlotskiRun(event, now)
  fail('INVALID_GAME', '不支持的游戏类型')
  return null
}

function periodKeys(run, now) {
  // 每日挑战保留玩法，但不单独生成“今日挑战排行榜”；成绩只进总榜/周榜。
  return ['all', 'week:' + weekKey(now)]
}

function isBetter(game, candidate, existing) {
  if (!existing) return true
  if (game === '2048') {
    if (!existing.score && !existing.moves) return true
    if (candidate.score !== existing.score) return candidate.score > existing.score
    return candidate.moves < existing.moves
  }
  // 兼容旧数据：moves 缺失/为 0 的记录不能当作“0 步最佳”卡住新成绩
  if (!existing.moves || existing.moves <= 0) return true
  if (candidate.moves !== existing.moves) return candidate.moves < existing.moves
  return candidate.timeMs < existing.timeMs
}

function normalizeNickname(input) {
  const nickname = String(input == null ? '' : input).replace(/\s+/g, ' ').trim()
  if (nickname.length < 2 || nickname.length > 12) {
    fail('INVALID_NICKNAME', '昵称需要 2–12 个字符')
  }
  if (/[<>\n\r]/.test(nickname)) fail('INVALID_NICKNAME', '昵称包含不支持的字符')
  return nickname
}

module.exports = {
  GAMES,
  dateKey,
  weekKey,
  dailySeed,
  dailyInfo,
  verifyRun,
  verifyKlotskiRun,
  verify2048Run,
  periodKeys,
  isBetter,
  normalizeNickname,
  fail,
}
