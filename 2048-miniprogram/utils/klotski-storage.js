/**
 * 数字华容道最佳记录存储（wx storage）。
 * 每个尺寸单独保存：3×3 / 4×4。
 */
const KEYS = Object.freeze({
  3: 'g2048.klotski.best.3.v1',
  4: 'g2048.klotski.best.4.v1',
})

function isValidSize(size) {
  return size === 3 || size === 4
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null
  const moves = Number(record.moves)
  const timeMs = Number(record.timeMs)
  if (!Number.isInteger(moves) || moves <= 0) return null
  if (!Number.isFinite(timeMs) || timeMs <= 0) return null
  return { moves, timeMs: Math.floor(timeMs) }
}

/**
 * @param {object} [wxApi] 可注入 wx（测试用）
 */
function createKlotskiStorage(wxApi) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : null)

  function read(key) {
    try {
      if (!api || typeof api.getStorageSync !== 'function') return null
      const raw = api.getStorageSync(key)
      if (raw === '' || raw === null || raw === undefined) return null
      return typeof raw === 'string' ? raw : String(raw)
    } catch (error) {
      return null
    }
  }

  function write(key, value) {
    try {
      if (!api || typeof api.setStorageSync !== 'function') return false
      api.setStorageSync(key, String(value))
      return true
    } catch (error) {
      return false
    }
  }

  function loadBest(size) {
    if (!isValidSize(size)) return null
    const raw = read(KEYS[size])
    if (!raw) return null
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return null
    }
    return normalizeRecord(parsed)
  }

  function saveBest(size, record) {
    if (!isValidSize(size)) return false
    const normalized = normalizeRecord(record)
    if (!normalized) return false
    return write(KEYS[size], JSON.stringify(normalized))
  }

  return { loadBest, saveBest }
}

module.exports = { KEYS, createKlotskiStorage, normalizeRecord }
