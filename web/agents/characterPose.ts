import type { Pose } from './Character';
import type { Round, Route, Session } from '../model/projection';
import type { RecordedEvent } from '../model/schema';
import type { Panel } from '../app/context';
import { roundState } from '../records/RoundView';

export function executionPose(
  sessionId: string,
  round: Round | undefined,
  route: Route | undefined,
  events: readonly RecordedEvent[],
): Pose {
  if (!round || !route) return 'idle';
  if (
    roundState(round, route.connected).uncertain ||
    route.paused ||
    (round.interruptRequested && !round.complete)
  )
    return 'waiting';
  if (round.complete)
    return round.outcome === 'interrupted' || round.outcome === 'failed' ? 'waiting' : 'reporting';
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index],
      data = event.data;
    if (
      event.sessionId !== sessionId ||
      event.seq > round.lastSeq ||
      !('roundId' in data) ||
      data.roundId !== round.id
    )
      continue;
    switch (data.type) {
      case 'canvas.noted':
        return data.note.kind === 'decision'
          ? 'pointing'
          : data.note.kind === 'material' || data.note.kind === 'observation'
            ? 'reading'
            : data.note.kind === 'result'
              ? 'reporting'
              : 'thinking';
      case 'decision.recorded':
        return 'pointing';
      case 'tool.prepared':
      case 'tool.arguments.delta':
      case 'tool.failed':
      case 'tool.rejected':
      case 'tool.unknown':
        return 'waiting';
      case 'tool.started':
      case 'tool.output.updated':
        return 'working';
      case 'tool.finished':
        return 'reading';
      case 'response.delta':
      case 'response.updated':
        if (data.text.trim()) return 'talking';
        break;
      case 'summary.delta':
      case 'summary.updated':
        if (data.text.trim()) return 'thinking';
        break;
      case 'round.started':
        return 'thinking';
    }
  }
  return 'thinking';
}

export function sessionPose(
  session: Session,
  events: readonly RecordedEvent[],
  panel?: Panel | null,
): Pose {
  const route = session.routes.at(-1),
    round = route?.rounds.at(-1);
  const executing = executionPose(session.id, round, route, events);
  if (executing === 'waiting') return executing;
  if (panel?.kind === 'round' && panel.sessionId === session.id) {
    const inspected = session.routes
      .find((entry) => entry.id === panel.routeId)
      ?.rounds.find((entry) => entry.id === panel.roundId);
    const note = inspected?.notes.find((entry) => 'note:' + entry.id === panel.nodeId);
    if (note) return note.note.kind === 'decision' ? 'pointing' : 'reading';
    const call = inspected?.calls.find((entry) => 'tool:' + entry.id === panel.nodeId);
    if (call)
      return call.status === 'returned'
        ? 'reading'
        : call.status === 'running'
          ? 'working'
          : 'waiting';
    if (panel.nodeId === 'answer') return inspected?.complete ? 'reporting' : 'talking';
    if (panel.nodeId === 'input') return 'talking';
  }
  return executing;
}
