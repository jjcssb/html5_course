/**
 * 数字华容道求解器（用于“AI 提示/演示”）。
 *
 * - 3×3：A* + Manhattan，返回最优解（方向数组）
 * - 4×4：限时加权 A*，返回可行解（非最优）；超时/超节点返回 null
 *
 * 方向语义与游戏一致：方向 = 数字移动方向。
 */
const { createSolvedBoard, isSolved, moveBySwipe, DIRECTIONS } = require('./klotski')

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

class MinHeap {
  constructor() {
    this.items = []
  }

  get size() {
    return this.items.length
  }

  push(item) {
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.items[parent].f <= this.items[index].f) break
      const temp = this.items[parent]
      this.items[parent] = this.items[index]
      this.items[index] = temp
      index = parent
    }
  }

  pop() {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0) {
      this.items[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.items.length && this.items[left].f < this.items[smallest].f) smallest = left
        if (right < this.items.length && this.items[right].f < this.items[smallest].f) smallest = right
        if (smallest === index) break
        const temp = this.items[smallest]
        this.items[smallest] = this.items[index]
        this.items[index] = temp
        index = smallest
      }
    }
    return top
  }
}

function manhattan(board, size) {
  let distance = 0
  for (let index = 0; index < board.length; index += 1) {
    const value = board[index]
    if (value === 0) continue
    const goal = value - 1
    const row = Math.floor(index / size)
    const col = index % size
    const goalRow = Math.floor(goal / size)
    const goalCol = goal % size
    distance += Math.abs(row - goalRow) + Math.abs(col - goalCol)
  }
  return distance
}

function reconstruct(parent, goalKey) {
  const path = []
  let cursor = goalKey
  while (parent.has(cursor)) {
    const node = parent.get(cursor)
    path.push(node.direction)
    cursor = node.from
  }
  return path.reverse()
}

/** 3×3 A* 最优解。 */
function solveOptimal3(board) {
  const size = 3
  const goal = createSolvedBoard(3)
  const goalKey = goal.join(',')
  const startKey = board.join(',')
  if (startKey === goalKey) return []

  const heap = new MinHeap()
  const bestG = new Map([[startKey, 0]])
  const parent = new Map()
  heap.push({ key: startKey, board: board.slice(), g: 0, f: manhattan(board, size) })

  while (heap.size > 0) {
    const node = heap.pop()
    if (node.g !== bestG.get(node.key)) continue
    if (node.key === goalKey) return reconstruct(parent, goalKey)
    for (const direction of DIRECTIONS) {
      const result = moveBySwipe(node.board, direction)
      if (!result.moved) continue
      const key = result.board.join(',')
      const g = node.g + 1
      if (bestG.has(key) && bestG.get(key) <= g) continue
      bestG.set(key, g)
      parent.set(key, { from: node.key, direction })
      heap.push({ key, board: result.board, g, f: g + manhattan(result.board, size) })
    }
  }
  return null
}

/**
 * 4×4 限时加权 A*（可能找不到解；用于提示，不承诺最优）。
 * @returns {string[]|null}
 */
function solveWeighted4(board, options) {
  const opts = options || {}
  const maxNodes = opts.maxNodes || 120000
  const deadline = Date.now() + (opts.maxMs || 1200)
  const size = 4
  const goal = createSolvedBoard(4)
  const goalKey = goal.join(',')
  const startKey = board.join(',')
  if (startKey === goalKey) return []

  const heap = new MinHeap()
  const bestG = new Map([[startKey, 0]])
  const parent = new Map()
  const weight = 1.6
  heap.push({ key: startKey, board: board.slice(), g: 0, f: manhattan(board, size) * weight })
  let expanded = 0

  while (heap.size > 0) {
    if (expanded >= maxNodes || Date.now() > deadline) return null
    const node = heap.pop()
    if (node.g !== bestG.get(node.key)) continue
    expanded += 1
    if (node.key === goalKey) return reconstruct(parent, goalKey)
    const legal = DIRECTIONS.filter((direction) => moveBySwipe(node.board, direction).moved)
    for (const direction of legal) {
      const result = moveBySwipe(node.board, direction)
      const key = result.board.join(',')
      const g = node.g + 1
      if (bestG.has(key) && bestG.get(key) <= g) continue
      bestG.set(key, g)
      parent.set(key, { from: node.key, direction })
      heap.push({
        key,
        board: result.board,
        g,
        f: g + manhattan(result.board, size) * weight,
      })
    }
  }
  return null
}

/**
 * 求解入口。
 * @returns {{directions:string[], optimal:boolean, note:string}|null}
 */
function solve(board, options) {
  if (!Array.isArray(board) || (board.length !== 9 && board.length !== 16)) return null
  if (isSolved(board)) return { directions: [], optimal: true, note: '已完成' }
  if (board.length === 9) {
    const directions = solveOptimal3(board)
    return directions ? { directions, optimal: true, note: '3×3 最优解' } : null
  }
  const directions = solveWeighted4(board, options)
  return directions ? { directions, optimal: false, note: '4×4 建议解（非最优）' } : null
}

module.exports = { solve, manhattan }
