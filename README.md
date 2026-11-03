# 上下文守卫（@local/dsh-context-guard）

在 DeepSeek Harness Web 界面的输入框下方常驻一条状态栏，显示当前会话的执行轮次（对话轮次），并在轮次达到上限时，让模型先写一份交接文件，再把任务转移到新会话继续。

## 显示内容

`轮次 n/上限`（按 `turn/start` 折叠的会话轮次，一次用户输入 = 一轮），以及交接阶段：`正在写交接文件…`、`正在创建接续会话…`、`已交接 → <新会话>`（触发区显示 `· 已交接`）、`已达上限（未开启自动交接）`、`交接失败：<原因>`。

## 操作

输入框下方的「轮次 n/上限」是一个紧凑胶囊触发区（与输入栏右侧的上下文环一致）：

- **划过**：底色高亮（`--dsw-alias-interactive-bg-hover`）。
- **点击**：在触发区上方弹出悬浮设置窗（菜单面板：圆角 12、反转描边、lv3 阴影），内含轮次进度、最大轮次、自动交接、启用监控、立即交接与保存；点击窗外或按 Esc 关闭。
- 已交接的会话里，设置窗提供「打开接续会话」按钮，可手动切到接续会话；`立即交接` 在该会话隐藏，不会再重复发起交接。

## 交接流程

1. 在 `turn/end` 之后判定：轮次 ≥ 最大轮次（默认 100）。
2. 向当前会话注入一条交接指令（`agent.followup`，等 agent 空闲后发送），要求模型用 `write` 写出交接文件，包含任务目标、当前进度、未完成事项、关键文件、决策与约束、待确认问题、环境信息。
3. 交接那一轮结束后：
   - 文件存在 → 创建新会话（沿用原工作目录与**当前选中的 agent preset**），并把「先读交接文件再继续」的提示发给新会话；
   - 文件缺失 → 重试一次；仍缺失则用会话日志生成兜底交接文件，再转移。
4. 每个会话最多交接一次：
   - 交接阶段同时写进内存与 `context-guard.state.json`，插件/宿主重载后仍然有效；
   - 转移期间有进程内互斥锁，「同一轮次里重复的 turn/end」「重复点击立即交接」都不会创建第二个接续会话；
   - 状态文件丢失时，仍可用交接目录里的交接文件判定（文件名含会话短 id）。
5. 插件重载后第一次看到旧会话时，会用交接文件 + 接续会话里的续接提示（`这是上一会话 <旧会话> 的交接延续`，优先匹配本次交接文件路径）重建「已交接 → 接续会话」状态，不再触发新会话。

交接文件默认写到 `<会话工作目录>/tmp/handoff/<时间戳>-<会话短id>.md`，可通过设置文件的 `handoffDir` 改变相对目录。

## 自动跳转

交接完成时，仅当**当前页面正看着这次转移**（轮次处于 `正在写交接文件…` / `正在创建接续会话…`，并且探针观察到变成 `已交接`）才自动切到接续会话，而且同一个（旧会话, 接续会话）只跳一次（`localStorage` 标记）。之后回到已交接的旧会话不会被弹走；换页、重开页面、点侧栏进入都一样，需要去接续会话时用「打开接续会话」。

## 设置与存储

- 设置文件：`$DSH_PROFILE_DIR/context-guard.settings.json`（没有 `DSH_PROFILE_DIR` 时用 `$DSH_HOME/context-guard.settings.json`）。
- 交接状态文件：同目录的 `context-guard.state.json`，按会话记录 `phase` / `handoffFile` / `newSessionId`，只保留 7 天内、最多 500 条。
- 默认值：`enabled: true`、`autoHandoff: true`、`maxRounds: 100`、`handoffDir: tmp/handoff`。
- 宿主编排行：`cordis.patch.yml` 插入 `context-guard` 行（包根 `index.js`）；浏览器半边由 `package.json` 的 `dsh.client` 声明，注册到 `conversation.composer.dock`。

## 本机接口

`http://127.0.0.1:<web 端口>/context-guard/api`

- `GET /context-guard/api` → `{ settings, file, stateFile, source }`
- `GET /context-guard/api?session=<sessionId>` → 该会话的轮次与交接阶段（只对进程内活跃会话有效）
- `POST` `{ "action": "settings", "maxRounds": 100, "enabled": true, "autoHandoff": true }`
- `POST` `{ "action": "handoff", "sessionId": "<sessionId>" }`（该会话已在交接流程中时返回 409）

跨站请求（`Origin` 不匹配 或 `Sec-Fetch-Site` 非 `same-origin`）一律 403。

## 测试

```
cd tmp/dsh-context-guard && bun test
```

单测用模拟的宿主上下文覆盖：只交接一次、重复 `turn/end` 不重复开会话、插件重载后不重复交接、重载后从交接文件/续接提示恢复状态、续接沿用选中 preset、交接中拒绝重复请求。

## 安装与更新

源码仓库：`~/Codes/dsh-context-guard`（独立 git 仓库；DSH 桌面 profile 以 `link:` 依赖指向它）。

```bash
# 首次安装，或仓库位置变化后重新指向
dsh plugin --profile desktop add /Users/xiaohui/Codes/dsh-context-guard
```

- 安装后 profile 的 `package.json` 依赖为 `link:<仓库路径>`，`dsh.profile.bundles` 里保留 `@local/dsh-context-guard`。
- 宿主半边（`index.js`）改动后，运行中的 DSH 不会自动换模块：重启 DSH（或在插件管理里重装）后生效；浏览器半边 `client.js` 由客户端模块轮询自动换新。
- `GET /context-guard/api` 返回的 `source` 是当前进程实际加载的模块文件 URL，可用来确认正在跑哪一份代码。
- 设置与交接状态在 `~/.dsh/` 下（见上一节），不随仓库迁移。

## 已知边界

- 只处理根会话；子代理（`origin: subagent`）不参与交接。
- 交接状态文件在 DSH home 下，换 profile 或清空 `~/.dsh` 后会丢失；此时退回交接文件判定（仍不会重复开会话，只是 `已交接 →` 的新会话可能显示为空）。
- 停止插件或删除本包即移除状态栏与后台判定；已生成的交接文件保留。
