# Echidna Canvas

用一张持续生长的画布，指挥一个 Agent 或一支 Agent 团队。

这是 Echidna Web 交互项目的独立仓库：人物是对话入口，任务沿可追溯的路径展开，工具调用、材料、决策和协作关系按实际事件逐步出现。视觉参考 Excalidraw 的纸面与悬浮画笔，以及 diagram-design 的图形语言。

**当前阶段：设计基线与开发计划。** 仓库包含可运行的交互设计原型、选定的角色素材和分阶段验收方案。原型使用模拟事件与模拟登录；真实模型、进程执行、账户认证及后端持久化尚未实现。

## 查看原型

需要 Python 3.10+，无需安装项目依赖，也不会调用模型。

```sh
git clone https://github.com/F0und-icu/echidna-canvas.git
cd echidna-canvas
python3 scripts/preview.py
```

打开 <http://127.0.0.1:4173>，从「Menu → 示例场景」进入：

- 工具反馈改变判断。
- 用户中途纠正方向，保留旧路线。
- 委派独立复核，回传后采纳有限范围。

主题、画布、角色、项目档案、运行恢复与交接记录都从菜单或人物详情进入。状态仅保留在本次打开期间。预览服务只提供设计文件，不是产品后端。

## 开发入口

| 文档 | 用途 |
| --- | --- |
| [当前状态](docs/STATUS.md) | 已完成内容、验证结果与下一阶段 |
| [开发计划](docs/DEVELOPMENT_PLAN.md) | 工作拆分、依赖、交付物与阶段门槛 |
| [架构方案](docs/ARCHITECTURE.md) | Web、编排、独立运行时与数据边界 |
| [交互与协议](docs/INTERACTION_CONTRACT.md) | 事件、命令、AI 能力预填与调用语义 |
| [验收场景](docs/ACCEPTANCE.md) | 从设计到真实执行的可复现验收 |
| [设计原则](design/DESIGN_PRINCIPLES.md) | 配色、人物、画布、决策与运行细则 |
| [素材说明](docs/ASSETS.md) | 当前角色、来源与使用范围 |

## 第一版范围

单用户、本地运行的 Web 画布；先完成一条真实 Agent 路径，再做受限的多 Agent 委派。已有 Echidna 运行时保持独立，本仓库承载 Web 与编排。具体运行时桥接方式需要先验证，当前不承诺已有可直接调用的库或 Web API。

不把未返回的内部思维、图形位置或角色表情当作执行事实。每个 Agent 的 Session、模型状态、工具回执及凭据边界都保持独立。

## 参考与归属

- [Excalidraw](https://excalidraw.com/)：白板交互参考。
- [diagram-design](https://github.com/cathrynlavery/diagram-design)：图形与排版参考。
- [Echidna Agent](https://github.com/F0und-icu/echidna-agent)：计划接入的运行时项目。

以上为参考或集成目标，不表示代码已被引入或集成已经完成。原型图标使用 Lucide，许可证随文件保留；角色归属见素材说明。本仓库暂未授予整体开源许可。
