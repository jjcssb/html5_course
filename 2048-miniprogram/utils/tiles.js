/**
 * 方块视图辅助函数（纯逻辑）：把棋盘数据与移动结果转换为可做动画的方块列表。
 * 页面层负责把返回的方块映射成 WXML 节点。
 */

const TILE_ANIMATION_MS = 120
const TILE_EFFECT_MS = 220

function createIdGenerator(start) {
  let nextId = start || 1
  return function next() {
    const id = nextId
    nextId += 1
    return id
  }
}

function cellKey(row, col) {
  return row + ',' + col
}

/** 从棋盘创建方块列表，可标记新出现的格子。 */
function tilesFromBoard(board, nextId, options) {
  const opts = options || {}
  const newCells = opts.newCells || []
  const newKeys = {}
  for (const cell of newCells) newKeys[cellKey(cell.row, cell.col)] = true

  const tiles = []
  board.forEach(function eachRow(row, rowIndex) {
    row.forEach(function eachValue(value, colIndex) {
      if (value === 0) return
      tiles.push({
        id: nextId(),
        value,
        row: rowIndex,
        col: colIndex,
        isNew: Boolean(newKeys[cellKey(rowIndex, colIndex)]),
        merged: false,
      })
    })
  })
  return tiles
}

/** 根据移动结果更新每个方块的目标位置（返回新数组，不修改入参）。 */
function slideTiles(tiles, slides) {
  const targets = {}
  for (const slide of slides) {
    targets[cellKey(slide.from.row, slide.from.col)] = slide.to
  }
  return tiles.map(function mapTile(tile) {
    const target = targets[cellKey(tile.row, tile.col)]
    if (!target) return tile
    return Object.assign({}, tile, { row: target.row, col: target.col })
  })
}

/** 动画结束后：移除参与合并的旧方块，补上合并结果与新生成的方块。 */
function settleTiles(tiles, result, nextId) {
  const mergeKeys = {}
  for (const merge of result.merges) mergeKeys[cellKey(merge.row, merge.col)] = true
  const kept = tiles.filter(function keepTile(tile) {
    return !mergeKeys[cellKey(tile.row, tile.col)]
  })

  const mergedTiles = result.merges.map(function mapMerge(merge) {
    return {
      id: nextId(),
      value: merge.value,
      row: merge.row,
      col: merge.col,
      isNew: false,
      merged: true,
    }
  })

  const spawnedTiles = result.spawned
    ? [
        {
          id: nextId(),
          value: result.spawned.value,
          row: result.spawned.row,
          col: result.spawned.col,
          isNew: true,
          merged: false,
        },
      ]
    : []

  return kept.concat(mergedTiles, spawnedTiles)
}

/** 校验方块列表与棋盘是否一致（数量、位置、数值一一对应，且无重叠）。 */
function tilesMatchBoard(tiles, board) {
  let expectedCount = 0
  for (const row of board) {
    for (const value of row) {
      if (value !== 0) expectedCount += 1
    }
  }
  if (tiles.length !== expectedCount) return false

  const seen = {}
  for (const tile of tiles) {
    if (!board[tile.row] || board[tile.row][tile.col] !== tile.value) return false
    const key = cellKey(tile.row, tile.col)
    if (seen[key]) return false
    seen[key] = true
  }
  return true
}

module.exports = {
  TILE_ANIMATION_MS,
  TILE_EFFECT_MS,
  createIdGenerator,
  tilesFromBoard,
  slideTiles,
  settleTiles,
  tilesMatchBoard,
}
