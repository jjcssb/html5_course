/**
 * 云开发配置。
 *
 * 使用步骤：
 * 1. 微信开发者工具 → 云开发 → 开通 → 创建环境（免费额度即可）；
 * 2. 把环境 ID 复制到 ENV_ID；
 * 3. 右键 cloudfunctions/api → “上传并部署：云端安装依赖”；
 * 4. 重新编译。
 *
 * 未填写 ENV_ID 时，小程序仍可单机玩；排行榜/每日挑战会提示云端未连接。
 */
module.exports = {
  ENV_ID: 'cloud1-d6g4xzrx22180edd4',
  CLOUD_FUNCTION: 'api',
  COLLECTIONS: {
    PLAYERS: 'players',
    RANKINGS: 'rankings',
  },
}
