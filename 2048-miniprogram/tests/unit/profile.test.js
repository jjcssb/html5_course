const test = require('node:test')
const assert = require('node:assert/strict')

const profile = require('../../utils/profile')

test('profile：6 个头像与 3 个性别选项', () => {
  assert.equal(profile.AVATARS.length, 6)
  assert.equal(profile.GENDERS.length, 3)
  assert.equal(profile.avatarById('a3').emoji, '🐼')
  assert.equal(profile.genderById('female').label, '女生')
})

test('profile：非法头像/性别安全回退', () => {
  assert.equal(profile.normalizeAvatar('bad-avatar'), 'a1')
  assert.equal(profile.normalizeGender('bad-gender'), 'private')
  assert.equal(profile.normalizeAvatar('a6'), 'a6')
  assert.equal(profile.normalizeGender('male'), 'male')
})
