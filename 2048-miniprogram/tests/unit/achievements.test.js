const test = require('node:test')
const assert = require('node:assert/strict')

const { ACHIEVEMENTS, unlockForRun, mergeUnlocked, detailList } = require('../../utils/achievements')

test('成就：2048 首次胜利与 4096', () => {
  assert.deepEqual(unlockForRun({ game: '2048', score: 2048 }), ['first_2048'])
  assert.deepEqual(unlockForRun({ game: '2048', score: 4096 }), ['first_2048', 'score_4096'])
  assert.deepEqual(unlockForRun({ game: '2048', score: 1024 }), [])
})

test('成就：华容道 3×3/4×4 与速通', () => {
  assert.deepEqual(unlockForRun({ game: 'klotski3', moves: 40, timeMs: 130000 }), ['first_3x3'])
  assert.deepEqual(
    unlockForRun({ game: 'klotski3', moves: 26, timeMs: 60000 }),
    ['first_3x3', 'speed_3'],
  )
  assert.deepEqual(unlockForRun({ game: 'klotski4', moves: 120, timeMs: 300000 }), ['first_4x4'])
})

test('成就：每日挑战与合并去重', () => {
  assert.deepEqual(
    unlockForRun({ game: 'klotski3', moves: 40, timeMs: 130000, daily: true }),
    ['first_3x3', 'daily_1'],
  )
  assert.deepEqual(mergeUnlocked(['first_3x3'], ['daily_1', 'first_3x3']), ['first_3x3', 'daily_1'])
  assert.equal(detailList(['first_3x3']).filter((item) => item.unlocked).length, 1)
  assert.equal(ACHIEVEMENTS.length, 6)
})
