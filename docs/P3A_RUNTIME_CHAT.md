# P3a · 自由对话与通用运行时接入

此文记录 P3a 的历史交付；当前设备码授权、模型测试与画布工具进展见 `P3B_CANVAS_GUIDANCE.md` 和 `STATUS.md`。

2026-10-16。按用户「继续开发，做得通用，后续接入自己的 Agent」实现。当前是 P3 的一个可验证单元，完整 P3 尚未完成。

## 用户可见行为

「Menu → Agent 连接」读取当前运行时能力、账户和模型目录。创建时选择外观、名称、任务、模型及工作偏好；点击角色进入自由对话。输入、草稿和记录按 Agent 隔离；关闭面板、切换或刷新不丢草稿。Enter 发送、Shift+Enter 换行，中文输入法组合按键不派发。

消息保留原文，新增回合绑定当次输入快照。发送确认后只清空未再次编辑的那份草稿；未知结果保留输入并禁止自动重发。历史前缀不接收新命令。运行细节、来源和故障演示置于折叠菜单；角色、九色主题与已有美术资产不变。

Fixture 只返回固定示例，始终明确标记。真实回答需运行 Codex 模式并独立登录；本轮未发送模型请求。

## 接口与接入自己的 Agent

```text
Web 对话 / 画布
      ↓ HTTP v1 命令 / ↑ SSE v2 状态与事实
Coordinator → RuntimeStore ← RuntimeCodec
      ↓ RuntimeBridge
CodexBridge / FixtureCodexBridge / 后续自有 Agent
```

`server/runtime-port.ts` 定义唯一接口：

| 方法/属性 | 契约 |
| --- | --- |
| descriptor / status | 稳定后端 ID、真实/演示、明确能力、账户状态和真实模型目录 |
| login | 运行时自有登录流程的 HTTPS URL；不返回令牌 |
| createSession | 独立 sessionRef、实际 model，可选独立 executionRef |
| forkSession | 源 sessionRef 和精确 Turn ID 前缀，返回独立会话身份；后端显式声明 fork 能力，不支持时返回可见拒绝 |
| startTurn | 原文输入、stream 对应 commandId；异步 emit 来源帧、fault 表示连接中断；返回真实 turnId |
| interrupt | 请求中断；成功响应只证明请求已确认，不制造执行终态 |
| close | 清理自己拥有的资源，不补造取消事实 |
| codec.validate | 在来源边界校验并清除不应保存的字段，返回 session/turn/item 引用和可持久化 payload |
| codec.project | 将同一来源流的连续前缀投影为通用 EventData；不制造模型未返回的摘要/决策/工具回执 |

后续自己的 Agent 实现上述接口，在 `server/composition.ts` 增加一个固定选择；浏览器、协调器和存储不需要理解它的私有协议。`tests/integration/runtime-port.test.ts` 使用不同的 kind/conversation/cycle 协议证明了这个边界；该适配器仅用于测试，没有增加一个生产用占位运行时。

帧 v1 包含 streamId、递增 sourceSeq 与不透明 packet。存储验证 frame 版本、会话归属、同流 turn 身份和连续性。相同命令 ID 返回已有结果；相同来源序号内容不同或有缺口会显式失败。只有本地可证明尚未派发的 RuntimeRequestRejected 才记 rejected；RPC 拒绝、超时和退出保留 unknown，不猜测服务端是否执行。

## 首个 Codex 适配

`CodexBridge` 通过 argv 启动产品拥有的 app-server，使用 JSONL / JSON-RPC 和固定初始化握手。参照 [官方 app-server 文档](https://developers.openai.com/codex/app-server)，并核对本机 **Codex 0.149.0** 生成的 JSON Schema：

- initialize → initialized；account/read 使用 refreshToken:false。
- 2026-10-17 用户明确调整：thread/start 使用 `danger-full-access`，返回需确认为 dangerFullAccess；turn/start 使用 dangerFullAccess，approvalPolicy 为 never。原先验证阶段的只读／禁网配置已移除。
- 组合入口显式选择 `echidna_http` Provider，使用 Responses HTTP/SSE、supports_websockets=false、web_search=live；保留产品独立的 Codex 认证路径和账户默认地址解析。内置 Provider 不能靠同名配置覆盖，所以不写一个会被忽略的 model_providers.openai 开关。
- 新线程 developerInstructions 仅为 `canvasGuidance` 的工具用法；任务、人格、流程、表达风格和执行限制不再追加。用户消息原文保持现有输入通道；创建配置的任务／工作偏好仍保留为画布元数据，不以另一种提示词绕回模型。用户要求新增执行限制须先获同意，已记录到 AGENTS.md。
- thread.id 保存为 sessionRef；thread.sessionId 保存为 executionRef，两者不混用。
- 自由消息作为原文 turn 输入；角色外观不修改指令。
- 初始支持 turn、userMessage、agentMessage、公开 reasoning summary、plan、commandExecution、contextCompaction、error 与 thread 累计用量。2026-10-17 按 0.149.0 生成 Schema 扩展至 18 类已知 item 的消费字段及 MCP／patch／terminal 当前进度通知，详见 STATUS。摘要不等于内部思维，计划不伪装成当时的决策。
- 原始 reasoning content / textDelta 不持久化到画布；stderr 只排空，不解析为执行事实或输出到 UI。远端 JSON-RPC 错误只公开方法和错误码，不转发原始错误正文。
- 支持本版本启动时的 remoteControl/status/changed 控制通知；只呈现状态，不保存远程身份。未知通知或需要客户端审批的服务端请求显式停止连接，不自动审批或忽略。
- 事件可早于 turn/start 响应；终态后晚到的累计用量保留归属。累计用量只取最新线程总数。
- 请求超时不重发；TERM 后有界 KILL 清理子进程。中断确认丢失仍保留命令未知，但已经观察到的回合终态不回退成未知执行。

`npm run dev:codex` 启动真实适配器；`npm run dev:server` 保持默认 Fixture。二者使用同一个端口，必须择一启动。真实配置使用 `ECHIDNA_CANVAS_CODEX_BINARY` 和 `ECHIDNA_CANVAS_PROJECT_DIR`；应用只把 PATH、HOME、临时目录、语言和证书路径等明确环境传给子进程，不继承现有 Codex 登录或通用 API Key 环境。Codex 的专属 profile 是 `~/.echidna-canvas/codex-profile`；按[官方凭据存储契约](https://learn.chatgpt.com/docs/auth#credential-storage)显式选择 cli_auth_credentials_store=file，避免进入系统凭据存储的自动选择路径。账户不从其他应用取得。

## 版本与数据

- HTTP/SSE 状态 v2，命令 v1，来源帧 v1，浏览器文档保持 v1 的可选字段扩展。
- SQLite user_version=2；原 P2 库只能迁入 codex-fixture，来源事件字节不改写。旧 P2 程序会拒绝 v2 库；升级前可自行备份 `.echidna-canvas/`。
- 后端 ID 进入 Agent 身份，数据库记录后端 ID；不同后端的历史可在同一画布共存。同一后端记录库被替换时拒绝直接合并。
- 账户、令牌和 auth profile 不进入浏览器文档、事件或 Git。浏览器只保存可见对话和草稿，服务 SQLite 保留命令/来源与呈现记录。

## 验证与限制

Node.js 24.19.0，已安装 Chromium，本轮没有新增 npm 依赖或下载浏览器。完整单元/集成、构建、格式和浏览器结果记录在 `STATUS.md`。

子进程 Fixture 覆盖两次任意输入、多字节分块、事件先于确认、独立 Session 身份、公开摘要、原始 reasoning 清除、累计用量、登录入口、中断，以及退出/拒绝/超时/审批请求导致的未知结果且不重发。不同协议适配器覆盖两后端身份隔离与画布复用；HTTP 覆盖账户/登录接口的本地访问边界；P2 迁移测试检查历史字节不变。

实际 0.149.0 只做了隔离空 profile、空项目的 initialize / initialized / account/read 检查，返回 signed-out 和 remote-control disabled；没有登录、推理或发送工具请求。首次握手发现启动控制通知未覆盖，按该版本生成 Schema 补齐后通过，并加入子进程 Fixture 回归。

尚未实现/验收：真实账户登录和调用资格、真实模型与命令端到端、其他 Codex 工具/item 家族、运行中改向/真实路线分叉、旧真实 Session 在新进程中的 resume、AI 创建子 Agent、跨 Agent 任务共享、真实文件写入与共享预算。本轮没有声称完整 Codex 协议兼容，也没有修改自己的 Echidna Agent 核心。
