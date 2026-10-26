const test = require('node:test')
const assert = require('node:assert/strict')

const { solve, manhattan } = require('../../utils/klotski-solver')
const { createSolvedBoard, isSolved, moveBySwipe, shuffleBoard, DIRECTIONS } = require('../../utils/klotski')
const { createSeededRandom } = require('../../utils/random')

function apply(board, directions) {
  let current = board
  for (const direction of directions) {
    const result = moveBySwipe(current, direction)
    assert.equal(result.moved, true, '解中出现非法方向：' + direction)
    current = result.board
  }
  return current
}

test('solver：已完成棋盘返回空解', () => {
  const result = solve(createSolvedBoard(3))
  assert.deepEqual(result.directions, [])
  assert.equal(result.optimal, true)
  assert.deepEqual(solve(createSolvedBoard(4)).directions, [])
})

test('solver：3×3 一步完成，返回正确方向', () => {
  const nearSolved = [1, 2, 3, 4, 5, 6, 7, 0, 8]
  const result = solve(nearSolved)
  assert.deepEqual(result.directions, ['left'])
  assert.equal(isSolved(apply(nearSolved, result.directions)), true)
})

test('solver：3×3 随机打乱可求最优解', () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const board = shuffleBoard(3, createSeededRandom(seed), 200)
    const result = solve(board)
    assert.ok(result && result.directions.length > 0)
    assert.equal(result.optimal, true)
    assert.equal(isSolved(apply(board, result.directions)), true)
  }
})

test('solver：manhattan 距离计算', () => {
  assert.equal(manhattan(createSolvedBoard(3), 3), 0)
  assert.equal(manhattan([1, 2, 3, 4, 5, 6, 7, 0, 8], 3), 1)
})

test('solver：4×4 已完成/近完成可解', () => {
  assert.deepEqual(solve(createSolvedBoard(4)).directions, [])
  const near = createSolvedBoard(4)
  near[14] = 0
  near[15] = 15
  const result = solve(near)
  assert.ok(result && result.directions.length === 1)
  assert.equal(isSolved(apply(near, result.directions)), true)
})
