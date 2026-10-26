/**
 * 游戏状态机单元测试（小程序版）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { maxTileValue } = require('../../utils/board')
const {
  END_REASON,
  GAME_STATUS,
  applyMove,
  buildRecord,
  continueAfterWin,
  createGameState,
  restartGame,
} = require('../../utils/engine')
const { createSeededRandom } = require('../../utils/random')

const ZERO_ROW = [0, 0, 0, 0]

function makeState(partial) {
  const changes = partial || {}
  const board = changes.board || [ZERO_ROW.slice(), ZERO_ROW.slice(), ZERO_ROW.slice(), ZERO_ROW.slice()]
  const state = {
    board,
    score: 0,
    best: 0,
    status: GAME_STATUS.PLAYING,
    winAcknowledged: false,
    moves: 0,
    maxTile: maxTileValue(board),
    startedAt: 0,
    lastSpawned: [],
  }
  return Object.assign(state, changes, {
    board,
    maxTile: changes.maxTile === undefined ? maxTileValue(board) : changes.maxTile,
  })
}

const randomZero = () => 0

test('createGameState：生成两个数字、初始分数为 0、状态为进行中', () => {
  const state = createGameState({ random: createSeededRandom(1), now: () => 1000, best: 500 })
  const tiles = state.board.flat().filter((value) => value !== 0)
  assert.equal(tiles.length, 2)
  assert.equal(state.score, 0)
  assert.equal(state.best, 500)
  assert.equal(state.status, GAME_STATUS.PLAYING)
  assert.equal(state.winAcknowledged, false)
  assert.equal(state.moves, 0)
  assert.equal(state.startedAt, 1000)
  assert.equal(state.lastSpawned.length, 2)
})

test('createGameState：异常最高分被规整为 0', () => {
  for (const best of [-1, 1.5, '300', NaN, Infinity, null, undefined]) {
    assert.equal(createGameState({ random: createSeededRandom(1), best }).best, 0, 'best=' + String(best))
  }
})

test('有效移动：计分、最高分、步数、生成一个新数字都正确', () => {
  const state = makeState({
    board: [
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    best: 10,
  })
  const { state: next, result } = applyMove(state, 'left', { random: randomZero, now: () => 5000 })

  assert.equal(result.moved, true)
  assert.equal(result.gained, 4)
  assert.equal(result.spawned.value, 2)
  assert.equal(result.spawned.row, 0)
  assert.equal(result.spawned.col, 1)
  assert.deepEqual(next.board[0], [4, 2, 0, 0])
  assert.equal(next.score, 4)
  assert.equal(next.best, 10)
  assert.equal(next.moves, 1)
  assert.equal(next.maxTile, 4)
  assert.equal(next.status, GAME_STATUS.PLAYING)
  assert.equal(result.won, false)
  assert.equal(result.over, false)
})

test('有效移动后棋盘上只新增一个数字', () => {
  const state = makeState({
    board: [
      [2, 2, 4, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  })
  const before = state.board.flat().filter(Boolean).length
  const { state: next } = applyMove(state, 'left', { random: randomZero })
  assert.equal(next.board.flat().filter(Boolean).length, before - 1 + 1)
})

test('无效移动：不生成数字、不加分、步数不变、返回原状态', () => {
  const state = makeState({
    board: [
      [2, 4, 2, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    best: 88,
    score: 12,
    moves: 3,
  })
  const { state: next, result } = applyMove(state, 'left', { random: randomZero })
  assert.equal(result.moved, false)
  assert.equal(result.blocked, false)
  assert.equal(result.spawned, null)
  assert.equal(next, state)
  assert.equal(next.score, 12)
  assert.equal(next.best, 88)
  assert.equal(next.moves, 3)
})

test('一次移动多次合并：得分与结果棋盘正确', () => {
  const state = makeState({
    board: [
      [2, 2, 4, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  })
  const { state: next, result } = applyMove(state, 'left', { random: randomZero })
  assert.equal(result.gained, 12)
  assert.equal(next.score, 12)
  assert.equal(next.best, 12)
  assert.deepEqual(next.board[0].slice(0, 2), [4, 8])
})

test('首次合成 2048：触发胜利并保留棋盘与分数', () => {
  const state = makeState({
    board: [
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  })
  const { state: wonState, result } = applyMove(state, 'left', { random: randomZero })
  assert.equal(result.won, true)
  assert.equal(wonState.status, GAME_STATUS.WON)
  assert.equal(wonState.score, 2048)
  assert.equal(wonState.best, 2048)
  assert.equal(wonState.winAcknowledged, false)
  assert.ok(wonState.board.flat().indexOf(2048) !== -1)
})

test('继续游戏：保留棋盘与分数、记录已提示、不重复弹胜利提示', () => {
  const wonState = makeState({
    board: [
      [2048, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    status: GAME_STATUS.WON,
    score: 2048,
    best: 2048,
    maxTile: 2048,
  })
  const { state: playing, result } = continueAfterWin(wonState)
  assert.equal(result.continued, true)
  assert.equal(result.over, false)
  assert.equal(playing.status, GAME_STATUS.PLAYING)
  assert.equal(playing.winAcknowledged, true)
  assert.deepEqual(playing.board, wonState.board)
  assert.equal(playing.score, 2048)

  const stateWithSecond = Object.assign({}, playing, {
    board: [
      [2048, 1024, 1024, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  })
  const { state: after, result: afterResult } = applyMove(stateWithSecond, 'left', {
    random: randomZero,
  })
  assert.equal(afterResult.won, false)
  assert.equal(after.status, GAME_STATUS.PLAYING)
  assert.equal(after.board.flat().filter((value) => value === 2048).length, 2)
})

test('继续游戏时若棋盘已无路可走，则立即进入结束状态并给出一条战绩', () => {
  const fullNoMove = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]
  const wonState = makeState({
    board: fullNoMove,
    status: GAME_STATUS.WON,
    score: 2048,
    best: 2048,
    moves: 100,
    maxTile: 2048,
    startedAt: 0,
  })
  const { state: next, result } = continueAfterWin(wonState, { now: () => 60000 })
  assert.equal(next.status, GAME_STATUS.OVER)
  assert.equal(result.over, true)
  assert.ok(result.record)
  assert.equal(result.record.endedBy, END_REASON.GAME_OVER)
  assert.equal(result.record.durationMs, 60000)
  assert.equal(result.record.won, true)
})

test('非胜利状态下调用“继续游戏”不做任何改变', () => {
  const state = makeState()
  const { state: next, result } = continueAfterWin(state)
  assert.equal(result.continued, false)
  assert.equal(next, state)
  const overState = makeState({ status: GAME_STATUS.OVER })
  assert.equal(continueAfterWin(overState).result.continued, false)
})

test('游戏结束：棋盘填满且无可合并方块时正确结束', () => {
  const state = makeState({
    board: [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 4],
    ],
    score: 100,
    best: 100,
    moves: 20,
  })
  const { state: next, result } = applyMove(state, 'left', { random: randomZero })
  assert.equal(result.over, true)
  assert.equal(result.won, false)
  assert.equal(next.status, GAME_STATUS.OVER)
  assert.equal(next.score, 108)
  assert.equal(next.board.flat().filter(Boolean).length, 16)

  const blocked = applyMove(next, 'up', { random: randomZero })
  assert.equal(blocked.result.moved, false)
  assert.equal(blocked.result.blocked, true)
  assert.equal(blocked.state, next)
})

test('游戏结束：满盘但仍可合并时不得误判', () => {
  const state = makeState({
    board: [
      [2, 2, 4, 8],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [16, 32, 64, 128],
    ],
    moves: 10,
  })
  const { state: next, result } = applyMove(state, 'left', { random: randomZero })
  assert.equal(result.over, false)
  assert.equal(next.status, GAME_STATUS.PLAYING)
  assert.equal(next.board.flat().filter(Boolean).length, 16)
})

test('重新开始：清空本局状态，保留最高分', () => {
  const state = makeState({
    board: [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2, 4],
      [8, 16, 32, 64],
    ],
    score: 3000,
    best: 5000,
    status: GAME_STATUS.OVER,
    moves: 88,
    maxTile: 1024,
    winAcknowledged: false,
  })
  const { state: next, result } = restartGame(state, {
    random: createSeededRandom(3),
    now: () => 9000,
  })
  assert.equal(result.abortedRecord, null)
  assert.equal(next.score, 0)
  assert.equal(next.best, 5000)
  assert.equal(next.status, GAME_STATUS.PLAYING)
  assert.equal(next.winAcknowledged, false)
  assert.equal(next.moves, 0)
  assert.equal(next.board.flat().filter(Boolean).length, 2)
  assert.equal(next.startedAt, 9000)
})

test('重新开始：进行中的对局会生成一条“主动重开”的战绩', () => {
  const state = makeState({
    board: [
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    score: 24,
    best: 24,
    moves: 3,
    startedAt: 1000,
  })
  const { result } = restartGame(state, { random: createSeededRandom(4), now: () => 11000 })
  assert.ok(result.abortedRecord)
  assert.equal(result.abortedRecord.endedBy, END_REASON.RESTART)
  assert.equal(result.abortedRecord.score, 24)
  assert.equal(result.abortedRecord.durationMs, 10000)
  assert.equal(result.abortedRecord.moves, 3)

  const fresh = restartGame(makeState(), { random: createSeededRandom(5), now: () => 0 })
  assert.equal(fresh.result.abortedRecord, null)
})

test('buildRecord：记录本局得分、最大数字、步数、时长与胜利标记', () => {
  const state = makeState({ score: 1234, maxTile: 2048, moves: 56, startedAt: 1000, winAcknowledged: true })
  assert.deepEqual(buildRecord(state, END_REASON.GAME_OVER, 31000), {
    score: 1234,
    maxTile: 2048,
    moves: 56,
    durationMs: 30000,
    endedBy: END_REASON.GAME_OVER,
    endedAt: 31000,
    won: true,
  })
})
