/**
 * 客户端云开发封装：初始化、静默登录、排行榜、每日挑战、成绩提交。
 *
 * 所有云端失败都不影响单机玩法；页面根据 rejected 的错误码展示提示。
 */
const config = require('../config/cloud')

const state = {
  initialized: false,
  available: false,
  player: null,
  openid: '',
  loginPromise: null,
}

function isAvailable() {
  return state.available
}

function getPlayer() {
  return state.player
}

function getOpenid() {
  return state.openid
}

function isConfigured() {
  return Boolean(config.ENV_ID && String(config.ENV_ID).trim())
}

function init() {
  if (state.initialized) return state.available
  state.initialized = true
  if (typeof wx === 'undefined' || !wx.cloud) {
    state.available = false
    return false
  }
  try {
    const options = { traceUser: true }
    if (isConfigured()) options.env = String(config.ENV_ID).trim()
    wx.cloud.init(options)
    state.available = true
  } catch (error) {
    state.available = false
  }
  return state.available
}

function normalizeError(error) {
  if (error && error.ok === false) {
    return { code: error.code || 'CLOUD_ERROR', message: error.message || '云端服务异常' }
  }
  const message = (error && (error.errMsg || error.message)) || '云端调用失败'
  if (/env|environment|云环境|未开通|not found/i.test(message)) {
    return { code: 'CLOUD_ENV', message: '云开发环境未配置或未开通' }
  }
  if (/timeout|network|fail/i.test(message)) {
    return { code: 'CLOUD_NETWORK', message: '云端网络不稳定，请稍后重试' }
  }
  return { code: 'CLOUD_ERROR', message: message }
}

function call(action, data) {
  init()
  if (!state.available) {
    return Promise.reject({ code: 'CLOUD_UNAVAILABLE', message: '当前基础库不支持云开发' })
  }
  return new Promise(function invoke(resolve, reject) {
    wx.cloud.callFunction({
      name: config.CLOUD_FUNCTION || 'api',
      data: Object.assign({ action }, data || {}),
      success(response) {
        const result = response && response.result
        if (result && result.ok === false) {
          reject(normalizeError(result))
          return
        }
        resolve(result || {})
      },
      fail(error) {
        reject(normalizeError(error))
      },
    })
  })
}

function ensureLogin() {
  init()
  if (state.player) return Promise.resolve(state.player)
  if (!state.available) {
    return Promise.reject({ code: 'CLOUD_UNAVAILABLE', message: '云开发未初始化' })
  }
  if (state.loginPromise) return state.loginPromise

  state.loginPromise = call('login')
    .then(function onLogin(result) {
      state.player = result.player || null
      state.openid = result.openid || (result.player && result.player._openid) || ''
      state.loginPromise = null
      return state.player
    })
    .catch(function onLoginError(error) {
      state.loginPromise = null
      throw error
    })
  return state.loginPromise
}

function refreshPlayer() {
  init()
  if (!state.available) {
    return Promise.reject({ code: 'CLOUD_UNAVAILABLE', message: '云开发未初始化' })
  }
  return call('login').then(function onLogin(result) {
    state.player = result.player || null
    state.openid = result.openid || (result.player && result.player._openid) || ''
    return state.player
  })
}

function submitRun(run) {
  return ensureLogin()
    .then(function doSubmit() {
      return call('submitRun', run || {})
    })
    .then(function updateLocalPlayer(result) {
      if (state.player && Array.isArray(result.achievements)) {
        state.player.achievements = result.achievements
      }
      if (state.player && result.nickname) state.player.nickname = result.nickname
      if (state.player && result.best) {
        const best = result.best
        if (result.game === '2048') {
          state.player.best2048Score = best.score || 0
          state.player.best2048Moves = best.moves || 0
          state.player.best2048Time = best.timeMs || 0
          state.player.best2048At = best.at || null
        } else if (result.game === 'klotski3') {
          state.player.best3Moves = best.moves || 0
          state.player.best3Time = best.timeMs || 0
          state.player.best3At = best.at || null
        } else if (result.game === 'klotski4') {
          state.player.best4Moves = best.moves || 0
          state.player.best4Time = best.timeMs || 0
          state.player.best4At = best.at || null
        }
      }
      return result
    })
}

function getLeaderboard(query) {
  return ensureLogin().then(function doQuery() {
    return call('leaderboard', query || {})
  })
}

function getDaily() {
  return ensureLogin().then(function doQuery() {
    return call('daily')
  })
}

function updateProfile(profile) {
  return ensureLogin().then(function doUpdate() {
    return call('updateProfile', profile || {}).then(function onUpdated(result) {
      state.player = result.player || state.player
      return state.player
    })
  })
}

function updateNickname(nickname) {
  return updateProfile({ nickname })
}

function resetMyData() {
  return ensureLogin()
    .then(function doReset() {
      return call('resetMyData')
    })
    .then(function clearCache(result) {
      state.player = null
      state.openid = ''
      state.loginPromise = null
      return result
    })
}

function saveState(savedGame) {
  return ensureLogin()
    .then(function doSave() {
      return call('saveState', savedGame)
    })
    .then(function updateLocal(result) {
      if (state.player) state.player.savedGame = result.savedGame
      return result
    })
}

function loadState() {
  return ensureLogin()
    .then(function doLoad() {
      return call('loadState')
    })
    .then(function updateLocal(result) {
      if (state.player) state.player.savedGame = result.savedGame || null
      return result.savedGame || null
    })
}

function clearState() {
  return ensureLogin()
    .then(function doClear() {
      return call('clearState')
    })
    .then(function updateLocal(result) {
      if (state.player) state.player.savedGame = null
      return result
    })
}

function uploadAvatar(filePath) {
  if (!state.available) {
    return Promise.reject({ code: 'CLOUD_UNAVAILABLE', message: '云开发未初始化' })
  }
  const text = String(filePath || '')
  const match = text.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)
  const extension = match ? match[1].toLowerCase() : 'png'
  const cloudPath =
    'avatars/' + Date.now() + '-' + Math.floor(Math.random() * 1000000) + '.' + extension
  return new Promise(function executor(resolve, reject) {
    wx.cloud.uploadFile({
      cloudPath,
      filePath: text,
      success: function onUploaded(result) {
        resolve(result.fileID)
      },
      fail: function onFailed(error) {
        reject(error || { message: '头像上传失败' })
      },
    })
  })
}

module.exports = {
  init,
  isAvailable,
  isConfigured,
  getPlayer,
  getOpenid,
  ensureLogin,
  refreshPlayer,
  submitRun,
  getLeaderboard,
  getDaily,
  updateNickname,
  updateProfile,
  resetMyData,
  saveState,
  loadState,
  clearState,
  uploadAvatar,
}
