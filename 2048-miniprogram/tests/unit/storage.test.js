/**
 * 小程序存储适配单元测试：默认值、格式错误、wx API 抛异常、缺失 API、历史战绩。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_THEME,
  MAX_HISTORY,
  STORAGE_KEYS,
  createMemoryStorage,
  createStorage,
  createWxStorage,
} = require('../../utils/storage')

const validRecord = (overrides) =>
  Object.assign(
    {
      score: 512,
      maxTile: 64,
      moves: 30,
      durationMs: 95000,
      endedBy: 'gameover',
      endedAt: 1700000000000,
      won: false,
    },
    overrides || {},
  )

test('空存储：所有读取返回安全默认值', () => {
  const storage = createStorage(createMemoryStorage())
  assert.equal(storage.loadBestScore(), 0)
  assert.equal(storage.loadTheme(), DEFAULT_THEME)
  assert.equal(storage.loadSoundEnabled(), true)
  assert.deepEqual(storage.loadHistory(), [])
})

test('最高分：正常读写与覆盖', () => {
  const storage = createStorage(createMemoryStorage())
  assert.equal(storage.saveBestScore(2048), true)
  assert.equal(storage.loadBestScore(), 2048)
  assert.equal(storage.saveBestScore(4096), true)
  assert.equal(storage.loadBestScore(), 4096)
  assert.equal(storage.saveBestScore(0), true)
  assert.equal(storage.loadBestScore(), 0)
})

test('最高分：缺失、非数字、负数、小数、超大值都回退为 0', () => {
  for (const raw of ['', '   ', 'abc', '12abc', '-5', '3.5', '1e999', 'NaN', 'Infinity', '{}', 'null']) {
    const storage = createStorage(createMemoryStorage({ [STORAGE_KEYS.bestScore]: raw }))
    assert.equal(storage.loadBestScore(), 0, 'raw=' + JSON.stringify(raw))
  }
})

test('最高分：写入非法值被拒绝', () => {
  const storage = createStorage(createMemoryStorage())
  assert.equal(storage.saveBestScore(-1), false)
  assert.equal(storage.saveBestScore(1.5), false)
  assert.equal(storage.saveBestScore('100'), false)
  assert.equal(storage.saveBestScore(NaN), false)
  assert.equal(storage.loadBestScore(), 0)
})

test('存储后端缺失或读写抛异常时不崩溃', () => {
  const missing = createStorage(null)
  assert.equal(missing.loadBestScore(), 0)
  assert.equal(missing.saveBestScore(9), false)
  assert.deepEqual(missing.loadHistory(), [])

  const failing = createStorage({
    getItem() {
      throw new Error('boom')
    },
    setItem() {
      throw new Error('boom')
    },
    removeItem() {
      throw new Error('boom')
    },
  })
  assert.equal(failing.loadBestScore(), 0)
  assert.equal(failing.saveBestScore(100), false)
  assert.equal(failing.loadTheme(), DEFAULT_THEME)
  assert.deepEqual(failing.loadHistory(), [])
  assert.equal(failing.clearHistory(), false)
})

test('主题：非法值回退浅色，合法值保存并读取', () => {
  const storage = createStorage(createMemoryStorage({ [STORAGE_KEYS.theme]: 'rainbow' }))
  assert.equal(storage.loadTheme(), 'light')
  for (const theme of ['dark', 'retro', 'light']) {
    assert.equal(storage.saveTheme(theme), true)
    assert.equal(storage.loadTheme(), theme)
  }
  assert.equal(storage.saveTheme('blue'), false)
})

test('音效开关：缺失默认开启，非法值默认开启，可持久化', () => {
  assert.equal(createStorage(createMemoryStorage()).loadSoundEnabled(), true)
  assert.equal(
    createStorage(createMemoryStorage({ [STORAGE_KEYS.sound]: 'garbage' })).loadSoundEnabled(),
    true,
  )
  assert.equal(
    createStorage(createMemoryStorage({ [STORAGE_KEYS.sound]: 'off' })).loadSoundEnabled(),
    false,
  )
  const storage = createStorage(createMemoryStorage())
  storage.saveSoundEnabled(false)
  assert.equal(storage.loadSoundEnabled(), false)
  storage.saveSoundEnabled(true)
  assert.equal(storage.loadSoundEnabled(), true)
})

test('历史战绩：缺失、损坏 JSON、非数组都回退为空数组', () => {
  for (const raw of ['not-json', '{bad', '"a string"', '123', 'null', '{"a":1}']) {
    const storage = createStorage(createMemoryStorage({ [STORAGE_KEYS.history]: raw }))
    assert.deepEqual(storage.loadHistory(), [], 'raw=' + raw)
  }
})

test('历史战绩：非法条目被过滤，合法条目保留', () => {
  const list = [
    validRecord(),
    { score: 'oops' },
    null,
    { ...validRecord(), endedBy: 'unknown' },
    { ...validRecord(), score: -3 },
    42,
    validRecord({ score: 2048, won: true, maxTile: 2048 }),
  ]
  const storage = createStorage(createMemoryStorage({ [STORAGE_KEYS.history]: JSON.stringify(list) }))
  const history = storage.loadHistory()
  assert.equal(history.length, 2)
  assert.equal(history[0].score, 512)
  assert.equal(history[1].score, 2048)
  assert.equal(history[1].won, true)
})

test('历史战绩：追加、最新在前、最多保留 10 条、非法记录被忽略', () => {
  const storage = createStorage(createMemoryStorage())
  for (let i = 1; i <= 12; i += 1) storage.addHistory(validRecord({ score: i * 10 }))
  const history = storage.loadHistory()
  assert.equal(history.length, MAX_HISTORY)
  assert.equal(history[0].score, 120)
  assert.equal(history[9].score, 30)
  const before = storage.loadHistory()
  storage.addHistory({ score: 'bad' })
  assert.deepEqual(storage.loadHistory(), before)
})

test('历史战绩：clearHistory 可清空', () => {
  const storage = createStorage(createMemoryStorage())
  storage.addHistory(validRecord())
  assert.equal(storage.loadHistory().length, 1)
  assert.equal(storage.clearHistory(), true)
  assert.deepEqual(storage.loadHistory(), [])
})

test('wx 存储适配：正常读写（getStorageSync 缺失键返回空字符串）', () => {
  const map = {}
  const fakeWx = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : ''
    },
    setStorageSync(key, value) {
      map[key] = value
    },
    removeStorageSync(key) {
      delete map[key]
    },
  }
  const storage = createWxStorage(fakeWx)
  assert.equal(storage.loadBestScore(), 0)
  assert.equal(storage.saveBestScore(1024), true)
  assert.equal(storage.loadBestScore(), 1024)
  assert.equal(storage.saveTheme('dark'), true)
  assert.equal(storage.loadTheme(), 'dark')
  storage.addHistory(validRecord())
  assert.equal(storage.loadHistory().length, 1)
})

test('wx 存储适配：API 抛异常或缺失时安全降级', () => {
  const throwing = createWxStorage({
    getStorageSync() {
      throw new Error('SecurityError')
    },
    setStorageSync() {
      throw new Error('QuotaExceededError')
    },
    removeStorageSync() {
      throw new Error('boom')
    },
  })
  assert.equal(throwing.loadBestScore(), 0)
  assert.equal(throwing.saveBestScore(100), false)
  assert.equal(throwing.loadTheme(), DEFAULT_THEME)
  assert.deepEqual(throwing.loadHistory(), [])

  const missing = createWxStorage({})
  assert.equal(missing.loadBestScore(), 0)
  assert.equal(missing.saveBestScore(1), false)
  assert.equal(createWxStorage(null).loadSoundEnabled(), true)
})
