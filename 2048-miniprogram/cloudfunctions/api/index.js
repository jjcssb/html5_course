/**
 * 小游戏合集云函数（单一 api 入口）：
 *   login / submitRun / leaderboard / daily / updateProfile
 *
 * 数据库集合：
 *   players  : 每个微信用户一条，保存昵称与各游戏最佳记录
 *   rankings : 每个用户 × 游戏 × 周期（all / week / daily）一条，用于排行榜
 *
 * 所有写操作都走云函数，客户端不直接写数据库；集合可用默认权限。
 */
const cloud = require('wx-server-sdk')
const verify = require('./verify')
const achievements = require('./achievements')
const klotski = require('./klotski')
const profileOptions = require('./profile')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTIONS = {
  PLAYERS: 'players',
  RANKINGS: 'rankings',
}

const BEST_FIELDS = {
  '2048': {
    score: 'best2048Score',
    moves: 'best2048Moves',
    time: 'best2048Time',
    at: 'best2048At',
  },
  klotski3: { moves: 'best3Moves', time: 'best3Time', at: 'best3At' },
  klotski4: { moves: 'best4Moves', time: 'best4Time', at: 'best4At' },
}

async function ensureCollections() {
  for (const name of Object.values(COLLECTIONS)) {
    try {
      await db.collection(name).limit(1).get()
    } catch (error) {
      if (typeof db.createCollection === 'function') {
        try {
          await db.createCollection(name)
        } catch (createError) {
          // 已存在或权限不足，交给后续查询给出明确错误
        }
      }
    }
  }
}

function defaultNickname(openid) {
  let hash = 0
  const text = String(openid || '')
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return '玩家' + String(1000 + (hash % 9000))
}

async function getPlayer(openid) {
  const collection = db.collection(COLLECTIONS.PLAYERS)
  const found = await collection.where({ _openid: openid }).limit(1).get()
  if (found.data.length > 0) return found.data[0]

  const data = {
    _openid: openid,
    nickname: defaultNickname(openid),
    nicknameSet: false,
    profileCompleted: false,
    gender: 'private',
    avatar: 'a1',
    avatarUrl: '',
    totalRuns: 0,
    achievements: [],
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  }
  const added = await collection.add({ data })
  return Object.assign({ _id: added._id }, data)
}

function bestOf(game, run) {
  if (game === '2048') {
    return { score: run.score, moves: run.moves, timeMs: run.timeMs, at: new Date() }
  }
  return { moves: run.moves, timeMs: run.timeMs, at: new Date() }
}

/** 从扁平字段还原玩家最佳记录，兼容以前保存过 null 的旧文档。 */
function playerBest(player, game) {
  const fields = BEST_FIELDS[game]
  if (!fields) return null
  const hasValue =
    player[fields.moves] != null ||
    player[fields.time] != null ||
    (fields.score && player[fields.score] != null)
  if (!hasValue) return null
  return {
    score: fields.score ? player[fields.score] || 0 : 0,
    moves: player[fields.moves] || 0,
    timeMs: player[fields.time] || 0,
    at: player[fields.at] || null,
  }
}

/** 最佳记录写成扁平字段，避免 CloudBase 对 null 嵌套对象合并失败。 */
function bestUpdateFields(game, best) {
  const fields = BEST_FIELDS[game]
  const update = {}
  update[fields.moves] = best.moves
  update[fields.time] = best.timeMs
  if (fields.score) update[fields.score] = best.score || 0
  update[fields.at] = best.at
  return update
}

function rankValue(game, row) {
  return {
    nickname: row.nickname || '玩家',
    avatar: row.avatar || 'a1',
    avatarUrl: row.avatarUrl || '',
    score: row.score || 0,
    moves: row.moves || 0,
    timeMs: row.timeMs || 0,
  }
}

function normalizeAvatarUrl(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length > 600 || text.indexOf('cloud://') !== 0) {
    verify.fail('INVALID_AVATAR_URL', '头像地址不合法')
  }
  return text
}

async function upsertRanking(openid, nickname, game, periodKey, run, avatar, avatarUrl) {
  const collection = db.collection(COLLECTIONS.RANKINGS)
  const candidate = { score: run.score || 0, moves: run.moves || 0, timeMs: run.timeMs || 0 }
  const profileFields = {
    avatar: avatar || 'a1',
    avatarUrl: avatarUrl || '',
  }
  const existing = await collection
    .where({ _openid: openid, game, periodKey })
    .limit(1)
    .get()

  if (existing.data.length === 0) {
    await collection.add({
      data: Object.assign(
        {
          _openid: openid,
          nickname,
          game,
          periodKey,
          dailyKey: run.dailyKey || '',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
        profileFields,
        candidate,
      ),
    })
    return true
  }

  const current = existing.data[0]
  if (!verify.isBetter(game, candidate, current)) {
    await collection.doc(current._id).update({
      data: Object.assign({ nickname, updatedAt: db.serverDate() }, profileFields),
    })
    return false
  }

  await collection.doc(current._id).update({
    data: Object.assign(
      { nickname, dailyKey: run.dailyKey || '', updatedAt: db.serverDate() },
      profileFields,
      candidate,
    ),
  })
  return true
}

async function computeRank(game, periodKey, candidate, openid) {
  const collection = db.collection(COLLECTIONS.RANKINGS)
  const base = { game, periodKey }
  // 排除自己的旧记录，避免刚写入后读到旧值/重复记录导致“自己排在自己前面”
  if (openid) base._openid = _.neq(openid)
  if (game === '2048') {
    const higher = await collection
      .where(Object.assign({}, base, { score: _.gt(candidate.score) }))
      .count()
    const tied = await collection
      .where(Object.assign({}, base, { score: candidate.score, moves: _.lt(candidate.moves) }))
      .count()
    return higher.total + tied.total + 1
  }
  const fewer = await collection
    .where(Object.assign({}, base, { moves: _.lt(candidate.moves) }))
    .count()
  const tied = await collection
    .where(Object.assign({}, base, { moves: candidate.moves, timeMs: _.lt(candidate.timeMs) }))
    .count()
  return fewer.total + tied.total + 1
}

async function handleLogin(openid) {
  const player = await getPlayer(openid)
  return {
    ok: true,
    openid,
    player,
  }
}

async function handleSubmitRun(event, openid) {
  const player = await getPlayer(openid)
  const now = new Date()
  const run = verify.verifyRun(event, now)
  const nickname = player.nickname || defaultNickname(openid)
  const periods = verify.periodKeys(run, now)

  for (const periodKey of periods) {
    await upsertRanking(
      openid,
      nickname,
      run.game,
      periodKey,
      run,
      player.avatar,
      player.avatarUrl,
    )
  }

  const previousBest = playerBest(player, run.game)
  const candidateBest = bestOf(run.game, run)
  const isBest = verify.isBetter(run.game, candidateBest, previousBest)

  const playerUpdate = {
    nickname,
    totalRuns: _.inc(1),
    updatedAt: db.serverDate(),
  }
  if (isBest) Object.assign(playerUpdate, bestUpdateFields(run.game, candidateBest))

  const previousAchievements = Array.isArray(player.achievements) ? player.achievements : []
  const newAchievementIds = achievements
    .unlockForRun(run)
    .filter(function notUnlocked(id) {
      return previousAchievements.indexOf(id) === -1
    })
  const mergedAchievements = achievements.mergeUnlocked(previousAchievements, newAchievementIds)
  if (mergedAchievements.length !== previousAchievements.length) {
    playerUpdate.achievements = mergedAchievements
  }
  await db.collection(COLLECTIONS.PLAYERS).doc(player._id).update({ data: playerUpdate })

  const rankPeriod = 'all'
  const rank = await computeRank(run.game, rankPeriod, candidateBest, openid)
  return {
    ok: true,
    game: run.game,
    isBest,
    rank,
    rankPeriod: 'all',
    best: isBest ? candidateBest : previousBest,
    nickname,
    achievements: mergedAchievements,
    newAchievements: newAchievementIds.map(function mapAchievement(id) {
      return achievements.describe(id)
    }),
  }
}

async function handleLeaderboard(event, openid) {
  const game = String(event.game || '')
  if (verify.GAMES.indexOf(game) === -1) verify.fail('INVALID_GAME', '排行榜游戏类型不合法')
  let period = String(event.period || 'all')
  if (['all', 'week', 'daily'].indexOf(period) === -1) period = 'all'

  const now = new Date()
  let periodKey = 'all'
  if (period === 'week') periodKey = 'week:' + verify.weekKey(now)
  if (period === 'daily') periodKey = 'daily:' + verify.dateKey(now)

  // 取最多 300 条，在云函数内排序后按页返回；避免依赖云数据库复合索引。
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  let allRows = []
  for (let skip = 0; skip < 300; skip += 100) {
    const pageResult = await db
      .collection(COLLECTIONS.RANKINGS)
      .where({ game, periodKey })
      .skip(skip)
      .limit(100)
      .get()
    allRows = allRows.concat(pageResult.data)
    if (pageResult.data.length < 100) break
  }
  const rows = allRows
    .filter(function validRow(row) {
      return game === '2048' || (row.moves || 0) > 0
    })
    .slice()
    .sort(function sortRows(left, right) {
    if (game === '2048') {
      if ((right.score || 0) !== (left.score || 0)) return (right.score || 0) - (left.score || 0)
      return (left.moves || 0) - (right.moves || 0)
    }
    if ((left.moves || 0) !== (right.moves || 0)) return (left.moves || 0) - (right.moves || 0)
    return (left.timeMs || 0) - (right.timeMs || 0)
  })
  const total = rows.length
  const start = (page - 1) * pageSize
  const list = rows.slice(start, start + pageSize).map(function mapRow(row, index) {
    return Object.assign({ rank: start + index + 1, isMe: row._openid === openid }, rankValue(game, row))
  })

  const mineResult = await db
    .collection(COLLECTIONS.RANKINGS)
    .where({ game, periodKey, _openid: openid })
    .limit(1)
    .get()
  const mineRaw = mineResult.data[0] || null
  const mine = game === '2048' || (mineRaw && (mineRaw.moves || 0) > 0) ? mineRaw : null
  let myRank = null
  if (mine) {
    myRank = await computeRank(game, periodKey, {
      score: mine.score || 0,
      moves: mine.moves || 0,
      timeMs: mine.timeMs || 0,
    }, openid)
  }

  return {
    ok: true,
    game,
    period,
    periodKey,
    list,
    myBest: mine ? Object.assign({ rank: myRank }, rankValue(game, mine)) : null,
    myRank,
    total,
    page,
    pageSize,
    hasMore: start + list.length < total,
  }
}

async function handleDaily(openid) {
  const info = verify.dailyInfo(new Date())
  return {
    ok: true,
    dateKey: info.dateKey,
    game: info.game,
    size: info.size,
    seed: info.seed,
    games: info.games,
  }
}

async function handleUpdateProfile(event, openid) {
  const nickname = verify.normalizeNickname(event.nickname)
  const gender = profileOptions.normalizeGender(event.gender)
  const avatar = profileOptions.normalizeAvatar(event.avatar)
  const avatarUrl = normalizeAvatarUrl(event.avatarUrl)
  const player = await getPlayer(openid)
  await db
    .collection(COLLECTIONS.PLAYERS)
    .doc(player._id)
    .update({
      data: {
        nickname,
        nicknameSet: true,
        profileCompleted: true,
        gender,
        avatar,
        avatarUrl,
        updatedAt: db.serverDate(),
      },
    })
  await db
    .collection(COLLECTIONS.RANKINGS)
    .where({ _openid: openid })
    .update({ data: { nickname, avatar, avatarUrl, updatedAt: db.serverDate() } })
  player.nickname = nickname
  player.nicknameSet = true
  player.profileCompleted = true
  player.gender = gender
  player.avatar = avatar
  player.avatarUrl = avatarUrl
  return { ok: true, player }
}

/** 校验并规范化未完成局存档（不参与排行榜，只用于跨设备继续）。 */
function normalizeSavedGame(event) {
  const game = String(event.game || '')
  const sizes = { '2048': 4, klotski3: 3, klotski4: 4 }
  if (Object.prototype.hasOwnProperty.call(sizes, game) === false) {
    verify.fail('INVALID_SAVE_GAME', '存档游戏类型不合法')
  }
  const size = sizes[game]
  const seed = Number(event.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    verify.fail('INVALID_SAVE_SEED', '存档种子不合法')
  }
  const directions = event.directions
  if (!Array.isArray(directions) || directions.length < 1 || directions.length > 20000) {
    verify.fail('INVALID_SAVE_MOVES', '存档步骤不合法')
  }
  for (const direction of directions) {
    if (['up', 'down', 'left', 'right'].indexOf(direction) === -1) {
      verify.fail('INVALID_SAVE_MOVES', '存档步骤方向不合法')
    }
  }
  const moves = Number(event.moves)
  if (!Number.isInteger(moves) || moves !== directions.length) {
    verify.fail('INVALID_SAVE_MOVES', '存档步数不一致')
  }
  const elapsedMs = Number(event.elapsedMs)
  if (!Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 7 * 24 * 3600 * 1000) {
    verify.fail('INVALID_SAVE_TIME', '存档用时不合法')
  }
  const daily = Boolean(event.daily)
  const dailyKey = String(event.dailyKey || '')

  let board = null
  if (game === '2048') {
    if (event.board != null) {
      if (!Array.isArray(event.board) || event.board.length !== 16) {
        verify.fail('INVALID_SAVE_BOARD', '2048 存档棋盘不合法')
      }
      for (const value of event.board) {
        if (!Number.isInteger(value) || value < 0 || (value !== 0 && (value & (value - 1)) !== 0)) {
          verify.fail('INVALID_SAVE_BOARD', '2048 存档数字不合法')
        }
      }
      board = event.board.slice()
    }
  } else {
    if (!Array.isArray(event.board) || event.board.length !== size * size) {
      verify.fail('INVALID_SAVE_BOARD', '华容道存档棋盘不合法')
    }
    if (!klotski.isValidBoard(event.board) || !klotski.isSolvable(event.board)) {
      verify.fail('INVALID_SAVE_BOARD', '华容道存档棋盘不可解')
    }
    board = event.board.slice()
  }

  return {
    game,
    size,
    seed,
    board,
    directions: directions.slice(),
    moves,
    elapsedMs,
    daily,
    dailyKey,
    score: Number.isInteger(Number(event.score)) ? Math.max(0, Number(event.score)) : 0,
  }
}

async function handleSaveState(event, openid) {
  const savedGame = normalizeSavedGame(event)
  const player = await getPlayer(openid)
  await db
    .collection(COLLECTIONS.PLAYERS)
    .doc(player._id)
    .update({ data: { savedGame, updatedAt: db.serverDate() } })
  return { ok: true, savedGame }
}

async function handleLoadState(openid) {
  const player = await getPlayer(openid)
  return { ok: true, savedGame: player.savedGame || null }
}

async function handleClearState(openid) {
  const player = await getPlayer(openid)
  await db
    .collection(COLLECTIONS.PLAYERS)
    .doc(player._id)
    .update({ data: { savedGame: _.remove(), updatedAt: db.serverDate() } })
  return { ok: true }
}

/** 清空成绩但保留昵称/头像/性别，用于清除自动化/测试成绩。 */
async function handleResetScores(openid) {
  const rankings = await db
    .collection(COLLECTIONS.RANKINGS)
    .where({ _openid: openid })
    .remove()
  const player = await getPlayer(openid)
  const removeFields = {
    totalRuns: 0,
    achievements: [],
    savedGame: _.remove(),
    best2048Score: _.remove(),
    best2048Moves: _.remove(),
    best2048Time: _.remove(),
    best2048At: _.remove(),
    best3Moves: _.remove(),
    best3Time: _.remove(),
    best3At: _.remove(),
    best4Moves: _.remove(),
    best4Time: _.remove(),
    best4At: _.remove(),
    updatedAt: db.serverDate(),
  }
  await db.collection(COLLECTIONS.PLAYERS).doc(player._id).update({ data: removeFields })
  return {
    ok: true,
    removedRankings: rankings.stats ? rankings.stats.removed : 0,
    keptNickname: player.nickname || '',
    keptAvatarUrl: player.avatarUrl || '',
  }
}

/** 仅清理当前调用者自己的云端数据，用于测试数据清理/用户重置。 */
async function handleResetMyData(openid) {
  const rankings = await db
    .collection(COLLECTIONS.RANKINGS)
    .where({ _openid: openid })
    .remove()
  const players = await db
    .collection(COLLECTIONS.PLAYERS)
    .where({ _openid: openid })
    .remove()
  return {
    ok: true,
    removedRankings: rankings.stats ? rankings.stats.removed : 0,
    removedPlayers: players.stats ? players.stats.removed : 0,
  }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = context.OPENID
  const action = event && event.action
  try {
    await ensureCollections()
    if (!openid) return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' }

    if (action === 'login') return await handleLogin(openid)
    if (action === 'submitRun') return await handleSubmitRun(event, openid)
    if (action === 'leaderboard') return await handleLeaderboard(event, openid)
    if (action === 'daily') return await handleDaily(openid)
    if (action === 'updateProfile') return await handleUpdateProfile(event, openid)
    if (action === 'saveState') return await handleSaveState(event, openid)
    if (action === 'loadState') return await handleLoadState(openid)
    if (action === 'clearState') return await handleClearState(openid)
    if (action === 'resetMyData') return await handleResetMyData(openid)
    if (action === 'resetMyScores') return await handleResetScores(openid)

    return { ok: false, code: 'UNKNOWN_ACTION', message: '未知操作：' + action }
  } catch (error) {
    console.error('[api] action=' + action, error)
    return {
      ok: false,
      code: error.code || 'SERVER_ERROR',
      message: error.message || '云端服务异常',
    }
  }
}
