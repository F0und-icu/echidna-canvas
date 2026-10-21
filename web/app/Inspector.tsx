import { lazy, Suspense, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import { AgentSettings } from '../agents/AgentSettings';
import { Dialogue } from '../dialogue/Dialogue';
import { activeRoute, visibleSessions, reportedSessionUsage } from '../model/projection';
import {
  appendEvent,
  deliveryBlock,
  editDrafts,
  newId,
  receiveNext,
  removeDrafts,
  updateCanvas,
} from '../model/workspace';
import { RoundDetails } from '../records/RoundDetails';
import { Appearance } from '../settings/Appearance';
import { useApp } from './context';
import { RuntimePanel, RuntimeAgent } from '../runtime/RuntimePanel';
import { useOutsideDismiss } from './useOutsideDismiss';
import { McpPanel, McpBinding } from '../runtime/McpPanel';
import { CanvasContents } from './CanvasContents';
import { CanvasTrash } from './CanvasTrash';
import type { RemovalTarget } from '../model/deletion';

const ProjectFiles = lazy(() =>
  import('../files/ProjectFiles').then((module) => ({ default: module.ProjectFiles })),
);

export function Inspector() {
  const { panel, openPanel, view, canvas, requestRemoval } = useApp();
  const inspector = useRef<HTMLElement>(null);
  useOutsideDismiss(!!panel && panel.kind !== 'files', [inspector], () => openPanel(null));
  if (!panel) return null;
  if (panel.kind === 'files')
    return (
      <Suspense
        fallback={
          <div className="files-loading" role="status">
            正在打开项目档案…
          </div>
        }
      >
        <ProjectFiles
          key={`${panel.root}/${panel.path}/${panel.revisionId}`}
          initialRoot={panel.root}
          initialPath={panel.path}
          initialRevision={panel.revisionId}
          onClose={() => openPanel(null)}
        />
      </Suspense>
    );
  let title: string, content: ReactNode;
  switch (panel.kind) {
    case 'trash':
      title = '回收站 · 临时目录';
      content = <CanvasTrash />;
      break;
    case 'contents':
      title = '管理画布内容';
      content = <CanvasContents />;
      break;
    case 'mcp':
      title = '接入与 MCP';
      content = <McpPanel key={panel.id ?? 'new'} id={panel.id} />;
      break;
    case 'mcp-bind':
      title = '连接 MCP';
      content = (
        <McpBinding
          key={panel.connectionId + '/' + panel.agentId}
          connectionId={panel.connectionId}
          agentId={panel.agentId}
        />
      );
      break;
    case 'create':
      title = '创建 Agent';
      content = <AgentSettings point={panel.point} />;
      break;
    case 'agent':
      title = '任务与角色';
      content = view.sessions[panel.sessionId]?.runtime ? (
        <RuntimeAgent key={panel.sessionId} sessionId={panel.sessionId} />
      ) : (
        <AgentSettings key={panel.sessionId} sessionId={panel.sessionId} />
      );
      break;
    case 'chat':
      title = `与 ${view.sessions[panel.source.sessionId].config.name} 对话`;
      content = view.sessions[panel.source.sessionId]?.runtime ? (
        <RuntimeAgent key={panel.source.sessionId} sessionId={panel.source.sessionId} />
      ) : (
        <Dialogue
          key={`${panel.source.sessionId}/${panel.source.routeId}/${panel.source.roundId}/${panel.source.eventSeq}`}
          source={panel.source}
        />
      );
      break;
    case 'runtime':
      title = 'Agent 连接';
      content = <RuntimePanel />;
      break;
    case 'runtime-agent':
      title = 'Agent 对话';
      content = <RuntimeAgent key={panel.sessionId} sessionId={panel.sessionId} />;
      break;
    case 'round':
      title = panel.nodeId === 'media' ? '图片与网页' : panel.nodeId ? '节点详情' : '本轮记录';
      content = (
        <RoundDetails
          sessionId={panel.sessionId}
          routeId={panel.routeId}
          roundId={panel.roundId}
          nodeId={panel.nodeId}
        />
      );
      break;
    case 'draft':
      title = '手工草稿';
      content = <DraftEditor key={panel.id} id={panel.id} />;
      break;
    case 'appearance':
      title = '主题与外观';
      content = <Appearance />;
      break;
    case 'execution':
      title = '运行与恢复';
      content = <Execution />;
      break;
    case 'budget':
      title = '任务、能力与预算';
      content = <Budget />;
      break;
    case 'events':
      title = '原始演示事件';
      content = <Events />;
      break;
    case 'relations':
      title = '连线与来源';
      content = <Relations />;
      break;
    case 'link':
      title = '临时协作';
      content = <LinkForm key={`${panel.from}/${panel.to}`} from={panel.from} to={panel.to} />;
      break;
    case 'handoffs':
      title = '交接记录';
      content = <Handoffs />;
      break;
    case 'handoff':
      title = '委派与采纳';
      content = <Handoff id={panel.id} />;
      break;
  }
  const removable: RemovalTarget | null =
    panel.kind === 'agent' || panel.kind === 'runtime-agent'
      ? { kind: 'agent', id: panel.sessionId }
      : panel.kind === 'chat'
        ? { kind: 'agent', id: panel.source.sessionId }
        : panel.kind === 'mcp' && panel.id && canvas.connectionIds?.includes(panel.id)
          ? { kind: 'mcp', id: panel.id }
          : null;
  return (
    <aside
      ref={inspector}
      className="inspector"
      data-panel={panel.kind}
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="inspector-heading">
        <h2>{title}</h2>
        {removable && (
          <button
            className="icon-button"
            aria-label="从当前画布移除"
            title="从当前画布移除"
            onClick={() => requestRemoval(removable)}
          >
            <Trash2 size={16} />
          </button>
        )}
        <button className="icon-button" aria-label="关闭详情" onClick={() => openPanel(null)}>
          <X size={17} />
        </button>
      </div>
      <div
        className="inspector-body"
        key={
          panel.kind === 'round'
            ? `${panel.sessionId}/${panel.routeId}/${panel.roundId}/${panel.nodeId ?? ''}`
            : panel.kind
        }
      >
        {content}
      </div>
    </aside>
  );
}
function SelectAgent() {
  const { canvas, view, setWorkspace } = useApp();
  return (
    <div className="stack">
      <p>选择要查看的 Agent。</p>
      {visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions).map((session) => (
        <button
          key={session.id}
          onClick={() =>
            setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, selectedSession: session.id })))
          }
        >
          {session.config.name}
        </button>
      ))}
    </div>
  );
}
function Execution() {
  const { workspace, canvas, live, setWorkspace } = useApp(),
    session = canvas.selectedSession ? live.sessions[canvas.selectedSession] : undefined;
  const route = session?.routes.at(-1);
  if (!session || !route) return <SelectAgent />;
  if (session.runtime) return <RuntimeAgent key={session.id} sessionId={session.id} />;
  const dispatch = (data: Parameters<typeof appendEvent>[3]) =>
    setWorkspace((w) => appendEvent(w, session.id, route.id, data));
  return (
    <div className="stack">
      <p className="fine-print">
        {session.config.name} · {route.connected ? '事件连接正常' : '连接断开 · 运行结果待核对'}
      </p>
      <button
        onClick={() => dispatch({ type: route.paused ? 'operator.resumed' : 'operator.paused' })}
      >
        {route.paused ? '恢复后续采样' : '暂停后续采样'}
      </button>
      <small>暂停只阻止新的模型轮次，已有工具仍可回传。</small>
      {route.rounds.flatMap((round) =>
        round.calls
          .filter((call) => call.status === 'running')
          .map((call) => (
            <button
              key={`${round.id}/${call.id}`}
              disabled={call.cancelRequested}
              onClick={() =>
                dispatch({ type: 'tool.cancel.requested', roundId: round.id, callId: call.id })
              }
            >
              {call.cancelRequested ? '取消待确认' : `请求取消：${call.title}`}
            </button>
          )),
      )}
      <button
        onClick={() =>
          dispatch({ type: route.connected ? 'connection.lost' : 'connection.restored' })
        }
      >
        {route.connected ? '演示连接中断' : '恢复事件连接'}
      </button>
      <small>恢复只补齐后续演示记录，不重发已有命令。真实进程恢复尚未接入。</small>
      {Object.values(workspace.replays)
        .filter((plan) => plan.ownerId === session.id && plan.routeId !== route.id)
        .map((plan) => (
          <section className="detail-section" key={plan.id}>
            <small>旧路线 {plan.routeId.toUpperCase()} · 原记录保留</small>
            <button
              disabled={!!deliveryBlock(workspace, plan.id, live)}
              onClick={() => setWorkspace((w) => receiveNext(w, plan.id))}
            >
              继续接收旧路线 {plan.routeId.toUpperCase()}
            </button>
            <p className="fine-print">
              {deliveryBlock(workspace, plan.id, live) ?? '可以继续接收已经开始的响应与工具结果。'}
            </p>
          </section>
        ))}
      <details>
        <summary>回放与运行状态</summary>
        <p>暂停回放只停止浏览器计时器；暂停后续采样、取消请求和连接状态属于独立的演示事件。</p>
        <p>当前 {workspace.events.filter((e) => e.sessionId === session.id).length} 条会话记录。</p>
      </details>
    </div>
  );
}
function Budget() {
  const { canvas, view } = useApp(),
    session = canvas.selectedSession ? view.sessions[canvas.selectedSession] : undefined;
  if (!session) return <SelectAgent />;
  const route = session.routes.at(-1),
    sessions = visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions),
    usages = sessions.flatMap((s) => {
      const usage = reportedSessionUsage(s);
      return usage ? [usage] : [];
    });
  const rows = [
    ['任务', route?.task ?? '尚未绑定任务'],
    ['模型配置', session.config.model],
    ['材料快照', route?.materials.join(' · ') ?? '尚未提供'],
    [
      '能力来源',
      session.source === 'runtime'
        ? '运行时实际返回'
        : session.runtime
          ? '离线协议夹具'
          : '离线夹具 offline-v1',
    ],
    [
      'Provider 回传用量',
      usages.length
        ? `${usages.reduce((n, u) => n + u.input, 0)} 输入 / ${usages.reduce((n, u) => n + u.output, 0)} 输出 tokens${sessions.every((s) => s.source !== 'runtime') ? '（演示）' : ''}`
        : '未提供',
    ],
    ['实际费用', '未提供'],
    ['当前子会话', String(sessions.filter((s) => s.parentId).length)],
    ['准入与账户额度', '真实编排尚未接入'],
  ];
  return (
    <>
      {rows.map(([label, value]) => (
        <section className="detail-section" key={label}>
          <small>{label}</small>
          <p>{value}</p>
        </section>
      ))}
      <p className="fine-print">外观、工作偏好与模型能力独立。用量不等于额度或实际费用。</p>
    </>
  );
}
function Events() {
  const { workspace, canvas } = useApp();
  return (
    <>
      {workspace.events.slice(0, canvas.historySeq ?? workspace.events.length).map((event) => (
        <details className="event-record" key={event.id}>
          <summary>
            #{event.seq} · {event.data.type}
            <small>
              {event.sessionId} / {event.routeId}
            </small>
          </summary>
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </details>
      ))}
    </>
  );
}
function Relations() {
  return (
    <>
      {[
        ['sequence', '响应先后', '只表示接收顺序，不自动声称因果。'],
        ['evidence', '依据引用', '材料进入哪一次模型调用。'],
        ['feedback', '反馈回传', '已收到的工具结果进入后续采样。'],
        ['delegation', '任务派发', '任务、材料、完成条件和结果接收者。'],
        ['correction', '路线纠正', '采用用户补充后追加路线，旧记录保留。'],
      ].map(([kind, title, text]) => (
        <section key={kind} className="detail-section">
          <span className={`line-sample ${kind}`} />
          {title}
          <p>{text}</p>
        </section>
      ))}
      <small>手工线是草稿关系，不能当作执行或共享上下文的证据。</small>
    </>
  );
}
function LinkForm({ from, to }: { from: string; to: string }) {
  const { view, setWorkspace, openPanel } = useApp(),
    [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const source = view.sessions[from],
    target = view.sessions[to],
    route = activeRoute(source);
  if (source.runtime || target.runtime)
    return <p>当前运行时接入尚未派发跨 Agent 协作。可以继续绘制草稿关系。</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) {
      setError('请填写具体的协作问题。');
      return;
    }
    const linkId = newId();
    setWorkspace((w) =>
      appendEvent(w, from, route.id, {
        type: 'collaboration.requested',
        linkId,
        targetId: to,
        question: question.trim(),
        materials: route.materials,
      }),
    );
    openPanel({ kind: 'handoffs' });
  };
  return (
    <form className="stack" onSubmit={submit}>
      {error && <p role="alert">{error}</p>}
      <p>
        {source.config.name} → {target.config.name}
      </p>
      <label>
        希望对方协助的问题
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <small>随附材料：{route.materials.join(' · ')}</small>
      <button className="primary-button">创建协作请求</button>
      <p className="fine-print">离线请求只记录意图，不自动复制上下文或假装对方已接收。</p>
    </form>
  );
}
function Handoffs() {
  const { canvas, view, openPanel } = useApp(),
    sessions = visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions),
    ids = new Set(sessions.map((s) => s.id));
  const links = Object.values(view.delegations).filter(
      (d) => ids.has(d.parentId) && ids.has(d.childId),
    ),
    collaborations = view.collaborations.filter((d) => ids.has(d.from) && ids.has(d.to));
  const names = {
    sent: '待接收',
    working: '工作中',
    returned: '已回传，待采纳',
    adopted: '已采纳有限范围',
  };
  return (
    <div className="stack">
      {!links.length && !collaborations.length && <p>当前视图尚无交接记录。</p>}
      {links.map((link) => (
        <button key={link.id} onClick={() => openPanel({ kind: 'handoff', id: link.id })}>
          {view.sessions[link.parentId].config.name} → {view.sessions[link.childId].config.name} ·{' '}
          {names[link.status]}
        </button>
      ))}
      {collaborations.map((link) => (
        <section key={link.id} className="detail-section">
          <p>
            {view.sessions[link.from].config.name} → {view.sessions[link.to].config.name} ·
            请求已记录
          </p>
          <p>{link.question}</p>
          <small>尚无接收或执行回传。</small>
        </section>
      ))}
    </div>
  );
}
function Handoff({ id }: { id: string }) {
  const { view, setWorkspace, openPanel, focusAgent, workspace } = useApp(),
    link = view.delegations[id];
  if (!link) return <p>这份交接尚未出现在当前历史前缀中。</p>;
  const child = view.sessions[link.childId];
  return (
    <div className="stack">
      <p>{link.task}</p>
      <section className="detail-section">
        <small>随附材料</small>
        <p>{link.materials.join(' · ')}</p>
        <small>完成条件</small>
        <p>{link.criterion}</p>
      </section>
      <p>{link.result ?? '尚无子 Agent 回传。'}</p>
      {link.scope && (
        <section className="adoption-scope">
          <small>采纳范围 · {view.sessions[link.actor!].config.name}</small>
          <p>{link.scope}</p>
        </section>
      )}
      {child?.routes.length > 0 && (
        <button
          onClick={() => {
            setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, selectedSession: child.id })));
            focusAgent(child.id, true);
            const route = activeRoute(child),
              round = route.rounds.at(-1);
            openPanel(
              round
                ? { kind: 'round', sessionId: child.id, routeId: route.id, roundId: round.id }
                : {
                    kind: 'chat',
                    source: {
                      sessionId: child.id,
                      routeId: route.id,
                      roundId: null,
                      eventSeq: workspace.events.length,
                    },
                  },
            );
          }}
        >
          查看子 Agent 记录
        </button>
      )}
    </div>
  );
}
function DraftEditor({ id }: { id: string }) {
  const { canvas, setWorkspace, openPanel } = useApp(),
    draft = canvas.drafts.find((d) => d.id === id);
  const [title, setTitle] = useState(draft?.title ?? '');
  if (!draft) return <p>这份草稿已删除；执行记录保持不变。</p>;
  return (
    <div className="stack">
      <label>
        草稿内容
        <textarea rows={4} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button
        className="primary-button"
        onClick={() =>
          setWorkspace((w) =>
            editDrafts(
              w,
              canvas.drafts.map((d) => (d.id === id ? { ...d, title } : d)),
            ),
          )
        }
      >
        保存草稿
      </button>
      <button
        onClick={() => {
          const copy = { ...structuredClone(draft), id: newId(), x: draft.x + 24, y: draft.y + 24 };
          setWorkspace((w) => editDrafts(w, [...canvas.drafts, copy]));
          openPanel({ kind: 'draft', id: copy.id });
        }}
      >
        复制草稿
      </button>
      <button
        onClick={() => {
          setWorkspace((w) => removeDrafts(w, [id]));
          openPanel(null);
        }}
      >
        删除草稿
      </button>
      <p className="fine-print">手工草稿不作为 Agent 的执行事实。</p>
    </div>
  );
}
