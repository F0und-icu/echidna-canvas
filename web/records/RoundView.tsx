import {
  Braces,
  Check,
  CircleDashed,
  FileText,
  Terminal,
  TriangleAlert,
  Unplug,
} from 'lucide-react';
import { useApp } from '../app/context';
import type { Round, Route, Session, ToolCall } from '../model/projection';
import type { Point } from '../model/schema';
import { referencedCall } from './references';
import { RuntimeRound } from './RuntimeRound';
import { ReplyCard } from './MarkdownReply';

export function callStatus(call: ToolCall, connected: boolean) {
  if (call.status === 'preparing')
    return call.tool === 'codex.commandExecution' ? '等待执行' : '参数接收中';
  if (call.status === 'returned') return call.artifact!;
  if (call.status === 'failed') return '工具失败';
  if (call.status === 'rejected') return '执行被拒绝';
  if (call.status === 'unknown') return '结果待核对';
  if (!connected) return '状态待核对';
  return call.cancelRequested ? '取消待确认' : '执行中';
}
export function roundState(round: Round, connected: boolean) {
  const uncertain =
    round.calls.some((call) => call.status === 'unknown') ||
    (!connected &&
      (!round.complete ||
        round.calls.some((call) => ['preparing', 'running'].includes(call.status))));
  const phase = uncertain
    ? '结果待核对'
    : round.calls.some((call) => call.status === 'preparing')
      ? round.unit === 'turn'
        ? '等待执行'
        : '参数接收中'
      : round.calls.some((call) => call.status === 'running')
        ? '工具执行中'
        : round.calls.some((call) => call.status === 'failed')
          ? '工具失败'
          : round.outcome === 'interrupted'
            ? '回合中断'
            : round.outcome === 'failed'
              ? '回合失败'
              : round.complete
                ? '已结束'
                : round.modelDone
                  ? '输出已结束'
                  : '模型输出';
  return { uncertain, phase };
}
export function RoundView({
  session,
  route,
  round,
  index,
  position,
  current,
  dimmed,
}: {
  session: Session;
  route: Route;
  round: Round;
  index: number;
  position: Point;
  current: boolean;
  dimmed: boolean;
}) {
  const { openPanel, panel } = useApp(),
    decision = round.decisions.at(-1);
  const recordPanel = {
    kind: 'round' as const,
    sessionId: session.id,
    routeId: route.id,
    roundId: round.id,
  };
  const inspect = () => openPanel(recordPanel);
  const { phase, uncertain } = roundState(round, route.connected);
  if (round.unit === 'turn')
    return (
      <RuntimeRound
        round={round}
        sessionName={session.config.name}
        fixture={session.source === 'fixture'}
        phase={phase}
        uncertain={uncertain}
        routeId={route.id}
        index={index}
        position={position}
        current={current}
        dimmed={dimmed}
        selectedId={
          panel?.kind === 'round' &&
          panel.sessionId === session.id &&
          panel.routeId === route.id &&
          panel.roundId === round.id
            ? (panel.nodeId ?? null)
            : null
        }
        inspect={(nodeId) => openPanel({ ...recordPanel, nodeId })}
        statusFor={(call) => callStatus(call, route.connected)}
      />
    );
  return (
    <section
      className={`round-record ${current ? 'current' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ left: position.x, top: position.y }}
      aria-label={`${session.config.name} / ${route.id} / ${round.id}`}
      data-round={`${session.id}/${route.id}/${round.id}`}
    >
      <svg className="round-lines" viewBox="0 0 330 390" aria-hidden="true">
        {round.refs.map((_, i) => (
          <path
            key={i}
            d={`M ${round.refs.length === 1 ? 165 : 78 + i * 174} 76 Q ${round.refs.length === 1 ? 165 : 78 + i * 174} 100 165 108`}
          />
        ))}
        {decision &&
          decision.options.map((option, i) => (
            <path
              key={option.id}
              className={option.selected ? 'chosen' : 'alternative'}
              d={`M 165 176 Q 165 193 ${80 + i * 170} 205`}
            />
          ))}
        {round.calls.map((call, i) => {
          const x = round.calls.length === 1 ? 165 : 80 + i * 170,
            selected = decision ? decision.options.findIndex((option) => option.selected) : 0,
            from = decision ? 80 + selected * 170 : 165;
          return (
            <path
              key={call.id}
              className={call.status === 'returned' ? 'chosen' : ''}
              d={`M ${from} ${decision ? 238 : 178} C ${from} 262 ${x} 260 ${x} 285`}
            />
          );
        })}
      </svg>
      <button className="round-header" onClick={inspect}>
        <span className="round-dot" />
        {round.unit === 'turn' ? '回合' : '采样'} {String(index + 1).padStart(2, '0')} / {phase}
      </button>
      <div className="round-refs">
        {round.refs.map((ref) => {
          const source = referencedCall(route, ref);
          return (
            <button key={ref} title={ref} onClick={inspect}>
              <FileText size={13} />
              <span>
                {source?.call.status === 'returned'
                  ? source.call.artifact
                  : ref.startsWith('delegation/')
                    ? '独立复核回传'
                    : ref}
              </span>
            </button>
          );
        })}
      </div>
      <button className={`round-thought ${round.summary ? '' : 'no-summary'}`} onClick={inspect}>
        <small>{round.summary ? '模型摘要 · 点击展开' : '未提供摘要'}</small>
        <strong>{round.title}</strong>
        <span className="summary-excerpt">{round.summary || '本轮仅展示实际返回的调用与响应'}</span>
      </button>
      {decision && (
        <div className="round-choices">
          {decision.options.map((option) => (
            <button key={option.id} className={option.selected ? 'chosen' : ''} onClick={inspect}>
              {option.selected ? <Check size={13} /> : <CircleDashed size={13} />}
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="round-calls">
        {round.calls.map((call) => {
          const Icon =
            call.status === 'returned'
              ? Check
              : ['failed', 'rejected', 'unknown'].includes(call.status)
                ? TriangleAlert
                : call.status === 'preparing'
                  ? Braces
                  : !route.connected
                    ? Unplug
                    : Terminal;
          return (
            <button
              key={call.id}
              className={`call ${call.status}`}
              aria-label={`${call.title} · ${callStatus(call, route.connected)}`}
              onClick={inspect}
            >
              <span className="call-symbol">
                <Icon size={15} />
              </span>
              <span>{call.title}</span>
              <small>{callStatus(call, route.connected)}</small>
            </button>
          );
        })}
      </div>
      {round.response && (
        <div className={`round-answer ${decision ? 'with-choice' : ''}`}>
          <ReplyCard text={round.response} fixture onInspect={inspect} />
        </div>
      )}
    </section>
  );
}
