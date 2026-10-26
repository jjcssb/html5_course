/**
 * 本地存储封装（微信小程序版）：最高分 / 主题 / 音效 / 历史战绩。
 *
 * - 读取不存在、格式错误、wx API 抛异常、API 不可用时一律回退到安全默认值；
 * - 写入失败只返回 false，不崩溃；
 * - backend 可注入，Node 单元测试用内存假后端；
 * - 存储键与 H5 版保持一致，便于对照。
 */

const STORAGE_KEYS = Object.freeze({
  bestScore: 'g2048.bestScore.v1',
  theme: 'g2048.theme.v1',
  sound: 'g2048.sound.v1',
  history: 'g2048.history.v1',
})

const MAX_HISTORY = 10
const THEMES = Object.freeze(['light', 'dark', 'retro'])
const DEFAULT_THEME = 'light'
const END_REASONS = Object.freeze(['gameover', 'restart'])

/** 内存后端，接口与 wx storage 一致，便于测试。 */
function createMemoryStorage(initial) {
  const map = {}
  const source = initial || {}
  Object.keys(source).forEach(function setInitial(key) {
    map[key] = String(source[key])
  })
  return {
    getItem: function getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
    },
    setItem: function setItem(key, value) {
      map[key] = String(value)
    },
    removeItem: function removeItem(key) {
      delete map[key]
    },
    clear: function clear() {
      Object.keys(map).forEach(function remove(key) {
        delete map[key]
      })
    },
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null
  const score = Number(record.score)
  const maxTile = Number(record.maxTile)
  const moves = Number(record.moves)
  const durationMs = Number(record.durationMs)
  const endedAt = Number(record.endedAt)
  if (
    !isFinite(score) ||
    !isFinite(maxTile) ||
    !isFinite(moves) ||
    !isFinite(durationMs) ||
    !isFinite(endedAt)
  ) {
    return null
  }
  if (score < 0 || maxTile < 0 || moves < 0 || durationMs < 0 || endedAt < 0) return null
  if (END_REASONS.indexOf(record.endedBy) === -1) return null
  return {
    score: Math.floor(score),
    maxTile: Math.floor(maxTile),
    moves: Math.floor(moves),
    durationMs: Math.floor(durationMs),
    endedAt: Math.floor(endedAt),
    endedBy: record.endedBy,
    won: Boolean(record.won),
  }
}

/** 基于可注入 backend 的存储封装。 */
function createStorage(backend) {
  function safeGet(key) {
    try {
      if (!backend || typeof backend.getItem !== 'function') return null
      const raw = backend.getItem(key)
      if (raw === null || raw === undefined) return null
      return typeof raw === 'string' ? raw : String(raw)
    } catch (error) {
      return null
    }
  }

  function safeSet(key, value) {
    try {
      if (!backend || typeof backend.setItem !== 'function') return false
      const result = backend.setItem(key, String(value))
      return result !== false
    } catch (error) {
      return false
    }
  }

  function safeRemove(key) {
    try {
      if (!backend || typeof backend.removeItem !== 'function') return false
      const result = backend.removeItem(key)
      return result !== false
    } catch (error) {
      return false
    }
  }

  function loadBestScore() {
    const raw = safeGet(STORAGE_KEYS.bestScore)
    if (raw === null || raw.trim() === '') return 0
    const value = Number(raw)
    return isNonNegativeInteger(value) ? value : 0
  }

  function saveBestScore(score) {
    if (!isNonNegativeInteger(score)) return false
    return safeSet(STORAGE_KEYS.bestScore, score)
  }

  function loadTheme() {
    const raw = safeGet(STORAGE_KEYS.theme)
    return THEMES.indexOf(raw) === -1 ? DEFAULT_THEME : raw
  }

  function saveTheme(theme) {
    if (THEMES.indexOf(theme) === -1) return false
    return safeSet(STORAGE_KEYS.theme, theme)
  }

  function loadSoundEnabled() {
    const raw = safeGet(STORAGE_KEYS.sound)
    if (raw === 'off' || raw === 'false' || raw === '0') return false
    if (raw === 'on' || raw === 'true' || raw === '1') return true
    return true
  }

  function saveSoundEnabled(enabled) {
    return safeSet(STORAGE_KEYS.sound, enabled ? 'on' : 'off')
  }

  function loadHistory() {
    const raw = safeGet(STORAGE_KEYS.history)
    if (raw === null || raw.trim() === '') return []
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return []
    }
    if (!Array.isArray(parsed)) return []
    const list = []
    for (const item of parsed) {
      const normalized = normalizeRecord(item)
      if (normalized) list.push(normalized)
      if (list.length >= MAX_HISTORY) break
    }
    return list
  }

  function saveHistory(list) {
    if (!Array.isArray(list)) return false
    const normalized = []
    for (const item of list) {
      const record = normalizeRecord(item)
      if (record) normalized.push(record)
      if (normalized.length >= MAX_HISTORY) break
    }
    return safeSet(STORAGE_KEYS.history, JSON.stringify(normalized))
  }

  function addHistory(record) {
    const normalized = normalizeRecord(record)
    const current = loadHistory()
    if (!normalized) return current
    const next = [normalized].concat(current).slice(0, MAX_HISTORY)
    safeSet(STORAGE_KEYS.history, JSON.stringify(next))
    return next
  }

  function clearHistory() {
    return safeRemove(STORAGE_KEYS.history)
  }

  return {
    loadBestScore,
    saveBestScore,
    loadTheme,
    saveTheme,
    loadSoundEnabled,
    saveSoundEnabled,
    loadHistory,
    saveHistory,
    addHistory,
    clearHistory,
  }
}

/**
 * 微信小程序存储实例。
 * @param {object} [wxApi] 可注入 wx（测试用），默认取全局 wx
 */
function createWxStorage(wxApi) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : null)
  const backend = {
    getItem: function getItem(key) {
      try {
        if (!api || typeof api.getStorageSync !== 'function') return null
        const value = api.getStorageSync(key)
        // wx.getStorageSync 读取不存在的键时返回空字符串
        if (value === '' || value === null || value === undefined) return null
        return typeof value === 'string' ? value : String(value)
      } catch (error) {
        return null
      }
    },
    setItem: function setItem(key, value) {
      try {
        if (!api || typeof api.setStorageSync !== 'function') return false
        api.setStorageSync(key, String(value))
        return true
      } catch (error) {
        return false
      }
    },
    removeItem: function removeItem(key) {
      try {
        if (!api || typeof api.removeStorageSync !== 'function') return false
        api.removeStorageSync(key)
        return true
      } catch (error) {
        return false
      }
    },
  }
  return createStorage(backend)
}

module.exports = {
  STORAGE_KEYS,
  MAX_HISTORY,
  THEMES,
  DEFAULT_THEME,
  createMemoryStorage,
  createStorage,
  createWxStorage,
}
