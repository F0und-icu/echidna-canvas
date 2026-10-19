import { useApp } from '../app/context';
import { callStatus, roundState } from './RoundView';
import { runtimeNodes, toolLabel, type RuntimeNode } from './runtimeLayout';
import { Check, Circle, FileText, ArrowUpRight } from 'lucide-react';
import { toolIcon } from './toolIcon';
import { MediaPreview } from './MediaPreview';
import { BranchButton } from '../runtime/BranchButton';
import { MarkdownReply } from './MarkdownReply';

export function RoundDetails({
  sessionId,
  routeId,
  roundId,
  nodeId,
}: {
  sessionId: string;
  routeId: string;
  roundId: string;
  nodeId?: string;
}) {
  const { canvas, view, openPanel, setWorkspace } = useApp(),
    session = view.sessions[sessionId];
  const route = session?.routes.find((r) => r.id === routeId),
    round = route?.rounds.find((r) => r.id === roundId);
  if (!round || !route) return <p>这份记录尚未出现在当前历史前缀中。</p>;
  const nodes = runtimeNodes(round);
  const selected = nodes.find((node) => node.id === nodeId);
  const checkpoint =
    selected &&
    ['intent', 'material', 'observation', 'decision', 'result', 'tool'].includes(selected.kind)
      ? view.events.findLast(
          (event) =>
            event.sessionId === sessionId &&
            'roundId' in event.data &&
            event.data.roundId === roundId &&
            ((event.data.type === 'canvas.noted' && 'note:' + event.data.noteId === selected.id) ||
              ((event.data.type === 'tool.finished' || event.data.type === 'tool.failed') &&
                'tool:' + event.data.callId === selected.id)),
        )
      : undefined;
  const inspectNode = (id?: string) =>
    openPanel({ kind: 'round', sessionId, routeId, roundId, nodeId: id });
  if (nodeId === 'media')
    return (
      <>
        <p className="record-eyebrow">
          {session.config.name} · 回合 {String(route.rounds.indexOf(round) + 1).padStart(2, '0')}
        </p>
        <h3>
          {nodes.filter((node) => node.kind === 'image').length} 张图片 ·{' '}
          {nodes.filter((node) => node.kind === 'webpage').length} 个网页
        </h3>
        {session.source === 'fixture' && <p className="fine-print">离线演示 · 固定示例</p>}
        {!nodes.some((node) => node.preview) && <p>当前历史前缀还没有图片或网页记录。</p>}
        <MediaRecords nodes={nodes.filter((node) => node.preview)} inspect={inspectNode} />
        <button onClick={() => inspectNode()}>查看整轮记录</button>
      </>
    );
  if (nodeId && !selected)
    return (
      <>
        <p>这个节点尚未出现在当前历史前缀中。</p>
        <button onClick={() => inspectNode()}>查看当前轮次</button>
      </>
    );
  const notes = selected
    ? round.notes.filter((note) => 'note:' + note.id === selected.id)
    : round.notes;
  const calls = round.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => !selected || 'tool:' + call.id === selected.id);
  const following = selected ? nodes.filter((node) => node.refs.includes(selected.id)) : [];
  return (
    <>
      <p className="record-eyebrow">
        {session.config.name}{' '}
        <span>回合 {String(route.rounds.indexOf(round) + 1).padStart(2, '0')}</span>
        <small>
          #{round.firstSeq}–{round.lastSeq}
        </small>
      </p>
      <h3>{selected ? selected.title : round.title}</h3>
      {session.runtime &&
        selected &&
        ['intent', 'material', 'observation', 'decision', 'result', 'tool'].includes(
          selected.kind,
        ) && (
          <BranchButton
            key={`${sessionId}/${roundId}/${checkpoint?.id ?? nodeId}`}
            sessionId={sessionId}
            roundId={roundId}
            side="at"
            eventId={checkpoint?.id}
            composer
          />
        )}
      {roundState(round, route.connected).uncertain && (
        <div role="alert">
          <p>运行结果待核对；已有文字不代表完整回复，没有重新派发。</p>
          {route.connectionError && <p className="fine-print">{route.connectionError}</p>}
        </div>
      )}
      {!selected && round.outcome && (
        <p>
          {round.outcome === 'completed'
            ? '回合已结束'
            : round.outcome === 'interrupted'
              ? '运行时已确认回合中断'
              : '回合失败'}
          {round.error && `：${round.error}`}
        </p>
      )}
      {!selected && round.interruptRequested && !round.outcome && (
        <p>中断待确认；不推断命令已停止。</p>
      )}
      {!selected && (round.summary || round.unit !== 'turn') && (
        <p className="record-prose">{round.summary || '本轮没有返回可见摘要。'}</p>
      )}
      {selected?.kind === 'input' && <p className="record-prose">{round.input.task}</p>}
      {notes.map(({ id, seq, note }) => (
        <section className="detail-section note-detail" key={id}>
          <div className="record-section-heading">
            {!selected && <h4>{note.title}</h4>}
            <span>Agent 标注</span>
          </div>
          <p className={`record-prose ${note.kind === 'decision' ? 'decision-basis' : ''}`}>
            {note.detail}
          </p>
          {!!note.options.length && (
            <div className="decision-choices">
              {note.options.map((option) => (
                <div key={option.id} className={option.selected ? 'selected' : ''}>
                  {option.selected ? <Check size={14} /> : <Circle size={14} />}
                  <span>{option.label}</span>
                  <small>{option.selected ? '已选方向' : '未选方向'}</small>
                </div>
              ))}
            </div>
          )}
          {!!note.refs.length && (
            <div className="reference-list">
              <small>引用依据</small>
              {note.refs.map((ref) => {
                const source = nodes.find((node) => node.id === ref)!;
                const Icon = source.call ? toolIcon(source.call.tool) : FileText;
                return (
                  <button key={ref} onClick={() => inspectNode(ref)}>
                    <Icon size={14} />
                    <span>{source.title}</span>
                    <ArrowUpRight size={12} />
                  </button>
                );
              })}
            </div>
          )}
          <details className="compact-source">
            <summary>来源</summary>
            <code>
              {'note:' + id} · #{seq}
            </code>
          </details>
        </section>
      ))}
      {!selected &&
        round.decisions.map((decision) => (
          <section className="detail-section" key={decision.seq}>
            <h4>当时记录的决策 · #{decision.seq}</h4>
            {decision.options.map((option) => (
              <p key={option.id}>
                {option.selected ? '✓' : '○'} {option.label}
              </p>
            ))}
            <p>{decision.reason}</p>
            <small>依据：{decision.refs.join(' · ')}</small>
          </section>
        ))}
      {!selected &&
        round.assessments.map((assessment) => (
          <section className="detail-section" key={assessment.seq}>
            <h4>
              {assessment.source} · #{assessment.seq}
            </h4>
            <p>{assessment.text}</p>
          </section>
        ))}
      <MediaRecords
        nodes={nodes.filter(
          (node) =>
            node.preview &&
            (!selected || selected.id === node.id || node.refs.includes(selected.id)),
        )}
        inspect={inspectNode}
      />
      {calls.map(({ call, index }) => {
        const Icon = toolIcon(call.tool);
        return (
          <section className="detail-section tool-record" key={call.id}>
            <div className="tool-record-heading">
              <span className="terminal-mark">
                <Icon size={17} />
              </span>
              <h4>{toolLabel(call, index)}</h4>
              <span className="tool-state" data-state={call.status}>
                {callStatus(call, route.connected)}
              </span>
            </div>
            <details className="command-content" open={!!selected}>
              <summary>参数与原始回传</summary>
              <div className="command-block">
                <div className="command-block-title">
                  <span>{call.tool === 'codex.commandExecution' ? '终端原文' : '调用参数'}</span>
                  <small>原始记录</small>
                </div>
                <pre>
                  <code>
                    {call.tool === 'codex.commandExecution'
                      ? call.title
                      : call.status === 'preparing'
                        ? call.argumentText
                        : JSON.stringify(call.args, null, 2)}
                  </code>
                </pre>
              </div>
              {call.tool === 'codex.commandExecution' && typeof call.args.cwd === 'string' && (
                <p className="command-cwd">
                  <span>工作目录</span>
                  <code>{call.args.cwd}</code>
                </p>
              )}
              {call.result !== undefined && (
                <div className="command-block output-block">
                  <div className="command-block-title">
                    <span>输出</span>
                  </div>
                  <pre>
                    <code>{call.result}</code>
                  </pre>
                </div>
              )}
              {call.error && <p className="tool-error">{call.error}</p>}
              <details className="compact-source">
                <summary>来源与回执</summary>
                <dl>
                  <dt>调用</dt>
                  <dd>{call.id}</dd>
                  <dt>工具</dt>
                  <dd>{call.tool}</dd>
                  {call.receipt && (
                    <>
                      <dt>回执</dt>
                      <dd>{call.receipt}</dd>
                    </>
                  )}
                </dl>
              </details>
            </details>
            {call.cancelRequested && (
              <p className="fine-print">
                {call.status === 'returned'
                  ? '取消请求之后收到了真实回传，保留该结果。'
                  : '尚无执行器取消确认，不推断副作用已消失。'}
              </p>
            )}
          </section>
        );
      })}
      {round.response && (!selected || selected.kind === 'answer') && (
        <section className="detail-section">
          <h4>面向用户的回答</h4>
          <MarkdownReply text={round.response} />
        </section>
      )}
      {!!following.length && (
        <section className="reference-list detail-section">
          <small>后续引用</small>
          {following.map((node) => (
            <button key={node.id} onClick={() => inspectNode(node.id)}>
              <ArrowUpRight size={14} />
              <span>{node.title}</span>
            </button>
          ))}
        </section>
      )}
      {(!selected || selected.kind === 'input') && (
        <details className="detail-section">
          <summary>不可变输入快照</summary>
          <pre>
            {JSON.stringify({ ...round.input, roundId, routeId, origin: route.origin }, null, 2)}
          </pre>
        </details>
      )}
      <div className="inline-actions">
        {session.runtime &&
          (!selected || selected.kind === 'input' || selected.kind === 'answer') && (
            <BranchButton
              key={`${sessionId}/${roundId}/${nodeId ?? 'round'}`}
              sessionId={sessionId}
              roundId={roundId}
              side={selected?.kind === 'input' ? 'before' : 'after'}
              eventId={selected?.kind === 'input' ? round.inputEventId : round.terminalEventId}
            />
          )}
        {!(session.runtime && selected && !['input', 'answer'].includes(selected.kind)) && (
          <button
            className="primary-button"
            onClick={() =>
              openPanel({
                kind: 'chat',
                source: {
                  sessionId,
                  routeId,
                  roundId,
                  eventSeq: canvas.historySeq ?? round.lastSeq,
                },
              })
            }
          >
            {session.runtime ? '与 Agent 继续对话' : '补充信息，开启新路线'}
          </button>
        )}
        <button onClick={() => openPanel(null)}>返回画布</button>
        {selected && <button onClick={() => inspectNode()}>查看整轮记录</button>}
      </div>
      <button
        className="text-button"
        onClick={() =>
          setWorkspace((w) => ({
            ...w,
            canvases: w.canvases.map((c) =>
              c.id === w.activeCanvas ? { ...c, historySeq: round.lastSeq, follow: false } : c,
            ),
          }))
        }
      >
        回看这个时刻
      </button>
    </>
  );
}

function MediaRecords({ nodes, inspect }: { nodes: RuntimeNode[]; inspect: (id: string) => void }) {
  return nodes.map((node) => (
    <section className="detail-section media-detail" key={node.id}>
      <h4>{node.preview!.kind === 'webpage' ? '网页' : node.preview!.title}</h4>
      <MediaPreview key={node.id} preview={node.preview!} expanded />
      {node.preview!.kind === 'webpage' && <p className="media-url">{node.preview!.url}</p>}
      <button className="text-button" onClick={() => inspect(node.refs[0])}>
        查看工具来源 · #{node.seq}
      </button>
      <p className="fine-print">
        {node.preview!.kind === 'image'
          ? '点击放大。文件来源显示当前内容；内嵌图片保留原始回传。'
          : '运行时记录的打开或页内查找操作；未报告页面加载成功状态。'}
      </p>
    </section>
  ));
}
