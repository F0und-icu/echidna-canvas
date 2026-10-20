# 项目实屏

当前 README 使用 [project/](project/) 中的 **1920×1080** 完整应用截图和视频。没有说明侧栏、拼贴、额外模糊、画面裁切或替换界面文字。PNG 直接保存捕获字节；视频仅做编码与操作片段衔接。

运行前端后打开 [展示页](http://127.0.0.1:4173/docs/media/index.html)。

| 内容                                                                                                      | 来源                                                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [项目画布](project/canvas.png)                                                                            | 新画布挂载已有真实 Codex 分支，执行事实保持不变                      |
| [命令回执](project/terminal.png) · [结论](project/conclusion.png) · [独立对话](project/branch-result.png) | 真实回合 `01a15484-f70f-70b0-8ce1-4d92469b3b25` 的既有记录           |
| [任务报告](project/project-report.png)                                                                    | 实际项目 `/private/tmp/echidna-canvas-acceptance19/branch/report.md` |
| [版本连接图](project/file-history.png) · [逐行差异](project/file-diff.png)                                | 既有人工编辑文件的 v3 → v4，+3／−2 行；本次只读                      |
| [图片产物](project/generated-image.png)                                                                   | 此前真实 Codex 编程生成的 main/diagram.png，通过工具来源记录打开     |
| [创建配置](project/create-agent.png)                                                                      | 已连接的真实 Codex、实际模型目录；仅取景，未再次创建                 |
| [项目记录浏览 MP4](project/project-tour.mp4) · [GIF](project/project-tour.gif)                            | 画布 → 工具回执 → 结论 → 分支对话 → 已返回的结果                     |
| [项目文件浏览 MP4](project/project-files.mp4) · [GIF](project/project-files.gif)                          | 打开任务报告 → 切换项目 → 查看版本图 → 选择 v4 → 完整差异表          |
| [图片预览 MP4](project/project-image.mp4)                                                                 | 从真实工具记录打开已有图片，并保留最终预览画面                       |
| [来源清单](project/manifest.json)                                                                         | PNG／视频 SHA256、原始帧哈希、采集时间与剪辑顺序                     |

这次拍摄没有新的模型推理、文件写入或工具重放。画布分支及报告来自此前的真实任务，文件历史为此前的实际人工保存；不能将本轮浏览视频当成重新执行或新的语义验收。图像预览背景的遮罩、文件窗口背景的模糊来自应用自身。

用户明确选择 1920×1080 横屏后，使用临时桌面视口，并通过 `Page.captureScreenshot` 的明确完整视口区域保存 PNG。普通表面截图与 screencast 试片存在边缘裁切，已排除。应用中的长对话、代码块和版本路线仍按实际交互滚动，不通过裁图或改写内容让它们假装全部展开。

视频按约 2 fps 采集原生 PNG，片段内保持原始时间，编码为 12 fps H.264；重复帧不代表更高采集率，没有插值动作。GIF 是调色板预览，PNG 与 MP4 用于查看细节。片段间省略工具操作间的等待；末尾保留了结论、回复、差异或图片，避免在操作结果出现前结束。

## 编码

```sh
node scripts/encode_project_recordings.mjs /absolute/path/to/capture-directory
```

输入为 CUA 保存的完整 PNG 和 `fullN/frames.json`。脚本检查文件签名、1920×1080 尺寸与递增帧时间，原样复制九张截图，再通过 FFmpeg 编码三份 MP4 与两份 GIF，不连接浏览器或生成执行事实。重新拍摄需要实际操作应用；原始临时帧不在 Git 中，清单保留其哈希和时间。

## 历史素材

`ui-*`、`clean/`、`recordings/` 与 [旧清单](clean-manifest.json) 属于上一版离线协议示例和说明版式；五张未加 `ui-` 前缀的功能图与 [旧清单](manifest.json) 属于更早的说明图。它们不再出现在当前展示页。

[context-branch.mp4](context-branch.mp4) 是上下文关系示意动画，始终不是实际任务录屏。[早期原始截图](../screenshots/README.md) 保持原字节与原尺寸，保留作历史来源。
