import {
  ArrowUpRight,
  Check,
  Circle,
  CircleDashed,
  FileText,
  Link2,
  Images,
  MessageCircle,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { Round, ToolCall } from '../model/projection';
import type { Point } from '../model/schema';
import {
  runtimeLayout,
  runtimeNodes,
  focusedReferences,
  runtimeGeometry,
  runtimeReferencePoints,
  runtimeReferencePath,
  recordPreview,
  commandPreview,
} from './runtimeLayout';
import { toolIcon } from './toolIcon';
import { MediaPreview } from './MediaPreview';
import { ReplyCard } from './MarkdownReply';
import { useOutsideDismiss } from '../app/useOutsideDismiss';

const names = {
  input: '你的任务',
  intent: '目标',
  material: '材料',
  observation: '观察',
  decision: '选择',
  result: '结论',
  tool: '工具',
  answer: '回复',
  image: '图像',
  webpage: '网页',
};
export function RuntimeRound({
  round,
  sessionName,
  fixture,
  phase,
  uncertain,
  routeId,
  index,
  position,
  current,
  dimmed,
  selectedId,
  inspect,
  statusFor,
}: {
  round: Round;
  sessionName: string;
  fixture: boolean;
  phase: string;
  uncertain: boolean;
  routeId: string;
  index: number;
  position: Point;
  current: boolean;
  dimmed: boolean;
  selectedId: string | null;
  inspect: (nodeId?: string) => void;
  statusFor: (call: ToolCall) => string;
}) {
  const nodes = runtimeNodes(round),
    layout = runtimeLayout(round);
  const [hovered, setHovered] = useState<string | null>(null);
  const [keyOpened, setKeyOpened] = useState(false);
  const relationKey = useRef<HTMLDivElement>(null);
  useOutsideDismiss(keyOpened, [relationKey], () => setKeyOpened(false));
  const focused = hovered ?? selectedId;
  const references = focusedReferences(nodes, focused);
  const related = new Set(references.flatMap((edge) => [nodes[edge.from].id, nodes[edge.to].id]));
  const wireId = useId().replaceAll(':', '');
  return (
    <section
      className={`round-record runtime-round ${current ? 'current' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        width: layout.width,
        height: layout.height,
      }}
      aria-label={`${sessionName} / ${routeId} / ${round.id}`}
      data-round={round.id}
    >
      <button className="round-header" onClick={() => inspect()}>
        {uncertain ? (
          <TriangleAlert className="round-warning" size={12} />
        ) : (
          <span className="round-dot" />
        )}
        回合 {String(index + 1).padStart(2, '0')} / {phase}
        {fixture && (
          <span className="runtime-origin" title="协议演示：固定回复，不会理解输入">
            <CircleDashed size={11} />
            固定示例
          </span>
        )}
      </button>
      {nodes.some((node) => node.preview) && (
        <button className="round-media-entry" onClick={() => inspect('media')}>
          <Images size={13} /> 图片与网页 <span>{nodes.filter((node) => node.preview).length}</span>
        </button>
      )}
      <div className="runtime-relation-key" ref={relationKey}>
        <details open={keyOpened} onToggle={(event) => setKeyOpened(event.currentTarget.open)}>
          <summary aria-label="连线说明" title="连线说明">
            <Link2 size={14} />
          </summary>
          <div className="relation-popover">
            <p>横向片段按记录先后展开，不代表模型采样次数。</p>
            <p>绿实线表示所选方向，短灰虚线表示未选项；细灰箭头只表示记录先后，不表示执行依赖。</p>
            <p>点选或悬停时，棕色“依据”线展示当前节点的直接引用。</p>
            <p>标题上方的引用入口指向已存在的材料或记录，细弧线表示它是该判断的依据。</p>
            <p>对话曲线连接本轮输入与回复；回复摘录不代表额外的思考或验证。</p>
          </div>
        </details>
        {selectedId && selectedId !== 'media' && (
          <button
            aria-label="收起节点依据"
            onClick={() => {
              setHovered(null);
              inspect();
            }}
          >
            <X size={11} />
            收起依据
          </button>
        )}
      </div>
      <svg className="runtime-wires" width={layout.width} height={layout.height} aria-hidden="true">
        <defs>
          <marker
            id={wireId + 'sequence'}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M 1 1 L 5 3 L 1 5" />
          </marker>
          <marker
            id={wireId + 'reference'}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path className="reference-arrow" d="M 1 1 L 5 3 L 1 5" />
          </marker>
        </defs>
        {layout.chapters.map((chapter) => {
          const heading = chapter.heading;
          const input = chapter.materials.find((entry) => entry.node.kind === 'input');
          return (
            <g key={chapter.left}>
              {heading &&
                chapter.sources.map((source) => (
                  <path
                    key={source.node.id}
                    className="material-flow"
                    data-edge="local-reference"
                    d={`M ${source.x + source.width / 2} ${runtimeGeometry.materialTop + 32} C ${source.x + source.width / 2} ${heading.y - 10} ${heading.x + heading.width / 2} ${heading.y - 10} ${heading.x + heading.width / 2} ${heading.y}`}
                  />
                ))}
              {heading &&
                heading.node.options.map((option, j) => (
                  <path
                    key={option.id}
                    className={option.selected ? 'chosen' : 'alternative'}
                    d={`M ${heading.x + heading.width / 2} ${heading.y + heading.height + 4} C ${heading.x + heading.width / 2} ${runtimeGeometry.optionTop - 12} ${heading.x + (j + 0.5) * (heading.width / heading.node.options.length)} ${runtimeGeometry.optionTop - 16} ${heading.x + (j + 0.5) * (heading.width / heading.node.options.length)} ${runtimeGeometry.optionTop}`}
                  />
                ))}
              {input && heading?.node.kind === 'answer' && (
                <path
                  className="conversation"
                  d={`M ${input.x + 12} ${input.y + input.height} Q ${input.x + 12} ${heading.y - 8} ${heading.x + 28} ${heading.y}`}
                />
              )}
              {chapter.actions.slice(1).map((action, index) => {
                const previous = chapter.actions[index];
                return (
                  <path
                    key={action.node.id}
                    className="sequence"
                    data-edge="record-order"
                    markerEnd={`url(#${wireId}sequence)`}
                    d={`M ${previous.x + previous.width + 2} ${previous.y + 16} L ${action.x - 3} ${action.y + 16}`}
                  />
                );
              })}
            </g>
          );
        })}
        {references.map((edge, referenceIndex) => {
          const fromId = nodes[edge.from].id,
            toId = nodes[edge.to].id;
          const points = runtimeReferencePoints(layout, fromId, toId, referenceIndex);
          const referenceY = runtimeGeometry.referenceTop + referenceIndex * 18;
          const horizontal = points.filter((point) => point.y === referenceY);
          const path = runtimeReferencePath(points);
          return (
            <g key={fromId}>
              <path className="reference" d={path} markerEnd={`url(#${wireId}reference)`} />
              <text
                className="reference-label"
                x={(horizontal[0].x + horizontal.at(-1)!.x) / 2}
                y={referenceY - 5}
                textAnchor="middle"
              >
                依据
              </text>
            </g>
          );
        })}
      </svg>
      {layout.chapters.length > 1 &&
        layout.chapters.map((chapter, chapterIndex) => (
          <div
            className="runtime-chapter-label"
            key={chapter.left}
            style={{ left: chapter.left + 14 }}
          >
            <span />
            片段 {String(chapterIndex + 1).padStart(2, '0')}
          </div>
        ))}
      {layout.chapters.flatMap((chapter) =>
        chapter.sources
          .filter((source) => source.portal)
          .map((source) => {
            const Icon = source.node.call ? toolIcon(source.node.call.tool) : FileText;
            return (
              <button
                key={`${chapter.left}/${source.node.id}`}
                className="runtime-source"
                style={{ left: source.x, top: runtimeGeometry.materialTop, width: source.width }}
                onClick={() => inspect(source.node.id)}
                aria-label={`查看依据：${source.node.title}`}
                title={source.node.title}
              >
                <Icon size={12} />
                <span>{source.node.title}</span>
                <ArrowUpRight size={10} />
              </button>
            );
          }),
      )}
      {layout.chapters
        .filter((chapter) => chapter.heading && chapter.heading.node.refs.length > 2)
        .map((chapter) => (
          <button
            key={chapter.left}
            className="runtime-source-more"
            style={{ left: chapter.left + chapter.width - 34, top: 92 }}
            onClick={() => inspect(chapter.heading!.node.id)}
            aria-label={`查看全部 ${chapter.heading!.node.refs.length} 份依据`}
          >
            +{chapter.heading!.node.refs.length - 2}
          </button>
        ))}
      {layout.placed.map(({ node, x, y, width, height, lane }) => {
        const Icon = node.call
          ? toolIcon(node.call.tool)
          : node.kind === 'input'
            ? MessageCircle
            : FileText;
        const command = node.call?.tool === 'codex.commandExecution' ? node.call.title : null;
        return (
          <div
            className={`runtime-step lane-${lane} kind-${node.kind} ${focused === node.id ? 'node-focused' : ''} ${references.length && !related.has(node.id) ? 'node-muted' : ''}`}
            style={{ left: x, top: y, width, height }}
            key={node.id}
            data-canvas-node={node.kind}
            data-node-id={node.id}
            data-status={node.call?.status}
            onMouseEnter={() => setHovered(node.id)}
            onMouseLeave={() => setHovered(null)}
          >
            {node.preview ? (
              <div className="runtime-media">
                <MediaPreview preview={node.preview} />
              </div>
            ) : node.kind === 'answer' ? (
              <ReplyCard
                text={node.excerpt ?? node.detail}
                fixture={fixture}
                onInspect={() => inspect(node.id)}
              />
            ) : (
              <button
                className="runtime-node"
                onClick={() => {
                  inspect(node.id);
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.id)}
                onBlur={() => setHovered(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setHovered(null);
                    inspect();
                  }
                }}
                aria-pressed={selectedId === node.id}
                title={command ?? (node.kind === 'tool' ? node.title : undefined)}
                aria-label={names[node.kind] + '：' + node.title}
              >
                {lane === 'judgment' ? (
                  <>
                    <small>{names[node.kind]}</small>
                    <strong>{node.title}</strong>
                    {node.kind === 'result' && (
                      <span className="node-excerpt">{recordPreview(node.detail, 72)}</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="record-symbol">
                      <Icon size={lane === 'action' ? 14 : 12} />
                      {node.call && (
                        <span className="tool-status-mark" aria-label={statusFor(node.call)}>
                          {node.call.status === 'returned' ? (
                            <Check size={9} />
                          ) : ['failed', 'unknown', 'rejected'].includes(node.call.status) ? (
                            <TriangleAlert size={9} />
                          ) : (
                            <Circle size={8} />
                          )}
                        </span>
                      )}
                    </span>
                    {command ? (
                      <>
                        <strong className="tool-identity">{node.title}</strong>
                        <code className="command-preview">{commandPreview(command)}</code>
                      </>
                    ) : (
                      <strong>{node.title}</strong>
                    )}
                    {node.call && node.call.status !== 'returned' && (
                      <small className="node-status">{statusFor(node.call)}</small>
                    )}
                  </>
                )}
              </button>
            )}
            {!!node.options.length && (
              <div
                className="runtime-options"
                style={{ top: runtimeGeometry.optionTop - y, width }}
              >
                {node.options.map((option) => (
                  <button
                    key={option.id}
                    className={option.selected ? 'selected' : ''}
                    onClick={() => {
                      inspect(node.id);
                    }}
                  >
                    {option.selected ? <Check size={12} /> : <Circle size={12} />}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
