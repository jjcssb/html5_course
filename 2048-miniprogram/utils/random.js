/**
 * 可重现的伪随机数生成器（mulberry32），用于测试与确定性演示。
 */
function createSeededRandom(seed) {
  let state = (seed || 1) >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

module.exports = { createSeededRandom }
