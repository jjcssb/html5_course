const cloud = require('./utils/cloud')

App({
  onLaunch() {
    // 静默初始化云开发；未配置环境时仍可单机玩
    cloud.init()
  },
  globalData: {
    appName: '小游戏合集',
  },
})
