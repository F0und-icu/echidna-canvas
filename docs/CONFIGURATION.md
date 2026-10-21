# 配置说明

操作步骤见 [使用指南](USER_GUIDE.md)，启动命令见 [README](../README.md#快速开始)。

## Codex 与项目路径

真实模式使用 PATH 中的 `codex`，默认项目为启动目录。可显式指定：

```sh
ECHIDNA_CANVAS_CODEX_BINARY=/absolute/path/to/codex \
ECHIDNA_CANVAS_PROJECT_DIR=/absolute/path/to/project \
npm run dev:codex
```

每个 Agent 创建时仍可选择自己的已有项目目录；同项目复用档案，不同项目保留独立文件路线。手动切换档案不改变已有 Agent 的工作目录。

当前每个本地服务使用一个运行时，真实模式支持 Codex。

## 认证与默认行为

浏览器授权、设备码和 API Key 交给应用自己启动的 Codex app-server，认证由它写入 `~/.echidna-canvas/codex-profile`，不导入其他 CLI 或桌面应用登录。认证属于本机 harness/profile，模型配置属于各 Agent；API Key 不写入画布。

创建表单从实际模型目录生成模型、思考强度和支持的原生配置。名称自动生成，形象与描述可修改；自由文本工作偏好目前是画布备注，不自动注入行为提示。

用户授权的默认值为 HTTP/SSE 模型传输、完整文件与网络访问、实时网页搜索、无需执行审批。应用附加的 developer instructions 仅包含画布标注与来源查询工具的用法，用户消息保持原文。连接失败保留错误，不切换账户或静默降级。

## MCP 与文件边界

MCP 当前支持已有 HTTP(S) Streamable HTTP 网关，无需认证、Bearer、自定义 API Key Header 和原生 MCP OAuth。Docker 图标表示该网关，不提供 stdio 安装器或启动 daemon。

修改接入产生新版本，不自动更新已有绑定。应用配置要求 Agent 已知空闲，保留历史并建立新的底层 Codex Session；不启动模型回合、不重放工具。未知状态先核对，工具就绪与配置绑定分别显示。

文件编辑只支持不超过 1 MiB 的 UTF-8 文本。保存核对基础 SHA256，冲突时保留草稿。常见凭据、内部记录、依赖目录及符号链接不开放给文件浏览入口；这不改变 Codex 的执行权限。当前没有文件新建／删除、Git 历史导入、实时监视、多进程写入锁或跨资源事务。

## 数据保存

| 位置                                | 内容                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| 浏览器 IndexedDB                    | 画布视图、对话草稿与可见记录；旧 localStorage 数据可迁移 |
| `.echidna-canvas/runtime.sqlite`    | 离线夹具运行记录                                         |
| `.echidna-canvas/codex.sqlite`      | 真实模式命令、事件和运行时来源                           |
| `.echidna-canvas/files.sqlite`      | 按项目隔离的文件快照和历史正文                           |
| `.echidna-canvas/mcp.sqlite`        | MCP 公开配置和不可变版本元数据                           |
| `~/.echidna-canvas/codex-profile`   | Codex 管理的专属配置与认证                               |
| `~/.echidna-canvas/mcp-credentials` | MCP 静态凭据                                             |

服务数据保存在启动目录下，已加入 Git 忽略；凭据与画布、导出及公开配置元数据分离。文件窗口草稿仅保存在该窗口内存，显式保存才写入磁盘；文件正文与版本不进入画布导出。

刷新浏览器会补齐记录，不启动新回合。服务重启保留历史，但目前不能 Resume 旧真实会话，不自动续跑或把未知结果改成成功。
