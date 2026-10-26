/**
 * 触摸手势单元测试：方向判定、最小距离、单次触发、取消、多指、快速连续。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_MIN_DISTANCE,
  createTouchTracker,
  resolveSwipe,
} = require('../../utils/gesture')

const point = (x, y) => ({ x, y })
const touch = (x, y) => ({ clientX: x, clientY: y })

test('resolveSwipe：四个方向判定正确', () => {
  assert.equal(resolveSwipe(point(100, 100), point(20, 100)), 'left')
  assert.equal(resolveSwipe(point(100, 100), point(180, 100)), 'right')
  assert.equal(resolveSwipe(point(100, 100), point(100, 20)), 'up')
  assert.equal(resolveSwipe(point(100, 100), point(100, 180)), 'down')
})

test('resolveSwipe：以位移较大的轴作为方向', () => {
  assert.equal(resolveSwipe(point(100, 100), point(180, 130)), 'right')
  assert.equal(resolveSwipe(point(100, 100), point(20, 70)), 'left')
  assert.equal(resolveSwipe(point(100, 100), point(130, 20)), 'up')
  assert.equal(resolveSwipe(point(100, 100), point(70, 180)), 'down')
  assert.equal(resolveSwipe(point(0, 0), point(40, 40)), 'right')
})

test('resolveSwipe：小于最小滑动距离或数据异常时不算有效滑动', () => {
  assert.equal(resolveSwipe(point(100, 100), point(110, 108)), null)
  assert.equal(resolveSwipe(point(100, 100), point(123, 100)), null)
  assert.equal(resolveSwipe(point(100, 100), point(124, 100)), 'right')
  assert.equal(resolveSwipe(point(100, 100), point(10, 100), 200), null)
  assert.equal(resolveSwipe(null, point(10, 10)), null)
  assert.equal(resolveSwipe(point(0, 0), null), null)
  assert.equal(resolveSwipe({ x: NaN, y: 0 }, point(100, 0)), null)
  assert.equal(resolveSwipe(point(0, 0), point(100, 0), -5), 'right')
  assert.equal(DEFAULT_MIN_DISTANCE, 24)
})

test('触摸控制器：一次按下到抬起最多触发一次移动', () => {
  const swipes = []
  const tracker = createTouchTracker({ onSwipe: (direction) => swipes.push(direction) })
  assert.equal(tracker.touchStart([touch(100, 100)]), true)
  assert.equal(tracker.touchEnd([touch(20, 100)]), 'left')
  assert.equal(tracker.touchEnd([touch(20, 100)]), null)
  assert.deepEqual(swipes, ['left'])
  assert.equal(tracker.isTracking, false)
})

test('触摸控制器：轻触（位移不足）不触发移动', () => {
  const swipes = []
  const tracker = createTouchTracker({ onSwipe: (direction) => swipes.push(direction) })
  tracker.touchStart([touch(100, 100)])
  assert.equal(tracker.touchEnd([touch(105, 104)]), null)
  assert.deepEqual(swipes, [])
})

test('触摸控制器：缺少坐标不会误触发', () => {
  const tracker = createTouchTracker()
  tracker.touchStart([touch(100, 100)])
  assert.equal(tracker.touchEnd([{ clientX: undefined, clientY: 10 }]), null)
  assert.equal(tracker.isTracking, false)
})

test('触摸控制器：触摸取消（来电/返回手势）后不再产生移动', () => {
  const swipes = []
  const tracker = createTouchTracker({ onSwipe: (direction) => swipes.push(direction) })
  tracker.touchStart([touch(100, 100)])
  tracker.touchCancel()
  assert.equal(tracker.isTracking, false)
  assert.equal(tracker.touchEnd([touch(20, 100)]), null)
  assert.deepEqual(swipes, [])
})

test('触摸控制器：多指操作被忽略', () => {
  const swipes = []
  const tracker = createTouchTracker({ onSwipe: (direction) => swipes.push(direction) })
  assert.equal(tracker.touchStart([{ clientX: 100, clientY: 100, identifier: 1 }, { clientX: 300, clientY: 300, identifier: 2 }]), false)
  assert.equal(tracker.isTracking, false)
  assert.equal(tracker.touchEnd([touch(20, 100)]), null)
  assert.deepEqual(swipes, [])
})

test('触摸控制器：快速连续滑动每次都能识别（页面负责动画串行化）', () => {
  const swipes = []
  const tracker = createTouchTracker({ onSwipe: (direction) => swipes.push(direction) })
  tracker.touchStart([touch(100, 100)])
  tracker.touchEnd([touch(200, 100)])
  tracker.touchStart([touch(100, 100)])
  tracker.touchEnd([touch(100, 200)])
  tracker.touchStart([touch(100, 100)])
  tracker.touchEnd([touch(10, 100)])
  assert.deepEqual(swipes, ['right', 'down', 'left'])
})

test('触摸控制器：reset 可强制清空进行中的手势', () => {
  const tracker = createTouchTracker()
  tracker.touchStart([touch(100, 100)])
  tracker.reset()
  assert.equal(tracker.isTracking, false)
  assert.equal(tracker.touchEnd([touch(20, 100)]), null)
})

test('触摸控制器：空 touches 不会开始手势', () => {
  const tracker = createTouchTracker()
  assert.equal(tracker.touchStart([]), false)
  assert.equal(tracker.touchStart(null), false)
  assert.equal(tracker.touchEnd([touch(20, 100)]), null)
})
