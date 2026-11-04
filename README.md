# 会话交接（Session Handoff）· DSH 插件

> 常驻显示会话启动时间、工作时间与当前对话轮次；达到可配置上限时，先让模型写出交接文件，再自动把任务转移到一个新会话继续。
> A DeepSeek Harness plugin that shows the session start time, accumulated turn work time, and turn count, and hands the current task off to a fresh session at a configurable limit.

[English](#english) · [安装](#安装与更新) · [License](#license)

在 DeepSeek Harness Web 界面的输入框下方常驻一条状态栏，显示当前会话的启动时间、工作时间与执行轮次（对话轮次），并在轮次达到上限时，让模型先写一份交接文件，再把任务转移到新会话继续。

## 显示内容

状态栏从左到右依次是：

- **启动**：`启动 14:32`，取会话创建时间（会话头的 `createdAt`）；不是今天创建的会话会带上日期，如 `11-02 14:32`。鼠标悬停（或读屏聚焦触发区）可拿到完整的启动时间。
- **工作时间**：`工作时间 12分03秒`，是各轮任务运行时间之和——每轮从 `turn/start` 到 `turn/end` 的时长相加，轮与轮之间的空闲不计；正在跑的这一轮会实时累加（每秒刷新），满一小时后按分钟显示，如 `1小时05分`。它不是「当前时间 − 启动时间」的墙钟年龄。
- **轮次**：`轮次 n/上限`（按 `turn/start` 折叠的会话轮次，一次用户输入 = 一轮），以及交接阶段：`正在写交接文件…`、`正在创建接续会话…`、`已交接 → <新会话>`（触发区显示 `· 已交接`）、`已达上限（未开启自动交接）`、`交接失败：<原因>`。

「启动 · 工作时间」本身也是一个按钮，点击弹出「工时记录」面板，见下一节。

## 操作

输入框下方的状态栏里，左边是「启动 · 工作时间」信息胶囊，右边是「轮次 n/上限」设置胶囊（与输入栏右侧的上下文环一致）：

- **点击「启动 · 工作时间」**：在触发区上方弹出「工时记录」面板，外观与输入区的 token/统计面板一致（图标 + 标题、标题下一根 0.5px 分割线、右对齐的数值行，`dl` 语义），显示 **启动时间**、**最后对话结束时间**（最近一次 `turn/end` 的完整时间）与 **总工作时间**（与胶囊同一数字，进行中的轮次实时累加）。
- **点击「轮次 n/上限」**：弹出设置窗，内含轮次进度、最大轮次、自动交接、启用监控、立即交接与保存；两个面板互斥，点击窗外或按 Esc 关闭。
- **划过**：两个胶囊都有底色高亮（`--dsw-alias-interactive-bg-hover`）。
- 已交接的会话里，设置窗提供「打开接续会话」按钮，可手动切到接续会话；`立即交接` 在该会话隐藏，不会再重复发起交接。

## 交接流程

1. 在 `turn/end` 之后判定：轮次 ≥ 最大轮次（默认 30）。
2. 向当前会话注入一条交接指令（`agent.followup`，等 agent 空闲后发送），要求模型用 `write` 写出交接文件，包含任务目标、当前进度、未完成事项、关键文件、决策与约束、待确认问题、环境信息。
3. 交接那一轮结束后：
   - 文件存在 → 创建新会话（沿用原会话所在的**工作区**与**当前选中的 agent preset**，新会话从该工作区的目录启动），立即把它命名为「**原会话标题 第N次交接**」（N 沿交接链递增；`session.create` 本身不接受标题，是创建后调用 `rename`），再把「先读交接文件再继续」的提示发给新会话；原会话未归入任何工作区时沿用当前工作目录，接续会话也保持未分组；
   - 文件缺失 → 重试一次；仍缺失则用会话日志生成兜底交接文件，再转移。
4. 每个会话最多交接一次：
   - 交接阶段同时写进内存与 `session-handoff.state.json`，插件/宿主重载后仍然有效；
   - 转移期间有进程内互斥锁，「同一轮次里重复的 turn/end」「重复点击立即交接」都不会创建第二个接续会话；
   - 状态文件丢失时，仍可用交接目录里的交接文件判定（文件名含会话短 id）。
5. 插件重载后第一次看到旧会话时，会用交接文件 + 接续会话里的续接提示（`这是上一会话 <旧会话> 的交接延续`，优先匹配本次交接文件路径）重建「已交接 → 接续会话」状态，不再触发新会话。

交接文件默认写到 `<会话工作目录>/tmp/handoff/<时间戳>-<会话短id>.md`，可通过设置文件的 `handoffDir` 改变相对目录。

## 自动跳转

交接完成时，仅当**当前页面正看着这次转移**（轮次处于 `正在写交接文件…` / `正在创建接续会话…`，并且探针观察到变成 `已交接`）才自动切到接续会话，而且同一个（旧会话, 接续会话）只跳一次（`localStorage` 标记）。之后回到已交接的旧会话不会被弹走；换页、重开页面、点侧栏进入都一样，需要去接续会话时用「打开接续会话」。

## 设置与存储

- 设置文件：`$DSH_PROFILE_DIR/session-handoff.settings.json`（没有 `DSH_PROFILE_DIR` 时用 `$DSH_HOME/session-handoff.settings.json`）。
- 交接状态文件：同目录的 `session-handoff.state.json`，按会话记录 `phase` / `handoffFile` / `newSessionId`，只保留 7 天内、最多 500 条。
- 默认值：`enabled: true`、`autoHandoff: true`、`maxRounds: 30`、`handoffDir: tmp/handoff`。
- 宿主编排行：`cordis.patch.yml` 插入 `session-handoff` 行（包根 `index.js`）；浏览器半边由 `package.json` 的 `dsh.client` 声明，注册到 `conversation.composer.dock`。

## 本机接口

`http://127.0.0.1:<web 端口>/session-handoff/api`

- `GET /session-handoff/api` → `{ settings, file, stateFile, source }`
- `GET /session-handoff/api?session=<sessionId>` → 该会话的 `{ session, startedAt, runMs, runStartedAt, lastTurnEndedAt, guard, turns }`：`startedAt` 是会话创建时间（Unix 毫秒），`runMs` 是已结束轮次的工作时间之和（毫秒），`runStartedAt` 是当前轮的开始时间（没有在跑的轮次时 0），`lastTurnEndedAt` 是最近一次 `turn/end` 的时间，`guard` 含轮次、工作时间与交接阶段（只对进程内活跃会话有效）
- `POST` `{ "action": "settings", "maxRounds": 30, "enabled": true, "autoHandoff": true }`
- `POST` `{ "action": "handoff", "sessionId": "<sessionId>" }`（该会话已在交接流程中时返回 409）

跨站请求（`Origin` 不匹配 或 `Sec-Fetch-Site` 非 `same-origin`）一律 403。

## 测试

```
bun test
```

单测用模拟的宿主上下文覆盖：只交接一次、重复 `turn/end` 不重复开会话、插件重载后不重复交接、重载后从交接文件/续接提示恢复状态、续接沿用选中 preset、交接中拒绝重复请求、启动时间/最后结束时间投影与探针字段、轮次工作时间累加（轮间空闲不计、重复 `turn/end` 不重复计、未结束的轮次丢弃）、接续会话继承工作区、标题按「原标题 第N次交接」生成与连号（含无标题兜底、80 字节截断、重命名失败不阻断交接）。状态栏的启动时间/工作时间格式化与实时累加由 `test/client-clock.test.mjs` 直接加载浏览器半边做纯函数校验。

## 安装与更新

仓库：<https://github.com/xiaohui-zhangxh/dsh-session-handoff>；DSH 桌面 profile 以 `link:` 依赖指向它。

```bash
git clone https://github.com/xiaohui-zhangxh/dsh-session-handoff.git
dsh plugin --profile desktop add "$(pwd)/dsh-session-handoff"
```

- 安装后 profile 的 `package.json` 依赖为 `link:<仓库路径>`，`dsh.profile.bundles` 里保留 `@local/dsh-session-handoff`。
- 宿主半边（`index.js`）改动后，运行中的 DSH 不会自动换模块：重启 DSH（或在插件管理里重装）后生效；浏览器半边 `client.js` 由客户端模块轮询自动换新。启动时间与运行时间由宿主半边的投影提供，因此升级到带该显示的一版后，同样要等 DSH 重启才会出现在状态栏（旧宿主只会显示轮次）。
- `GET /session-handoff/api` 返回的 `source` 是当前进程实际加载的模块文件 URL，可用来确认正在跑哪一份代码。
- 设置与交接状态在 `~/.dsh/` 下（见上一节），不随仓库迁移。

## English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin. It keeps a compact status line below the composer with the session start time, the accumulated work time of the session's turns, and the turn counter; the time pill opens a “work time” panel (same skin as the composer token/stat panels: icon + title, rule, right-aligned rows) with the start time, last turn end time, and total work time. When a configurable turn limit is reached it asks the model to write a handoff file, then creates a fresh session with the same workspace and agent preset, names it “<source title> 第N次交接” (N advances along the chain), and sends it a resume prompt. The handoff is durable and idempotent: one session can never spawn more than one continuation, and reopening a handed-off session does not redirect away from it again.

- Requires DSH 0.2.x on the Web/desktop profile (verified on 0.2.1-rc.5).
- Install: `dsh plugin --profile desktop add <repo dir>`.
- Tests: `bun test`.

## 已知边界

- 只处理根会话；子代理（`origin: subagent`）不参与交接。
- 接续会话会继承原会话的工作区，因此出现在侧栏同一分组而不是「未分组」；原会话本身未归组时不做强行归类。
- 启动时间取会话创建时间；宿主半边未更新（投影里没有 `startedAt`/`runMs`）时，状态栏只显示轮次，不显示启动时间与工作时间。
- 工作时间只累计已结束轮次的 `turn/start → turn/end`；宿主崩溃导致某轮没有 `turn/end` 时，该轮不计入（不会把之后到下一轮之间的空闲算进去）。
- 「最后对话结束时间」只在 `turn/end` 到达时更新；进行中的一轮显示的是上一次结束时间。
- 会话里用 `cd` 切换过的子目录不会带进接续会话：接续会话以工作区目录为工作目录（交接文件里记录了原工作目录，可在接续会话中切回）。
- 接续会话的命名依赖标题后缀「第N次交接」：连号靠解析上一会话标题得到，手动改写或删除该后缀后，下一条接续会话会按新标题重新从第 1 次开始编号；标题受 DSH 的 80 字节上限约束，超长时截断原标题以保留后缀；重命名失败只记日志，不影响交接本身。
- 交接状态文件在 DSH home 下，换 profile 或清空 `~/.dsh` 后会丢失；此时退回交接文件判定（仍不会重复开会话，只是 `已交接 →` 的新会话可能显示为空）。
- 停止插件或删除本包即移除状态栏与后台判定；已生成的交接文件保留。

## License

[MIT](LICENSE)
