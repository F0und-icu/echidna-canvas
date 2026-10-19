import { useState, type FormEvent } from 'react';
import { ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../app/context';
import type { Source } from '../model/schema';
import { applyProposal, updateCanvas } from '../model/workspace';

export function Dialogue({ source }: { source: Source }) {
  const { workspace, canvas, view, setWorkspace, openPanel, focusAgent } = useApp();
  const session = view.sessions[source.sessionId],
    route = session.routes.find((route) => route.id === source.routeId)!;
  const matching =
    canvas.proposal?.source.sessionId === source.sessionId &&
    canvas.proposal.source.routeId === source.routeId &&
    canvas.proposal.source.roundId === source.roundId;
  const proposal = matching ? canvas.proposal : null;
  const [text, setText] = useState(proposal?.text ?? '');
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('请填写具体的补充内容。');
      return;
    }
    setError('');
    setWorkspace((w) =>
      updateCanvas(w, (c) => ({ ...c, proposal: { source, text: text.trim() } })),
    );
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="dialogue-context">
        <ArrowUpRight size={14} />
        {source.routeId.toUpperCase()} / {source.roundId ?? 'Agent 起点'}
        <small>#{source.eventSeq}</small>
      </div>
      <div className="inline-actions">
        <button
          aria-label="配置角色"
          onClick={() => openPanel({ kind: 'agent', sessionId: source.sessionId })}
        >
          <SlidersHorizontal size={15} />
        </button>
        <button onClick={() => openPanel({ kind: 'execution' })}>运行详情</button>
      </div>
      <details>
        <summary>任务与角色详情</summary>
        <p>{route.task}</p>
        <p>{session.config.model}</p>
        <p>{session.config.personality}</p>
      </details>
      <div className="conversation" aria-live="polite">
        {session.routes
          .filter((r) => r.originKind === 'user')
          .map((r) => (
            <div key={r.id} className="conversation-entry">
              <small>你 · {r.id.toUpperCase()}</small>
              <p>{r.task}</p>
              <span>已采用 · 新路线保留原始来源</span>
            </div>
          ))}
        {!proposal && (
          <p className="dialogue-empty">
            补充一个事实，
            <br />
            或一起调整下一步。
          </p>
        )}
        {proposal && (
          <>
            <div className="conversation-entry">
              <small>你</small>
              <p>{proposal.text}</p>
            </div>
            <div className="proposal">
              <small>离线建议 · 尚未调用模型</small>
              <p>从选定记录建立新路线，使用这条补充作为新任务。</p>
              <textarea
                aria-label="修改路线建议"
                value={proposal.text}
                onChange={(e) =>
                  setWorkspace((w) =>
                    updateCanvas(w, (c) => ({
                      ...c,
                      proposal: c.proposal ? { ...c.proposal, text: e.target.value } : null,
                    })),
                  )
                }
              />
              <button
                className="primary-button"
                disabled={!proposal.text.trim()}
                onClick={() => {
                  setWorkspace(applyProposal);
                  focusAgent(source.sessionId, true);
                  openPanel(null);
                }}
              >
                采用建议，开启新路线
              </button>
            </div>
          </>
        )}
      </div>
      <form className="stack compose" onSubmit={submit}>
        <textarea
          aria-label="对话消息"
          placeholder="补充信息，或纠正下一步…"
          required
          rows={3}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="inline-actions">
          <button type="button" onClick={() => setText('先核对真实环境，不修改文件')}>
            试试：先验证内容
          </button>
          <button className="primary-button" type="submit">
            发送
          </button>
        </div>
      </form>
      <p className="fine-print">
        来源固定为事件前缀 #{source.eventSeq}；当前共有 {workspace.events.length} 条演示记录。
      </p>
    </>
  );
}
