import { afterEach, beforeEach, expect, it } from 'vitest';
import { Coordinator } from '../../server/coordinator';
import { FixtureCodexBridge } from '../../server/fixture-bridge';
import { RuntimeStore } from '../../server/runtime-store';
import { notificationSchema } from '../../server/codex-protocol';
import { project } from '../../web/model/projection';
import { runtimeNodes } from '../../web/records/runtimeLayout';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cases from '../fixtures/codex-native-items.json';

let store: RuntimeStore, coordinator: Coordinator, seq: number;
const agentId = 'agent/codex-fixture/native-create';
const scope = { threadId: 'thr_native-create', turnId: 'native-turn' };
const round = () => project(store.events()).sessions[agentId].routes[0].rounds[0];
const push = (method: string, params: Record<string, unknown>) => {
  store.ingest(agentId, {
    version: 1,
    streamId: 'native-start',
    sourceSeq: seq + 1,
    packet: { method, params: { ...scope, ...params } },
  });
  seq++;
};
async function initialize(path = ':memory:') {
  const bridge = new FixtureCodexBridge();
  store = new RuntimeStore(path, bridge);
  coordinator = new Coordinator(store, bridge);
  await coordinator.execute({
    version: 1,
    commandId: 'native-create',
    type: 'agent.create',
    config: { name: '测试', avatar: 'echidna', model: 'fixture', personality: '' },
    task: '只读检查',
  });
  store.admit({
    version: 1,
    commandId: 'native-start',
    type: 'turn.start',
    agentId,
    text: '只读检查',
  });
  seq = 0;
  push('turn/started', { turn: { id: scope.turnId, status: 'inProgress' } });
}
beforeEach(() => initialize());
afterEach(() => coordinator.close());

it('rejects a terminal interaction without an owned command even after interruption', () => {
  push('turn/completed', { turn: { id: scope.turnId, status: 'interrupted', error: null } });
  const cursor = store.cursor();
  expect(() =>
    push('item/commandExecution/terminalInteraction', {
      itemId: 'not-an-admitted-command',
      processId: 'unknown-process',
    }),
  ).toThrow('Codex terminal interaction references an unknown command');
  expect(store.cursor()).toBe(cursor);
  expect(round().assessments).toHaveLength(0);
});

it.each(cases)(
  'accepts and pairs the target native item $start.type',
  ({ start, completed, progress }) => {
    push('item/started', { item: start });
    if (progress) push(progress.method, progress.params);
    expect(round().calls.every((call) => !call.receipt)).toBe(true);
    push('item/completed', { item: completed });
    push('turn/completed', { turn: { id: scope.turnId, status: 'completed', error: null } });
    expect(round().outcome).toBe('completed');
    expect(store.state().agents[0].state).toBe('idle');
    expect(store.events().some((event) => event.data.type.startsWith('delegation.'))).toBe(false);
    const bytes = JSON.stringify(store.events());
    expect(bytes).not.toContain('private-hook-instructions');
    expect(bytes).not.toContain('private-transport-metadata');
  },
);

it('preserves real native tool identities, progress, and uncertain search success', () => {
  for (const test of cases) {
    push('item/started', { item: test.start });
    if (test.progress) push(test.progress.method, test.progress.params);
    if (test.start.type === 'mcpToolCall') expect(round().calls[0].result).toBe('正在读取');
    push('item/completed', { item: test.completed });
  }
  expect(round().calls.map((call) => call.tool)).toEqual([
    'codex.mcpToolCall',
    'codex.webSearch',
    'codex.fileChange',
    'codex.imageView',
    'codex.sleep',
    'codex.imageGeneration',
  ]);
  const web = round().calls[1];
  expect(web.artifact).toBe('检索已结束 · 未报告成功状态');
  expect(web.result).toBe('Codex 未提供结构化搜索结果。');
  expect(web.receipt).toContain('/web:item-completed');
  expect(round().calls[0].result).toContain('fixture-only-result');
  expect(round().calls[2].args.changes).toHaveLength(1);
  const previews = runtimeNodes(round()).filter((node) => node.preview);
  expect(previews.map((node) => node.kind)).toEqual(['webpage', 'image', 'image']);
  expect(previews[0].refs).toEqual(['tool:web']);
});

it('does not publish previews before completion or leak them into an earlier history prefix', () => {
  const item = cases.find((test) => test.start.type === 'imageGeneration')!;
  push('item/started', { item: item.start });
  const prefix = store.cursor();
  expect(runtimeNodes(round()).some((node) => node.preview)).toBe(false);
  push('item/completed', { item: item.completed });
  expect(runtimeNodes(round()).some((node) => node.preview)).toBe(true);
  const old = project(store.events(), prefix).sessions[agentId].routes[0].rounds[0];
  expect(runtimeNodes(old).some((node) => node.preview)).toBe(false);
});

const raster =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5wAAAABJRU5ErkJggg==';
it('retains inline image sources across a store restart without republishing bytes or executing tools', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-durable-media-'));
  try {
    coordinator.close();
    const path = join(directory, 'runtime.sqlite');
    await initialize(path);
    const start = { ...cases[5].start, id: 'durable-image' };
    push('item/started', { item: start });
    push('item/completed', { item: { ...start, status: 'completed', result: raster } });
    push('turn/completed', { turn: { id: scope.turnId, status: 'completed', error: null } });
    store.acknowledge('native-start', { turnId: scope.turnId });
    const events = store.events(),
      commands = store.state().commands;
    const event = events.find((event) => event.data.type === 'tool.finished')!;
    coordinator.close();
    const bridge = new FixtureCodexBridge();
    store = new RuntimeStore(path, bridge);
    coordinator = new Coordinator(store, bridge);
    expect(store.events()).toEqual(events);
    expect(store.state().commands).toEqual(commands);
    expect(store.imageSource(event, 0)).toEqual({
      type: 'inline',
      data: raster,
      mimeType: 'image/png',
    });
    expect(JSON.stringify(store.state())).not.toContain(raster);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('projects all MCP image parts with exact completion sources and keeps their bytes server-side', () => {
  const image = { type: 'image', mimeType: 'image/png', data: raster };
  const start = { ...cases[0].start, id: 'multi-image' };
  push('item/started', { item: start });
  const prefix = store.cursor(),
    before = runtimeNodes(round());
  push('item/completed', {
    item: {
      ...start,
      status: 'completed',
      result: {
        content: [{ type: 'text', text: 'actual caption' }, image, image],
        structuredContent: { image },
      },
    },
  });
  const call = round().calls[0];
  expect(call.previews).toHaveLength(2);
  expect(call.result).toContain('actual caption');
  expect(JSON.stringify(store.state())).not.toContain(raster);
  const media = runtimeNodes(round()).filter((node) => node.preview);
  expect(media.map((node) => node.id)).toEqual(['preview:multi-image', 'preview:multi-image:1']);
  expect(media.every((node) => node.refs[0] === 'tool:multi-image')).toBe(true);
  for (const node of media) {
    const preview = node.preview!;
    const event = store.events().find((event) => event.id === preview.eventId)!;
    expect(store.imageSource(event, preview.kind === 'image' ? preview.sourceIndex! : -1)).toEqual({
      type: 'inline',
      data: raster,
      mimeType: 'image/png',
    });
  }
  expect(
    runtimeNodes(project(store.events(), prefix).sessions[agentId].routes[0].rounds[0]),
  ).toEqual(before);
});

it.each([raster, 'data:image/png;base64,' + raster])(
  'recognizes native inline image results without publishing their bytes',
  (result) => {
    const start = { ...cases[5].start, id: 'inline' };
    push('item/started', { item: start });
    push('item/completed', { item: { ...start, status: 'completed', result } });
    expect(round().calls[0].previews).toHaveLength(1);
    expect(JSON.stringify(store.state())).not.toContain(raster);
  },
);

it('does not turn search results into visits or publish images from a failed generation', () => {
  const search = {
    ...cases[1].start,
    action: { type: 'search', query: 'test' },
    results: [{ url: 'https://example.com/' }],
  };
  push('item/started', { item: search });
  push('item/completed', { item: search });
  expect(round().calls[0].previews).toEqual([]);
  const image = {
    ...cases[5].start,
    status: 'failed',
    result: raster,
    savedPath: 'must-not-show.png',
  };
  push('item/started', { item: { ...image, status: 'in_progress' } });
  push('item/completed', { item: image });
  expect(round().calls[1].status).toBe('failed');
  expect(round().calls[1].previews).toBeUndefined();
  expect(JSON.stringify(store.events())).not.toContain(raster);
});

it('projects every page returned by a native batch open, without turning search results or thumbnails into visits', () => {
  const results = [
    {
      type: 'text_result',
      ref_id: 'turn0view0',
      title: 'SSE',
      url: 'https://developer.mozilla.org/sse',
      thumbnail_url: 'https://images.example/thumbnail.png',
    },
    {
      type: 'text_result',
      ref_id: 'turn0view1',
      title: 'WebSocket',
      url: 'https://developer.mozilla.org/websocket',
    },
    { type: 'text_result', ref_id: 'turn0view2', title: 'Unsafe', url: 'javascript:alert(1)' },
    {
      type: 'text_result',
      ref_id: 'turn0view3',
      title: 'Credential URL',
      url: 'https://private:secret@example.com/',
    },
    { type: 'other', url: 'https://example.com/unknown' },
  ];
  const opening = {
    ...cases[1].start,
    id: 'batch-open',
    action: { type: 'openPage', url: results[0].url },
  };
  push('item/started', { item: opening });
  push('item/completed', { item: { ...opening, results } });
  expect(round().calls[0].previews).toEqual([
    expect.objectContaining({ kind: 'webpage', url: results[0].url, part: 0 }),
    expect.objectContaining({ kind: 'webpage', url: results[1].url, title: 'WebSocket', part: 1 }),
  ]);
  const search = {
    ...opening,
    id: 'only-search',
    action: { type: 'search', query: 'test' },
    results,
  };
  push('item/started', { item: search });
  push('item/completed', { item: search });
  expect(round().calls[1].previews).toEqual([]);
});

it('preserves MCP and patch failure or refusal without fabricating successful receipts', () => {
  const mcp = cases[0].start;
  push('item/started', { item: mcp });
  push('item/completed', {
    item: { ...mcp, status: 'failed', error: { message: 'actual-error' } },
  });
  expect(round().calls[0]).toMatchObject({ status: 'failed', error: 'actual-error' });
  const patch = cases[2].start;
  push('item/started', { item: patch });
  push('item/completed', { item: { ...patch, status: 'declined' } });
  expect(round().calls[1].status).toBe('rejected');
  expect(round().calls[1].receipt).toBeUndefined();
});

it('keeps opaque image statuses literal and does not attach a preview on explicit failure', () => {
  const image = { ...cases[5].start, status: 'vendor-specific-state' };
  push('item/started', { item: image });
  push('item/completed', {
    item: {
      ...image,
      failure: { type: 'usageLimitExceeded', limitId: 'fixture' },
      savedPath: 'must-not-show.png',
    },
  });
  expect(round().calls[0].status).toBe('failed');
  expect(round().calls[0].previews).toBeUndefined();
});

it.each([
  'missing-start',
  'duplicate-start',
  'duplicate-completion',
  'wrong-type',
  'wrong-tool',
  'nonterminal',
  'late-progress',
])('rejects broken native lifecycle: %s', (mode) => {
  const test = cases[0];
  if (mode === 'missing-start') {
    expect(() => push('item/completed', { item: test.completed })).toThrow('matching open item');
    return;
  }
  push('item/started', { item: test.start });
  const bad = () => {
    if (mode === 'duplicate-start') push('item/started', { item: test.start });
    else if (mode === 'wrong-type')
      push('item/completed', { item: { ...cases[1].completed, id: test.start.id } });
    else if (mode === 'wrong-tool')
      push('item/completed', { item: { ...test.completed, tool: 'different' } });
    else if (mode === 'nonterminal') push('item/completed', { item: test.start });
    else if (mode === 'duplicate-completion') push('item/completed', { item: test.completed });
    else push(test.progress!.method, test.progress!.params);
  };
  if (mode === 'duplicate-completion' || mode === 'late-progress')
    push('item/completed', { item: test.completed });
  const before = store.events();
  expect(bad).toThrow('Codex');
  expect(store.events()).toEqual(before);
});

it('refuses malformed native fields and unsafe URL previews, while preserving raw tool records', () => {
  expect(() =>
    notificationSchema.parse({
      method: 'item/started',
      params: { ...scope, item: { ...cases[0].start, server: 1 } },
    }),
  ).toThrow();
  const item = { ...cases[1].start, action: { type: 'openPage', url: 'javascript:alert(1)' } };
  push('item/started', { item });
  push('item/completed', { item });
  expect(round().calls[0].previews).toEqual([]);
  expect(JSON.stringify(round().calls[0].args)).toContain('javascript:alert(1)');
});

it('keeps terminal interaction input private and rejects progress assigned to another item family', () => {
  const item = {
    type: 'commandExecution',
    id: 'cmd',
    command: 'fixture-only',
    cwd: '/fixture',
    status: 'inProgress',
  };
  push('item/started', { item });
  const packet = notificationSchema.parse({
    method: 'item/commandExecution/terminalInteraction',
    params: { ...scope, itemId: 'cmd', processId: 'process-1', stdin: 'private-terminal-input' },
  });
  expect(JSON.stringify(packet)).not.toContain('private-terminal-input');
  push(packet.method, packet.params);
  expect(round().assessments.at(-1)?.source).toBe('终端交互');
  expect(() => push('item/mcpToolCall/progress', { itemId: 'cmd', message: 'wrong' })).toThrow(
    'type mismatch',
  );
  expect(round().calls[0].receipt).toBeUndefined();
});
