import type {
  AgentConfig,
  EventData,
  RecordedEvent,
  Source,
  ToolPreview,
  BranchOrigin,
} from './schema';
import { CanvasNoteRejected, type CanvasNote } from '../../contracts/canvas.ts';
import type { McpRef } from '../../contracts/mcp.ts';

export interface ToolCall {
  firstSeq: number;
  id: string;
  title: string;
  tool: string;
  argumentText: string;
  args: Record<string, unknown>;
  status: 'preparing' | 'running' | 'returned' | 'failed' | 'rejected' | 'unknown';
  cancelRequested: boolean;
  result?: string;
  artifact?: string;
  receipt?: string;
  error?: string;
  previews?: (ToolPreview & { eventId: string; seq: number; part: number })[];
}
export interface Round {
  id: string;
  inputEventId: string;
  terminalEventId?: string;
  title: string;
  refs: string[];
  input: Extract<EventData, { type: 'round.started' }>['input'];
  summary: string;
  response: string;
  responsePreview?: string;
  calls: ToolCall[];
  decisions: (Extract<EventData, { type: 'decision.recorded' }> & { seq: number })[];
  assessments: { text: string; source: string; seq: number }[];
  notes: { id: string; seq: number; note: CanvasNote }[];
  responseSeq?: number;
  modelDone: boolean;
  complete: boolean;
  firstSeq: number;
  lastSeq: number;
  usage?: { input: number; output: number; scope?: 'thread-total'; seq: number };
  unit?: 'turn';
  outcome?: 'completed' | 'failed' | 'interrupted';
  error?: string | null;
  interruptRequested?: boolean;
}
export interface Route {
  id: string;
  task: string;
  materials: string[];
  origin: Source | null;
  originKind: RecordedEvent['source'] | null;
  rounds: Round[];
  paused: boolean;
  connected: boolean;
  connectionError?: string;
}
export interface Session {
  id: string;
  config: AgentConfig;
  parentId: string | null;
  projectRoot?: string;
  connections?: McpRef[];
  routes: Route[];
  runtime?: RecordedEvent['runtime'];
  source: RecordedEvent['source'];
  branch?: BranchOrigin;
}
export interface Delegation {
  id: string;
  createdSeq: number;
  parentId: string;
  routeId: string;
  roundId: string;
  childId: string;
  task: string;
  materials: string[];
  criterion: string;
  status: 'sent' | 'working' | 'returned' | 'adopted';
  result?: string;
  artifact?: string;
  scope?: string;
  actor?: string;
}
export interface Collaboration {
  id: string;
  from: string;
  to: string;
  question: string;
  materials: string[];
}
export interface Projection {
  events: readonly RecordedEvent[];
  sessions: Record<string, Session>;
  delegations: Record<string, Delegation>;
  collaborations: Collaboration[];
}

export function project(events: readonly RecordedEvent[], through = events.length): Projection {
  const responseItems = new Map<Round, { id: string; prefix: number }>();
  const state: Projection = {
    events: events.slice(0, through),
    sessions: {},
    delegations: {},
    collaborations: [],
  };
  for (const e of events.slice(0, through)) {
    const d = e.data;
    if (d.type === 'session.created') {
      if (d.branch) {
        const point = resolveBranchPoint(
          state,
          d.branch.agentId,
          d.branch.roundId,
          d.branch.side,
          d.branch.eventId,
        );
        if (point.origin.throughTurnId !== d.branch.throughTurnId)
          throw new Error('Branch context boundary does not match its source');
      }
      if (state.sessions[e.sessionId]) throw new Error(`Duplicate session: ${e.sessionId}`);
      state.sessions[e.sessionId] = {
        id: e.sessionId,
        config: { ...d.config },
        parentId: d.parentId,
        ...(d.projectRoot ? { projectRoot: d.projectRoot } : {}),
        ...(d.connections ? { connections: structuredClone(d.connections) } : {}),
        routes: [],
        runtime: e.runtime,
        source: e.source,
        ...(d.branch ? { branch: structuredClone(d.branch) } : {}),
      };
      continue;
    }
    const session = state.sessions[e.sessionId];
    if (!session) throw new Error(`Event ${e.id} references missing session ${e.sessionId}`);
    if (d.type === 'session.configured') {
      session.config = { ...d.config };
      continue;
    }
    if (d.type === 'session.mcp.configured') {
      session.connections = structuredClone(d.connections);
      session.config = { ...session.config, model: d.model };
      session.runtime = e.runtime;
      continue;
    }
    if (d.type === 'route.started') {
      if (session.routes.some((route) => route.id === e.routeId))
        throw new Error(`Duplicate route: ${e.routeId}`);
      session.routes.push({
        id: e.routeId,
        task: d.task,
        materials: [...d.materials],
        origin: d.origin,
        originKind: d.origin ? e.source : null,
        rounds: [],
        paused: false,
        connected: true,
      });
      continue;
    }
    const route = session.routes.find((route) => route.id === e.routeId);
    if (!route) throw new Error(`Event ${e.id} references missing route ${e.routeId}`);
    switch (d.type) {
      case 'operator.paused':
        route.paused = true;
        continue;
      case 'operator.resumed':
        route.paused = false;
        continue;
      case 'connection.lost':
        route.connected = false;
        route.connectionError = d.reason;
        continue;
      case 'connection.restored':
        route.connected = true;
        delete route.connectionError;
        continue;
      case 'collaboration.requested':
        state.collaborations.push({
          id: d.linkId,
          from: e.sessionId,
          to: d.targetId,
          question: d.question,
          materials: d.materials,
        });
        continue;
      case 'delegation.created':
        state.delegations[d.delegationId] = {
          ...d,
          id: d.delegationId,
          createdSeq: e.seq,
          parentId: e.sessionId,
          routeId: e.routeId,
          status: 'sent',
        };
        continue;
      case 'delegation.accepted':
        state.delegations[d.delegationId].status = 'working';
        continue;
      case 'delegation.returned':
        Object.assign(state.delegations[d.delegationId], {
          status: 'returned',
          result: d.result,
          artifact: d.artifact,
        });
        continue;
      case 'delegation.adopted':
        Object.assign(state.delegations[d.delegationId], {
          status: 'adopted',
          scope: d.scope,
          actor: d.actor,
        });
        continue;
      case 'round.started':
        if (route.rounds.some((round) => round.id === d.roundId))
          throw new Error(`Duplicate round: ${d.roundId}`);
        route.rounds.push({
          id: d.roundId,
          inputEventId: e.id,
          title: d.title,
          refs: [...d.refs],
          input: structuredClone(d.input),
          summary: '',
          response: '',
          calls: [],
          decisions: [],
          assessments: [],
          notes: [],
          modelDone: false,
          complete: false,
          firstSeq: e.seq,
          lastSeq: e.seq,
          unit: d.unit,
        });
        continue;
    }
    const round = route.rounds.find((round) => round.id === d.roundId);
    if (!round) throw new Error(`Event ${e.id} references missing round ${d.roundId}`);
    round.lastSeq = e.seq;
    switch (d.type) {
      case 'summary.delta':
        round.summary += d.text;
        break;
      case 'response.delta':
        round.responseSeq ??= e.seq;
        round.response += d.text;
        break;
      case 'summary.updated':
        round.summary = d.text;
        break;
      case 'response.updated':
        round.responseSeq ??= e.seq;
        if (e.runtime?.itemId) {
          if (responseItems.get(round)?.id !== e.runtime.itemId)
            responseItems.set(round, {
              id: e.runtime.itemId,
              prefix: round.response.length + (round.response ? 2 : 0),
            });
          // The codec joins observed agentMessage items with two newlines.
          round.responsePreview = d.text.slice(responseItems.get(round)!.prefix);
        }
        round.response = d.text;
        break;
      case 'canvas.noted': {
        if (round.notes.some((n) => n.id === d.noteId))
          throw new Error('Duplicate canvas annotation identity');
        const known = new Set([
          ...round.notes.map((n) => 'note:' + n.id),
          ...round.calls.map((c) => 'tool:' + c.id),
        ]);
        if (d.note.refs.some((ref) => !known.has(ref)))
          throw new CanvasNoteRejected(
            'Unknown canvas reference. Use only noteRef/toolRefs returned by earlier calls, or refs: [].',
          );
        round.notes.push({ id: d.noteId, seq: e.seq, note: structuredClone(d.note) });
        break;
      }
      case 'round.interrupt.requested':
        round.interruptRequested = true;
        break;
      case 'round.terminated':
        round.complete = true;
        round.terminalEventId = e.id;
        round.outcome = d.status;
        round.error = d.error;
        if (d.status === 'interrupted')
          for (const call of round.calls)
            if (call.status === 'preparing' || call.status === 'running') {
              call.status = 'unknown';
              call.error = '回合已确认中断；此工具未返回结束回执，结果待核对。';
            }
        break;
      case 'tool.output.updated':
        getCall(round, d.callId).result = d.text;
        break;
      case 'tool.rejected':
        Object.assign(getCall(round, d.callId), { status: 'rejected', error: d.error });
        break;
      case 'tool.unknown':
        Object.assign(getCall(round, d.callId), { status: 'unknown', error: d.error });
        break;
      case 'decision.recorded':
        round.decisions.push({ ...structuredClone(d), seq: e.seq });
        break;
      case 'assessment.recorded':
        round.assessments.push({ text: d.text, source: d.source, seq: e.seq });
        break;
      case 'tool.prepared':
        round.calls.push({
          id: d.callId,
          firstSeq: e.seq,
          title: d.title,
          tool: d.tool,
          status: 'preparing',
          argumentText: '',
          args: {},
          cancelRequested: false,
        });
        break;
      case 'tool.arguments.delta':
        getCall(round, d.callId).argumentText += d.text;
        break;
      case 'tool.started': {
        const prepared = round.calls.find((call) => call.id === d.callId);
        if (prepared) Object.assign(prepared, { status: 'running', args: structuredClone(d.args) });
        else
          round.calls.push({
            id: d.callId,
            firstSeq: e.seq,
            title: d.title,
            tool: d.tool,
            status: 'running',
            argumentText: '',
            args: structuredClone(d.args),
            cancelRequested: false,
          });
        break;
      }
      case 'tool.finished':
        Object.assign(getCall(round, d.callId), {
          status: 'returned',
          result: d.result,
          artifact: d.artifact,
          receipt: d.receipt,
          previews: (d.previews ?? (d.preview ? [d.preview] : [])).map((preview, part) => ({
            ...preview,
            eventId: e.id,
            seq: e.seq,
            part,
          })),
        });
        break;
      case 'tool.failed':
        Object.assign(getCall(round, d.callId), {
          status: 'failed',
          error: d.error,
          receipt: d.receipt,
        });
        break;
      case 'tool.cancel.requested':
        getCall(round, d.callId).cancelRequested = true;
        break;
      case 'model.completed':
        round.modelDone = true;
        break;
      case 'round.finished':
        round.complete = true;
        break;
      case 'usage.reported':
        round.usage = { input: d.input, output: d.output, scope: d.scope, seq: e.seq };
        break;
    }
  }
  return state;
}

export function conversationRounds(
  projection: Projection,
  agentId: string,
): { sessionId: string; routeId: string; round: Round }[] {
  const session = projection.sessions[agentId];
  let inherited: { sessionId: string; routeId: string; round: Round }[] = [];
  if (session.branch && session.branch.throughTurnId !== null) {
    const parent = conversationRounds(projection, session.branch.agentId);
    const index = parent.findIndex((entry) => entry.round.id === session.branch!.throughTurnId);
    if (index < 0) throw new Error('Branch context references a missing historical turn');
    inherited = parent.slice(0, index + 1);
  }
  if (session.branch?.side === 'at') {
    const boundary = projection.events.findIndex((event) => event.id === session.branch!.eventId);
    const prefix = project(projection.events, boundary + 1);
    const entry = conversationRounds(prefix, session.branch.agentId).find(
      (entry) => entry.round.id === session.branch!.roundId,
    )!;
    inherited.push(entry);
  }
  return [
    ...inherited,
    ...session.routes.flatMap((route) =>
      route.rounds.map((round) => ({ sessionId: session.id, routeId: route.id, round })),
    ),
  ];
}

export function resolveBranchPoint(
  projection: Projection,
  agentId: string,
  roundId: string,
  side: 'before' | 'after' | 'at',
  eventId: string,
) {
  if (!projection.sessions[agentId]) throw new Error('Branch source Agent is missing');
  const rounds = conversationRounds(projection, agentId);
  const index = rounds.findIndex((entry) => entry.round.id === roundId);
  if (index < 0) throw new Error('Branch source turn is missing');
  const entry = rounds[index];
  const checkpoint =
    side === 'at' ? projection.events.find((event) => event.id === eventId) : undefined;
  if (
    side === 'at' &&
    (!checkpoint ||
      checkpoint.sessionId !== entry.sessionId ||
      !('roundId' in checkpoint.data) ||
      checkpoint.data.roundId !== roundId ||
      !['canvas.noted', 'tool.finished', 'tool.failed'].includes(checkpoint.data.type) ||
      checkpoint.seq > entry.round.lastSeq)
  )
    throw new Error('Branch checkpoint does not match a recorded fragment');
  const expected =
    side === 'at'
      ? checkpoint!.id
      : side === 'before'
        ? entry.round.inputEventId
        : entry.round.terminalEventId;
  if (!expected)
    throw new Error('Codex requires the selected reply to end before forking its complete context');
  if (expected !== eventId)
    throw new Error('Branch source event does not match the selected message');
  const context = rounds.slice(0, side === 'after' ? index + 1 : index);
  const origin: BranchOrigin = {
    agentId,
    roundId,
    side,
    eventId,
    throughTurnId: context.at(-1)?.round.id ?? null,
  };
  const partial =
    side === 'at'
      ? conversationRounds(
          project(
            projection.events,
            projection.events.findIndex((event) => event.id === eventId) + 1,
          ),
          agentId,
        ).find((candidate) => candidate.round.id === roundId)!.round
      : undefined;
  return { entry, context, origin, partial };
}

export function publicBranchContext(round: Round) {
  const records = [
    ...round.notes.map(({ seq, note }) => ({ seq, kind: 'annotation', content: note })),
    ...round.calls.map((call) => ({ seq: call.firstSeq, kind: 'tool-record', content: call })),
    ...(round.responseSeq === undefined
      ? []
      : [{ seq: round.responseSeq, kind: 'assistant-reply', content: round.response }]),
  ].sort((a, b) => a.seq - b.seq);
  return {
    input: round.input.task,
    records: JSON.stringify({ source: 'canvas-public-prefix', records }),
  };
}

function getCall(round: Round, id: string): ToolCall {
  const call = round.calls.find((call) => call.id === id);
  if (!call) throw new Error(`Missing call ${id} in ${round.id}`);
  return call;
}

export function activeRoute(session: Session): Route {
  const route = session.routes.at(-1);
  if (!route) throw new Error(`Session ${session.id} has no route`);
  return route;
}
export function reportedSessionUsage(session: Session): { input: number; output: number } | null {
  const usages = session.routes.flatMap((r) =>
    r.rounds.flatMap((round) => (round.usage ? [round.usage] : [])),
  );
  if (!usages.length) return null;
  const total = usages
    .filter((u) => u.scope === 'thread-total')
    .sort((a, b) => a.seq - b.seq)
    .at(-1);
  return (
    total ??
    usages.reduce((sum, u) => ({ input: sum.input + u.input, output: sum.output + u.output }), {
      input: 0,
      output: 0,
    })
  );
}

export function visibleSessions(projection: Projection, roots: readonly string[]): Session[] {
  const visible = new Set(roots);
  // Sessions are projected in creation order: parents precede their children.
  return Object.values(projection.sessions).filter((session) => {
    if (session.parentId && visible.has(session.parentId)) visible.add(session.id);
    return visible.has(session.id);
  });
}
