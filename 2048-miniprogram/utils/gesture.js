/**
 * 触摸手势解析（纯逻辑，可脱离小程序环境在 Node 中测试）。
 *
 * 小程序事件里传入的是 touches / changedTouches 数组，
 * 控制器负责：位移较大轴定方向、最小距离、单次触发、取消与多指忽略。
 */

const DEFAULT_MIN_DISTANCE = 24

/**
 * 根据起点与终点计算滑动方向。
 * @returns {'up'|'down'|'left'|'right'|null}
 */
function resolveSwipe(start, end, minDistance) {
  if (!start || !end) return null
  const x1 = Number(start.x)
  const y1 = Number(start.y)
  const x2 = Number(end.x)
  const y2 = Number(end.y)
  if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return null

  const dx = x2 - x1
  const dy = y2 - y1
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const threshold = isFinite(minDistance) && minDistance > 0 ? minDistance : DEFAULT_MIN_DISTANCE
  if (Math.max(absX, absY) < threshold) return null

  // 位移相同时按横向处理，保证结果确定
  if (absX >= absY) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/**
 * 触摸控制器：页面把 touches / changedTouches 转发进来。
 */
function createTouchTracker(options) {
  const opts = options || {}
  const minDistance = opts.minDistance || DEFAULT_MIN_DISTANCE
  const onSwipe = opts.onSwipe

  let active = false
  let startPoint = null

  function reset() {
    active = false
    startPoint = null
  }

  return {
    get isTracking() {
      return active
    },

    /** 返回 true 表示这次按下被接受为手势起点；多指会被忽略并重置。 */
    touchStart(touches) {
      if (!touches || touches.length !== 1) {
        reset()
        return false
      }
      const touch = touches[0]
      if (!touch || !isFinite(touch.clientX) || !isFinite(touch.clientY)) {
        reset()
        return false
      }
      startPoint = { x: touch.clientX, y: touch.clientY }
      active = true
      return true
    },

    /** 抬手时结算一次方向；没有有效位移或未按下时返回 null。 */
    touchEnd(changedTouches) {
      if (!active || !startPoint) return null
      const touch = changedTouches && changedTouches[0]
      const endPoint = touch ? { x: touch.clientX, y: touch.clientY } : null
      const direction = resolveSwipe(startPoint, endPoint, minDistance)
      reset()
      if (!direction) return null
      if (typeof onSwipe === 'function') onSwipe(direction)
      return direction
    },

    /** 触摸被系统取消（来电、手势返回等）时清空状态，不产生移动。 */
    touchCancel() {
      reset()
    },

    reset,
  }
}

module.exports = {
  DEFAULT_MIN_DISTANCE,
  resolveSwipe,
  createTouchTracker,
}
