/**
 * 数字华容道核心逻辑与最佳记录存储测试。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SIZES,
  createSolvedBoard,
  isSolved,
  isValidBoard,
  getBlankIndex,
  moveBySwipe,
  canMove,
  countInversions,
  isSolvable,
  shuffleBoard,
  shuffleBoardWithPath,
  formatDuration,
  isBetterRecord,
} = require('../../utils/klotski')
const { createSeededRandom } = require('../../utils/random')
const { KEYS, createKlotskiStorage } = require('../../utils/klotski-storage')

test('createSolvedBoard：3×3 / 4×4 完成态正确', () => {
  assert.deepEqual(createSolvedBoard(3), [1, 2, 3, 4, 5, 6, 7, 8, 0])
  assert.deepEqual(createSolvedBoard(4), [
    1, 2, 3, 4,
    5, 6, 7, 8,
    9, 10, 11, 12,
    13, 14, 15, 0,
  ])
  assert.deepEqual(SIZES, [3, 4])
  assert.throws(() => createSolvedBoard(5), RangeError)
})

test('isSolved / getBlankIndex / isValidBoard', () => {
  const solved = createSolvedBoard(3)
  assert.equal(isSolved(solved), true)
  assert.equal(isSolved([1, 2, 3, 4, 5, 6, 7, 0, 8]), false)
  assert.equal(getBlankIndex(solved), 8)
  assert.equal(getBlankIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]), 0)
  assert.equal(isValidBoard(solved), true)
  assert.equal(isValidBoard([1, 2, 3]), false)
  assert.equal(isValidBoard([1, 2, 3, 4, 5, 6, 7, 8, 8]), false) // 重复
  assert.equal(isValidBoard([1, 2, 3, 4, 5, 6, 7, 8, 9]), false) // 越界
  assert.equal(isSolved([1, 2, 3, 4, 5, 6, 7, 8]), false)
})

test('moveBySwipe：空格在右下角时的合法/非法方向', () => {
  const solved = createSolvedBoard(3)
  const right = moveBySwipe(solved, 'right') // 把左侧的 8 往右推
  assert.equal(right.moved, true)
  assert.equal(right.from, 7)
  assert.equal(right.to, 8)
  assert.deepEqual(right.board, [1, 2, 3, 4, 5, 6, 7, 0, 8])

  const down = moveBySwipe(solved, 'down') // 把上方的 6 往下推
  assert.deepEqual(down.board, [1, 2, 3, 4, 5, 0, 7, 8, 6])

  assert.equal(moveBySwipe(solved, 'up').moved, false)
  assert.equal(moveBySwipe(solved, 'left').moved, false)
  assert.equal(canMove(solved, 'up'), false)
  assert.equal(canMove(solved, 'right'), true)
})

test('moveBySwipe：一步即可复原的局面', () => {
  const nearSolved = [1, 2, 3, 4, 5, 6, 7, 0, 8]
  const result = moveBySwipe(nearSolved, 'left') // 右侧的 8 往左推
  assert.equal(result.moved, true)
  assert.deepEqual(result.board, createSolvedBoard(3))
  assert.equal(isSolved(result.board), true)
})

test('moveBySwipe：不跨行跨列、不修改入参', () => {
  // 空格在 (1,0)，向右滑时左边越界，应该无效
  const board = [1, 2, 3, 0, 4, 5, 6, 7, 8]
  const snapshot = board.slice()
  const invalid = moveBySwipe(board, 'right')
  assert.equal(invalid.moved, false)
  assert.deepEqual(invalid.board, snapshot)

  // 空格在 (0,1)：向下滑需要上方数字，越界；向上滑可把下方的 4 推上去
  const top = [1, 0, 2, 3, 4, 5, 6, 7, 8]
  assert.equal(moveBySwipe(top, 'down').moved, false)

  // 合法移动：下方的 4 往上滑进空格；不修改原数组
  const legalUp = moveBySwipe(top, 'up')
  assert.equal(legalUp.moved, true)
  assert.deepEqual(legalUp.board, [1, 4, 2, 3, 0, 5, 6, 7, 8])
  assert.deepEqual(top, [1, 0, 2, 3, 4, 5, 6, 7, 8])

  assert.throws(() => moveBySwipe(board, 'diagonal'), RangeError)
  assert.throws(() => moveBySwipe([1, 2, 3], 'left'), TypeError)
})

test('countInversions 与 isSolvable：3×3', () => {
  const solved = createSolvedBoard(3)
  assert.equal(countInversions(solved), 0)
  assert.equal(isSolvable(solved), true)

  const swapped = solved.slice()
  swapped[0] = 2
  swapped[1] = 1
  assert.equal(countInversions(swapped), 1)
  assert.equal(isSolvable(swapped), false)
})

test('isSolvable：4×4 奇偶性', () => {
  const solved = createSolvedBoard(4)
  assert.equal(isSolvable(solved), true)

  const swapped = solved.slice()
  swapped[0] = 2
  swapped[1] = 1
  assert.equal(countInversions(swapped), 1)
  assert.equal(isSolvable(swapped), false)

  // 空格从最后一行移动到上一行（同一列），不改变可解性
  const movedBlank = moveBySwipe(solved, 'down').board
  assert.equal(isSolvable(movedBlank), true)
})

test('shuffleBoard：3×3 打乱 100 次均可解且不是完成态', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const board = shuffleBoard(3, createSeededRandom(seed))
    assert.equal(isValidBoard(board), true)
    assert.equal(isSolvable(board), true)
    assert.equal(isSolved(board), false, 'seed ' + seed + ' 打乱后仍是完成态')
    assert.equal(board.length, 9)
  }
})

test('shuffleBoard：4×4 打乱 100 次均可解且不是完成态', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const board = shuffleBoard(4, createSeededRandom(seed))
    assert.equal(isValidBoard(board), true)
    assert.equal(isSolvable(board), true)
    assert.equal(isSolved(board), false, 'seed ' + seed + ' 打乱后仍是完成态')
    assert.equal(board.length, 16)
  }
})

test('shuffleBoardWithPath：返回的保证解能还原 3×3/4×4', () => {
  for (const size of [3, 4]) {
    for (let seed = 1; seed <= 20; seed += 1) {
      const shuffled = shuffleBoardWithPath(size, createSeededRandom(seed))
      assert.equal(shuffled.board.length, size * size)
      assert.ok(shuffled.solution.length > 0)
      let board = shuffled.board
      for (const direction of shuffled.solution) {
        const moved = moveBySwipe(board, direction)
        assert.equal(moved.moved, true, size + '×' + size + ' 保证解出现非法方向')
        board = moved.board
      }
      assert.equal(isSolved(board), true, size + '×' + size + ' seed=' + seed)
    }
  }
})

test('shuffleBoard：确定性随机源可复现，且不修改入参', () => {
  const first = shuffleBoard(4, createSeededRandom(42))
  const second = shuffleBoard(4, createSeededRandom(42))
  assert.deepEqual(first, second)

  const third = shuffleBoard(4, createSeededRandom(43))
  assert.notDeepEqual(first, third)

  const custom = shuffleBoard(3, createSeededRandom(7), 10)
  assert.equal(custom.length, 9)
  assert.equal(isSolvable(custom), true)
})

test('formatDuration：时间格式化', () => {
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(999), '00:00')
  assert.equal(formatDuration(1000), '00:01')
  assert.equal(formatDuration(65000), '01:05')
  assert.equal(formatDuration(3661000), '61:01')
  assert.equal(formatDuration(-5), '00:00')
})

test('isBetterRecord：步数优先、同步骤比用时', () => {
  assert.equal(isBetterRecord(null, { moves: 10, timeMs: 5000 }), true)
  assert.equal(isBetterRecord({ moves: 10, timeMs: 5000 }, { moves: 9, timeMs: 9000 }), true)
  assert.equal(isBetterRecord({ moves: 10, timeMs: 5000 }, { moves: 10, timeMs: 4000 }), true)
  assert.equal(isBetterRecord({ moves: 10, timeMs: 5000 }, { moves: 10, timeMs: 6000 }), false)
  assert.equal(isBetterRecord({ moves: 10, timeMs: 5000 }, { moves: 11, timeMs: 1000 }), false)
  assert.equal(isBetterRecord(null, null), false)
  assert.equal(isBetterRecord(null, { moves: 0, timeMs: 1000 }), false)
  assert.equal(isBetterRecord({ moves: 0, timeMs: 35000 }, { moves: 30, timeMs: 9000 }), true)
})

test('沃容道存储：缺失 / 损坏 / 非法值时安全降级', () => {
  const empty = createKlotskiStorage({ getStorageSync: () => '', setStorageSync: () => {} })
  assert.equal(empty.loadBest(3), null)
  assert.equal(empty.loadBest(4), null)

  for (const raw of ['bad-json', '{}', '{"moves":0,"timeMs":100}', '{"moves":3,"timeMs":-1}', '{"moves":3,"timeMs":0}', '"x"']) {
    const storage = createKlotskiStorage({
      getStorageSync: (key) => (key === KEYS[3] ? raw : ''),
      setStorageSync: () => {},
    })
    assert.equal(storage.loadBest(3), null, 'raw=' + raw)
  }

  const throwing = createKlotskiStorage({
    getStorageSync() {
      throw new Error('boom')
    },
    setStorageSync() {
      throw new Error('boom')
    },
  })
  assert.equal(throwing.loadBest(3), null)
  assert.equal(throwing.saveBest(3, { moves: 10, timeMs: 1000 }), false)
  assert.equal(throwing.loadBest(5), null)
})

test('沃容道存储：正常读写，尺寸隔离', () => {
  const map = {}
  const fakeWx = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : ''
    },
    setStorageSync(key, value) {
      map[key] = value
    },
  }
  const storage = createKlotskiStorage(fakeWx)
  assert.equal(storage.saveBest(3, { moves: 12, timeMs: 34567 }), true)
  assert.equal(storage.saveBest(4, { moves: 40, timeMs: 123456 }), true)
  assert.deepEqual(storage.loadBest(3), { moves: 12, timeMs: 34567 })
  assert.deepEqual(storage.loadBest(4), { moves: 40, timeMs: 123456 })
  assert.equal(storage.saveBest(3, { moves: 0, timeMs: 1 }), false)
  assert.equal(storage.saveBest(3, { moves: 10.5, timeMs: 1 }), false)
  assert.deepEqual(storage.loadBest(3), { moves: 12, timeMs: 34567 })
})
