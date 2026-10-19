# 2026-10-19 · Codex 真实长任务验收

用户明确授权使用 Codex 真实长任务。新画布「Codex 真实长任务 · 库存对账与独立支线」，业务目录 `/private/tmp/echidna-canvas-acceptance19`，全部为本轮新建的公开虚构材料。实际 PATH 二进制为 Codex 0.163.0，模型 gpt-6.1-sol；业务主线与分叉 medium，独立打断角色使用目录默认 low。沿用产品独立 profile、HTTP-only、完整文件／网络、live search、无需执行审批。未改登录、凭据、同级仓库或产品默认权限。

## 业务与交互证据

| 项目 | 实际结果 |
| --- | --- |
| 长任务产物 | 实际读取期初、乱序事件与七类异常；打开 MDN SSE 与 SQLite UPSERT 网页；发布双方案取舍，生成程序、测试、JSON、中文报告及 PNG |
| 对账 | 14 次投递、12 个唯一事件、2 次一致重复；最终 A=11、B=7、C=4 |
| 检查 | 模型实际运行 30/30；独立脚本另运行 12/12，包括修改合法 delta、逆序到达、缺末尾序号、中途透支但最终为正的反例；十份输入 SHA256 不变 |
| 产物复验 | 从已确认工具回执另开 Session，新执行一次规范样本及哈希检查，completed；未追认原未知回合成功 |
| MCP | 空闲时应用既有本地样本，真实模型通过 MCP 接口调用 demo_echo 一次，返回 LOCAL_MCP_FIXTURE: LIVE19_MCP_d4bc；不是终端 HTTP 代调，没有 Docker daemon |
| 不同想法支线 | 在产物复验早期工具片段直接输入并发送；实际实现净额快照对照，两次 CLI 观测说明最终库存为正仍可掩盖中途负库存；独立再次运行两次得到相同结果 |
| 对话隔离 | 支线实际回答只见 SHARED19_5e7a、BRANCH19_1f6b，未见后来主线 PARENT19_8c2d；按真实来源重建的两层公开快照均不含后来标记 |
| 打断与纠正 | 独立新回合在 ACTIVE19_READY 输出后由界面请求中断，原生确认 interrupted；纠正草稿保留，发送后 completed、回复「已按纠正方向继续」、无新工具调用 |
| 刷新 | 第一次刷新前后 cursor=10151、commands=83、turn.start=41，完全不变；四个角色、七个回合、两条上下文分支、一个 MCP 图标／两条绑定线恢复 |

## 实测发现与修复

1. 原长任务生成了全部产物及最终回复，但 `thread/readState/changed` 使旧适配器断开。按本机 0.163.0 生成 Schema 校验 revision 与 firstUnread，作为已读元数据处理，不生成执行终态。畸形数据仍拒绝；新路线实际完成及下一轮真实 MCP 调用通过。原回合继续 unknown。
2. 首次打断样本被模型转为后台等待后就结束了回合，不能算中断成功。工具实际完成通知随后到达，被旧「回合已结束」检查拒绝。现在只允许同来源、已登记 commandExecution 的输出／完成迟到，并复用既有 item 配对、命令和 cwd 核对；伪造或更换命令仍拒绝。实际回执使当前底层会话的最新已结束回合清除未确认工具状态，不改变其他回合／Session 的状态。独立打断复验中，旧等待命令在新纠正回合完成后实际返回退出 0（事件 10150–10151），已正常接收，当前角色仍 idle、没有断连；这不表示 OS 命令被取消。此前丢失的回执不补造，首次等待路线仍 unknown。

子进程回归覆盖有效／畸形已读通知、迟到输出／完成及错误命令身份。最终默认完整回归 **184 PASS / 2 个可选实际二进制测试跳过**；当前 Codex 0.163.0 的原生 fork、MCP 两项离线集成另行通过。后者使用独立空 profile、loopback 固定模型与 MCP，不算远程推理。原生测试清理目录时实测遇到进程退出写盘造成 ENOTEMPTY，临时目录删除使用 Node 的有界文件系统重试；没有执行或工具重试。

TypeScript／生产构建、全量 Prettier、空白检查通过。主包约 659 kB、按需编辑器约 775 kB 的体积警告保留。

## 会话与来源

- 初始主线：`agent/codex/ba390fd7-cdfe-45b4-ad6e-7198d9fb6f69`，原回合 `01a1546f-1bd1-70d3-b203-ae87bd68be99`，unknown。
- 产物复验：`agent/codex/81df98ec-2e97-49bf-a76d-113eb662e231`，从原工具回执 `/8984` 创建；复验回合 completed，随后 MCP 回合 completed；后来的首次等待工具未知，Agent 保留 unknown。
- 快照想法：`agent/codex/24670e49-f881-4ed4-a50f-9e3697d0d5e1`，从复验回合工具事件 `/9269` 创建，completed。
- 打断纠正：`agent/codex/f5278ef4-a066-44de-bfcf-90d3dd3022f2`，等待回合 `01a15494-f09d-7a41-bebf-429fb3a938cc` interrupted，纠正回合 `01a15496-b12e-7190-a7d9-050832fcfc32` completed。

事件 ID 前缀均为 `runtime/a511a73c-e8dd-49ba-ae6c-2d80eb2e987a`。实际底层 Session 及 MCP 配置切换在证据 JSON 中记录。

## 限制与产物

这不是全产品通过：相对文件链接仍指向前端地址，尚未直接打开项目文件预览；窄窗口中的长图需要缩放和漫游，最低缩放下全图仍可能超出视口。一次 UI 填写超时也被记录，未据此宣称性能已通过。截图按实际窗口尺寸获取，没有为截图改变浏览器尺寸。

片段分支是公开记录快照，不是原生内部状态的任意截断；共享文件和当前 MCP 配置独立于聊天前缀。中断确认只证明回合终止，不能据此显示 OS 命令已取消；独立复验的命令后来正常退出 0，首次等待路线的旧回执仍缺失。未验收跨进程 Resume、AI 委派、真实 Docker、外部 OAuth 或完整原生图像生成。PNG 是真实模型编程绘制并由 imageView 打开的产物。

Provider 报告 thread-total 用量，见证据；不跨 Session／分叉重复相加，不推算实际请求数、缓存计费量或费用。原公开本地 MCP 样本曾被无 JSON 的探测请求终止，已按原地址恢复；该探测不算产品 MCP 验收或真实模型调用。

- 主任务：[业务报告](/private/tmp/echidna-canvas-acceptance19/main/report.md)、[流程图](/private/tmp/echidna-canvas-acceptance19/main/diagram.png)。
- 另一思路：[对照报告](/private/tmp/echidna-canvas-acceptance19/branch/report.md)。
- `/private/tmp/echidna-long19-evidence.json`：真实身份、状态、回执、隔离、独立检查与刷新计数。
- `/private/tmp/echidna-long19-events.json`：本轮公开事件，不含隐藏 reasoning。
- `/private/tmp/echidna-long19-independent.json`：独立 12 项核对。
- `/private/tmp/echidna-long19-overview.png`、`/private/tmp/echidna-long19-correction.png`、`/private/tmp/echidna-long19-interrupted.png`：实屏证据。

没有提交或推送。协议依据为本机 `/private/tmp/echidna-long19-codex163-schema`，正式文档入口为 [Codex app-server](https://learn.chatgpt.com/docs/app-server#api-overview)；正式文档本身未列出已读状态的详细 Schema。
