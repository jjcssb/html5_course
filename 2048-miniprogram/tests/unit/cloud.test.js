/**
 * 云开发相关纯逻辑测试：
 * - 中国时区日期 / ISO 周 / 每日种子
 * - 云函数成绩重放校验（防止改步数/改棋盘）
 * - 排行榜比较、昵称校验、展示格式
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const verify = require('../../cloudfunctions/api/verify')
const {
  createSolvedBoard,
  isSolved,
  moveBySwipe,
  shuffleBoard,
  DIRECTIONS,
} = require('../../cloudfunctions/api/klotski')
const { createSeededRandom } = require('../../cloudfunctions/api/random')
const { createGameState, applyMove } = require('../../cloudfunctions/api/engine')
const cloudUtils = require('../../utils/cloud-utils')

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

function legalDirections(board) {
  return DIRECTIONS.filter((direction) => moveBySwipe(board, direction).moved)
}

/** 与 shuffleBoard 相同的随机走法，同时记录方向，便于测试重放。 */
function shuffleWithPath(size, seed, steps) {
  const rng = createSeededRandom(seed)
  let board = createSolvedBoard(size)
  let last = null
  const path = []
  const total = steps || (size === 3 ? 200 : 500)
  for (let step = 0; step < total; step += 1) {
    let candidates = legalDirections(board).filter((direction) => !last || OPPOSITE[direction] !== last)
    if (candidates.length === 0) candidates = legalDirections(board)
    const direction = candidates[Math.floor(rng() * candidates.length)]
    board = moveBySwipe(board, direction).board
    path.push(direction)
    last = direction
  }
  if (isSolved(board)) {
    const direction = legalDirections(board).filter((item) => item !== last)[0]
    board = moveBySwipe(board, direction).board
    path.push(direction)
  }
  return { board, path }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code)
}

test('cloud dateKey：中国时区跨日边界正确', () => {
  assert.equal(verify.dateKey(new Date('2026-10-19T15:59:59Z')), '2026-10-19')
  assert.equal(verify.dateKey(new Date('2026-10-19T16:00:00Z')), '2026-10-20')
  assert.equal(cloudUtils.dateKey(new Date('2026-10-19T16:00:00Z')), '2026-10-20')
})

test('weekKey 与每日 seed 稳定且客户端/云函数一致', () => {
  const date = new Date('2026-10-19T04:00:00Z')
  assert.equal(verify.weekKey(date), cloudUtils.weekKey(date))
  assert.equal(verify.dailySeed('klotski3', '2026-10-19'), cloudUtils.dailySeed('klotski3', '2026-10-19'))
  assert.notEqual(
    verify.dailySeed('klotski3', '2026-10-19'),
    verify.dailySeed('klotski3', '2026-10-20'),
  )
  const local = cloudUtils.getLocalDailyInfo(date)
  assert.equal(local.dateKey, '2026-10-19')
  assert.equal(local.seed, verify.dailySeed('klotski3', '2026-10-19'))
  assert.equal(verify.dailyInfo(date).seed, local.seed)
})

test('verify：合法华容道步骤可以通过，步数必须与步骤一致', () => {
  const seed = 424242
  const shuffled = shuffleWithPath(3, seed, 200)
  assert.deepEqual(shuffled.board, shuffleBoard(3, createSeededRandom(seed), 200))
  const directions = shuffled.path.slice().reverse().map((direction) => OPPOSITE[direction])
  const result = verify.verifyKlotskiRun(
    { size: 3, seed, directions, moves: directions.length, timeMs: 12345 },
    new Date('2026-10-19T04:00:00Z'),
  )
  assert.equal(result.game, 'klotski3')
  assert.equal(result.moves, directions.length)
  assert.equal(result.daily, false)

  expectCode(
    () => verify.verifyKlotskiRun({ size: 3, seed, directions, moves: directions.length + 1, timeMs: 1000 }, new Date()),
    'MOVES_MISMATCH',
  )
})

test('verify：步数不足 / 方向非法 / 种子非法会被拒绝', () => {
  const seed = 424242
  const path = shuffleWithPath(3, seed, 200).path.reverse().map((direction) => OPPOSITE[direction])
  expectCode(
    () => verify.verifyKlotskiRun({ size: 3, seed, directions: path.slice(0, -1), moves: path.length - 1, timeMs: 1000 }, new Date()),
    'NOT_SOLVED',
  )
  expectCode(
    () => verify.verifyKlotskiRun({ size: 3, seed, directions: ['jump'], moves: 1, timeMs: 1000 }, new Date()),
    'INVALID_MOVES',
  )
  expectCode(
    () => verify.verifyKlotskiRun({ size: 3, seed: -1, directions: path, moves: path.length, timeMs: 1000 }, new Date()),
    'INVALID_SEED',
  )
  expectCode(
    () => verify.verifyKlotskiRun({ size: 3, seed, directions: path, moves: path.length, timeMs: -1 }, new Date()),
    'INVALID_TIME',
  )
  expectCode(
    () => verify.verifyKlotskiRun({ size: 3, seed, directions: path, moves: path.length, timeMs: 0 }, new Date()),
    'INVALID_TIME',
  )
})

test('verify：每日挑战种子/日期由服务端校验', () => {
  const now = new Date('2026-10-19T04:00:00Z')
  const info = verify.dailyInfo(now)
  const path = shuffleWithPath(3, info.seed, 200).path.reverse().map((direction) => OPPOSITE[direction])
  const good = verify.verifyKlotskiRun(
    {
      size: 3,
      seed: info.seed,
      directions: path,
      moves: path.length,
      timeMs: 8000,
      daily: true,
      dailyKey: info.dateKey,
    },
    now,
  )
  assert.equal(good.daily, true)
  assert.equal(good.dailyKey, '2026-10-19')

  expectCode(
    () =>
      verify.verifyKlotskiRun(
        { size: 3, seed: info.seed + 1, directions: path, moves: path.length, timeMs: 1000, daily: true },
        now,
      ),
    'DAILY_SEED_MISMATCH',
  )
  expectCode(
    () =>
      verify.verifyKlotskiRun(
        { size: 3, seed: info.seed, directions: path, moves: path.length, timeMs: 1000, daily: true, dailyKey: '2026-10-18' },
        now,
      ),
    'DAILY_EXPIRED',
  )
})

function make2048Run(seed) {
  const rng = createSeededRandom(seed)
  const chooser = createSeededRandom((seed ^ 0x9e3779b9) >>> 0)
  const directions = []
  let state = createGameState({ random: rng, best: 0, now: () => 0 })
  let guard = 0
  while (state.status === 'playing' && guard < 5000) {
    guard += 1
    const direction = ['left', 'right', 'up', 'down'][Math.floor(chooser() * 4)]
    const applied = applyMove(state, direction, { random: rng, now: () => 0 })
    if (applied.result.moved) {
      directions.push(direction)
      state = applied.state
    }
  }
  assert.equal(state.status === 'playing', false, '2048 随机局未结束')
  return { seed, directions, score: state.score, moves: state.moves, state }
}

test('verify：2048 种子 + 步骤重放校验', () => {
  const run = make2048Run(123456)
  const result = verify.verify2048Run({
    seed: run.seed,
    directions: run.directions,
    score: run.score,
    moves: run.moves,
    timeMs: 120000,
  })
  assert.equal(result.game, '2048')
  assert.equal(result.score, run.score)
  assert.equal(result.moves, run.moves)

  expectCode(
    () =>
      verify.verify2048Run({
        seed: run.seed,
        directions: run.directions,
        score: run.score + 1,
        moves: run.moves,
        timeMs: 120000,
      }),
    'SCORE_MISMATCH',
  )
  expectCode(
    () =>
      verify.verify2048Run({
        seed: run.seed,
        directions: run.directions.slice(0, -1),
        score: run.score,
        moves: run.moves,
        timeMs: 120000,
      }),
    'NOT_FINISHED',
  )
  expectCode(
    () => verify.verify2048Run({ directions: run.directions, score: run.score, moves: run.moves, timeMs: 120000 }),
    'INVALID_SEED',
  )
  expectCode(
    () => verify.verify2048Run({ seed: run.seed, directions: run.directions, score: run.score, moves: run.moves, timeMs: 0 }),
    'INVALID_TIME',
  )
  expectCode(
    () => verify.verify2048Run({ seed: run.seed, directions: run.directions, score: run.score, moves: run.moves, timeMs: 999999999 }),
    'INVALID_TIME',
  )
  expectCode(() => verify.verifyRun({ game: 'snake' }, new Date()), 'INVALID_GAME')
})

test('每日挑战保留玩法但不生成今日排行榜周期', () => {
  const now = new Date('2026-10-19T04:00:00.000Z')
  assert.deepEqual(verify.periodKeys({ daily: true }, now), ['all', 'week:' + verify.weekKey(now)])
})

test('排名比较：2048 分数优先，华容道步数优先', () => {
  assert.equal(verify.isBetter('2048', { score: 4096, moves: 100 }, { score: 2048, moves: 90 }), true)
  assert.equal(verify.isBetter('2048', { score: 2048, moves: 90 }, { score: 2048, moves: 100 }), true)
  assert.equal(verify.isBetter('2048', { score: 1024, moves: 10 }, { score: 2048, moves: 90 }), false)
  assert.equal(verify.isBetter('klotski3', { moves: 30, timeMs: 9000 }, { moves: 31, timeMs: 1000 }), true)
  assert.equal(verify.isBetter('klotski3', { moves: 30, timeMs: 9000 }, { moves: 30, timeMs: 8000 }), false)
  // 旧数据 moves=0 + 35s 不能把新成绩卡死
  assert.equal(verify.isBetter('klotski3', { moves: 30, timeMs: 9000 }, { moves: 0, timeMs: 35000 }), true)
  assert.equal(verify.isBetter('klotski3', { moves: 30, timeMs: 9000 }, { timeMs: 35000 }), true)
  assert.equal(verify.isBetter('2048', { score: 100, moves: 10 }, { score: 0, moves: 0 }), true)
})

test('昵称校验与排行榜展示格式', () => {
  assert.deepEqual(verify.normalizeNickname('  小 明  '), '小 明')
  assert.equal(cloudUtils.normalizeNickname(' 小 明 ').ok, true)
  assert.equal(cloudUtils.normalizeNickname('a').ok, false)
  assert.equal(cloudUtils.normalizeNickname('1234567890123').ok, false)
  assert.equal(cloudUtils.normalizeNickname('<bad>').ok, false)
  assert.equal(cloudUtils.formatRankValue('2048', { score: 4096 }), '4096 分')
  assert.equal(
    cloudUtils.formatRankValue('klotski3', { moves: 30, timeMs: 65000 }, (ms) => '01:05'),
    '30 步 · 01:05',
  )
})
