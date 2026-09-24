# 好感度分析

<p align="center">
  <img src="docs/assets/logo.png" alt="好感度分析" width="96" />
</p>

<p align="center">
  <b>一段双人聊天，读成对方对你的好感信号。</b><br/>
  贴进微信记录，选你是哪一边。情绪、意图、回复评级和好感度，标在气泡上。
</p>

<p align="center">
  <a href="README.en.md">English</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/FerryCorleone/crush-monitor">基于 Crush Monitor</a>
  &nbsp;·&nbsp;
  <a href="https://typesafe.ai/blog/introducing-system-one-models-and-jev">Jev</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT</a>
</p>

<p align="center">
  <img src="docs/assets/shot-home.png" alt="选择关系类型" width="220" />
  &nbsp;
  <img src="docs/assets/shot-import.png" alt="确认哪边是你" width="220" />
  &nbsp;
  <img src="docs/assets/shot-demo.png" alt="气泡上的好感标签" width="220" />
</p>

<p align="center">
  <sub>选关系 &nbsp;·&nbsp; 确认哪边是你 &nbsp;·&nbsp; 标签贴在原话上</sub>
</p>

它不写一篇「你们很般配」的作文。每一句对方的话给出情绪和意图，你的回复给出评级，整段对话合成一个好感度。数字是模型判断，不是对方的心意证明。

## 贴进去就能看

微信电脑版多选复制，或改成一行一条：

```text
我：今晚有空吗
小明：有啊，想吃什么
```

也认 QQ、WhatsApp 导出，以及带「下午」的微信时间。日期不会被当成第三个人。认不出两个人时，开始按钮保持灰色，页面写明原因。

选好「哪边是你」之后：

- 对方气泡下是情绪和意图
- 你的气泡下是回复评级
- 顶上是这一段的好感度，以及下一步建议

关系场景可以换：暧昧、朋友同事、社交平台。评分口径跟着场景走，不把导师关心读成恋爱。

## 跑起来

需要 Node.js 22.12 或更高。

```bash
git clone https://github.com/zhengge6/haogan.git
cd haogan
npm ci
cp .env.example .env
```

在 `.env` 里填 `JEV_API_KEY`（TypeSafe、Vercel AI Gateway 或 OpenRouter 的 Jev Key，三选一）。然后：

```bash
npm run build
npm start
```

打开 `http://127.0.0.1:3178/`。改界面用 `npm run dev`，页面在 `5178`，接口仍走 `3178`。

Key 只放在服务端。聊天原文会发到你选的模型服务商，费用记在这把 Key 上。

## 自用和管理

| 你要做的事 | 去哪 |
| --- | --- |
| 分析一段聊天 | `/` |
| 看已经同步的对话、补标签、导出 | `/admin` |
| 兑换码 | 后台里管理。`REDEEM_ENABLED=false` 时不拦分析次数 |

后台可以：

- 按和前台一样的气泡查看已同步的标签。有缓存就不再打模型
- 一条记录还没有标签时，一键分析并写入这条对话
- 导出 `我：内容` 这样的文本，或一张从上到下的长截图

同一段聊天如果交换过「哪边是你」，再换回来用本机上次的结果，不重复分析。

## 边界

- 只处理两个人的文字。图片和语音显示为占位，不参与打分。
- 模型看不到线下相处、语气和表情。
- 同步到服务器的记录可供管理员查看。不要贴高度敏感的内容。
- 试玩次数和兑换只在你打开 `REDEEM_ENABLED` 之后生效。

## 配置

| 变量 | 说明 |
| --- | --- |
| `JEV_PROVIDER` | `typesafe`、`vercel` 或 `openrouter` |
| `JEV_API_KEY` | 对应平台的 Key，仅服务端 |
| `PORT` / `HOST` | 默认 `3178` / `0.0.0.0` |
| `AUTH_ENABLED` | 账号登录 |
| `REDEEM_ENABLED` | 是否用兑换码限制分析次数 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 后台账号，部署后请换成强密码 |
| `CRUSH_DATA_DIR` | 对话和兑换数据目录 |

不要提交 `.env`、兑换码库或用户对话。生产部署见 `deploy/`。同步代码时不要覆盖服务器上的 `.env` 和 `data/`。仓库根目录的 `index.html` 必须继续指向 `/src/main.tsx`，不要用 `dist/index.html` 盖掉它。

## 技术栈

React 19、TypeScript、Vite、Express 5、Zod。判断模型是 Jev。数据是本机 JSON。

```text
src/          聊天界面、登录、分析状态
server/       分析、账号、兑换、同步、后台
shared/       解析、评分、同步快照
docs/assets/  标志和截图
deploy/       systemd 与安装脚本
```

## 致谢

本项目基于 [@FerryCorleone](https://github.com/FerryCorleone) 的 [Crush 好感监控器](https://github.com/FerryCorleone/crush-monitor)（MIT）二次开发。原作版权归原作者。模型是 [TypeSafe 的 Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)。如果你是从这里知道这个方向的，也请给原仓库一个 Star。详见 [NOTICE](NOTICE)。

[MIT](LICENSE)
