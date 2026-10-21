import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { graphWorkspace } from '../fixtures/canvas-graph';
import { project } from '../../web/model/projection';
import { eventSchema, type Workspace } from '../../web/model/schema';
import { AppContext, type AppContextValue } from '../../web/app/context';
import { RoundView, roundState } from '../../web/records/RoundView';
import { RuntimeAgent } from '../../web/runtime/RuntimePanel';
import { RoundDetails } from '../../web/records/RoundDetails';

const reason =
  'Codex item/started [item.type=fixtureUnknownTool] 处理失败：invalid_union@params.item.type';
function disconnectedConversation() {
  const workspace = graphWorkspace();
  workspace.events = workspace.events
    .filter((event) =>
      [
        'session.created',
        'route.started',
        'round.started',
        'response.updated',
        'round.terminated',
      ].includes(event.data.type),
    )
    .map((event, index) => ({ ...event, seq: index + 1 }));
  const first = workspace.events.find((event) => event.data.type === 'round.started')!;
  if (first.data.type !== 'round.started') throw new Error('Expected input fixture');
  for (const data of [
    {
      ...first.data,
      roundId: 'weather-2',
      title: '上海天气',
      input: { ...first.data.input, task: '上海的' },
    },
    { type: 'response.updated', roundId: 'weather-2', text: '我来查一下上海今天的天气。' },
    { type: 'connection.lost', reason },
  ])
    workspace.events.push(
      eventSchema.parse({
        ...first,
        id: 'weather/' + workspace.events.length,
        seq: workspace.events.length + 1,
        data,
      }),
    );
  return workspace;
}
function render(
  workspace: Workspace,
  kind: 'round' | 'chat' | 'detail',
  through = workspace.events.length,
) {
  const view = project(workspace.events, through),
    session = view.sessions['graph-agent'],
    route = session.routes[0],
    round = route.rounds.at(-1)!;
  const value: AppContextValue = {
    workspace,
    view,
    live: view,
    canvas: {
      ...workspace.canvases[0],
      historySeq: through < workspace.events.length ? through : null,
    },
    setWorkspace: () => {},
    panel: null,
    openPanel: () => {},
    notify: () => {},
    requestRemoval: () => {},
    focusAgent: () => {},
    focusArchive: () => {},
    mcp: { connections: [], error: '', refresh: async () => {}, remember: () => {} },
    runtime: {
      state: null,
      backend: null,
      error: '',
      connected: false,
      connect: async () => undefined,
      refreshBackend: async () => {},
      command: async () => {
        throw new Error('Rendering must not dispatch');
      },
      login: async () => {
        throw new Error('Rendering must not log in');
      },
    },
  };
  const child =
    kind === 'chat'
      ? createElement(RuntimeAgent, { sessionId: session.id })
      : kind === 'detail'
        ? createElement(RoundDetails, {
            sessionId: session.id,
            routeId: route.id,
            roundId: round.id,
            nodeId: 'answer',
          })
        : createElement(RoundView, {
            session,
            route,
            round,
            index: 1,
            position: { x: 0, y: 0 },
            current: true,
            dimmed: false,
          });
  return renderToStaticMarkup(createElement(AppContext.Provider, { value }, child));
}

it('shows a disconnected text-only second turn as unknown while preserving the first completed turn', () => {
  const workspace = disconnectedConversation(),
    route = project(workspace.events).sessions['graph-agent'].routes[0];
  expect(route.connectionError).toBe(reason);
  expect(route.rounds[1].calls).toEqual([]);
  expect(roundState(route.rounds[0], route.connected)).toEqual({
    uncertain: false,
    phase: '已结束',
  });
  expect(roundState(route.rounds[1], route.connected)).toEqual({
    uncertain: true,
    phase: '结果待核对',
  });
  const html = render(workspace, 'round');
  expect(html).toContain('结果待核对');
  expect(html).toContain('round-warning');
  expect(html).not.toContain('/ 模型输出');
  expect(route.rounds[1].outcome).toBeUndefined();
});

it('retains partial text and exposes the disconnection reason instead of an endless waiting message', () => {
  const workspace = disconnectedConversation(),
    html = render(workspace, 'chat');
  expect(html).toContain('运行时连接中断');
  expect(html).toContain('回复未完成');
  expect(html).toContain('我来查一下上海今天的天气。');
  expect(html).toContain('fixtureUnknownTool');
  expect(html).not.toContain('等待回复…');
  expect(html).not.toContain('>正在响应<');
  expect(render(workspace, 'detail')).toContain('运行结果待核对');
});

it('does not leak a later disconnection into history and clears its reason only on a recorded restoration', () => {
  const workspace = disconnectedConversation();
  const prefix = project(workspace.events, workspace.events.length - 1).sessions['graph-agent']
    .routes[0];
  expect(prefix.connected).toBe(true);
  expect(prefix.connectionError).toBeUndefined();
  expect(render(workspace, 'chat', workspace.events.length - 1)).not.toContain(
    'fixtureUnknownTool',
  );
  const last = workspace.events.at(-1)!;
  workspace.events.push({
    ...last,
    id: 'weather/restored',
    seq: last.seq + 1,
    data: { type: 'connection.restored' },
  });
  const restored = project(workspace.events).sessions['graph-agent'].routes[0];
  expect(restored.connected).toBe(true);
  expect(restored.connectionError).toBeUndefined();
  expect(restored.rounds[1].outcome).toBeUndefined();
});

it('shows a current runtime reconnect notice and stops presenting it once newer output arrives', () => {
  const workspace = disconnectedConversation(),
    last = workspace.events.at(-1)!;
  workspace.events[workspace.events.length - 1] = {
    ...last,
    data: {
      type: 'assessment.recorded',
      roundId: 'weather-2',
      source: '运行时错误',
      text: 'Reconnecting... 2/5',
    },
  };
  expect(render(workspace, 'chat')).toContain('Reconnecting... 2/5');
  workspace.events.push({
    ...last,
    id: 'weather/continued',
    seq: last.seq + 1,
    data: {
      type: 'response.updated',
      roundId: 'weather-2',
      text: '后续实际返回的文字。',
    },
  });
  const html = render(workspace, 'chat');
  expect(html).not.toContain('Reconnecting... 2/5');
  expect(html).toContain('后续实际返回的文字。');
});
