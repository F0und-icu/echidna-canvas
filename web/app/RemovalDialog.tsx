import { useEffect, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
import type { RemovalTarget } from '../model/deletion';
import { useApp } from './context';
import { useDialogBackdrop } from './useDialogBackdrop';

export function RemovalDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: RemovalTarget;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { workspace, live, mcp } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useDialogBackdrop(onCancel);
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  const name =
    target.kind === 'canvas'
      ? workspace.canvases.find((canvas) => canvas.id === target.id)!.name
      : target.kind === 'agent'
        ? live.sessions[target.id].config.name
        : target.kind === 'project'
          ? (target.root ?? '项目档案')
          : (mcp.connections.find((connection) => connection.id === target.id)?.name ?? 'MCP 接入');
  const descriptions = {
    canvas:
      '将这张画布及其中的手工图形和布局移入回收站。Agent 对话、执行记录、项目文件与 MCP 配置保留，其他画布不受影响。',
    agent: '从当前画布移除这个 Agent 及其任务路径。独立支线和对话草稿保留，任务不会被打断。',
    project:
      '从当前画布移除档案角色及文件版本路线。磁盘文件、修改记录和 Agent 的工作目录保持不变。',
    mcp: '从当前画布移除接入图标及其可见连线。接入配置、认证和已有 Agent 绑定保留，工具仍可使用。',
  };
  return (
    <dialog
      ref={dialog}
      className="removal-dialog"
      aria-labelledby="removal-title"
      aria-describedby="removal-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      {...backdrop}
    >
      <header>
        <Trash2 size={20} />
        <h2 id="removal-title">{target.kind === 'canvas' ? '删除画布' : '从当前画布移除'}</h2>
        <button className="icon-button" aria-label="关闭移除确认" onClick={onCancel}>
          <X size={17} />
        </button>
      </header>
      <strong className="removal-name">{name}</strong>
      <p id="removal-description">{descriptions[target.kind]}</p>
      {target.kind === 'canvas' ? (
        workspace.canvases.length === 1 && (
          <p className="fine-print">删除后会打开一张新空白画布。</p>
        )
      ) : (
        <p className="fine-print">内容进入回收站，可恢复到当前画布。</p>
      )}
      <footer>
        <button autoFocus onClick={onCancel}>
          取消
        </button>
        <button className="primary-button" onClick={onConfirm}>
          {target.kind === 'canvas' ? '确认删除画布' : '确认移除'}
        </button>
      </footer>
    </dialog>
  );
}
