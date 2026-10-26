/**
 * 轻量音效与震动（微信小程序版）。
 *
 * 使用本地 WAV 文件（assets/merge.wav、win.wav、over.wav），
 * 不依赖网络资源；wx API 不可用或播放失败时静默忽略，不影响游戏。
 * wxApi 可注入，便于在 Node 中做容错测试。
 */
function createSoundPlayer(options) {
  const opts = options || {}
  const wxApi = opts.wxApi || (typeof wx !== 'undefined' ? wx : null)
  const getEnabled = opts.getEnabled || function alwaysEnabled() {
    return true
  }

  const contexts = {}

  function getContext(name) {
    if (contexts[name]) return contexts[name]
    if (!wxApi || typeof wxApi.createInnerAudioContext !== 'function') return null
    try {
      const context = wxApi.createInnerAudioContext()
      context.src = '/assets/' + name + '.wav'
      context.volume = 0.6
      context.obeyMuteSwitch = false
      if (typeof context.onError === 'function') {
        context.onError(function ignoreAudioError() {})
      }
      contexts[name] = context
      return context
    } catch (error) {
      return null
    }
  }

  function play(name) {
    if (!getEnabled()) return false
    const context = getContext(name)
    if (!context) return false
    try {
      context.stop()
      context.play()
      return true
    } catch (error) {
      return false
    }
  }

  function vibrate(type) {
    if (!getEnabled()) return false
    if (!wxApi || typeof wxApi.vibrateShort !== 'function') return false
    try {
      // 部分环境不支持 type 参数，失败回调里静默忽略
      wxApi.vibrateShort({
        type: type || 'light',
        fail: function ignoreVibrateError() {},
      })
      return true
    } catch (error) {
      return false
    }
  }

  function destroy() {
    Object.keys(contexts).forEach(function destroyContext(name) {
      try {
        if (typeof contexts[name].destroy === 'function') contexts[name].destroy()
      } catch (error) {
        // 忽略销毁异常
      }
      delete contexts[name]
    })
  }

  return {
    playMerge: function playMerge() {
      return play('merge')
    },
    playWin: function playWin() {
      return play('win')
    },
    playGameOver: function playGameOver() {
      return play('over')
    },
    vibrate,
    destroy,
  }
}

module.exports = { createSoundPlayer }
