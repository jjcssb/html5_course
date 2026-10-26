# 云开发配置步骤（v1.8.0 必读）

本项目排行榜、每日挑战、云端最佳记录依赖**微信云开发**。代码已经写好，但云环境必须由小程序管理员在开发者工具中开通一次。

> **本项目当前状态**：已创建免费体验环境、已部署 `api` 云函数、已完成真实云在线验证；`config/cloud.js` 已填环境 ID。
>
> **费用提醒**：微信云开发不是永久免费。常见政策是新用户免费体验 1 个月，之后基础套餐约 39.9 元/月（以开通页为准）。课程演示够用；**到期前请在云开发控制台确认续费/停用，避免自动扣费**。

## 1. 开通云开发并创建环境

1. 用微信开发者工具打开 `2048-miniprogram/`；
2. 点击工具栏 **“云开发”**（第一次会提示开通）；
3. 同意开通，创建一个环境（选择开通页提供的免费体验/基础版）；
4. 复制**环境 ID**（形如 `cloud1-2gxxxxx`，不是环境名称）；
5. 把环境 ID 填到：

```js
// config/cloud.js
module.exports = {
  ENV_ID: 'cloud1-xxxxxxxx',
  ...
}
```

> 未填环境 ID 时：2048、华容道、每日挑战（本地种子）仍可玩；排行榜与云端同步会提示“云开发环境未配置”。体验版要展示排行榜，必须完成本节。

## 2. 创建数据库集合

云函数会自动尝试创建；如果提示权限/集合不存在，请在云开发控制台 → 数据库手动创建两个集合：

| 集合 | 用途 | 建议权限 |
| --- | --- | --- |
| `players` | 每个微信用户一条：昵称、各游戏最佳记录、总场次、成就 | 仅创建者可读写 |
| `rankings` | 用户 × 游戏 × 周期（总榜/周榜/今日）一条 | 仅创建者可读写 |

> 排行榜分页需要按 `game + periodKey` 查询；数据量大时建议在云开发控制台给 `rankings` 建组合索引（`game` 升序、`periodKey` 升序）。课程数据量下不建索引也能运行。

客户端**不直接读写数据库**，所有读写都通过云函数，因此不需要开放“所有用户可读”。

## 3. 部署云函数

云函数目录：`cloudfunctions/api`（登录、提交成绩、排行榜、每日挑战、改昵称、成就、云端存档、2048/华容道重放校验全部在这一个函数里）。

### 方式 A：开发者工具右键

右键 `cloudfunctions/api` → **上传并部署：云端安装依赖（不上传 node_modules）**。

### 方式 B：命令行

```bash
"D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions deploy ^
  --project "D:\...\2048-miniprogram" ^
  --env "你的环境ID" ^
  --names api ^
  --remote-npm-install
```

## 4. 验证

1. 重新编译小程序；
2. 首页应显示“云端玩家 · 玩家xxxx”和“已同步”；
3. 点“排行榜”，应出现空榜/已有记录，而不是“云开发环境未配置”；
4. 玩一局华容道/2048，完成弹窗应显示“成绩已上传云端”或“云端最佳已更新”；
5. 首页“每日挑战”可分别进入 2048 / 3×3 / 4×4，完成后计入最佳成绩（不单独生成今日榜）；
6. 首页成就卡应显示“成就 X/6”，完成挑战后增加；
7. 首次进入应先出现“创建玩家档案”，选头像/昵称/性别后进入首页；
8. “我的资料”可修改头像、昵称、性别，并查看最佳成绩/成就、分享挑战、清空云端记录；
9. 华容道/2048 走几步后返回首页，应出现“继续上局”，点进去步数/分数/计时恢复；连续切游戏不应被旧存档覆盖。

## 5. 数据结构

### players

```json
{
  "_openid": "微信 openid",
  "nickname": "玩家1234",
  "nicknameSet": false,
  "profileCompleted": false,
  "gender": "private",
  "avatar": "a1",
  "avatarUrl": "cloud://env/avatars/xxx.png",
  "best2048Score": 4096,
  "best2048Moves": 300,
  "best2048Time": 120000,
  "best2048At": "Date",
  "best3Moves": 30,
  "best3Time": 65000,
  "best3At": "Date",
  "best4Moves": 120,
  "best4Time": 300000,
  "best4At": "Date",
  "totalRuns": 8,
  "achievements": ["first_3x3", "daily_1"],
  "savedGame": {
    "game": "klotski3",
    "size": 3,
    "seed": 123456,
    "board": [1, 2, 3, 4, 5, 6, 7, 0, 8],
    "directions": ["left"],
    "moves": 1,
    "elapsedMs": 18000,
    "daily": false,
    "dailyKey": "",
    "score": 0
  }
}
```

> `savedGame` 只保留**最新一局**（华容道或 2048 共用一个槽位）；有进度退出时由客户端自动保存，首页显示“继续上局”。每日挑战会校验日期，过期自动丢弃。

> 新玩家昵称由云函数生成“玩家 + 4 位数字”，`nicknameSet=false`、`profileCompleted=false`；首次进入会到建档页，保存后置为 `true`，同时写入 `gender`（male/female/private）、`avatar`（a1–a6）和可选的 `avatarUrl`（微信头像上传后的云存储 fileID）。昵称只允许 2–12 个字符，由云函数校验。

> 最佳记录使用扁平字段保存，避免 CloudBase 在 `best: null` 上合并嵌套对象时报
> `Cannot create field 'at' in element {best3: null}`。

### rankings

```json
{
  "_openid": "微信 openid",
  "nickname": "玩家1234",
  "avatar": "a1",
  "avatarUrl": "cloud://env/avatars/xxx.png",
  "game": "2048 | klotski3 | klotski4",
  "periodKey": "all | week:2026-W42",
  "score": 4096,
  "moves": 300,
  "timeMs": 120000,
  "dailyKey": "2026-10-19"
}
```

- 2048 按 `score` 降序、`moves` 升序；
- 华容道按 `moves` 升序、`timeMs` 升序；`moves=0` 的历史脏数据会被过滤，不再卡住新最佳；
- 排行榜默认总榜，只有总榜 / 本周两个周期；每日挑战保留玩法，不生成今日排行榜。
- 华容道按 `moves` 升序、`timeMs` 升序；
- 客户端提交 2048/华容道的 `seed + directions`，云函数会用同一套引擎 **重放验证**，防止直接改分数/步数；
- 每日挑战种子由服务端按中国时区日期生成（2048、3×3、4×4 各一个），客户端无法指定；
- 排行榜按页返回（默认 20 条/页，最多前 300 名），支持“加载更多”。

## 6. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 首页显示“云开发环境未配置” | `config/cloud.js` 的 ENV_ID 为空/错误 | 填入正确环境 ID |
| 排行榜“collection not exists” | 未创建 `players`/`rankings` | 控制台手动创建，或重新部署后进首页触发登录 |
| 云函数报 `wx-server-sdk` 缺失 | 部署时未云端安装依赖 | 用“云端安装依赖”重新部署 |
| 每日挑战显示本地模式 | 云函数未部署或网络失败 | 检查云函数 `api` 是否部署成功 |
| 上传体验版后排行榜空白 | 体验版仍连开发环境 | 云开发环境需与小程序 AppID 对应；确认 `ENV_ID` 后重新上传 |
