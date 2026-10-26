/**
 * 玩家资料选项（客户端/云函数共用）。
 * 头像使用内置 emoji，不依赖外部图片和云存储，避免上传失败。
 */
const AVATARS = Object.freeze([
  { id: 'a1', emoji: '🎮', label: '玩家' },
  { id: 'a2', emoji: '🐱', label: '小猫' },
  { id: 'a3', emoji: '🐼', label: '熊猫' },
  { id: 'a4', emoji: '🚀', label: '火箭' },
  { id: 'a5', emoji: '🦊', label: '狐狸' },
  { id: 'a6', emoji: '🐯', label: '老虎' },
])

const GENDERS = Object.freeze([
  { id: 'male', label: '男生', symbol: '♂' },
  { id: 'female', label: '女生', symbol: '♀' },
  { id: 'private', label: '保密', symbol: '·' },
])

function avatarById(id) {
  for (const avatar of AVATARS) {
    if (avatar.id === id) return avatar
  }
  return AVATARS[0]
}

function genderById(id) {
  for (const gender of GENDERS) {
    if (gender.id === id) return gender
  }
  return GENDERS[2]
}

function normalizeAvatar(value) {
  return avatarById(String(value || 'a1')).id
}

function normalizeGender(value) {
  return genderById(String(value || 'private')).id
}

module.exports = {
  AVATARS,
  GENDERS,
  avatarById,
  genderById,
  normalizeAvatar,
  normalizeGender,
}
