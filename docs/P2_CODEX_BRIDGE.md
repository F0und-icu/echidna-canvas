# P2：Codex 协议桥接

2026-10-16。用户指定首个真实 Agent 使用 Codex。本阶段交付可运行的本地服务和固定协议夹具；没有启动 Codex、读取账户、调用模型、执行命令或修改其他仓库。

## 当前可运行的路径

```text
画布人物 / 对话 → HTTP 命令 → SQLite 准入与命令记录
                              ↓
                      Fixture RuntimeBridge
                              ↓ Codex JSONL 形状的字节分块
                   解码与协议校验 → 有序来源投影
                              ↓ 同一事务写入来源帧和呈现事件
                   SQLite 已提交前缀 → SSE → 原有画布投影
```

前端入口为「Menu → Codex 连接」。创建协议演示 Agent 后，可发送回合输入、请求中断、查看命令派发和来源。历史视图不派发新输入；浏览器断线只停止显示，未中断运行时。原有纯浏览器示例仍使用独立的 `offline-v1` 路径。

## 代码所有者

| 文件 | 职责 |
| --- | --- |
| `contracts/runtime.ts` | 命令、返回记录与事件流的边界 Schema；请求身份的稳定序列化 |
| `server/codex-protocol.ts` | UTF-8/JSONL 分块解码、正式通知的有限子集、纯来源前缀投影 |
| `server/fixture-bridge.ts` | 固定 RuntimeBridge 接口及四种离线生产者；不启动子进程 |
| `server/runtime-store.ts` | SQLite 事务、命令去重、来源顺序、事件序号和重启状态 |
| `server/coordinator.ts` | 准入、派发、确认关联与提交后通知；不重试执行 |
| `server/http.ts` | loopback HTTP/SSE、Host/Origin 检查及 HttpOnly/SameSite 控制会话 |
| `web/runtime/` | 显式连接、已提交前缀合并、Codex 人物对话与命令详情 |

使用 Node 24 自带的 `node:sqlite`，没有新增 npm 依赖，也没有复制 Codex 实现。JSONL 解码是基于公开格式的本地实现。

## Codex 映射与语义

依据本轮读取的 [OpenAI 官方 Codex app-server 文档](https://learn.chatgpt.com/docs/app-server)（亦可从 [开发者入口](https://developers.openai.com/codex/app-server)访问）。官方支持 `initialize` / `initialized`、`thread/start`、`turn/start`、`turn/interrupt`，以及 item/回合事件。**当前高层 RuntimeBridge 只有夹具实现；没有完成真实 JSON-RPC 请求响应相关性、握手、错误回包或进程生命周期集成。**

| 正式对象或事件 | P2 表达 |
| --- | --- |
| Thread | Agent 关联的来源线程；夹具生成的 ID 明确不是实际 Codex 线程 |
| Turn / `turn/started` | 画布回合，`unit=turn`；不声称一次回合等于一次模型采样 |
| `reasoning.summary` 与公开摘要增量 | 展示公开摘要；最终 item 替换增量；不保留 raw reasoning content |
| `agentMessage` 与消息增量 | 保持 item 的先后关系；最终 item 文本为准 |
| `commandExecution` / `item/started` | 参数已知、等待执行；这个事件本身不足以证明命令开始 |
| 命令输出增量 | 开始展示观察到的执行和输出；不制造完整回传 |
| 命令 `item/completed` | 有退出码才关联完成观察；拒绝执行不产生执行回执；没有退出码保留未知 |
| `turn/interrupt` 确认 | 仅记录中断请求已被受理；后续 `turn/completed:interrupted` 才表示回合中断 |
| `turn/completed` | 保留 completed/failed/interrupted；未解决的命令仍阻止新回合 |

`receipt` 当前是明确指向 **Codex item 完成观察**的引用，不是新造的运行时 ExecutionReceipt。夹具中的路径与命令不会被系统执行。缺少摘要、候选决策、用量或费用时不补造。

当前不支持 MCP、文件修改、动态工具、服务器发起的审批/用户输入请求、其他通知、原始 reasoning 增量和真实账户。未支持消息在边界显式失败，不静默略过。下一阶段需要对实际 Codex 版本生成的 Schema 逐项核对后再扩大支持面。

## 持久化、顺序与未知

- 命令先在 SQLite 准入，再向 RuntimeBridge 派发。相同 commandId、相同请求返回已有记录；不同请求重用身份返回 409。未知状态不能靠新 ID 重发来绕过。
- 命令状态只有 dispatching、acknowledged、unknown。结构与业务准入失败在派发前明确拒绝；不会创建伪执行回执。
- 来源帧用 `(stream_id, source_seq)` 关联。完全相同的重复帧不再投影；身份冲突、缺口、越序或归属不符立即失败。
- Codex 通知本身没有被假定为携带全局可恢复事件 ID。P2 的来源序号仅在一个夹具传输流内分配。真实进程退出后的重连/对齐须在 P3 另行验证，不能用消息内容哈希猜测重复。
- 同一事务保存来源帧、投影事件及 Agent 状态，提交后才发送 SSE。持久化异常不会变成工具失败或成功；保留服务错误。
- 事件 cursor 与元数据 revision 分开。并发 HTTP 响应和 SSE 更新不能把新状态覆盖成旧状态。
- 浏览器重连读取已提交后缀；不重新派发命令。服务重启将未确认派发和运行中的工作标为未知，保留原事件，不自动恢复夹具或真实任务。
- 在同一来源流中获得连续的晚到回传时，可以补齐观察并解除已对齐的未知；没有终态的其他命令仍保留未知。

控制会话只用于本地 Web 服务访问，存于 HttpOnly/SameSite=Strict Cookie；不是 Provider 凭据。Codex 产品登录与凭据保存尚未实现。后续须由产品自己的 Codex 进程与专属存储完成，不读取桌面应用或用户现有 CLI 的登录文件，也不向画布导出令牌。

## 接口与启动

使用 Node.js 24+，同时运行 `npm run dev` 与 `npm run dev:server`。Vite 将 `/api/runtime` 代理至 loopback 的 4181 端口。

| 接口 | 行为 |
| --- | --- |
| `GET /api/runtime/session` | 建立本地控制会话；不登录 Codex |
| `GET /api/runtime` | 读取已提交事件、命令及 Agent 状态 |
| `POST /api/runtime/commands` | 版本 1 的 `agent.create`、`turn.start`、`turn.interrupt` |
| `GET /api/runtime/events?after=N` | SSE 后缀与最新状态；支持 Last-Event-ID；无命令重放 |

数据文件：`.echidna-canvas/runtime.sqlite`，已被 Git 忽略。浏览器仍保存视图、主题与呈现缓存；来源库 ID 不一致时拒绝混合，不覆盖旧画布。当前是单用户本地开发服务，不是托管服务。

## 验收范围

A05 的协议夹具部分覆盖命令准备/输出/终态和中断区别；A09 的桥接夹具部分覆盖重复、缺口、未知派发、浏览器 SSE 断开、服务重启与晚到回传。命令派发确认前后、事件提交与浏览器导入均有测试。未测真实进程、实际模型、真实配额、后端文件版本或 10,000 事件性能。

## 下一阶段 P3

先核对目标 Codex 二进制的生成 Schema 和稳定方法，完成产品专属进程、握手、双向请求相关性、所需通知、显式关闭与未知恢复。账户由该运行时自己的正式流程处理。之后从画布发起一个有界的只读任务，记录真实线程、回合、工具完成、错误与用量；在这些证据齐备前，不把本阶段的协议夹具写成真实 Agent 接入成功。
