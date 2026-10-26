/**
 * 数字华容道核心规则（纯函数，微信小程序 / Node 通用）。
 *
 * 棋盘用一维数组表示：长度 size*size，数字 1..(size²-1)，0 表示空格。
 * 目标：[1,2,...,size²-1,0]。
 *
 * 交互约定：滑动方向 = 数字要移动的方向（也就是朝空格方向推）。
 * 例如空格在中间，上方的 5 要下来 → 向下滑，5 与空格交换。
 */
const SIZES = Object.freeze([3, 4])
const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right'])

// 滑动方向 → 可移动数字相对空格的偏移
// 向下滑：数字从空格上方下来（dr = -1）；向上滑：数字从下方上去（dr = +1）
const SOURCE_OFFSETS = Object.freeze({
  up: { dr: 1, dc: 0 },
  down: { dr: -1, dc: 0 },
  left: { dr: 0, dc: 1 },
  right: { dr: 0, dc: -1 },
})

const OPPOSITE = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
})

function assertSize(size) {
  if (SIZES.indexOf(size) === -1) {
    throw new RangeError('不支持的数字华容道尺寸：' + size)
  }
}

function assertBoard(board) {
  if (!Array.isArray(board)) throw new TypeError('棋盘必须是数组')
  const size = Math.sqrt(board.length)
  if (SIZES.indexOf(size) === -1) throw new TypeError('棋盘尺寸不合法')
  const seen = new Array(board.length).fill(false)
  for (const value of board) {
    if (!Number.isInteger(value) || value < 0 || value >= board.length) {
      throw new TypeError('棋盘数字不合法')
    }
    if (seen[value]) throw new TypeError('棋盘数字重复')
    seen[value] = true
  }
  return size
}

/** 生成已完成棋盘。 */
function createSolvedBoard(size) {
  assertSize(size)
  const board = []
  for (let value = 1; value < size * size; value += 1) board.push(value)
  board.push(0)
  return board
}

/** 是否已经完成。非法棋盘返回 false。 */
function isSolved(board) {
  try {
    assertBoard(board)
  } catch (error) {
    return false
  }
  for (let index = 0; index < board.length - 1; index += 1) {
    if (board[index] !== index + 1) return false
  }
  return board[board.length - 1] === 0
}

/** 空格下标。 */
function getBlankIndex(board) {
  return board.indexOf(0)
}

/** 棋盘是否合法（尺寸 3/4，0..n²-1 各出现一次）。 */
function isValidBoard(board) {
  try {
    assertBoard(board)
    return true
  } catch (error) {
    return false
  }
}

/**
 * 根据滑动方向移动一个数字。
 * 返回 { board, moved, from, to, direction }，不修改入参。
 */
function moveBySwipe(board, direction) {
  const size = assertBoard(board)
  if (DIRECTIONS.indexOf(direction) === -1) {
    throw new RangeError('不支持的方向：' + direction)
  }
  const blankIndex = getBlankIndex(board)
  const blankRow = Math.floor(blankIndex / size)
  const blankCol = blankIndex % size
  const offset = SOURCE_OFFSETS[direction]
  const sourceRow = blankRow + offset.dr
  const sourceCol = blankCol + offset.dc

  if (sourceRow < 0 || sourceRow >= size || sourceCol < 0 || sourceCol >= size) {
    return { board: board.slice(), moved: false, from: null, to: blankIndex, direction }
  }

  const sourceIndex = sourceRow * size + sourceCol
  // 数字滑入空格，空格移动到数字原来的位置
  const result = board.slice()
  result[blankIndex] = board[sourceIndex]
  result[sourceIndex] = 0

  return {
    board: result,
    moved: true,
    from: sourceIndex,
    to: blankIndex,
    direction,
  }
}

/** 当前滑动方向是否可移动。 */
function canMove(board, direction) {
  return moveBySwipe(board, direction).moved
}

/** 计算逆序数（忽略 0）。 */
function countInversions(board) {
  let inversions = 0
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] === 0) continue
    for (let j = i + 1; j < board.length; j += 1) {
      if (board[j] !== 0 && board[j] < board[i]) inversions += 1
    }
  }
  return inversions
}

/**
 * 判断是否有解（标准数字华容道可解性）。
 * - 奇数阶：逆序数为偶数；
 * - 偶数阶：逆序数 + 空格所在行（从下往上数，1 基）为奇数。
 */
function isSolvable(board) {
  const size = assertBoard(board)
  const inversions = countInversions(board)
  if (size % 2 === 1) return inversions % 2 === 0
  const blankRowFromBottom = size - Math.floor(getBlankIndex(board) / size)
  return (inversions + blankRowFromBottom) % 2 === 1
}

function unitRandom(random) {
  const value = Number(random())
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 0.9999999999999999
  return value
}

function collectLegalDirections(board) {
  const directions = []
  for (const direction of DIRECTIONS) {
    if (moveBySwipe(board, direction).moved) directions.push(direction)
  }
  return directions
}

/**
 * 从完成态出发随机走合法步，保证打乱后一定有解。
 * 返回 { board, solution }：solution 是“当前棋盘 → 完成态”的保证解。
 */
function shuffleBoardWithPath(size, random, steps) {
  assertSize(size)
  const rng = random || Math.random
  if (typeof rng !== 'function') throw new TypeError('random 必须是函数')
  const totalSteps =
    Number.isInteger(steps) && steps > 0 ? steps : size === 3 ? 200 : 500

  let board = createSolvedBoard(size)
  let lastDirection = null
  const applied = []

  for (let step = 0; step < totalSteps; step += 1) {
    const candidates = collectLegalDirections(board).filter(function filterDirection(direction) {
      return !lastDirection || OPPOSITE[direction] !== lastDirection
    })
    const list = candidates.length > 0 ? candidates : collectLegalDirections(board)
    const direction = list[Math.floor(unitRandom(rng) * list.length)]
    board = moveBySwipe(board, direction).board
    applied.push(direction)
    lastDirection = direction
  }

  if (isSolved(board)) {
    const candidates = collectLegalDirections(board).filter(function filterDirection(direction) {
      return direction !== lastDirection
    })
    const list = candidates.length > 0 ? candidates : collectLegalDirections(board)
    const direction = list[0]
    board = moveBySwipe(board, direction).board
    applied.push(direction)
  }

  // 正向走 d1..dn，反向走 opposite(dn)..opposite(d1) 即回到完成态
  const solution = applied
    .slice()
    .reverse()
    .map(function invert(direction) {
      return OPPOSITE[direction]
    })

  return { board, solution }
}

/**
 * 从完成态出发随机走合法步，保证打乱后一定有解。
 * 返回新棋盘；不会返回完成态。
 */
function shuffleBoard(size, random, steps) {
  return shuffleBoardWithPath(size, random, steps).board
}

/** 把毫秒格式化为 mm:ss。 */
function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000) || 0)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const pad = function pad(value) {
    return value < 10 ? '0' + value : String(value)
  }
  return pad(minutes) + ':' + pad(seconds)
}

/** 新纪录规则：步数优先，步数相同再看用时。 */
function isBetterRecord(previous, next) {
  if (!next || !Number.isInteger(next.moves) || next.moves <= 0) return false
  if (!previous || !previous.moves || previous.moves <= 0) return true
  if (next.moves !== previous.moves) return next.moves < previous.moves
  return next.timeMs < previous.timeMs
}

module.exports = {
  SIZES,
  DIRECTIONS,
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
}
