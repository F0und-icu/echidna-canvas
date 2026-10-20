# README 媒体

本目录用于项目介绍。静态展示图、GIF、MP4 和海报统一为 **1600×1000、8:5**，与应用九色配色一致。

运行前端后，可在 [本地媒体展示页](http://127.0.0.1:4173/docs/media/index.html) 播放视频和查看功能图；GitHub 上也可直接打开 GIF 或下载 MP4。

## 内容与真实性

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

本轮浏览器安全检查拒绝读取当前标签，已请求操作者刷新；在恢复前不录制实际操作，也不通过其他浏览器或协议绕过限制。本轮交付的是基于既有实屏的功能图和明确标注的讲解动画。

## 重新生成

生成器只消费保存的截图和显式图形脚本，不读取账户、运行数据库或浏览器存储。需要 Node.js、`@napi-rs/canvas`、一个支持中文的字体以及带 libx264 的 FFmpeg。构建媒体所用依赖来自本机文档工具运行时，没有加入应用依赖。

```sh
node scripts/build_readme_media.mjs /absolute/path/to/node_modules /absolute/path/to/CJK-font.ttf
```

脚本会生成五张 PNG、动画帧、GIF、MP4、海报和来源清单；临时帧在成功编码后删除。原始截图不会被覆盖。导出的 GIF 使用调色板，原图和展示图保持无损 PNG，MP4 使用 CRF 16。

## README 结构参考

2026-10-20 查阅以下项目的当前 README，只参考展示方式，没有复制媒体、代码或许可证声明：

- [Excalidraw](https://github.com/excalidraw/excalidraw)：一句话定位、功能说明、快速开始和开发文档分开。
- [Flowise](https://github.com/FlowiseAI/Flowise)：把功能动图放在前部，随后给快速开始和文档入口；当前 README 的归档状态不作为本项目能力依据。
- [Continue](https://github.com/continuedev/continue)：品牌、短定位、统一横幅和单独文档入口；同样只参考版式。

本项目保留自己的真实性要求、已知限制和素材归属，不添加没有依据的状态或许可徽章。
