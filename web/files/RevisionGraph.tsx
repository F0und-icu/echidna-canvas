import { Eye, FileText, PencilLine } from 'lucide-react';
import { useId } from 'react';
import type { ArchivedFile } from '../../contracts/files';

export const revisionStep = 164,
  revisionStart = 70;
export const revisionY = (source: 'observed' | 'editor') => (source === 'editor' ? 54 : 152);
export const revisionGraphWidth = (count: number) => revisionStart * 2 + (count - 1) * revisionStep;
export function RevisionGraph({
  revisions,
  selectedId,
  disabled = false,
  onSelect,
}: {
  revisions: ArchivedFile['revisions'];
  selectedId?: number;
  disabled?: boolean;
  onSelect: (id: number) => void;
}) {
  const arrow = useId();
  const records = revisions.toReversed();
  return (
    <div
      className="revision-graph"
      role="group"
      aria-label="文件版本路线"
      style={{ width: revisionGraphWidth(records.length) }}
    >
      <svg className="revision-wires" width="100%" height="230" aria-hidden="true">
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0 0 6 3 0 6" fill="currentColor" />
          </marker>
        </defs>
        {records.slice(1).map((record, index) => {
          const from = records[index],
            x = revisionStart + index * revisionStep + 23,
            next = x + revisionStep - 46;
          const y = revisionY(from.source),
            nextY = revisionY(record.source),
            mid = (x + next) / 2;
          return (
            <path
              key={record.id}
              data-from={from.id}
              data-to={record.id}
              data-kind={record.source}
              d={`M${x} ${y} C${mid} ${y},${mid} ${nextY},${next} ${nextY}`}
              className={
                record.source === 'editor' ? 'revision-save-wire' : 'revision-observed-wire'
              }
              markerEnd={`url(#${arrow})`}
            />
          );
        })}
      </svg>
      {records.map((record, index) => (
        <button
          key={record.id}
          className={`revision-node ${record.source}`}
          style={{ left: revisionStart + index * revisionStep, top: revisionY(record.source) }}
          data-revision={record.id}
          aria-label={`查看版本 v${index + 1} · ${index === 0 ? '首次读取' : record.source === 'editor' ? '手动保存' : '读取到变化'}`}
          aria-pressed={selectedId === record.id}
          disabled={disabled}
          onClick={() => onSelect(record.id)}
          title={`${new Date(record.createdAt).toLocaleString()} · SHA256 ${record.hash}`}
        >
          <span className="revision-node-circle">
            {index === 0 ? (
              <FileText size={19} />
            ) : record.source === 'editor' ? (
              <PencilLine size={19} />
            ) : (
              <Eye size={19} />
            )}
          </span>
          <span className="revision-node-label">
            <strong>v{index + 1}</strong>{' '}
            {index === 0 ? '首次读取' : record.source === 'editor' ? '手动保存' : '读取到变化'}
          </span>
          <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleTimeString()}</time>
          {index === records.length - 1 && <small className="revision-latest">最新记录</small>}
        </button>
      ))}
    </div>
  );
}
