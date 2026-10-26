/**
 * 游戏状态机（纯函数，微信小程序 / Node 通用）。
 *
 * 状态字段：
 * - board / score / best
 * - status: 'playing' | 'won' | 'over'
 * - winAcknowledged: 是否已选择“继续游戏”
 * - moves / maxTile / startedAt
 *
 * 不访问 wx API、不操作页面；最高分与战绩由页面层落库。
 */
const boardModule = require('./board')
const WIN_VALUE = boardModule.WIN_VALUE
const createInitialBoard = boardModule.createInitialBoard
const isGameOver = boardModule.isGameOver
const maxTileValue = boardModule.maxTileValue
const moveBoard = boardModule.move
const hasWon = boardModule.hasWon
const spawnRandomTile = boardModule.spawnRandomTile

const GAME_STATUS = Object.freeze({
  PLAYING: 'playing',
  WON: 'won',
  OVER: 'over',
})

const END_REASON = Object.freeze({
  GAME_OVER: 'gameover',
  RESTART: 'restart',
})

const DEFAULT_NOW = () => Date.now()

function normalizeBest(best) {
  return Number.isSafeInteger(best) && best >= 0 ? best : 0
}

/** 创建一局新游戏的状态。 */
function createGameState(options) {
  const opts = options || {}
  const random = opts.random || Math.random
  const now = opts.now || DEFAULT_NOW
  const created = createInitialBoard(random)
  return {
    board: created.board,
    score: 0,
    best: normalizeBest(opts.best),
    status: GAME_STATUS.PLAYING,
    winAcknowledged: false,
    moves: 0,
    maxTile: maxTileValue(created.board),
    startedAt: now(),
    lastSpawned: created.spawned,
  }
}

/** 组装一条历史战绩记录。 */
function buildRecord(state, endedBy, endedAt) {
  return {
    score: state.score,
    maxTile: state.maxTile,
    moves: state.moves,
    durationMs: Math.max(0, endedAt - state.startedAt),
    endedBy,
    endedAt,
    won: state.winAcknowledged || state.maxTile >= WIN_VALUE,
  }
}

/**
 * 执行一次移动。无效移动原样返回旧 state，不生成数字、不加分。
 * 返回 { state, result }，result.slides / merges / spawned 供页面播放动画。
 */
function applyMove(state, direction, options) {
  const opts = options || {}
  const random = opts.random || Math.random
  const now = opts.now || DEFAULT_NOW

  if (state.status !== GAME_STATUS.PLAYING) {
    return {
      state,
      result: {
        moved: false,
        blocked: true,
        direction,
        gained: 0,
        slides: [],
        merges: [],
        spawned: null,
        won: false,
        over: state.status === GAME_STATUS.OVER,
      },
    }
  }

  const movedBoard = moveBoard(state.board, direction)
  if (!movedBoard.moved) {
    return {
      state,
      result: {
        moved: false,
        blocked: false,
        direction,
        gained: 0,
        slides: [],
        merges: [],
        spawned: null,
        won: false,
        over: false,
      },
    }
  }

  // 只有棋盘确实变化时才生成新数字
  const spawnedResult = spawnRandomTile(movedBoard.board, random)
  const boardAfterSpawn = spawnedResult.board
  const spawned = spawnedResult.spawned
  const score = state.score + movedBoard.gained
  const best = Math.max(state.best, score)
  const maxTile = maxTileValue(boardAfterSpawn)

  let status = GAME_STATUS.PLAYING
  let won = false
  let over = false

  if (!state.winAcknowledged && hasWon(boardAfterSpawn)) {
    // 首次合成 2048：先弹胜利提示，结束判定留到“继续游戏”之后处理
    status = GAME_STATUS.WON
    won = true
  } else if (isGameOver(boardAfterSpawn)) {
    status = GAME_STATUS.OVER
    over = true
  }

  const nextState = Object.assign({}, state, {
    board: boardAfterSpawn,
    score,
    best,
    status,
    moves: state.moves + 1,
    maxTile,
    lastSpawned: spawned ? [spawned] : [],
  })

  return {
    state: nextState,
    result: {
      moved: true,
      blocked: false,
      direction,
      gained: movedBoard.gained,
      slides: movedBoard.slides,
      merges: movedBoard.merges,
      spawned,
      won,
      over,
    },
  }
}

/** 选择“继续游戏”：保留棋盘与分数，并允许继续合成更大数字。 */
function continueAfterWin(state, options) {
  const opts = options || {}
  const now = opts.now || DEFAULT_NOW
  if (state.status !== GAME_STATUS.WON) {
    return {
      state,
      result: { continued: false, over: state.status === GAME_STATUS.OVER, record: null },
    }
  }

  const over = isGameOver(state.board)
  const nextState = Object.assign({}, state, {
    status: over ? GAME_STATUS.OVER : GAME_STATUS.PLAYING,
    winAcknowledged: true,
  })

  return {
    state: nextState,
    result: {
      continued: true,
      over,
      record: over ? buildRecord(nextState, END_REASON.GAME_OVER, now()) : null,
    },
  }
}

/**
 * 重新开始：重置棋盘、分数、胜利与结束状态，保留历史最高分。
 * 若当前局已有进度且不是正常结束，返回一条“主动重开”战绩。
 */
function restartGame(state, options) {
  const opts = options || {}
  const random = opts.random || Math.random
  const now = opts.now || DEFAULT_NOW
  const abortedRecord =
    state.moves > 0 && state.score > 0 && state.status !== GAME_STATUS.OVER
      ? buildRecord(state, END_REASON.RESTART, now())
      : null

  const nextState = createGameState({ best: state.best, random, now })
  return { state: nextState, result: { abortedRecord } }
}

module.exports = {
  GAME_STATUS,
  END_REASON,
  createGameState,
  applyMove,
  continueAfterWin,
  restartGame,
  buildRecord,
}
