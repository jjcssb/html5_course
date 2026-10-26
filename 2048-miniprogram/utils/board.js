/**
 * 2048 核心规则模块（纯函数，微信小程序 / Node 通用）。
 *
 * 约定：
 * - 棋盘是 4×4 的二维数组，0 表示空位；
 * - 所有函数都不修改入参，返回新的棋盘或结果对象；
 * - 随机数来源由参数注入，方便做确定性测试。
 */

const SIZE = 4
const WIN_VALUE = 2048
const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right'])

/** 创建一个全空的 size×size 棋盘。 */
function createEmptyBoard(size) {
  const boardSize = size || SIZE
  const board = []
  for (let row = 0; row < boardSize; row += 1) {
    board.push(new Array(boardSize).fill(0))
  }
  return board
}

/** 深拷贝棋盘，避免调用方共享状态。 */
function cloneBoard(board) {
  return board.map((row) => row.slice())
}

/** 校验棋盘结构是否合法（4×4、非负整数）。 */
function isValidBoard(board) {
  if (!Array.isArray(board) || board.length !== SIZE) return false
  for (const row of board) {
    if (!Array.isArray(row) || row.length !== SIZE) return false
    for (const value of row) {
      if (!Number.isInteger(value) || value < 0) return false
    }
  }
  return true
}

/** 返回所有空位坐标，按先行后列排序。 */
function getEmptyCells(board) {
  const cells = []
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col] === 0) cells.push({ row, col })
    }
  }
  return cells
}

/** 棋盘上的最大数字（空棋盘返回 0）。 */
function maxTileValue(board) {
  let max = 0
  for (const row of board) {
    for (const value of row) {
      if (value > max) max = value
    }
  }
  return max
}

/** 是否已经出现 2048（含更大的数字）。 */
function hasWon(board) {
  for (const row of board) {
    for (const value of row) {
      if (value >= WIN_VALUE) return true
    }
  }
  return false
}

/** 两个棋盘内容是否完全一致。 */
function boardEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let row = 0; row < a.length; row += 1) {
    if (!Array.isArray(a[row]) || !Array.isArray(b[row]) || a[row].length !== b[row].length) return false
    for (let col = 0; col < a[row].length; col += 1) {
      if (a[row][col] !== b[row][col]) return false
    }
  }
  return true
}

/** 把注入的随机函数返回值规整到 [0, 1) 区间。 */
function unitRandom(random) {
  const value = Number(random())
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 0.9999999999999999
  return value
}

/**
 * 在随机空位生成一个数字：90% 为 2，10% 为 4。
 * 随机函数按“先数字、后位置”的顺序各调用一次。
 * 棋盘已满时返回原棋盘的副本与 spawned: null。
 */
function spawnRandomTile(board, random) {
  const randomSource = random || Math.random
  if (typeof randomSource !== 'function') {
    throw new TypeError('spawnRandomTile: random 必须是函数')
  }
  const emptyCells = getEmptyCells(board)
  if (emptyCells.length === 0) {
    return { board: cloneBoard(board), spawned: null }
  }

  const value = unitRandom(randomSource) < 0.9 ? 2 : 4
  const index = Math.min(emptyCells.length - 1, Math.floor(unitRandom(randomSource) * emptyCells.length))
  const cell = emptyCells[index]

  const next = cloneBoard(board)
  next[cell.row][cell.col] = value
  return { board: next, spawned: { row: cell.row, col: cell.col, value } }
}

/** 新游戏棋盘：两个不同的随机空位各生成一个数字。 */
function createInitialBoard(random) {
  const first = spawnRandomTile(createEmptyBoard(), random)
  const second = spawnRandomTile(first.board, random)
  return {
    board: second.board,
    spawned: [first.spawned, second.spawned].filter(Boolean),
  }
}

/** 按移动方向取出第 index 条“线”，顺序即方块移动的目标顺序。 */
function lineCells(direction, index, size) {
  const cells = []
  for (let step = 0; step < size; step += 1) {
    if (direction === 'left') cells.push({ row: index, col: step })
    else if (direction === 'right') cells.push({ row: index, col: size - 1 - step })
    else if (direction === 'up') cells.push({ row: step, col: index })
    else cells.push({ row: size - 1 - step, col: index })
  }
  return cells
}

/**
 * 向指定方向移动并合并，返回完整的移动结果。
 *
 * 返回结构：
 * {
 *   board, moved, gained,
 *   slides: [{ from: {row,col}, to: {row,col}, value }],
 *   merges: [{ row, col, value }],
 *   maxTile
 * }
 */
function move(board, direction) {
  if (DIRECTIONS.indexOf(direction) === -1) {
    throw new RangeError('move: 不支持的方向 ' + direction)
  }
  if (!isValidBoard(board)) {
    throw new TypeError('move: 棋盘格式不合法')
  }

  const size = board.length
  const next = createEmptyBoard(size)
  const slides = []
  const merges = []
  let gained = 0

  for (let lineIndex = 0; lineIndex < size; lineIndex += 1) {
    const cells = lineCells(direction, lineIndex, size)
    const placed = []

    for (const cell of cells) {
      const value = board[cell.row][cell.col]
      if (value === 0) continue

      const last = placed[placed.length - 1]
      // 向靠边一端合并：只有紧邻上一次落位且尚未合并的相同数字才能合并
      if (last && !last.merged && last.value === value) {
        last.value *= 2
        last.merged = true
        last.sources.push(cell)
        gained += last.value
      } else {
        placed.push({ value, merged: false, sources: [cell] })
      }
    }

    for (let targetIndex = 0; targetIndex < placed.length; targetIndex += 1) {
      const entry = placed[targetIndex]
      const target = cells[targetIndex]
      next[target.row][target.col] = entry.value

      for (const source of entry.sources) {
        slides.push({
          from: { row: source.row, col: source.col },
          to: { row: target.row, col: target.col },
          value: board[source.row][source.col],
        })
      }

      if (entry.merged) {
        merges.push({ row: target.row, col: target.col, value: entry.value })
      }
    }
  }

  let moved = gained > 0
  if (!moved) {
    for (const slide of slides) {
      if (slide.from.row !== slide.to.row || slide.from.col !== slide.to.col) {
        moved = true
        break
      }
    }
  }

  return { board: next, moved, gained, slides, merges, maxTile: maxTileValue(next) }
}

/** 是否还存在可走的一步（有空格，或相邻有相同数字）。 */
function canMove(board) {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col] === 0) return true
      if (col + 1 < board[row].length && board[row][col + 1] === board[row][col]) return true
      if (row + 1 < board.length && board[row + 1][col] === board[row][col]) return true
    }
  }
  return false
}

/** 游戏是否结束：棋盘已满且横竖都不存在可合并的相邻方块。 */
function isGameOver(board) {
  return !canMove(board)
}

module.exports = {
  SIZE,
  WIN_VALUE,
  DIRECTIONS,
  createEmptyBoard,
  cloneBoard,
  isValidBoard,
  getEmptyCells,
  maxTileValue,
  hasWon,
  boardEquals,
  spawnRandomTile,
  createInitialBoard,
  move,
  canMove,
  isGameOver,
}
