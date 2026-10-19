# 架构方案

状态：P1/P2/P3a 已完成对应本地范围；P3b 加入固定标注工具、按事件增长的图形和来源查询。用户发起的原生上下文分叉及 Markdown 回复已完成离线验证，包括真实 Codex 二进制连接本地模拟模型。独立设备码登录与早期公开样本真实任务已验证；本轮没有新远程推理，重启 Resume 和 AI 委派尚未实现。见 STATUS 与 `P3B_CANVAS_GUIDANCE.md`。不修改已有 Echidna 核心。

## 部署与边界

```text
浏览器：画布 / 人物 / 对话 / 档案 / 详情
        │ HTTP 命令          ↑ SSE 事件与游标
        ▼                    │
本地协调器：命令准入、Agent 生命周期、任务交接、事件投影入口
        │                    │
        ├─ SQLite：命令状态、编排事实、运行时来源、视图
        ├─ 材料目录：版本化文件、Blob、预览
        └─ 固定 RuntimeBridge
                  ├─ Codex app-server / 离线 Codex Fixture
                  └─ 自有 Agent（后续实现同一接口；不同协议已用测试适配器验证）
```

一个本地服务面向一个用户，默认只监听 loopback；浏览器 API 校验 Origin 与会话访问凭据，不能因为监听本机就接受任意网站发来的控制请求。没有云端控制面、团队账号、租户系统或分布式队列。

2026-10-19 用户限定创建时先支持已接入 Codex：创建表单共用 App 的连接与 SSE，自动发现当前服务的 backend、账户和模型，随后在 `agent.create` 中显式绑定 harnessId。RuntimeStore 在准入前核对服务身份，避免发现后切换服务却在另一 harness 创建；实际绑定仍由持久化事件的 backendId + storeId + sessionRef 持有，不新增配置副本或注册中心。旧 v1 创建命令可省略 harnessId，保留已存命令的读取与去重。创建只建立独立 Session，不启动模型回合；离线角色由用户显式选择。

同日追加项目绑定：创建表单先通过 `/file-projects/register` 登记规范化根目录，再分配含 projectRoot 的创建命令。HTTP 首次准入验证目录；已有 commandId 先走持久化去重，不因目录后来消失重派发或丢失回执。Session 创建事件持有该根，Coordinator 传给 RuntimeBridge，Codex 在 start／fork 请求与返回 cwd 间核对；分支继承来源项目。旧事件缺少该字段时仍按原配置读取，不改写历史。

Codex 适配器通过产品自己启动的 stdio JSONL 子进程接入。通用协调器和 SQLite 存储接收运行时中立的 sessionRef、命令和 codec；Codex 的线程、回合、item 留在其协议边界。实际返回的 thread.sessionId 另存 executionRef，不推测它等于 thread.id。Codex 回合不等于一次模型采样。CLI 文案、Provider 原始网络包与内部会话文件不作为集成接口。

用户指定的 Codex 默认值为完整文件／网络访问、live 网页搜索、无需执行审批，模型连接固定 HTTP/SSE。composition 选中独立 `echidna_http` Provider 配置，保留 OpenAI 认证与默认地址解析，仅关闭其 WebSocket 能力。附加 developerInstructions 只有工具使用说明；不再附加任务、人格或行为指导。新增执行限制必须先经用户同意。

## 责任划分

2026-10-18 用户追加真实项目档案：`ProjectFileStore` 管理当前工作目录的文本读取、基于 hash 的保存检查及独立 `files.sqlite` 快照。HTTP 文件接口与运行时共用本机访问边界；文件编辑不通过 Coordinator 派发，不产生模型／工具执行记录。Web 的模态编辑器按路径持有窗口内存草稿，CodeMirror 只负责文本编辑；版本内容不进入 Workspace 或导出。逐行差异由已读取的两个快照在浏览器中计算，不写入文件或执行历史；文件窗口和编辑器按需加载。这是用户显式发起的文件编辑，不提供 Agent 资源锁、工作副本隔离或历史材料自动引用，不代表 P6 完成。

同日追加项目切换：`ProjectFileStore` 同时持有本机当前档案根目录及 SQLite 最近项目列表，根目录切换与当前 Agent 的运行目录分开。文件 API 显式绑定所选根目录，保存接收正文后核对再同步写入；UI 切换确认后清掉旧项目窗口缓冲，元数据请求按代次和根目录隔离。切根不创建 Agent、不改变已有执行资源或重放工具；仍是单服务、单用户的档案选择，不扩展多进程文件锁。

2026-10-19：档案操作可显式绑定已登记根，不再依赖全局当前选择；旧客户端保留当前选择与慢保存冲突核对。Web 按根持有元数据和错误；画布的 projectRoots 仅保存成员关系，project-archive:<root> 保存手动位置。项目区域和未手动定位的档案落点由现有人物、回合和版本路线推导；区域不接受指针，不新增执行命令或文件内容副本。

| 所有者 | 持有什么 | 不持有什么 |
| --- | --- | --- |
| Web ViewState | 坐标、缩放、选中、折叠、主题、草稿、历史前缀 | 执行权、凭据、工具事实的修改权 |
| 编排 CommandHandler | 用户与模型命令的校验、配额与持久化状态 | 模型采样、工具执行回执的制造权 |
| 编排 EventStore | 自身事实、排序游标、去重、指向运行时记录的引用 | 核心 Session 的另一份可改写真相 |
| RuntimeBridge | 版本转换、命令关联、来源保留、能力映射 | 第二套 AgentLoop、静默兼容与工具重试 |
| Agent 运行时 | 自己的线程/Session、模型状态、实际执行与完成记录 | 其他 Agent 的隐式上下文访问 |
| MaterialStore | 不可变版本、大输出引用、文件建议的基础版本 | 自动将观察升级为结论 |
| 固定 CredentialAdapter | 产品自己获得的账户与凭据 | 读取其他应用的登录状态 |

## 数据与权威

P3b 的 `canvas.noted` 是运行时明确提交的模型标注，附原始工具请求引用，不等于执行回执或验证证据。`contracts/canvas.ts` 唯一持有预填指导和固定工具 Schema。标注只能引用已存在的当前回合节点/工具；先持久化，再确认工具结果。输入快照记录 canvasContract，旧 canvas-v1 可读；新线程使用 canvas-v2，增加只读 echidna_canvas_inspect 查询当前回合的有界来源说明。查询沿同一来源配对/持久化路径确认，不产生画布标注或执行回执，不改变 RuntimeBridge。真实工具事件独立投影。节点按首次事件顺序分层落位，文本更新不重排已有节点。

`Agent`、`Task`、`Route`、`ModelRound`、`ToolCall`、`Delegation`、`ArtifactRevision`、`InputSnapshot`、`Command` 和 `Event` 各有稳定 ID。ViewState 只引用这些 ID，不承载执行事实。

运行时原始事实由运行时持有；协调器保留来源引用、必要的呈现投影与自己发起的编排事件。每条投影附来源 Session、事件/回执引用及投影版本。重新生成投影不会修改来源，也不把摘要变成证据。

决策可能是模型明确返回、用户提出或事后评估；保留来源类型与发生时点。没有可见摘要、候选项、用量或费用时保留缺失状态。

自然回复的气泡是现有 response 与首次 responseSeq 的视图摘录，不新增 canvas.noted、摘要或事实来源。结构标注缺失时仍展示实际回复；Fixture 来源由已保存的 Session source 决定，断开连接后也保留离线标记。回合尺寸与引用绕行属于纯视图布局，不改写原事件或触发模型、命令重放。

标题上方的有界来源入口引用同一 RuntimeNode ID，点击导航到原记录，不创建投影副本。无框标题、工具圆形落点、结论下方的后到回复及来源绕行均由纯布局函数处理；后续事件不能搬动已有节点，不扩展 HTTP 或运行时 Schema。

回复由 `MarkdownReply` 使用固定版本 react-markdown / remark-gfm 渲染，保留原始 response。画布卡片以固定可见区域摘录，完整详情渲染全文，不截断 Markdown 语法。原始 HTML 不执行，URL 沿渲染器默认处理，Markdown 图片为链接；真实图片预览仍以已记录工具来源进入既有媒体接口。

## 独立 MCP 与创建配置

2026-10-19 用户追加：CodexBridge 将实际 model/list 的默认模型、思考强度和人格支持投影为有界配置字段；Web 复用一份选择器渲染。认证通过专用 RuntimeBridge.login 请求传递，秘密不进入 AgentConfig 或编排命令；同一 Codex harness 继续使用产品自己的账户 profile。没有通用配置 DSL、运行时注册中心或向 developerInstructions 追加人格文本。

`McpStore` 持有独立元数据版本与私有凭据目录，公开配置 id/revision 才进入编排命令和事件。Coordinator 在创建、分支和显式配置时解析确切版本，通过 RuntimeBridge 交给 Codex 原生 mcp_servers；Web 不直连网关或持有密钥。Native MCP OAuth 凭据继续由 Codex profile 管理，静态 Header 密钥由本应用专用目录持有。

Codex 已加载线程不能通过 resume 原位应用这些配置。切换命令因此在已知空闲状态，以所选完整上下文前缀创建原生分支／空 Session，并追加绑定确认；Agent 的视图身份保持，底层来源身份显式变化。命令准入与去重仍只有 RuntimeStore 一个所有者。旧流迟到帧对照其命令首帧的 Session，不与新底层会话混同；未知结果不重建或重新执行。MCP 初始化状态来自正式通知／目录读取，绑定回执与接入就绪分别呈现。原生 HTTP 错误正文可能含凭据回显，公开诊断只保留失败分类。

## 用户发起的上下文分叉

片段级 `side=at` 从稳定标注／工具回传事件重建投影前缀；`publicBranchContext` 只序列化该前缀的公开回复、标注和工具记录。RuntimeBridge.forkSession 接收局部快照序列，Codex 将此前完整回合原生分叉，再通过 thread/inject_items 注入各段用户原文与公开快照。原生 API 不支持任意 item 截断，界面明确区分快照与完整回合。注入不创建采样，不重放工具；后续对话和运行时隐藏 reasoning 不进入快照。嵌套来源仍由同一 resolveBranchPoint 校验。

`agent.fork` 引用源 Agent、回合、before/after 和稳定 eventId。`resolveBranchPoint` 唯一校验用户消息或回合终态边界；`conversationRounds` 只返回选定前缀的 Round 条目，不携带包含未来回合的完整 Session/Route。`session.created.branch` 保存来源及 throughTurnId，投影再次核对边界一致性。继承聊天通过来源引用呈现，不复制执行事件。

通用 `RuntimeBridge.forkSession` 接收精确 Turn ID 前缀；Codex 使用 thread/fork(lastTurnId)，确认返回前缀和新线程身份后才承认创建。空前缀走 thread/start。同步 RPC 确认回调先登记 forkedTurns，再处理同批初始化用量通知；仅匹配已继承 ID 的线程累计用量留在运行时元数据，不重新归属父回合或触发新采样。错误、超时和未知效果保持原有去重／不重发契约。

分支是用户创建的独立会话，保持原对话可继续；它不是 AI 委派。文件、共享目录和外部状态不回滚。落库和页面重载保留分支关系，不代表已实现旧线程的进程重启 Resume。

## 命令与事件生命周期

1. 用户与模型通过同一命令入口提交 `command_id` 和参数。
2. 在协调器事务中校验请求、占用相关配额，并记录准入结果。
3. 准入通过后向运行时派发，绑定运行时命令/会话标识；持久化确认后向 Web 发布可恢复事件。
4. 创建回执、接收、执行、结果、采纳分别追加，不能用单个 `done` 代替。
5. 重复请求返回已知的同一命令状态；命令已受理但派发结果未知时先核对，不重新派发。

协调器数据库事务不能包住外部进程或网络副作用，因此不承诺普遍的 exactly-once。真实语义依赖稳定命令关联、运行时回执与恢复对齐。已派发工具没有终态时保留未知；不得通过新工具调用“修复”画面。

SSE 的全局事件游标与运行时自己的序号分开。只去重能够证明相同来源的事件；序号缺口阻止跨缺口投影。大文本的流式分块可以合并显示，持久化事件和回执引用不丢失。

## 多 Agent 与能力预填

多 Agent 由协调器关联独立的运行时会话，首个后端采用 Codex；当前夹具间的线程、回合与 item 身份独立。真实多 Agent 尚未实现。人物与工作偏好通过明确配置分开；如果运行时不支持可变人格，映射为允许的任务指导，或者标注不支持，不覆写运行时固定身份。

编排工具只向被赋予该职责的会话暴露。工具声明与实际派发使用同一套能力快照；角色图片、图形连线和用户旁注都不授予能力。子会话默认没有继续委派的工具，除非启动配置明确给出预算与层级范围。

启动与恢复时由同一上下文构建入口注入操作契约版本、正式工具 Schema、身份、任务、完成条件、可用材料引用和当前团队摘要。仅靠一段自然语言说明、网站截图或压缩摘要不构成工具接入。

## 文件与资源

路径只用于定位，读取事实使用 revision/hash。两个 Agent 的写入建议绑定各自基础版本；提交时不匹配就返回冲突并保留差异。优先隔离工作副本；共享执行环境需要明确资源归属。

归属、配额预留与未知效果相关联；连接断开不会自动释放。只有明确的终态、恢复核对或操作者按实际运行时约定处理后，才可以改变这些状态。

## 前端组织

浏览器完整工作区存入 IndexedDB，事务完成后才显示保存成功；新库没有工作区时读取旧 localStorage 并随首次保存迁移，旧副本保留。保存错误不自动清空记录。SQLite 仍是运行时事实的持久化所有者；RuntimeStore 仅缓存已校验的事件前缀、读取新后缀，事务回滚清空缓存，不增加第二份可改写事实存储。

`web/` 持有画布与投影；`server/runtime-port.ts` 是运行时方法与来源 codec 的唯一接口；`composition.ts` 固定选择 Fixture 或 Codex。`contracts/runtime.ts` 定义 HTTP/SSE v2 状态、v1 命令、模型目录与登录状态。存储注入 codec，不导入 Codex 协议。没有插件注册或第二套 AgentLoop。

Agent ID 包含 backend ID；记录库绑定一个后端，不同后端的历史可以并存于浏览器。SQLite v2 只允许旧 P2 记录库迁移回原 Fixture 后端，原始事件字节不重写；旧 P2 二进制不能打开 v2 库。来源保留 backend/store/session/stream/cursor，视图继续独立保存。每个 Agent 的可选 chatDrafts 与历史前缀互不改写。

默认使用 DOM/SVG 以保留可选中文本、原生表单和可访问语义。节点坐标由视图持有，新事件只延伸；折叠、过滤和虚拟化都不能重排事实或删除引用。

## 凭据与失败

Web 只看见 account_ref、配置引用、状态和能力版本。真实密钥、OAuth 状态、刷新与撤销由专属本地边界处理；日志和事件不包含授权头或令牌。每个接入协议单独验证，不通过品牌名猜测能力。

模型错误、参数拒绝、工具失败、命令结果未知、事件连接错误与持久化失败分别返回。提交失败不发布假成功；未开始的工具拒绝没有执行回执；已开始的执行必须引用真实回执或保持未知。

连接原因来自既有 connection.lost 的当前前缀投影，不是新的事实来源。无工具调用的未完成回合同样呈现待核对；部分文字不等于完整回复，历史完成回合保持原状态。协议错误只附受限的 item.type 标识符辅助定位，不回显整个事件；未知类型继续显式失败，不跳过。

## P3 原生 item 与媒体预览

2026-10-19 真实 Codex 0.163.0 追加两项明确适配：thread/readState/changed 按生成 Schema 校验并只消费已读元数据；已结束回合中，已登记 commandExecution 的输出／完成仍可按原来源到达，继续使用同一 item 配对与命令身份检查。真实完成回执仅核对当前底层 Session 的最新已结束回合是否还有未确认工具，不改变其他回合和 Session 的执行状态。回合结束不等于后台命令完成；历史缺失回执不被制造。

`codex-items.ts` 是目标 0.149.0 的已知 item 消费字段、工具身份和原生完成投影所有者；`codex-protocol.ts` 校验来源、生命周期和进度。识别 18 类 type 不等于支持全部请求或开放对应能力。Hook／审阅／运行时协作记录只进入 assessment，产品委派仍未实现；原始 reasoning、Hook 正文、stdin 和 MCP transport metadata 在边界清除。

`tool.finished` 可带一个运行时中立的 `preview`：image 为路径及名称，webpage 为经过协议校验的 HTTP(S) URL 及名称。投影保留完成事件 ID／序号，布局据此追加来源相连的预览节点。只从 imageGeneration.savedPath、imageView.path 与实际 openPage／findInPage 记录产生，未知结构的搜索结果不被猜成访问记录。网页卡片不自动联网加载 HTML、图标或截图。

`GET /api/runtime/image?event=...` 通过既有本地访问边界读取事件对应文件，不接受任意文件参数。`image-preview.ts` 限定配置项目目录、真实路径、大小和光栅文件签名；返回 no-store / nosniff。文件当前内容与不可变执行回执是不同语义；该接口不是 MaterialStore／Blob 存储或证据快照，跨目录文件显示不可预览。
