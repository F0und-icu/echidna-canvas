import { useEffect } from 'react';
import { BookOpen, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { Character } from '../agents/Character';
import { useApp } from '../app/context';
import { updateCanvas } from '../model/workspace';
import type { Point } from '../model/schema';
import { RevisionGraph, revisionY, revisionStart } from './RevisionGraph';
import { useProjectArchive } from './archive';
import {
  archiveBounds,
  archiveGraphX,
  archivePositionKey,
  archiveRowHeight,
  initialArchivePosition,
} from './archiveLayout';

export function ArchiveCanvas({
  position,
  root,
  positionKey = archivePositionKey,
}: {
  position?: Point;
  root?: string;
  positionKey?: string;
}) {
  const archive = useProjectArchive();
  const index = root ? (archive.indexes[root] ?? null) : archive.index;
  const busy = root ? (archive.loading[root] ?? !index) : archive.busy;
  const error = root ? archive.errors[root] : archive.error;
  useEffect(() => {
    if (root) void archive.refresh(root);
  }, [root, archive.refresh]);
  const { canvas, view, panel, openPanel, setWorkspace, requestRemoval } = useApp();
  useEffect(() => {
    if (!root && !position && index?.files.length)
      setWorkspace((w) =>
        updateCanvas(w, (c) => ({
          ...c,
          positions: { ...c.positions, [positionKey]: initialArchivePosition(view, c) },
        })),
      );
  }, [
    position,
    index?.root,
    index?.files.length,
    canvas.id,
    setWorkspace,
    view,
    root,
    positionKey,
  ]);
  if (!position) return null;
  const files = index ? index.files : [];
  const bounds = archiveBounds(files);
  return (
    <section
      className="archive-canvas"
      aria-label="项目档案修改路线"
      style={{ left: position.x, top: position.y, width: bounds.w, height: bounds.h }}
    >
      <button
        className="archive-root"
        data-archive-root={root ?? ''}
        data-archive-key={positionKey}
        aria-label="项目档案"
        onClick={(event) => {
          if (!event.detail) openPanel({ kind: 'files', root });
        }}
      >
        <Character
          avatar="archivist"
          height={138}
          pose={panel?.kind === 'files' || busy ? 'reading' : 'idle'}
        />
        <span>项目档案</span>
        <small title={index?.root}>
          {index || root
            ? (root ?? index!.root).split('/').at(-1) || root || index!.root
            : busy
              ? '正在读取档案…'
              : '档案未连接'}
        </small>
      </button>
      <div className="archive-route-tools">
        <small>修改路线</small>
        <button
          aria-label="从画布移除项目档案"
          title="移除档案路线，保留文件与版本"
          onClick={() => requestRemoval({ kind: 'project', root })}
        >
          <Trash2 size={12} />
        </button>
        <button
          aria-label="刷新档案路线"
          disabled={busy}
          onClick={() => void archive.refresh(root)}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {error && (
        <p className="archive-route-error" role="alert">
          {error}
        </p>
      )}
      <svg className="archive-root-wires" width={bounds.w} height={bounds.h} aria-hidden="true">
        {files.map((file, row) => {
          const y = row * archiveRowHeight;
          return (
            <g key={file.path} data-file-route={file.path}>
              <path d={`M105 132 C146 132,142 ${y + 142},174 ${y + 142}`} />
              <path
                d={`M326 ${y + 142} C350 ${y + 142},350 ${y + revisionY('observed')},${archiveGraphX + revisionStart - 23} ${y + revisionY('observed')}`}
              />
            </g>
          );
        })}
      </svg>
      {files.map((file, row) => (
        <div
          className="archive-file-route"
          key={file.path}
          data-archive-file={file.path}
          role="group"
          aria-label={`${file.path} 修改路线`}
          style={{ top: row * archiveRowHeight }}
        >
          <button
            className="archive-file-node"
            style={{ left: 174, top: 108 }}
            title={file.path}
            onClick={() => openPanel({ kind: 'files', root: index!.root, path: file.path })}
          >
            <FileText size={17} />
            <span>
              {file.path.split('/').at(-1)}
              <small>{file.revisions.length} 个版本</small>
            </span>
          </button>
          <div className="archive-file-graph" style={{ left: archiveGraphX }}>
            <RevisionGraph
              revisions={file.revisions}
              selectedId={
                panel?.kind === 'files' && panel.path === file.path ? panel.revisionId : undefined
              }
              onSelect={(revisionId) =>
                openPanel({ kind: 'files', root: index!.root, path: file.path, revisionId })
              }
            />
          </div>
        </div>
      ))}
      {!files.length && !busy && (
        <button className="archive-start" onClick={() => openPanel({ kind: 'files', root })}>
          <BookOpen size={16} />
          打开文件，开始记录
        </button>
      )}
      <small className="archive-route-caption">
        实线 · 保存　虚线 · 读取观察
        <br />
        连线按记录顺序，不推测外部修改者
      </small>
    </section>
  );
}
