# 2026-10-18 真实长任务复验

本轮使用产品独立 Codex 账户、gpt-5.6-sol 和既有 HTTP-only／完整访问／无需执行审批配置。所有业务材料均为 `/private/tmp/echidna-canvas-long-acceptance` 下的公开虚构样本，不修改同级项目。画布「长任务复验 · 黑发Q版与独立支线」保留本轮 7 个回合、1 条片段分支。

## 结果

| 项目 | 实测结果 |
| --- | --- |
| 主路线长任务 | completed；新建 audit.py 和 report.json，7 项 stdout／stderr／退出码精确比较通过，九份原件哈希不变 |
| 不同想法支线 | 从「复验方案取舍」直接输入并发送，独立线程实际生成迁移器和新副本；审计 11/11 通过 |
| 迁移拒绝对照 | 重复 ID、缺字段、未知版本、拒绝覆盖既有目标均实际验证 |
| 独立复核 | 两个新审计脚本再次执行均退出 0；复制样本后只追加空白改变原件哈希，主审计退出 1、passed=false；真实原件未动 |
| 上下文隔离 | 分支继承 SHARED18_4d91，排除后续 PARENT18_c72e 和主路线最终结论；实际分支回答只列共享与 BRANCH18_9a63 |
| 打断 | 新会话在实际工具调用未回传时中断，运行时确认 interrupted；草稿保留，确认后发送可用 |
| 打断后纠正 | 协议修复后的新会话回复「已按纠正方向继续」，completed、0 次工具调用；旧工具结果仍 unknown，没有补造回执 |
| 刷新 | 刷新前后 cursor=7615、commands=55、turn.start=32，不变；7 个回合、1 条上下文分支及画布名恢复 |
| 动作映射 | 实际事件前缀覆盖 thinking／talking／waiting／working／reading／pointing／reporting；实屏观察到思考、查阅、比较、交流及终态，工作与部分瞬态只确认事件投影，不能声称每个瞬态均已实屏捕捉 |

## 新会话与边界

- 主路线 `agent/codex/ecc130a7-8e03-402f-b512-23ba5eaff97c`，首回合 `01a14ac5-a820-7ea1-a3a2-e867c4fb7cc5`。片段分叉事件 `runtime/a511a73c-e8dd-49ba-ae6c-2d80eb2e987a/5756`。此前完整回合为空，使用当前回合截至该节点的公开记录快照；不是任意 item 的原生内部状态截断。
- 迁移支线 `agent/codex/639ee15a-9d9d-4f7e-adda-2755e63d1130`，回合 `01a14ad0-04a2-72c0-8f39-bf50ef091eab`，completed。
- 迟到通知复验 `agent/codex/12122123-12b8-40fa-a9d5-63a2588af087`，中断回合 `01a14adf-99a9-7f20-a2cf-aaa607157bbc`，纠正回合 `01a14ae0-926a-7bd0-a5dd-353921ff6a6f`，后者 completed。

两个业务路线共实际返回 13 条工具记录，另有三个等待命令用于打断窗口。其中首次 45 秒等待在操作者发出中断前已自然完成，不能算打断成功；后续采用新的 180 秒窗口，并确实中断。没有重发未知命令。

## 本轮暴露并修正的缺陷

空摘要：运行时反复返回仅含换行的 summary.updated，旧视图误将查阅或比较覆盖为思考。现在空摘要／空回复不触发动作，原记录不改写，新增回归。

迟到通知：原路线回合 `01a14ad9-65ad-7a53-a8aa-58378f63a566` 已确认 interrupted，但新纠正发送时收到旧命令的 terminalInteraction；适配器错误拒绝已终止回合的通知并断开。该纠正命令 `3525c0e0-72a5-45ac-9b04-267be170f367` 保留 unknown，未重发，也未追认成功。

修复只允许已知线程／回合中确实存在的 commandExecution 接收 terminalInteraction，按来源追加终端交互说明，不保存 stdin、不生成执行成功或取消回执。其他终态后的越界事件仍拒绝。子进程夹具在下一次 turn/start 时故意发回旧回合通知，验证新纠正继续、旧工具仍 unknown、命令去重；另有无所属命令的拒绝对照。确认无 running 后重载后端，用新会话完成真实正向重测，没有修改旧失败事实。

## 视觉与性能限制

已实屏检查黑发 Q 版、片段输入与可见发送按钮、真实双方案及分支线、终端原文预览、Markdown 结果和打断／纠正入口。参考尺寸测试请求 1924×768，工具保存实际截图 1867×768；全景约 38%，文字需要局部放大或详情。恢复默认视口后仍可漫游。不能据全景宣布小字可读性完全通过。

长回复流期间出现多次浏览器工具超时和一次会话工具重置；后端任务仍完成。尚未区分浏览器工具链和应用渲染各自的耗时，不把它归因为已修复的性能问题。终端 item/started 当前先投影参数接收，工作姿态要等实际输出／执行后缀；参数通知本身没有被冒充 OS 已执行证明。

跨后端重启的旧 Session Resume、未知工具进程现状核对及 AI 委派仍不在本轮通过范围。主路线旧失败后保持 unknown，迁移支线与新纠正会话 idle，当前无 running／dispatching。

## 本机证据

- `/private/tmp/echidna-acceptance18-review.json`：公开记录投影、隔离边界、动作序列、实际终态与用量。
- `/private/tmp/echidna-acceptance18-events.json`：本轮公开事件，稳定原始来源 ID；投影复核的局部 seq 另行连续编号，不改变 runtime.cursor。
- `/private/tmp/echidna-acceptance18-business.json`：两个审计报告及独立正负复核。
- `/private/tmp/echidna-acceptance18-reload.json`：刷新前后执行计数。
- `/private/tmp/echidna-acceptance18-overview.png`：实际长任务全景。
- `/private/tmp/echidna-acceptance18-correction.png`：修复后纠正对话界面。

Provider 仅报告 thread-total：主路线最后 input=534791/output=5848，迁移支线 input=347786/output=5251，纠正复验 input=30038/output=113；不按每回合累计重复相加。费用未提供。证据没有账户凭据和隐藏 reasoning，不进入 Git。
