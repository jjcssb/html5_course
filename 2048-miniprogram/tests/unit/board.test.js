/**
 * 2048 核心规则单元测试（小程序版，node:test + CommonJS）。
 * 运行：npm test
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SIZE,
  WIN_VALUE,
  cloneBoard,
  boardEquals,
  canMove,
  createEmptyBoard,
  createInitialBoard,
  getEmptyCells,
  hasWon,
  isGameOver,
  isValidBoard,
  maxTileValue,
  move,
  spawnRandomTile,
} = require('../../utils/board')
const { createSeededRandom } = require('../../utils/random')

const zeros = () => createEmptyBoard()
const boardWithRow = (row) => {
  const board = zeros()
  board[0] = row.slice()
  return board
}
const left = (row) => move(boardWithRow(row), 'left')
const right = (row) => move(boardWithRow(row), 'right')

function boardWithColumn(col) {
  const board = zeros()
  col.forEach((value, row) => {
    board[row][0] = value
  })
  return board
}
const up = (col) => move(boardWithColumn(col), 'up')
const down = (col) => move(boardWithColumn(col), 'down')

function randomSequence(values) {
  let index = 0
  return () => values[index++ % values.length]
}

test('棋盘基础工具：创建、克隆、校验、空位与最大值', () => {
  const empty = createEmptyBoard()
  assert.equal(empty.length, SIZE)
  assert.ok(empty.every((row) => row.length === SIZE && row.every((v) => v === 0)))
  assert.ok(isValidBoard(empty))

  const board = boardWithRow([2, 0, 4, 0])
  const copied = cloneBoard(board)
  assert.deepEqual(copied, board)
  assert.notEqual(copied, board)
  assert.notEqual(copied[0], board[0])

  assert.deepEqual(getEmptyCells(board).slice(0, 2), [
    { row: 0, col: 1 },
    { row: 0, col: 3 },
  ])
  assert.equal(getEmptyCells(board).length, 14)
  assert.equal(maxTileValue(board), 4)
  assert.equal(maxTileValue(empty), 0)

  assert.equal(isValidBoard(null), false)
  assert.equal(isValidBoard([[1, 2]]), false)
  assert.equal(isValidBoard([[-1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), false)
  assert.equal(isValidBoard([[1.5, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), false)
})

test('向左移动：题目给出的四个示例全部符合', () => {
  assert.deepEqual(left([2, 2, 2, 2]).board[0], [4, 4, 0, 0])
  assert.deepEqual(left([2, 2, 4, 0]).board[0], [4, 4, 0, 0])
  assert.deepEqual(left([4, 4, 4, 0]).board[0], [8, 4, 0, 0])
  assert.deepEqual(left([2, 0, 2, 2]).board[0], [4, 2, 0, 0])
})

test('向右移动：靠右端合并且顺序正确', () => {
  assert.deepEqual(right([2, 2, 2, 2]).board[0], [0, 0, 4, 4])
  assert.deepEqual(right([2, 2, 4, 0]).board[0], [0, 0, 4, 4])
  assert.deepEqual(right([4, 4, 4, 0]).board[0], [0, 0, 4, 8])
  assert.deepEqual(right([0, 2, 0, 2]).board[0], [0, 0, 0, 4])
})

test('向上移动：纵向压缩与合并', () => {
  const result = up([2, 2, 4, 0])
  assert.deepEqual(result.board.map((row) => row[0]), [4, 4, 0, 0])
  assert.equal(result.gained, 4)
  assert.equal(result.moved, true)
  assert.deepEqual(up([2, 0, 2, 2]).board.map((row) => row[0]), [4, 2, 0, 0])
})

test('向下移动：从底部开始合并', () => {
  const result = down([2, 2, 4, 0])
  assert.deepEqual(result.board.map((row) => row[0]), [0, 0, 4, 4])
  assert.equal(result.gained, 4)
  const merged = down([2, 2, 2, 2])
  assert.deepEqual(merged.board.map((row) => row[0]), [0, 0, 4, 4])
  assert.equal(merged.gained, 8)
})

test('空位压缩：中间的空格被消除，数字保持相对顺序', () => {
  assert.deepEqual(left([0, 2, 0, 4]).board[0], [2, 4, 0, 0])
  assert.deepEqual(left([0, 0, 0, 2]).board[0], [2, 0, 0, 0])
  assert.deepEqual(left([0, 2, 0, 2]).board[0], [4, 0, 0, 0])
  assert.equal(left([0, 2, 0, 2]).gained, 4)
})

test('不连续相同数字不合并（中间隔着其他数字）', () => {
  const result = left([2, 4, 2, 0])
  assert.deepEqual(result.board[0], [2, 4, 2, 0])
  assert.equal(result.moved, false)
  assert.equal(result.gained, 0)
})

test('每个方块每步最多合并一次：[2,2,4,0] 向左不得变成 [8,0,0,0]', () => {
  const result = left([2, 2, 4, 0])
  assert.deepEqual(result.board[0], [4, 4, 0, 0])
  assert.notDeepEqual(result.board[0], [8, 0, 0, 0])
  assert.equal(result.gained, 4)
})

test('每个方块每步最多合并一次：链式合并被阻止', () => {
  assert.deepEqual(left([2, 2, 2, 0]).board[0], [4, 2, 0, 0])
  assert.deepEqual(left([2, 2, 4, 4]).board[0], [4, 8, 0, 0])
  assert.deepEqual(left([4, 2, 2, 0]).board[0], [4, 4, 0, 0])
  assert.deepEqual(left([4, 4, 8, 0]).board[0], [8, 8, 0, 0])
  assert.deepEqual(left([4, 4, 4, 4]).board[0], [8, 8, 0, 0])
  assert.equal(left([4, 4, 4, 4]).gained, 16)
})

test('一次移动多次合并时得分累加正确', () => {
  assert.equal(left([2, 2, 4, 4]).gained, 12)
  assert.equal(left([2, 2, 2, 2]).gained, 8)
  assert.equal(left([2, 2, 4, 0]).gained, 4)
  assert.equal(left([4, 4, 4, 0]).gained, 8)
})

test('四方向移动都不修改传入的棋盘（纯函数）', () => {
  const board = [
    [2, 2, 0, 4],
    [0, 8, 8, 0],
    [2, 0, 0, 2],
    [0, 4, 4, 4],
  ]
  const snapshot = cloneBoard(board)
  for (const direction of ['up', 'down', 'left', 'right']) {
    move(board, direction)
    assert.deepEqual(board, snapshot, direction + ' 不应修改入参')
  }
})

test('无效移动：棋盘不变且 moved 为 false', () => {
  const board = boardWithRow([2, 4, 2, 4])
  const result = move(board, 'left')
  assert.equal(result.moved, false)
  assert.deepEqual(result.board, board)
  assert.equal(result.gained, 0)

  const stay = move(boardWithRow([0, 0, 0, 2]), 'left')
  assert.equal(stay.moved, true)
  assert.equal(stay.gained, 0)
  assert.deepEqual(stay.board[0], [2, 0, 0, 0])
})

test('滑动信息与合并信息可用于动画', () => {
  const result = left([2, 2, 0, 4])
  assert.deepEqual(result.board[0], [4, 4, 0, 0])
  assert.deepEqual(
    result.slides.map((slide) => slide.to),
    [
      { row: 0, col: 0 },
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ],
  )
  assert.deepEqual(result.merges, [{ row: 0, col: 0, value: 4 }])
})

test('非法方向与非法棋盘会抛出明确错误', () => {
  assert.throws(() => move(createEmptyBoard(), 'diagonal'), RangeError)
  assert.throws(() => move(null, 'left'), TypeError)
  assert.throws(() => spawnRandomTile(createEmptyBoard(), 'not-a-function'), TypeError)
})

test('随机数字只生成在空位，且不覆盖已有数字', () => {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 0],
  ]
  const rng = createSeededRandom(2024)
  for (let i = 0; i < 200; i += 1) {
    const { board: next, spawned } = spawnRandomTile(board, rng)
    assert.ok(spawned)
    assert.equal(next[spawned.row][spawned.col], spawned.value)
    assert.ok(spawned.value === 2 || spawned.value === 4)
    let count = 0
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (next[row][col] !== 0) count += 1
        if (board[row][col] !== 0) assert.equal(next[row][col], board[row][col])
      }
    }
    assert.equal(count, 16)
  }
})

test('新数字 90% 为 2、10% 为 4（统计验证，不依赖固定样本）', () => {
  const almostFull = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 0],
  ]
  const rng = createSeededRandom(99)
  let fours = 0
  const rounds = 20000
  for (let i = 0; i < rounds; i += 1) {
    const { spawned } = spawnRandomTile(almostFull, rng)
    if (spawned.value === 4) fours += 1
  }
  const ratio = fours / rounds
  assert.ok(ratio > 0.08 && ratio < 0.12, '4 的比例应接近 10%，实际 ' + (ratio * 100).toFixed(2) + '%')
})

test('棋盘已满时不再生成数字，且不修改原棋盘', () => {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]
  const { board: next, spawned } = spawnRandomTile(board, Math.random)
  assert.equal(spawned, null)
  assert.deepEqual(next, board)
  assert.notEqual(next, board)
})

test('初始棋盘：恰好两个数字，位于不同空位，取值为 2 或 4', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const { board, spawned } = createInitialBoard(createSeededRandom(seed))
    const cells = []
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (board[row][col] !== 0) cells.push({ row, col, value: board[row][col] })
      }
    }
    assert.equal(cells.length, 2, 'seed ' + seed + ' 应只有两个非空格')
    assert.notDeepEqual([cells[0].row, cells[0].col], [cells[1].row, cells[1].col])
    assert.ok(cells.every((cell) => cell.value === 2 || cell.value === 4))
    const sortedSpawned = spawned.slice().sort((a, b) => a.row - b.row || a.col - b.col)
    assert.deepEqual(sortedSpawned, cells)
  }
})

test('胜利判定：出现 2048 或更大数字即为胜利', () => {
  assert.equal(hasWon(boardWithRow([2048, 0, 0, 0])), true)
  assert.equal(hasWon(boardWithRow([4096, 0, 0, 0])), true)
  assert.equal(hasWon(boardWithRow([1024, 1024, 0, 0])), false)
  assert.equal(hasWon(createEmptyBoard()), false)
  assert.equal(WIN_VALUE, 2048)
})

test('结束判定：棋盘已满但仍存在横向/纵向可合并方块时不算结束', () => {
  const horizontal = [
    [2, 2, 4, 8],
    [4, 8, 16, 32],
    [8, 16, 32, 64],
    [16, 32, 64, 128],
  ]
  assert.equal(canMove(horizontal), true)
  assert.equal(isGameOver(horizontal), false)

  const vertical = [
    [2, 4, 8, 16],
    [2, 8, 16, 32],
    [4, 16, 32, 64],
    [8, 32, 64, 128],
  ]
  assert.equal(isGameOver(vertical), false)
})

test('结束判定：棋盘已满且横纵都无可合并方块时结束', () => {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]
  assert.equal(canMove(board), false)
  assert.equal(isGameOver(board), true)
  assert.equal(isGameOver(boardWithRow([2, 2, 4, 8])), false)
})

test('boardEquals 能正确比较棋盘内容', () => {
  const a = boardWithRow([2, 4, 8, 16])
  assert.equal(boardEquals(a, cloneBoard(a)), true)
  assert.equal(boardEquals(a, boardWithRow([2, 4, 8, 32])), false)
  assert.equal(boardEquals(a, null), false)
})

test('自定义随机序列可完全控制生成结果', () => {
  const first = spawnRandomTile(createEmptyBoard(), randomSequence([0.95, 0]))
  assert.deepEqual(first.spawned, { row: 0, col: 0, value: 4 })
  const second = spawnRandomTile(createEmptyBoard(), randomSequence([0.1, 0.99]))
  assert.deepEqual(second.spawned, { row: 3, col: 3, value: 2 })
})
