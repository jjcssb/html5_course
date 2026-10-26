# 小程序模拟器自动化（可选）

这些脚本用于在微信开发者工具模拟器中做功能验证与截图，**不是小程序运行所必需**。

## 前提

1. 微信开发者工具已安装并登录；
2. 开发者工具中开启：设置 → 安全设置 → 服务端口；
3. 项目根目录安装自动化依赖（仅本地测试，不参与小程序打包）：
   ```bash
   npm install --no-save miniprogram-automator
   ```
4. 开启自动化端口（路径按本机安装位置调整）：
   ```bash
   "D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto ^
     --project "D:\...\2048-miniprogram" --auto-port 9421 --trust-project
   ```

## 运行

```bash
node tests/simulator/functional.js   # 2048 功能
node tests/simulator/gameflow.js     # 2048 胜负流程
node tests/simulator/klotski.js      # 数字华容道流程
node tests/simulator/shot.js initial
node tests/simulator/shot.js klotski-3
# 截图场景：initial swipe restart-confirm dark retro history win over
#           home klotski-size klotski-3 klotski-4 klotski-win
```

`gameflow.js` 会向页面注入测试局面（仅运行时，不写入交付代码），再调用真实的
`move / onContinueTap / onRestartOverlayTap`，验证胜利、继续、结束、重开与拒绝移动。

`klotski.js` 会验证首页入口、3×3/4×4 选择、触摸滑动、计时、胜利、最佳记录与重开/换尺寸确认。

截图输出到 `screenshots/`。

## 已知工具限制（不是游戏缺陷）

- `miniprogram-automator` 0.13 与开发者工具 2.02 的 `page.callMethod` 不兼容；
  脚本改用 `miniProgram.evaluate` 在页面上下文调用页面方法。
- `App.captureScreenshot` 每次页面加载只能成功一次；因此截图脚本每个场景单独启动进程。
- 当前自动化通道里 `navigateBack / redirectTo / reLaunch` 不会改变页面栈；
  `klotski.js` 的 4×4 步骤用 `navigateTo` 绕过，“换尺寸”按钮的确认逻辑单独验证。
  真实用户操作不受此限制。
- 胜利/结束弹窗截图通过 `setData` 渲染界面，**规则逻辑**由 `tests/unit/engine.test.js` 覆盖。
