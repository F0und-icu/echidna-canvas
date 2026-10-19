import { activeRoute, project } from './projection';
import { makeFixture, materials, sampleConfig, sampleTask } from './fixtures';
import {
  workspaceSchema,
  type AgentConfig,
  type CanvasDocument,
  type Draft,
  type EventData,
  type Source,
  type Workspace,
} from './schema';

export const themes = {
  paper: {
    name: '暖米白',
    colors: [
      '#F6F3ED',
      '#FAF8F4',
      '#2C2B27',
      '#55534D',
      '#777268',
      '#825B42',
      '#53684F',
      '#DBD5CA',
      '#ECE7DF',
    ],
  },
  sage: {
    name: '鼠尾草纸',
    colors: [
      '#F0F2EB',
      '#F8F9F3',
      '#283129',
      '#4C584D',
      '#6E786A',
      '#647454',
      '#8B684E',
      '#D5DCCD',
      '#E5E9DD',
    ],
  },
  night: {
    name: '夜间胡桃',
    colors: [
      '#24231F',
      '#2E2D28',
      '#F3EDE2',
      '#D5CEC1',
      '#ADA393',
      '#D3A789',
      '#A8B59A',
      '#49453D',
      '#3A3730',
    ],
  },
};
export const scenarioNames = {
  feedback: '工具反馈改变判断',
  steering: '用户中途纠正方向',
  handoff: '委派、复核与采纳',
};
export type Scenario = keyof typeof scenarioNames;
export const planKey = (sessionId: string, routeId: string) => `${sessionId}::${routeId}`;
export const newId = (): string => crypto.randomUUID();

export function emptyCanvas(id: string, name: string): CanvasDocument {
  return {
    id,
    name,
    scenario: null,
    rootSessions: [],
    positions: {},
    viewport: { x: 20, y: 50, zoom: 0.9 },
    paper: 'plain',
    drafts: [],
    undo: [],
    redo: [],
    selectedSession: null,
    selectedDrafts: [],
    historySeq: null,
    follow: false,
    showPast: true,
    proposal: null,
  };
}
export function currentCanvas(workspace: Workspace): CanvasDocument {
  const canvas = workspace.canvases.find((canvas) => canvas.id === workspace.activeCanvas);
  if (!canvas) throw new Error('Active canvas is missing');
  return canvas;
}
export function updateCanvas(
  workspace: Workspace,
  change: (canvas: CanvasDocument) => CanvasDocument,
): Workspace {
  return {
    ...workspace,
    canvases: workspace.canvases.map((canvas) =>
      canvas.id === workspace.activeCanvas ? change(canvas) : canvas,
    ),
  };
}
export function appendEvent(
  workspace: Workspace,
  sessionId: string,
  routeId: string,
  data: EventData,
  source: 'fixture' | 'user' = 'user',
): Workspace {
  const seq = workspace.events.length + 1;
  return {
    ...workspace,
    events: [
      ...workspace.events,
      { id: `event/${seq}`, seq, sessionId, routeId, source, data: structuredClone(data) },
    ],
  };
}
export function addAgent(
  workspace: Workspace,
  config: AgentConfig,
  task: string,
  x: number,
  y: number,
  id = newId(),
): Workspace {
  let next = appendEvent(workspace, id, 'r1', { type: 'session.created', config, parentId: null });
  next = appendEvent(next, id, 'r1', { type: 'route.started', task, materials, origin: null });
  next = {
    ...next,
    replays: {
      ...next.replays,
      [planKey(id, 'r1')]: {
        id: planKey(id, 'r1'),
        ownerId: id,
        routeId: 'r1',
        cursor: 0,
        steps: makeFixture(id, 'r1', task, config),
      },
    },
  };
  return updateCanvas(next, (canvas) => ({
    ...canvas,
    rootSessions: [...canvas.rootSessions, id],
    positions: { ...canvas.positions, [id]: { x, y } },
    selectedSession: id,
    historySeq: null,
  }));
}
export function createWorkspace(): Workspace {
  const empty: Workspace = {
    version: 1,
    events: [],
    replays: {},
    canvases: [emptyCanvas('canvas/main', '恢复路径')],
    activeCanvas: 'canvas/main',
    appearance: {
      theme: 'paper',
      colors: [...themes.paper.colors],
      motion: true,
      flowCharacters: true,
    },
  };
  let next = addAgent(empty, sampleConfig, sampleTask, 64, 320, 'agent/main');
  for (let i = 0; i < 20; i++) next = receiveNext(next, planKey('agent/main', 'r1'));
  return next;
}
export function deliveryBlock(
  workspace: Workspace,
  key: string,
  projection = project(workspace.events),
): string | null {
  const plan = workspace.replays[key];
  if (!plan) return '子会话随父任务接收演示记录';
  if (plan.cursor === plan.steps.length) return '演示已结束';
  const step = plan.steps[plan.cursor],
    session = projection.sessions[step.sessionId];
  const ownerRoute = projection.sessions[plan.ownerId].routes.find(
    (route) => route.id === plan.routeId,
  )!;
  if (!ownerRoute.connected) return '事件连接断开 · 结果待核对';
  // A creation event precedes its Session and is admitted by the parent replay.
  if (step.data.type === 'session.created') return null;
  const route = session.routes.find((route) => route.id === step.routeId);
  if (step.data.type === 'route.started') return null;
  if (!route) throw new Error('Fixture references a missing route');
  if (!route.connected) return '事件连接断开 · 结果待核对';
  if (
    (route.paused || (step.sessionId === plan.ownerId && ownerRoute.paused)) &&
    step.data.type === 'round.started'
  )
    return '后续采样已暂停';
  return null;
}
export function receiveNext(workspace: Workspace, key: string): Workspace {
  const projection = project(workspace.events);
  if (deliveryBlock(workspace, key, projection)) return workspace;
  const plan = workspace.replays[key],
    step = plan.steps[plan.cursor];
  let data = step.data;
  if (data.type === 'route.started' && projection.sessions[step.sessionId].parentId) {
    const handoff = Object.values(projection.delegations).find(
      (link) => link.childId === step.sessionId,
    );
    if (!handoff) throw new Error('A child route requires its recorded delegation');
    data = {
      ...data,
      origin: {
        sessionId: handoff.parentId,
        routeId: handoff.routeId,
        roundId: handoff.roundId,
        eventSeq: handoff.createdSeq,
      },
    };
  }
  if (data.type === 'round.started') {
    const session = projection.sessions[step.sessionId],
      route = session.routes.find((route) => route.id === step.routeId)!;
    data = {
      ...data,
      input: {
        task: route.task,
        model: session.config.model,
        personality: session.config.personality,
        materials: [...route.materials],
        contractVersion: 'offline-v1',
      },
    };
  }
  const next = appendEvent(workspace, step.sessionId, step.routeId, data, 'fixture');
  return { ...next, replays: { ...next.replays, [key]: { ...plan, cursor: plan.cursor + 1 } } };
}
export function openScenario(workspace: Workspace, scenario: Scenario): Workspace {
  const existing = workspace.canvases.find((canvas) => canvas.scenario === scenario);
  if (existing) return { ...workspace, activeCanvas: existing.id };
  const id = newId(),
    canvas = { ...emptyCanvas(id, scenarioNames[scenario]), scenario };
  let next = { ...workspace, canvases: [...workspace.canvases, canvas], activeCanvas: id };
  const agentId = newId();
  next = addAgent(next, sampleConfig, sampleTask, 64, 320, agentId);
  const key = planKey(agentId, 'r1'),
    steps = next.replays[key].steps;
  const end =
    steps.findIndex((step) =>
      scenario === 'feedback'
        ? step.data.type === 'decision.recorded' && step.data.roundId === 's3'
        : scenario === 'steering'
          ? step.data.type === 'decision.recorded' && step.data.roundId === 's2'
          : step.sessionId !== agentId && step.data.type === 'tool.started',
    ) + 1;
  for (let i = 0; i < end; i++) next = receiveNext(next, key);
  return next;
}
export function applyProposal(workspace: Workspace): Workspace {
  const proposal = currentCanvas(workspace).proposal;
  if (!proposal) throw new Error('A correction requires a proposal');
  const { source, text } = proposal,
    snapshot = project(workspace.events, source.eventSeq),
    sourceSession = snapshot.sessions[source.sessionId];
  const prior = sourceSession.routes.find((route) => route.id === source.routeId)!;
  const live = project(workspace.events).sessions[source.sessionId],
    routeId = `r${live.routes.length + 1}`;
  let next = appendEvent(workspace, live.id, activeRoute(live).id, { type: 'operator.paused' });
  next = appendEvent(next, live.id, routeId, {
    type: 'route.started',
    task: text,
    materials: prior.materials,
    origin: source,
  });
  const key = planKey(live.id, routeId);
  next = {
    ...next,
    replays: {
      ...next.replays,
      [key]: {
        id: key,
        ownerId: live.id,
        routeId,
        cursor: 0,
        steps: makeFixture(live.id, routeId, text, live.config, true),
      },
    },
  };
  next = receiveNext(next, key);
  return updateCanvas(next, (canvas) => ({
    ...canvas,
    historySeq: null,
    selectedSession: live.id,
    proposal: null,
  }));
}
export function sourceFor(
  workspace: Workspace,
  sessionId: string,
  routeId: string,
  roundId: string | null,
): Source {
  return {
    sessionId,
    routeId,
    roundId,
    eventSeq: currentCanvas(workspace).historySeq ?? workspace.events.length,
  };
}
export function duplicateCanvas(workspace: Workspace): Workspace {
  const source = currentCanvas(workspace),
    copy = {
      ...structuredClone(source),
      id: newId(),
      name: `${source.name} · 副本`,
      scenario: null,
      undo: [],
      redo: [],
      follow: false,
    };
  return { ...workspace, canvases: [...workspace.canvases, copy], activeCanvas: copy.id };
}
export function editDrafts(workspace: Workspace, drafts: Draft[]): Workspace {
  return updateCanvas(workspace, (canvas) => ({
    ...canvas,
    drafts,
    undo: [...canvas.undo, canvas.drafts].slice(-100),
    redo: [],
  }));
}
export function moveDraftHistory(workspace: Workspace, redo: boolean): Workspace {
  return updateCanvas(workspace, (canvas) => {
    const from = redo ? canvas.redo : canvas.undo,
      target = from.at(-1);
    if (!target) return canvas;
    return {
      ...canvas,
      drafts: target,
      selectedDrafts: [],
      undo: redo ? [...canvas.undo, canvas.drafts] : from.slice(0, -1),
      redo: redo ? from.slice(0, -1) : [...canvas.redo, canvas.drafts],
    };
  });
}
export function removeDrafts(workspace: Workspace, ids: readonly string[]): Workspace {
  const removed = new Set(ids),
    drafts = currentCanvas(workspace).drafts.filter(
      (draft) =>
        !removed.has(draft.id) && !removed.has(draft.from ?? '') && !removed.has(draft.to ?? ''),
    );
  return updateCanvas(editDrafts(workspace, drafts), (canvas) => ({
    ...canvas,
    selectedDrafts: [],
  }));
}
export function parseWorkspace(raw: string): Workspace {
  const workspace = workspaceSchema.parse(JSON.parse(raw));
  const ids = new Set<string>();
  workspace.events.forEach((event, i) => {
    if (event.seq !== i + 1 || ids.has(event.id)) throw new Error('保存的事件序号或身份不连续');
    ids.add(event.id);
  });
  const projection = project(workspace.events);
  for (const plan of Object.values(workspace.replays))
    if (plan.cursor > plan.steps.length) throw new Error('演示游标超出记录范围');
  if (!workspace.canvases.some((canvas) => canvas.id === workspace.activeCanvas))
    throw new Error('当前画布引用不存在');
  for (const canvas of workspace.canvases) {
    if (canvas.historySeq !== null && canvas.historySeq > workspace.events.length)
      throw new Error('历史快照超出记录范围');
    for (const root of canvas.rootSessions)
      if (!projection.sessions[root]) throw new Error('画布引用了不存在的会话');
    for (const draft of canvas.drafts.filter((draft) => draft.kind === 'relation'))
      if (
        ![draft.from, draft.to].every((id) =>
          canvas.drafts.some(
            (other) => other.id === id && !['ink', 'relation'].includes(other.kind),
          ),
        )
      )
        throw new Error('草稿连线端点不存在');
  }
  return workspace;
}
