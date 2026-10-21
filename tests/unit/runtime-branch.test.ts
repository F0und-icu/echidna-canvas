import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FixtureCodexBridge } from '../../server/fixture-bridge';
import { RuntimeStore } from '../../server/runtime-store';
import { Coordinator } from '../../server/coordinator';
import { project, conversationRounds, publicBranchContext } from '../../web/model/projection';
import { createWorkspace } from '../../web/model/workspace';
import { mergeRuntime } from '../../web/runtime/connection';
import { RuntimeAgent } from '../../web/runtime/RuntimePanel';
import { AppContext, type AppContextValue } from '../../web/app/context';

let store: RuntimeStore, coordinator: Coordinator;
const agentId = 'agent/codex-fixture/branch-ui-create';
beforeEach(async () => {
  vi.useFakeTimers();
  const bridge = new FixtureCodexBridge();
  store = new RuntimeStore(':memory:', bridge);
  coordinator = new Coordinator(store, bridge);
  await coordinator.execute({
    version: 1,
    commandId: 'branch-ui-create',
    type: 'agent.create',
    config: { name: 'UI fixture', avatar: 'none', model: 'fixture', personality: '' },
    task: 'test',
  });
  for (const [commandId, text] of [
    ['ui-past', 'VISIBLE_PAST_MESSAGE'],
    ['ui-future', 'HIDDEN_FUTURE_MESSAGE'],
  ]) {
    await coordinator.execute({ version: 1, commandId, type: 'turn.start', agentId, text });
    await vi.advanceTimersByTimeAsync(1500);
  }
});
afterEach(() => {
  coordinator.close();
  vi.useRealTimers();
});

function renderAgent(id: string) {
  const workspace = mergeRuntime(createWorkspace(), store.state());
  const view = project(workspace.events);
  const value: AppContextValue = {
    workspace,
    canvas: workspace.canvases[0],
    view,
    live: view,
    setWorkspace: () => {},
    panel: null,
    openPanel: () => {},
    notify: () => {},
    requestRemoval: () => {},
    focusAgent: () => {},
    focusArchive: () => {},
    mcp: { connections: [], error: '', refresh: async () => {}, remember: () => {} },
    runtime: {
      state: store.state(),
      backend: null,
      connected: true,
      error: '',
      connect: async () => undefined,
      refreshBackend: async () => {},
      command: async () => {
        throw new Error('Render must not dispatch');
      },
      login: async () => {
        throw new Error('Render must not log in');
      },
    },
  };
  return renderToStaticMarkup(
    createElement(AppContext.Provider, { value }, createElement(RuntimeAgent, { sessionId: id })),
  );
}

it('keeps the workspace identity for duplicate and state-only feeds while rejecting conflicts', () => {
  const feed = store.state();
  const workspace = mergeRuntime(createWorkspace(), feed);
  expect(mergeRuntime(workspace, feed)).toBe(workspace);
  expect(mergeRuntime(workspace, { ...feed, events: [] })).toBe(workspace);
  const changed = structuredClone(feed);
  changed.events[0].id += '/conflict';
  expect(() => mergeRuntime(workspace, changed)).toThrow('重复事件');
  const missing = createWorkspace();
  expect(() => mergeRuntime(missing, { ...feed, events: feed.events.slice(1) })).toThrow(
    '游标缺口',
  );
});

it('renders a branch action on every user message and completed reply', () => {
  const html = renderAgent(agentId);
  expect(html.match(/aria-label="从此消息发送前分支"/g)).toHaveLength(2);
  expect(html.match(/aria-label="从此回复后分支"/g)).toHaveLength(2);
});

it('renders only inherited prefix messages, including after workspace cursor renumbering and reload', async () => {
  const first = conversationRounds(project(store.events()), agentId)[0].round;
  const result = await coordinator.execute({
    version: 1,
    commandId: 'ui-branch',
    type: 'agent.fork',
    sourceAgentId: agentId,
    roundId: first.id,
    side: 'after',
    eventId: first.terminalEventId!,
  });
  expect(result.status).toBe('acknowledged');
  const html = renderAgent(result.agentId);
  expect(html).toContain('VISIBLE_PAST_MESSAGE');
  expect(html).not.toContain('HIDDEN_FUTURE_MESSAGE');
  expect(html).toContain('继承的对话上下文');
  expect(html).toContain('查看来源对话');
  const workspace = mergeRuntime(createWorkspace(), store.state());
  const restored = JSON.parse(JSON.stringify(workspace));
  expect(
    conversationRounds(project(restored.events), result.agentId).map(
      (entry) => entry.round.input.task,
    ),
  ).toEqual(['VISIBLE_PAST_MESSAGE']);
});

it('rejects tampered branch boundaries instead of inheriting future history', async () => {
  const first = conversationRounds(project(store.events()), agentId)[0].round;
  const result = await coordinator.execute({
    version: 1,
    commandId: 'ui-branch',
    type: 'agent.fork',
    sourceAgentId: agentId,
    roundId: first.id,
    side: 'after',
    eventId: first.terminalEventId!,
  });
  const events = structuredClone(store.events());
  const event = events.find(
    (entry) => entry.sessionId === result.agentId && entry.data.type === 'session.created',
  )!;
  if (event.data.type !== 'session.created' || !event.data.branch)
    throw new Error('Missing branch fixture');
  event.data.branch.throughTurnId = 'turn_ui-future';
  expect(() => project(events)).toThrow('boundary does not match');
});

it('inherits only media from the branch prefix, including legacy single-preview events', async () => {
  const first = conversationRounds(project(store.events()), agentId)[0].round;
  const branch = await coordinator.execute({
    version: 1,
    commandId: 'media-prefix',
    type: 'agent.fork',
    sourceAgentId: agentId,
    roundId: first.id,
    side: 'after',
    eventId: first.terminalEventId!,
  });
  const events = structuredClone(store.events());
  for (const event of events)
    if (event.data.type === 'tool.finished') {
      if (event.data.roundId === first.id)
        event.data.preview = { kind: 'image', title: 'past image', path: 'past.png' };
      else
        event.data.previews = [
          { kind: 'webpage', title: 'future page', url: 'https://example.com/future' },
        ];
    }
  const inherited = conversationRounds(project(events), branch.agentId);
  expect(inherited[0].round.calls[0].previews).toEqual([
    expect.objectContaining({ kind: 'image', path: 'past.png', part: 0 }),
  ]);
  expect(JSON.stringify(inherited)).not.toContain('future page');
  expect(JSON.stringify(inherited)).not.toContain('example.com/future');
});

it('branches at a tool checkpoint without exposing later replies or subsequent turns', async () => {
  const checkpoint = store
    .events()
    .find((event) => event.sessionId === agentId && event.data.type === 'tool.finished')!;
  const first = conversationRounds(project(store.events()), agentId)[0].round;
  const result = await coordinator.execute({
    version: 1,
    commandId: 'fragment-fork',
    type: 'agent.fork',
    sourceAgentId: agentId,
    roundId: first.id,
    side: 'at',
    eventId: checkpoint.id,
  });
  expect(result.status).toBe('acknowledged');
  const inherited = conversationRounds(project(store.events()), result.agentId);
  expect(inherited).toHaveLength(1);
  expect(inherited[0].round.response).toBe('');
  expect(inherited[0].round.calls[0].result).toContain('README.md');
  expect(inherited[0].round.lastSeq).toBe(checkpoint.seq);
  const context = publicBranchContext(inherited[0].round);
  expect(context.input).toBe('VISIBLE_PAST_MESSAGE');
  expect(context.records).not.toContain('HIDDEN_FUTURE_MESSAGE');
  const html = renderAgent(result.agentId);
  expect(html).toContain('截至所选片段的公开记录快照');
  expect(html).not.toContain('HIDDEN_FUTURE_MESSAGE');
  expect(html).not.toContain('已收到演示命令的回传');
});
