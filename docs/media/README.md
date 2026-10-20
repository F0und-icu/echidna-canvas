# README 媒体

本目录用于项目介绍。静态展示图、GIF、MP4 和海报统一为 **1600×1000、8:5**，与应用九色配色一致。

运行前端后，可在 [本地媒体展示页](http://127.0.0.1:4173/docs/media/index.html) 播放视频和查看功能图；GitHub 上也可直接打开 GIF 或下载 MP4。

## 内容与真实性

2026-10-20 用户刷新并恢复标签后，新建「产品演示 · 从片段开启支线」，保留旧画布与真实任务历史。新素材使用 `/private/tmp/echidna-canvas-media-demo` 的公开样本；创建一个离线 Agent，发送一个固定示例回合，再从工具片段实际发送独立支线。文件演示实际编辑 `notes.md`、显式保存并生成 v1 → v2，核对 +3／−1 行。

| 新素材                                                                                                                                                                                                                                            | 内容                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [ui-branch.gif](ui-branch.gif) · [MP4](ui-branch.mp4)                                                                                                                                                                                             | 17.5 秒片段选择、输入、发送与新分支对话的实际界面节选   |
| [ui-files.gif](ui-files.gif) · [MP4](ui-files.mp4)                                                                                                                                                                                                | 17 秒文件预览、编辑保存与逐行差异的实际操作节选         |
| [ui-branch-poster.png](ui-branch-poster.png)                                                                                                                                                                                                      | 片段输入取景与操作说明                                  |
| [ui-create-agent-poster.png](ui-create-agent-poster.png)                                                                                                                                                                                          | 自动发现 harness、选择新登记的项目；取景时未再次创建    |
| [ui-files-poster.png](ui-files-poster.png)                                                                                                                                                                                                        | 样本 v1／v2 的实际逐行增删                              |
| [ui-version-route-poster.png](ui-version-route-poster.png)                                                                                                                                                                                        | 首次读取与保存连接图                                    |
| [clean/fragment-branch.png](clean/fragment-branch.png) · [创建](clean/create-agent.png) · [差异](clean/file-history-diff.png) · [路线](clean/file-version-route.png) · [预览](clean/file-preview.png) · [分支对话](clean/branch-conversation.png) | 六张未缩放、未标注的 1036×1448 原生无损 PNG             |
| [分支原始比例录屏](recordings/ui-branch-native.mp4) · [文件原始比例录屏](recordings/ui-files-native.mp4)                                                                                                                                          | 同一操作节选，1036×1448，不含说明版式                   |
| [clean-manifest.json](clean-manifest.json)                                                                                                                                                                                                        | 原图与原始比例视频的 SHA256、来源片段、帧时间和剪辑范围 |

通过 `Page.captureScreenshot(format=png)` 保存默认视口、DPR 2 的原始像素，没有使用 JPEG 改扩展名或放大补像素。原始画面保持不变；1600×1000 展示版在旁边添加说明，将完整原画面等比缩小到约 644×900。点击可查看原图，浏览器预览大小不代表原文件画质。

录屏按约 2 fps 采集无损 PNG，并保留每帧时间；仅在片段间剪辑等待，没有加速片段、插值动作或合成界面结果。H.264 MP4 为 12 fps 播放容器，重复帧不代表 12 fps 采集。GIF 是调色板预览；细节以 PNG 与 MP4 为准。新录制是实际 UI 操作，后端仍是固定回复夹具，**不证明新的模型推理、命令执行或分支隔离语义验收**。文件保存与版本差异是真实样本操作。

### 早期功能图与示意动画

| 文件                                                   | 用途与来源                                                |
| ------------------------------------------------------ | --------------------------------------------------------- |
| [fragment-branch.png](fragment-branch.png)             | 实际片段输入表单 + 共同前缀／独立支线示意，草稿未发送     |
| [create-agent.png](create-agent.png)                   | 实际创建表单取景 + harness／项目关系，未创建新 Agent      |
| [file-history-diff.png](file-history-diff.png)         | 实际版本比较范围 + 已有 v3／v4 的修改要点摘录，未改写文件 |
| [mcp-config.png](mcp-config.png)                       | 实际图标与样本网关地址 + 多项目绑定示意，未重新保存或绑定 |
| [conversation-controls.png](conversation-controls.png) | 实际纠正／支线入口，回合已结束，打断按钮禁用              |
| [context-branch.gif](context-branch.gif)               | 18 秒循环功能示意动画，12 fps，无音频                     |
| [context-branch.mp4](context-branch.mp4)               | 同一动画的 H.264 MP4，便于播放、暂停与拖动                |
| [context-branch-poster.png](context-branch-poster.png) | 视频海报                                                  |
| [index.html](index.html)                               | 本地展示页，含原生视频播放器和全部功能图                  |

展示图将 [原始 Retina 无损 PNG](../screenshots/README.md) 取景放到统一版式中；添加的标题、步骤和关系图均是文档注解，未改写界面中的文字与状态。原图保持不变并单独提供，取景坐标与 SHA256 见 [manifest.json](manifest.json)。

动画始终标注「功能示意动画」，解释共同前缀、用户发起的支线、后续对话隔离，以及当前共享文件状态。它不是新增模型任务、实际发送过程或新的分支隔离验收。媒体制作没有新增模型调用或工具重放。

早期制作时浏览器安全检查拒绝读取标签，因此当时仅交付既有实屏的功能图与讲解动画；用户刷新恢复后才录制上方的新素材。

## 重新生成

生成器只消费保存的截图和显式图形脚本，不读取账户、运行数据库或浏览器存储。需要 Node.js、`@napi-rs/canvas`、一个支持中文的字体以及带 libx264 的 FFmpeg。构建媒体所用依赖来自本机文档工具运行时，没有加入应用依赖。

```sh
node scripts/build_readme_media.mjs /absolute/path/to/node_modules /absolute/path/to/CJK-font.ttf
```

脚本会生成五张 PNG、动画帧、GIF、MP4、海报和来源清单；临时帧在成功编码后删除。原始截图不会被覆盖。导出的 GIF 使用调色板，原图和展示图保持无损 PNG，MP4 使用 CRF 16。

新展示版从仓库内保存的 `clean/` 原图与 `recordings/` 视频生成，不连接浏览器、不改动文件历史：

```sh
node scripts/build_clean_media.mjs /absolute/path/to/node_modules /absolute/path/to/CJK-font.ttf
```

它生成四张海报、两份 MP4 与两份 GIF。原始帧来自本次 CUA 实际操作采集，剪辑清单保留哈希与时间；重新采集需要在应用中重新操作，不通过生成器伪造执行过程。

## README 结构参考

2026-10-20 查阅以下项目的当前 README，只参考展示方式，没有复制媒体、代码或许可证声明：

- [Excalidraw](https://github.com/excalidraw/excalidraw)：一句话定位、功能说明、快速开始和开发文档分开。
- [Flowise](https://github.com/FlowiseAI/Flowise)：把功能动图放在前部，随后给快速开始和文档入口；当前 README 的归档状态不作为本项目能力依据。
- [Continue](https://github.com/continuedev/continue)：品牌、短定位、统一横幅和单独文档入口；同样只参考版式。

本项目保留自己的真实性要求、已知限制和素材归属，不添加没有依据的状态或许可徽章。
