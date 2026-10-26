/**
 * 动画数据与音效模块单元测试（小程序版）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createIdGenerator,
  settleTiles,
  slideTiles,
  tilesFromBoard,
  tilesMatchBoard,
} = require('../../utils/tiles')
const { createSoundPlayer } = require('../../utils/sound')
const { GAME_STATUS, applyMove, continueAfterWin, createGameState } = require('../../utils/engine')
const { createSeededRandom } = require('../../utils/random')

function createFakeAudioContext() {
  return {
    src: '',
    volume: 1,
    obeyMuteSwitch: true,
    playing: [],
    stop() {},
    play() {
      this.playing.push(this.src)
    },
    destroy() {},
    onError() {},
  }
}

function createFakeWx() {
  const contexts = []
  return {
    contexts,
    createInnerAudioContext() {
      const context = createFakeAudioContext()
      contexts.push(context)
      return context
    },
    vibrateShort(options) {
      this.lastVibrate = options
    },
  }
}

test('tilesFromBoard：从棋盘生成方块并标记新方块', () => {
  const nextId = createIdGenerator(1)
  const board = [
    [2, 0, 4, 0],
    [0, 0, 0, 0],
    [0, 8, 0, 0],
    [0, 0, 0, 0],
  ]
  const tiles = tilesFromBoard(board, nextId, { newCells: [{ row: 2, col: 1 }] })
  assert.equal(tiles.length, 3)
  assert.deepEqual(
    tiles.map((tile) => [tile.value, tile.row, tile.col, tile.isNew]),
    [
      [2, 0, 0, false],
      [4, 0, 2, false],
      [8, 2, 1, true],
    ],
  )
  assert.deepEqual(tiles.map((tile) => tile.id), [1, 2, 3])
})

test('滑动 + 合并结算后，方块列表与棋盘完全一致', () => {
  const nextId = createIdGenerator(1)
  let state = createGameState({ random: createSeededRandom(11) })
  let tiles = tilesFromBoard(state.board, nextId)
  const { state: afterLeft, result } = applyMove(state, 'left', { random: createSeededRandom(21) })
  assert.ok(result.moved)
  tiles = slideTiles(tiles, result.slides)
  tiles = settleTiles(tiles, result, nextId)
  assert.ok(tilesMatchBoard(tiles, afterLeft.board))
  assert.ok(tiles.some((tile) => tile.merged))
  assert.ok(tiles.some((tile) => tile.isNew))
})

test('连续随机移动 200 步，动画数据始终与逻辑棋盘一致', () => {
  const nextId = createIdGenerator(1)
  let state = createGameState({ random: createSeededRandom(3) })
  let tiles = tilesFromBoard(state.board, nextId)
  const directions = ['up', 'down', 'left', 'right']
  let moves = 0

  for (let step = 0; step < 200; step += 1) {
    const direction = directions[(step + moves) % directions.length]
    const { state: next, result } = applyMove(state, direction, { random: createSeededRandom(step + 100) })
    if (result.moved) {
      tiles = slideTiles(tiles, result.slides)
      tiles = settleTiles(tiles, result, nextId)
      assert.ok(tilesMatchBoard(tiles, next.board), '第 ' + step + ' 步后动画数据与棋盘不一致')
      moves += 1
    }
    state = next
    if (state.status === GAME_STATUS.WON) state = continueAfterWin(state).state
    if (state.status === GAME_STATUS.OVER) break
  }

  assert.ok(moves > 0, '应至少发生一次有效移动')
  assert.ok(tilesMatchBoard(tiles, state.board))
})

test('settleTiles：没有新生成数字时也能正确结算（边界情况）', () => {
  const nextId = createIdGenerator(1)
  const tiles = tilesFromBoard(
    [
      [4, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    nextId,
  )
  const settled = settleTiles(
    slideTiles(tiles, [
      { from: { row: 0, col: 0 }, to: { row: 0, col: 0 } },
      { from: { row: 0, col: 1 }, to: { row: 0, col: 0 } },
    ]),
    { merges: [{ row: 0, col: 0, value: 8 }], spawned: null },
    nextId,
  )
  assert.equal(settled.length, 1)
  assert.equal(settled[0].value, 8)
  assert.equal(settled[0].merged, true)
})

test('tilesMatchBoard：数量或位置不一致时返回 false', () => {
  const nextId = createIdGenerator(1)
  const board = [
    [2, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  const tiles = tilesFromBoard(board, nextId)
  assert.equal(tilesMatchBoard(tiles, board), true)
  assert.equal(tilesMatchBoard(tiles, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), false)
  const duplicated = tiles.concat([{ id: 9, value: 2, row: 0, col: 0 }])
  assert.equal(tilesMatchBoard(duplicated, board), false)
})

test('音效：开启时调用 InnerAudioContext 播放，关闭时不播放', () => {
  const fakeWx = createFakeWx()
  const player = createSoundPlayer({ wxApi: fakeWx, getEnabled: () => true })
  assert.equal(player.playMerge(), true)
  assert.equal(fakeWx.contexts.length, 1)
  assert.equal(fakeWx.contexts[0].src, '/assets/merge.wav')
  assert.equal(player.vibrate('light'), true)
  assert.equal(fakeWx.lastVibrate.type, 'light')
  player.destroy()

  const mutedWx = createFakeWx()
  const muted = createSoundPlayer({ wxApi: mutedWx, getEnabled: () => false })
  assert.equal(muted.playMerge(), false)
  assert.equal(muted.playWin(), false)
  assert.equal(muted.playGameOver(), false)
  assert.equal(muted.vibrate('light'), false)
  assert.equal(mutedWx.contexts.length, 0)
})

test('音效：wx API 缺失或抛异常时安全返回 false', () => {
  const noApi = createSoundPlayer({ wxApi: null })
  assert.equal(noApi.playMerge(), false)
  assert.equal(noApi.vibrate('light'), false)

  const throwing = createSoundPlayer({
    wxApi: {
      createInnerAudioContext() {
        throw new Error('not supported')
      },
      vibrateShort() {
        throw new Error('not supported')
      },
    },
  })
  assert.equal(throwing.playMerge(), false)
  assert.equal(throwing.vibrate('light'), false)
})
