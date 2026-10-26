/**
 * 成就定义与判定（客户端/云函数共用）。
 * 只根据一次已校验的成绩与当前玩家数据计算，不信任客户端传入的成就。
 */
const ACHIEVEMENTS = Object.freeze([
  { id: 'first_2048', name: '2048 初胜', desc: '首次合成 2048' },
  { id: 'first_3x3', name: '华容道入门', desc: '完成一局 3×3 华容道' },
  { id: 'first_4x4', name: '华容道挑战', desc: '完成一局 4×4 华容道' },
  { id: 'daily_1', name: '每日挑战', desc: '完成一次每日挑战' },
  { id: 'speed_3', name: '速通 3×3', desc: '3×3 30 步内且 2 分钟内完成' },
  { id: 'score_4096', name: '4096 俱乐部', desc: '2048 达到 4096 分' },
])

const BY_ID = ACHIEVEMENTS.reduce(function build(map, item) {
  map[item.id] = item
  return map
}, {})

/** 返回本次成绩新满足的成就 id 列表。 */
function unlockForRun(run) {
  const ids = []
  if (!run) return ids
  if (run.game === '2048') {
    if (run.score >= 2048) ids.push('first_2048')
    if (run.score >= 4096) ids.push('score_4096')
  }
  if (run.game === 'klotski3') {
    ids.push('first_3x3')
    if (run.moves <= 30 && run.timeMs <= 120000) ids.push('speed_3')
  }
  if (run.game === 'klotski4') ids.push('first_4x4')
  if (run.daily) ids.push('daily_1')
  return ids
}

/** 合并已有成就与新成就，保持定义顺序。 */
function mergeUnlocked(existing, newIds) {
  const set = new Set((existing || []).concat(newIds || []))
  return ACHIEVEMENTS.filter(function filter(item) {
    return set.has(item.id)
  }).map(function map(item) {
    return item.id
  })
}

function describe(id) {
  return BY_ID[id] || { id, name: id, desc: '' }
}

/** 把 id 列表变成完整对象列表（用于页面展示）。 */
function detailList(ids) {
  const set = new Set(ids || [])
  return ACHIEVEMENTS.map(function map(item) {
    return Object.assign({ unlocked: set.has(item.id) }, item)
  })
}

module.exports = { ACHIEVEMENTS, unlockForRun, mergeUnlocked, describe, detailList }
