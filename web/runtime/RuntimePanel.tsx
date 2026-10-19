import { useState, type FormEvent } from 'react';
import { useApp } from '../app/context';
import { newId, updateCanvas } from '../model/workspace';
import { Character } from '../agents/Character';
import { sessionPose } from '../agents/characterPose';
import { conversationRounds } from '../model/projection';
import { runtimeBackend } from './connection';
import { roundState } from '../records/RoundView';
import { Images, Unplug } from 'lucide-react';
import { BranchButton } from './BranchButton';
import { MarkdownReply } from '../records/MarkdownReply';
import { attachRuntimeAgent } from './placement';
import { HarnessAuth } from './HarnessAuth';

export function RuntimePanel() {
  const { runtime, canvas, setWorkspace, openPanel, workspace, live, focusAgent } = useApp();
  const status = runtime.backend,
    descriptor = status?.backend;
  const attach = (id: string) => {
    setWorkspace((w) => attachRuntimeAgent(w, id));
    focusAgent(id);
    openPanel({ kind: 'runtime-agent', sessionId: id });
  };
  return (
    <div className="stack">
      <p className="fine-print">
        {descriptor ? descriptor.label : '连接你的 Agent 运行时'}
        {descriptor?.mode === 'fixture'
          ? ' · 离线演示，固定示例回复'
          : descriptor
            ? ' · 真实运行时'
            : ''}
      </p>
      {runtime.error && <p role="alert">{runtime.error}</p>}
      <button onClick={() => void runtime.connect()}>
        {runtime.connected ? '重新核对连接' : '连接本地服务'}
      </button>
      <small>
        {runtime.connected ? '已连接 · 记录由本地服务保存' : '尚未连接 · 请先启动本地运行时服务'}
      </small>
      {runtime.connected && (
        <>
          <p className="fine-print">
            {status?.account === 'signed-out'
              ? '运行时尚未登录'
              : status?.account === 'signed-in'
                ? '账户已就绪；模型调用资格以实际回合结果为准'
                : '此模式不需要账户'}
          </p>
          {descriptor?.capabilities.login && <HarnessAuth runtime={runtime} />}
          <button onClick={() => void runtime.refreshBackend()}>刷新账户与模型</button>
          {status?.notices.length ? (
            <details>
              <summary>运行时说明</summary>
              {status.notices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </details>
          ) : null}
        </>
      )}
      <button className="primary-button" onClick={() => openPanel({ kind: 'create' })}>
        创建 Agent
      </button>
      {runtime.state?.agents.map((agent) => (
        <button
          key={agent.id}
          disabled={
            !workspace.events.some(
              (e) => e.sessionId === agent.id && e.data.type === 'session.created',
            )
          }
          onClick={() => attach(agent.id)}
        >
          {agent.id === canvas.selectedSession ? '● ' : ''}
          {live.sessions[agent.id] ? live.sessions[agent.id].config.name : '创建结果待核对'} ·{' '}
          {agent.state === 'unknown'
            ? '状态待核对'
            : agent.state === 'running'
              ? '回合进行中'
              : '空闲'}
        </button>
      ))}
      <details>
        <summary>命令派发记录</summary>
        {runtime.state?.commands.map((command) => (
          <section className="detail-section" key={command.commandId}>
            <small>
              {command.type} · {command.status}
            </small>
            <pre>{JSON.stringify(command, null, 2)}</pre>
          </section>
        ))}
      </details>
    </div>
  );
}

export function RuntimeAgent({ sessionId }: { sessionId: string }) {
  const { runtime, view, workspace, openPanel, canvas, setWorkspace } = useApp();
  const session = view.sessions[sessionId],
    text = workspace.chatDrafts?.[sessionId] ?? '';
  const [scenario, setScenario] = useState<
    'success' | 'tool-failure' | 'disconnect' | 'dispatch-unknown'
  >('success');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [mode, setMode] = useState<'continue' | 'branch'>('continue');
  const [branchPoint, setBranchPoint] = useState<{
    roundId: string;
    side: 'at' | 'after' | 'before';
    eventId?: string;
  } | null>(null);
  const sameBackend =
    session?.runtime && runtime.state?.backend.id === runtimeBackend(session.runtime);
  const agent = sameBackend ? runtime.state?.agents.find((a) => a.id === sessionId) : undefined;
  const fixture = session?.source === 'fixture';
  const route = session?.routes[0];
  const rounds = route?.rounds ?? [],
    round = rounds.at(-1);
  const transcript = session ? conversationRounds(view, sessionId) : [];
  const state = round ? roundState(round, route!.connected) : null;
  const runtimeNotice = round?.assessments.filter((entry) => entry.source === '运行时错误').at(-1);
  const history = canvas.historySeq !== null;
  const checkpoint =
    round &&
    view.events.findLast(
      (event) =>
        event.sessionId === sessionId &&
        'roundId' in event.data &&
        event.data.roundId === round.id &&
        ['canvas.noted', 'tool.finished', 'tool.failed'].includes(event.data.type),
    );
  const canSend =
    !busy &&
    !history &&
    runtime.connected &&
    runtime.state?.backend.capabilities.chat &&
    agent?.state === 'idle' &&
    Boolean(text.trim());
  const setDraft = (value: string) =>
    setWorkspace((w) => ({ ...w, chatDrafts: { ...w.chatDrafts, [sessionId]: value } }));
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    const sent = text;
    setBusy(true);
    setError('');
    try {
      const result = await runtime.command({
        version: 1,
        commandId: newId(),
        type: 'turn.start',
        agentId: sessionId,
        text: sent,
        ...(fixture ? { scenario } : {}),
      });
      if (result.status === 'acknowledged')
        setWorkspace((w) => {
          if ((w.chatDrafts?.[sessionId] ?? '') !== sent) return w;
          const drafts = { ...w.chatDrafts };
          delete drafts[sessionId];
          return { ...w, chatDrafts: drafts };
        });
      else setError(result.error ?? '发送结果待核对；草稿已保留。');
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const interrupt = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await runtime.command({
        version: 1,
        commandId: newId(),
        type: 'turn.interrupt',
        agentId: sessionId,
        turnId: agent!.turnId!,
      });
      if (result.status !== 'acknowledged') setError(result.error ?? '中断请求结果待核对');
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  if (!session) return <p>这个 Agent 尚未出现在当前历史前缀中。</p>;
  return (
    <div className="stack runtime-chat">
      <div className="runtime-chat-header">
        <Character
          avatar={session.config.avatar}
          pose={sessionPose(session, view.events)}
          height={64}
        />
        <div>
          <strong>{session.config.name}</strong>
          <small>{session.config.model}</small>
          <small>
            {fixture
              ? '离线演示 · 固定示例回复'
              : sameBackend
                ? runtime.state?.backend.label
                : '所属运行时尚未连接'}
          </small>
        </div>
      </div>
      <div className="runtime-chat-modes" role="group" aria-label="对话方向">
        <button aria-pressed={mode === 'continue'} onClick={() => setMode('continue')}>
          继续／纠正当前任务
        </button>
        <button
          aria-pressed={mode === 'branch'}
          disabled={!round}
          onClick={() => {
            setBranchPoint({
              roundId: round!.id,
              side: checkpoint ? 'at' : round!.terminalEventId ? 'after' : 'before',
              eventId: checkpoint?.id ?? round!.terminalEventId ?? round!.inputEventId,
            });
            setMode('branch');
          }}
        >
          开一个不同想法的支线
        </button>
      </div>
      {mode === 'branch' && branchPoint && (
        <div className="runtime-branch-composer">
          <BranchButton
            key={`${sessionId}/${branchPoint.eventId}`}
            sessionId={sessionId}
            roundId={branchPoint.roundId}
            side={branchPoint.side}
            eventId={branchPoint.eventId}
            composer
          />
        </div>
      )}
      {history && (
        <p className="fine-print">
          历史快照 · 不派发新输入{' '}
          <button
            onClick={() =>
              setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, historySeq: null })))
            }
          >
            返回当前会话
          </button>
        </p>
      )}
      {(error || runtime.error) && <p role="alert">{error || runtime.error}</p>}
      {session.branch && (
        <p className="branch-origin">
          上下文分支 ·{' '}
          {session.branch.side === 'at'
            ? '截至所选片段的公开记录快照'
            : session.branch.side === 'before'
              ? '从消息发送前'
              : '从回复结束后'}
          <button
            onClick={() => openPanel({ kind: 'runtime-agent', sessionId: session.branch!.agentId })}
          >
            查看来源对话
          </button>
        </p>
      )}
      {state?.uncertain && (
        <section className="runtime-connection-fault" role="alert">
          <Unplug size={17} />
          <div>
            <strong>{route!.connected ? '运行结果待核对' : '运行时连接中断'}</strong>
            <p>已有回复和调用记录已保留；执行结果待核对，没有重新派发。</p>
            {route!.connectionError && (
              <details>
                <summary>中断原因</summary>
                <p>{route!.connectionError}</p>
              </details>
            )}
            <button onClick={() => openPanel({ kind: 'runtime' })}>查看连接与记录</button>
          </div>
        </section>
      )}
      {runtimeNotice &&
        !round!.complete &&
        !state!.uncertain &&
        runtimeNotice.seq === round!.lastSeq && (
          <p className="fine-print" role="status">
            {runtimeNotice.text}
          </p>
        )}
      {!runtime.connected && (
        <button onClick={() => void runtime.connect()}>连接本地服务，补齐记录</button>
      )}
      <div
        className="chat-transcript"
        role="log"
        aria-label="对话记录"
        aria-live={history ? 'off' : 'polite'}
      >
        {!transcript.length && <p className="chat-empty">从一句话开始。</p>}
        {transcript.map(({ sessionId: ownerId, routeId, round: entry }, index) => (
          <article
            className={`chat-turn ${ownerId !== sessionId ? 'inherited-turn' : ''}`}
            key={entry.id}
          >
            {ownerId !== sessionId && index === 0 && (
              <small className="context-divider">继承的对话上下文</small>
            )}
            {ownerId === sessionId &&
              index > 0 &&
              transcript[index - 1].sessionId !== sessionId && (
                <small className="context-divider">本分支的新对话</small>
              )}
            <div className="chat-message user">
              <div className="chat-message-heading">
                <small>你</small>
                <BranchButton
                  key={`${sessionId}/${entry.inputEventId}/before`}
                  sessionId={sessionId}
                  roundId={entry.id}
                  side="before"
                  eventId={entry.inputEventId}
                  compact
                />
              </div>
              <p>{entry.input.task}</p>
            </div>
            {entry.response ? (
              <div className="chat-message assistant">
                <div className="chat-message-heading">
                  <small>
                    {fixture ? '示例回复' : session.config.name}
                    {!entry.complete &&
                      roundState(
                        entry,
                        view.sessions[ownerId].routes.find((r) => r.id === routeId)!.connected,
                      ).uncertain &&
                      ' · 回复未完成'}
                  </small>
                  <BranchButton
                    key={`${sessionId}/${entry.inputEventId}/after`}
                    sessionId={sessionId}
                    roundId={entry.id}
                    side="after"
                    eventId={entry.terminalEventId}
                    compact
                  />
                </div>
                <MarkdownReply text={entry.response} />
              </div>
            ) : (
              <p className="fine-print">
                {entry.outcome === 'interrupted'
                  ? '本回合已中断'
                  : entry.outcome === 'failed'
                    ? '本回合失败'
                    : roundState(entry, route!.connected).uncertain
                      ? '连接中断，回复未完成'
                      : entry.complete
                        ? '本回合未返回文本回复'
                        : '等待回复…'}
              </p>
            )}
            {entry.calls.some((call) => call.previews?.length) && (
              <button
                className="chat-media-entry"
                onClick={() =>
                  openPanel({
                    kind: 'round',
                    sessionId: ownerId,
                    routeId,
                    roundId: entry.id,
                    nodeId: 'media',
                  })
                }
              >
                <Images size={14} /> 图片与网页 ·{' '}
                {entry.calls.reduce((count, call) => count + (call.previews?.length ?? 0), 0)}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="fine-print">
        {history
          ? '查看历史'
          : round?.outcome === 'interrupted' && agent?.state === 'idle'
            ? state?.uncertain
              ? '回合已中断；工具结果待核对。可发送新的纠正，不重放旧命令。'
              : '回合已中断，可以发送纠正。'
            : agent?.state === 'unknown' || state?.uncertain
              ? '状态待核对；不能重新派发已有命令。'
              : agent?.state === 'running'
                ? round?.interruptRequested
                  ? '中断待确认'
                  : '正在响应'
                : agent
                  ? '可以继续对话'
                  : '连接后核对运行状态'}
      </p>
      {mode === 'continue' && (
        <form className="stack chat-composer" onSubmit={(e) => void send(e)}>
          <div className="chat-send-row">
            <small>
              {agent?.state === 'running'
                ? '可先填写纠正，打断确认后发送'
                : 'Enter 发送 · Shift + Enter 换行'}
            </small>
            <button className="primary-button" type="submit" disabled={!canSend}>
              发送
            </button>
          </div>
          <textarea
            aria-label="对话消息"
            placeholder={
              agent?.state === 'running' ? '写下纠正内容，再打断当前任务…' : '继续对话或纠正方向…'
            }
            rows={3}
            maxLength={4000}
            disabled={history}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form!.requestSubmit();
              }
            }}
          />
        </form>
      )}
      {fixture && (
        <small>消息按原文保存；示例回复不会理解输入。真实回答需要连接运行时并登录。</small>
      )}
      <div className="inline-actions runtime-actions">
        <button
          disabled={
            busy ||
            history ||
            !runtime.connected ||
            !runtime.state?.backend.capabilities.interrupt ||
            agent?.state !== 'running' ||
            !agent.turnId ||
            round?.interruptRequested
          }
          onClick={() => void interrupt()}
        >
          {round?.interruptRequested && agent?.state === 'running' ? '打断待确认' : '打断当前任务'}
        </button>
        {round && (
          <button
            onClick={() =>
              openPanel({ kind: 'round', sessionId, routeId: 'r1', roundId: round.id })
            }
          >
            查看最近回合
          </button>
        )}
      </div>
      <details>
        <summary>任务与运行设置</summary>
        <p>{session.routes[0].task}</p>
        <p>{session.config.personality}</p>
        {session.config.harnessSettings && (
          <dl className="runtime-settings">
            {Object.entries(session.config.harnessSettings).map(([key, value]) => (
              <div key={key}>
                <dt>{key === 'reasoningEffort' ? '思考强度' : '内置人格'}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <button onClick={() => setDraft(session.routes[0].task)}>将任务填入输入框</button>
        {fixture && (
          <label>
            协议场景
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as typeof scenario)}
            >
              <option value="success">正常回传</option>
              <option value="tool-failure">命令执行失败</option>
              <option value="disconnect">执行中断线</option>
              <option value="dispatch-unknown">派发后确认丢失</option>
            </select>
          </label>
        )}
        <p className="fine-print">
          纠正在当前会话追加输入；不同想法创建独立支线。已有工具副作用不会回滚；跨进程恢复尚未接入。
        </p>
      </details>
      <details>
        <summary>来源与快照</summary>
        <pre>
          {JSON.stringify({ runtimeSession: agent?.sessionRef, source: session.runtime }, null, 2)}
        </pre>
      </details>
      <button className="text-button" onClick={() => openPanel({ kind: 'runtime' })}>
        连接与派发记录
      </button>
    </div>
  );
}
