import { useState } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useApp } from './context';
import { restoreCanvasContent } from '../model/deletion';

export function CanvasTrash() {
  const { workspace, setWorkspace, notify } = useApp();
  const [error, setError] = useState('');
  return (
    <div className="stack canvas-contents">
      <p className="fine-print">
        临时目录保存在当前浏览器中，刷新后仍保留。恢复到当前画布；整张画布恢复为原画布。不会移动磁盘文件或重新执行任务。
      </p>
      {error && <p role="alert">{error}</p>}
      {!workspace.trash?.length && <p>回收站是空的。</p>}
      {[...(workspace.trash ?? [])].reverse().map((entry) => (
        <div className="canvas-content-row" key={entry.id}>
          <span>
            <Trash2 size={13} /> {entry.label}
            <small>
              {entry.canvasName} · {new Date(entry.deletedAt).toLocaleString()}
            </small>
            <small>
              {
                {
                  canvas: '整张画布',
                  drafts: '手工图形与连线',
                  agent: 'Agent 画布路径',
                  project: '项目档案路线',
                  mcp: 'MCP 图标',
                }[entry.content.kind]
              }
            </small>
          </span>
          <button
            aria-label={`恢复：${entry.label}`}
            onClick={() => {
              try {
                const next = restoreCanvasContent(workspace, entry.id);
                setWorkspace(next);
                setError('');
                notify('已恢复画布内容，未派发任务');
              } catch (cause) {
                setError(String(cause));
              }
            }}
          >
            <ArchiveRestore size={14} /> 恢复
          </button>
        </div>
      ))}
      <small>
        已有同一图形时保留当前版本。若连线端点也已删除，请先恢复端点再恢复连线。记录不会自动清空。
      </small>
    </div>
  );
}
