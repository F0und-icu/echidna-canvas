import { useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useApp } from '../app/context';
import { project, resolveBranchPoint, visibleSessions } from '../model/projection';
import { currentCanvas, newId, updateCanvas } from '../model/workspace';
import { agentPosition, roundPosition } from '../canvas/geometry';
import { recordHeight, recordWidth } from '../records/runtimeLayout';
import { runtimeBackend } from './connection';

export function BranchButton({
  sessionId,
  roundId,
  side,
  eventId,
  compact = false,
  label: customLabel,
  composer = false,
}: {
  sessionId: string;
  roundId: string;
  side: 'before' | 'after' | 'at';
  eventId?: string;
  compact?: boolean;
  label?: string;
  composer?: boolean;
}) {
  const { runtime, view, workspace, setWorkspace, focusAgent, openPanel } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const commandId = useRef<string | null>(null);
  const branchId = useRef<string | null>(null);
  const sendId = useRef<string | null>(null);
  const dispatching = useRef(false);
  const draftKey = `fragment/${sessionId}/${roundId}/${eventId ?? 'pending'}`;
  const text = workspace.chatDrafts?.[draftKey] ?? '';
  const session = view.sessions[sessionId];
  const available =
    eventId &&
    runtime.connected &&
    runtime.state?.backend.capabilities.fork &&
    session.runtime &&
    runtimeBackend(session.runtime) === runtime.state.backend.id;
  const label =
    customLabel ??
    (side === 'at'
      ? '从此片段对话并分支'
      : side === 'before'
        ? '从此消息发送前分支'
        : '从此回复后分支');
  const fork = async () => {
    if (!available || dispatching.current || (composer && !text.trim())) return;
    dispatching.current = true;
    setBusy(true);
    setError('');
    try {
      if (!branchId.current) {
        commandId.current ??= newId();
        const result = await runtime.command({
          version: 1,
          commandId: commandId.current,
          type: 'agent.fork',
          sourceAgentId: sessionId,
          roundId,
          side,
          eventId,
        });
        if (result.status === 'rejected') commandId.current = null;
        if (result.status !== 'acknowledged') throw new Error(result.error ?? '分支创建结果待核对');
        branchId.current = result.agentId;
        setWorkspace((w) => {
          const p = project(w.events),
            c = currentCanvas(w);
          const point = resolveBranchPoint(p, sessionId, roundId, side, eventId);
          const source = point.entry;
          const owner = p.sessions[source.sessionId];
          const at = roundPosition(owner, source.routeId, source.round.id, p, c);
          const bottom = Math.max(
            at.y + recordHeight(source.round),
            ...visibleSessions(p, c.rootSessions, c.hiddenSessions).flatMap((s) => [
              agentPosition(s, p, c).y + 200,
              ...s.routes.flatMap((r) =>
                r.rounds.map(
                  (entry) => roundPosition(s, r.id, entry.id, p, c).y + recordHeight(entry),
                ),
              ),
            ]),
          );
          const next = updateCanvas(w, (board) => ({
            ...board,
            rootSessions: [...new Set([...board.rootSessions, result.agentId])],
            positions: board.positions[result.agentId]
              ? board.positions
              : {
                  ...board.positions,
                  [result.agentId]: {
                    x:
                      at.x +
                      (side === 'after'
                        ? recordWidth(source.round)
                        : side === 'at'
                          ? recordWidth(point.partial!)
                          : 0),
                    y: bottom + 260,
                  },
                },
            historySeq: null,
            selectedSession: result.agentId,
            follow: false,
          }));
          if (composer)
            return { ...next, chatDrafts: { ...next.chatDrafts, [result.agentId]: text } };
          return side === 'before'
            ? {
                ...next,
                chatDrafts: { ...next.chatDrafts, [result.agentId]: source.round.input.task },
              }
            : next;
        });
        commandId.current = null;
      }
      const agentId = branchId.current;
      if (composer) {
        setWorkspace((w) => ({ ...w, chatDrafts: { ...w.chatDrafts, [agentId]: text } }));
        sendId.current ??= newId();
        const sent = await runtime.command({
          version: 1,
          commandId: sendId.current,
          type: 'turn.start',
          agentId,
          text,
        });
        if (sent.status === 'rejected') sendId.current = null;
        if (sent.status !== 'acknowledged')
          throw new Error(sent.error ?? '发送结果待核对；草稿已保留，请核对分支记录。');
        setWorkspace((w) => {
          const drafts = { ...w.chatDrafts };
          delete drafts[draftKey];
          if (drafts[agentId] === text) delete drafts[agentId];
          return { ...w, chatDrafts: drafts };
        });
      }
      focusAgent(agentId);
      openPanel({ kind: 'runtime-agent', sessionId: agentId });
    } catch (failure) {
      setError(String(failure));
    } finally {
      dispatching.current = false;
      setBusy(false);
    }
  };
  return (
    <div className={composer ? 'stack chat-composer fragment-composer' : 'branch-action'}>
      {composer && (
        <>
          <div className="fragment-heading">
            <label htmlFor="fragment-message">另一个想法 · 独立支线</label>
            <button
              className="primary-button"
              disabled={busy || !available || !text.trim()}
              onClick={() => void fork()}
            >
              {busy ? '正在发送…' : '发送并开支线'}
            </button>
          </div>
          <textarea
            id="fragment-message"
            aria-label="片段对话消息"
            placeholder="如果换一种思路呢？写下你想探索的方向…"
            rows={2}
            maxLength={4000}
            value={text}
            disabled={busy || !!sendId.current}
            onChange={(e) => {
              const value = e.target.value;
              setWorkspace((w) => ({ ...w, chatDrafts: { ...w.chatDrafts, [draftKey]: value } }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void fork();
              }
            }}
          />
          <small>继承到此处的公开记录，支线独立探索，不改写原路线。</small>
          {!available && (
            <small>
              {!eventId ? '此片段尚无可用的回传节点。' : '请先连接所属运行时，再发送支线想法。'}
            </small>
          )}
        </>
      )}
      {!composer && (
        <button
          className="branch-button"
          disabled={busy || !available}
          aria-label={label}
          title={
            !eventId
              ? side === 'at'
                ? '等待此节点的标注或工具回传'
                : 'Codex 的完整上下文分叉需要此回复先结束'
              : label
          }
          onClick={() => void fork()}
        >
          <GitBranch size={13} />
          {!compact && (busy ? '创建分支…' : label)}
        </button>
      )}
      {error && (
        <span className="branch-error" role="alert">
          {error}
        </span>
      )}
      {error && branchId.current && (
        <button onClick={() => openPanel({ kind: 'runtime-agent', sessionId: branchId.current! })}>
          查看已创建的分支与派发记录
        </button>
      )}
    </div>
  );
}
