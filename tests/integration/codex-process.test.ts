import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CodexBridge } from '../../server/codex-bridge';
import { RuntimeStore } from '../../server/runtime-store';
import { Coordinator } from '../../server/coordinator';
import { project, reportedSessionUsage, conversationRounds } from '../../web/model/projection';
import type { RuntimeCommand } from '../../contracts/runtime';
import { canvasGuidance } from '../../contracts/canvas';
import { McpStore } from '../../server/mcp-store';

let directory: string, bridge: CodexBridge, store: RuntimeStore, coordinator: Coordinator;
function setup(mode = 'normal', timeout = 1000) {
  bridge = new CodexBridge({
    file: process.execPath,
    args: [resolve('tests/fixtures/codex-app-server.mjs')],
    projectDir: directory,
    env: { ECHIDNA_TEST_RPC_MODE: mode, ECHIDNA_TEST_RPC_LOG: join(directory, 'requests.jsonl') },
    requestTimeoutMs: timeout,
  });
  store = new RuntimeStore(join(directory, 'runtime.sqlite'), bridge);
  coordinator = new Coordinator(
    store,
    bridge,
    new McpStore(':memory:', join(directory, 'credentials')),
  );
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'canvas-codex-process-'));
});
afterEach(() => {
  coordinator.close();
  rmSync(directory, { recursive: true, force: true });
});
const create: RuntimeCommand = {
  version: 1,
  commandId: 'process-create',
  type: 'agent.create',
  config: {
    name: '研究员',
    avatar: 'echidna',
    model: 'fixture-model',
    personality: '先解释，再行动',
  },
  task: '自由交流',
};
const start = (id: string, text: string): RuntimeCommand => ({
  version: 1,
  commandId: id,
  type: 'turn.start',
  agentId: 'agent/codex/process-create',
  text,
});
const session = () => project(store.events()).sessions['agent/codex/process-create'];
function fork(
  id: string,
  roundId: string,
  side: 'before' | 'after',
  sourceAgentId = 'agent/codex/process-create',
): RuntimeCommand {
  const entry = conversationRounds(project(store.events()), sourceAgentId).find(
    (entry) => entry.round.id === roundId,
  )!;
  return {
    version: 1,
    commandId: id,
    type: 'agent.fork',
    sourceAgentId,
    roundId,
    side,
    eventId: side === 'before' ? entry.round.inputEventId : entry.round.terminalEventId!,
  };
}
const requests = () =>
  readFileSync(join(directory, 'requests.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

it('passes the selected project to thread creation and keeps it on a conversation branch', async () => {
  setup();
  const root = join(directory, 'selected-project');
  const created = await coordinator.execute({ ...create, projectRoot: root });
  expect(created.status).toBe('acknowledged');
  expect(session().projectRoot).toBe(root);
  expect(requests().find((request) => request.method === 'thread/start').params.cwd).toBe(root);
  await coordinator.execute(start('project-message', '项目上下文'));
  await expect.poll(() => store.state().agents[0].state).toBe('idle');
  const branch = await coordinator.execute(fork('project-branch', 'fixture-turn-1', 'after'));
  expect(branch.status).toBe('acknowledged');
  expect(project(store.events()).sessions[branch.agentId].projectRoot).toBe(root);
  expect(requests().find((request) => request.method === 'thread/fork').params.cwd).toBe(root);
});

it('handshakes once and carries arbitrary multiline messages through two real subprocess turns', async () => {
  setup();
  const created = await coordinator.execute(create);
  expect(created.result).toMatchObject({
    sessionRef: 'fixture-thread',
    executionRef: 'fixture-session-root',
  });
  await coordinator.execute(start('message-1', '自定义消息一\n保持换行与 🦋'));
  await expect
    .poll(() => session().routes[0].rounds[0].response)
    .toBe('模拟子进程收到：自定义消息一\n保持换行与 🦋');
  await expect.poll(() => store.state().agents[0].state).toBe('idle');
  await coordinator.execute(start('message-2', '继续解释我刚才的问题'));
  await expect
    .poll(() => session().routes[0].rounds[1].response)
    .toBe('模拟子进程收到：继续解释我刚才的问题');
  await expect.poll(() => reportedSessionUsage(session())).toMatchObject({ input: 20, output: 10 });
  expect(session().runtime?.executionRef).toBe('fixture-session-root');
  expect(JSON.stringify(store.events())).not.toContain('private-raw-reasoning');
  expect(JSON.stringify(store.events())).not.toContain('not-canvas-content');
  const db = new DatabaseSync(join(directory, 'runtime.sqlite'), { readOnly: true });
  const sourceBytes = db
    .prepare('SELECT body FROM frames')
    .all()
    .map((r) => r.body)
    .join('\n');
  db.close();
  expect(sourceBytes).not.toContain('private-raw-reasoning');
  expect(sourceBytes).not.toContain('not-canvas-content');
  const sent = requests();
  expect(sent.slice(0, 3).map((r) => r.method)).toEqual([
    'initialize',
    'initialized',
    'account/read',
  ]);
  expect(sent.filter((r) => r.method === 'initialize')).toHaveLength(1);
  expect(sent.find((r) => r.method === 'thread/start').params).toMatchObject({
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    model: 'fixture-model',
  });
  const guidance = sent.find((r) => r.method === 'thread/start').params.developerInstructions;
  expect(guidance).toBe(canvasGuidance);
  expect(guidance).not.toContain(create.config.personality);
  expect(guidance).not.toContain(create.task);
  expect(guidance).not.toContain('Task assigned by the operator');
  expect(guidance).not.toContain('Operator working preferences');
  expect(guidance).not.toContain('Codex execution limits');
  expect(guidance).not.toContain('terminal network access is disabled');
  for (const request of sent.filter((r) => r.method === 'turn/start'))
    expect(request.params).toMatchObject({
      sandboxPolicy: { type: 'dangerFullAccess' },
      approvalPolicy: 'never',
    });
  expect(sent.find((r) => r.method === 'thread/start').params.dynamicTools[0].name).toBe(
    'echidna_canvas_note',
  );
  expect(sent.find((r) => r.method === 'thread/start').params.dynamicTools[1].name).toBe(
    'echidna_canvas_inspect',
  );
  expect(sent.filter((r) => r.method === 'turn/start').map((r) => r.params.input[0].text)).toEqual([
    '自定义消息一\n保持换行与 🦋',
    '继续解释我刚才的问题',
  ]);
});
it('reports when the runtime fails to confirm the requested full-access configuration', async () => {
  setup('restricted-sandbox');
  expect(await coordinator.execute(create)).toMatchObject({
    status: 'unknown',
    error: 'Codex 没有确认用户要求的完整访问模式。',
  });
  expect(requests().some((request) => request.method === 'turn/start')).toBe(false);
});

it('forks an exact historical prefix without later messages, tool replay, or changes to its parent', async () => {
  setup();
  await coordinator.execute(create);
  await coordinator.execute(start('past-message', 'PAST_PUBLIC_CONTEXT'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  await coordinator.execute(start('future-message', 'FUTURE_PRIVATE_CONTEXT'));
  await expect.poll(() => session().routes[0].rounds[1].outcome).toBe('completed');
  const parentBytes = JSON.stringify(store.events());
  const command = fork('fork-after-past', 'fixture-turn-1', 'after');
  const result = await coordinator.execute(command);
  expect(result.status).toBe('acknowledged');
  expect(result.result).toMatchObject({
    sessionRef: 'fixture-thread-2',
    executionRef: 'fixture-session-root',
  });
  expect(await coordinator.execute(command)).toEqual(result);
  expect(requests().filter((request) => request.method === 'thread/fork')).toHaveLength(1);
  expect(requests().find((request) => request.method === 'thread/fork').params).toMatchObject({
    threadId: 'fixture-thread',
    lastTurnId: 'fixture-turn-1',
    developerInstructions: canvasGuidance,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
  });
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(2);
  expect(JSON.stringify(store.events().slice(0, JSON.parse(parentBytes).length))).toBe(parentBytes);
  const inherited = () => conversationRounds(project(store.events()), result.agentId);
  expect(inherited().map((entry) => entry.round.input.task)).toEqual(['PAST_PUBLIC_CONTEXT']);
  expect(JSON.stringify(inherited())).not.toContain('FUTURE_PRIVATE_CONTEXT');
  await coordinator.execute({
    version: 1,
    commandId: 'branch-message',
    type: 'turn.start',
    agentId: result.agentId,
    text: 'BRANCH_ONLY_CONTEXT',
  });
  await expect.poll(() => inherited().at(-1)?.round.outcome).toBe('completed');
  expect(inherited().map((entry) => entry.round.input.task)).toEqual([
    'PAST_PUBLIC_CONTEXT',
    'BRANCH_ONLY_CONTEXT',
  ]);
  expect(session().routes[0].rounds).toHaveLength(2);
  const nested = await coordinator.execute(
    fork('fork-nested', 'fixture-turn-3', 'after', result.agentId),
  );
  expect(nested.status).toBe('acknowledged');
  expect(
    conversationRounds(project(store.events()), nested.agentId).map(
      (entry) => entry.round.input.task,
    ),
  ).toEqual(['PAST_PUBLIC_CONTEXT', 'BRANCH_ONLY_CONTEXT']);
  expect(
    JSON.stringify(store.events().filter((event) => event.sessionId === result.agentId)),
  ).not.toContain('FUTURE_PRIVATE_CONTEXT');
  const saved = JSON.stringify(store.events());
  coordinator.close();
  setup();
  expect(JSON.stringify(store.events())).toBe(saved);
  expect(
    conversationRounds(project(store.events()), nested.agentId).map(
      (entry) => entry.round.input.task,
    ),
  ).toEqual(['PAST_PUBLIC_CONTEXT', 'BRANCH_ONLY_CONTEXT']);
  expect(await coordinator.execute(command)).toEqual(result);
  expect(requests().filter((request) => request.method === 'thread/fork')).toHaveLength(2);
});

it('branches before a user message and starts an empty context before the first message', async () => {
  setup();
  await coordinator.execute(create);
  await coordinator.execute(start('first-message', 'FIRST_MESSAGE'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  await coordinator.execute(start('second-message', 'SECOND_MESSAGE'));
  await expect.poll(() => session().routes[0].rounds[1].outcome).toBe('completed');
  const beforeSecond = await coordinator.execute(fork('before-second', 'fixture-turn-2', 'before'));
  expect(
    conversationRounds(project(store.events()), beforeSecond.agentId).map(
      (entry) => entry.round.input.task,
    ),
  ).toEqual(['FIRST_MESSAGE']);
  const beforeFirst = await coordinator.execute(fork('before-first', 'fixture-turn-1', 'before'));
  expect(beforeFirst.status).toBe('acknowledged');
  expect(conversationRounds(project(store.events()), beforeFirst.agentId)).toEqual([]);
  expect(project(store.events()).sessions[beforeFirst.agentId].branch?.throughTurnId).toBeNull();
  expect(requests().filter((request) => request.method === 'thread/fork')).toHaveLength(1);
  expect(requests().filter((request) => request.method === 'thread/start')).toHaveLength(2);
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(2);
});

it('refuses an unmatched source or unfinished reply and allows branching before the active user input', async () => {
  setup('slow');
  await coordinator.execute(create);
  await coordinator.execute(start('active-message', 'ACTIVE_MESSAGE'));
  const point = fork('bad-source', 'fixture-turn-1', 'before');
  await expect(
    coordinator.execute({ ...point, eventId: 'unrelated-event' } as RuntimeCommand),
  ).rejects.toThrow('does not match');
  await expect(
    coordinator.execute({
      ...point,
      commandId: 'unfinished-reply',
      side: 'after',
    } as RuntimeCommand),
  ).rejects.toThrow('requires the selected reply to end');
  const created = await coordinator.execute({ ...point, commandId: 'before-active-input' });
  expect(created.status).toBe('acknowledged');
  expect(store.agent('agent/codex/process-create').state).toBe('running');
  expect(conversationRounds(project(store.events()), created.agentId)).toEqual([]);
  expect(requests().some((request) => request.method === 'turn/interrupt')).toBe(false);
});

for (const mode of ['fork-wrong-prefix', 'fork-hang'])
  it('keeps a failed fork unknown without replay or modifying the source: ' + mode, async () => {
    setup(mode, 500);
    await coordinator.execute(create);
    await coordinator.execute(start('source-1', 'PAST'));
    await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
    await coordinator.execute(start('source-2', 'LATER'));
    await expect.poll(() => session().routes[0].rounds[1].outcome).toBe('completed');
    const command = fork('unknown-fork', 'fixture-turn-1', 'after');
    const result = await coordinator.execute(command);
    expect(result.status).toBe('unknown');
    expect(await coordinator.execute(command)).toEqual(result);
    expect(project(store.events()).sessions[result.agentId]).toBeUndefined();
    expect(session().routes[0].rounds.map((round) => round.input.task)).toEqual(['PAST', 'LATER']);
    expect(store.agent('agent/codex/process-create').state).toBe('idle');
    expect(requests().filter((request) => request.method === 'thread/fork')).toHaveLength(1);
    expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(2);
  });
it('persists valid canvas annotations before replying, rejects unknown references and keeps the source contiguous', async () => {
  setup('canvas');
  await coordinator.execute(create);
  await coordinator.execute(start('canvas-message', '比较 SSE 和 WebSocket'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  const round = session().routes[0].rounds[0];
  expect(round.notes.map((n) => n.note.kind)).toEqual(['intent', 'decision']);
  expect(round.notes[1].note.refs).toEqual(['note:note-1']);
  const returned = requests().filter((r) => r.result?.contentItems);
  expect(returned.map((r) => r.result.success)).toEqual([true, true, false, true]);
  expect(returned[0].result.contentItems[0].text).toContain('note:note-1');
  expect(JSON.parse(returned[0].result.contentItems[0].text).tools).toEqual([]);
  const inspected = JSON.parse(returned[1].result.contentItems[0].text);
  expect(inspected).not.toHaveProperty('noteRef');
  expect(inspected.recentNotes).toEqual([
    { noteRef: 'note:note-1', title: '比较通信方式', kind: 'intent' },
  ]);
  expect(inspected).toMatchObject({
    toolRefs: ['tool:read-sample-1'],
    tools: [
      {
        toolRef: 'tool:read-sample-1',
        commandPreview: 'cat README.md',
        status: 'completed',
        exitCode: 0,
      },
    ],
  });
  expect(round.input.canvasContract).toBe('canvas-v2');
  expect(round.calls).toHaveLength(1);
  const db = new DatabaseSync(join(directory, 'runtime.sqlite'), { readOnly: true });
  const inspectFrames = db
    .prepare('SELECT body FROM frames')
    .all()
    .map((row) => JSON.parse(String(row.body)))
    .filter(
      (packet) =>
        packet.method === 'item/tool/call' && packet.params.tool === 'echidna_canvas_inspect',
    );
  db.close();
  expect(inspectFrames).toHaveLength(1);
  expect(inspectFrames[0].params.arguments).toEqual({});
  await coordinator.execute(start('canvas-next-turn', '另一轮比较'));
  await expect.poll(() => session().routes[0].rounds[1].outcome).toBe('completed');
  const next = requests()
    .filter((r) => r.result?.contentItems)
    .at(-1);
  expect(JSON.parse(next.result.contentItems[0].text).toolRefs).toEqual(['tool:read-sample-2']);
  expect(JSON.parse(next.result.contentItems[0].text).tools[0].toolRef).toBe('tool:read-sample-2');
  expect(store.state().agents[0].state).toBe('idle');
});
it('uses an explicit managed login flow while keeping credentials out of canvas events', async () => {
  setup('signed-out');
  const status = await bridge.status();
  expect(status.account).toBe('signed-out');
  expect(status.models).toEqual([]);
  expect(await bridge.login()).toMatchObject({
    flowId: 'login-fixture',
    url: 'https://auth.openai.com/fixture-authorize',
  });
  expect((await coordinator.execute(create)).status).toBe('rejected');
  expect(requests().some((r) => r.method === 'thread/start')).toBe(false);
  expect(store.events()).toEqual([]);
});

it('publishes native defaults and applies supported settings to new and forked sessions', async () => {
  setup();
  const status = await bridge.status();
  expect(status.models[0]).toMatchObject({
    isDefault: true,
    settings: [
      { key: 'reasoningEffort', defaultValue: 'medium' },
      { key: 'personality', defaultValue: '' },
    ],
  });
  const config = {
    ...create.config,
    harnessSettings: { reasoningEffort: 'high', personality: 'none' as const },
  };
  expect((await coordinator.execute({ ...create, config })).status).toBe('acknowledged');
  expect(requests().find((request) => request.method === 'thread/start').params).toMatchObject({
    config: { model_reasoning_effort: 'high', personality: 'none' },
    developerInstructions: canvasGuidance,
  });
  await coordinator.execute(start('settings-message', '固定样本'));
  await expect.poll(() => store.state().agents[0].state).toBe('idle');
  const branch = await coordinator.execute(fork('settings-fork', 'fixture-turn-1', 'after'));
  expect(branch.status).toBe('acknowledged');
  expect(project(store.events()).sessions[branch.agentId].config.harnessSettings).toEqual(
    config.harnessSettings,
  );
  expect(
    requests().find((request) => request.method === 'thread/fork').params.config,
  ).toMatchObject({
    model_reasoning_effort: 'high',
    personality: 'none',
  });
});

it('rejects settings absent from the live model catalog before starting a thread', async () => {
  setup();
  const rejected = await coordinator.execute({
    ...create,
    config: {
      ...create.config,
      harnessSettings: { reasoningEffort: 'unsupported-effort' },
    },
  });
  expect(rejected.status).toBe('rejected');
  expect(requests().some((request) => request.method === 'thread/start')).toBe(false);
});

it('supports browser and API-key authentication without recording a secret', async () => {
  setup();
  expect(await bridge.login({ method: 'browser' })).toEqual({
    flowId: 'login-browser-fixture',
    url: 'https://auth.openai.com/fixture-browser',
  });
  const secret = 'test-only-secret-not-a-real-key';
  expect(await bridge.login({ method: 'api-key', apiKey: secret })).toEqual({ type: 'api-key' });
  expect(JSON.stringify(requests())).not.toContain(secret);
  expect(JSON.stringify(store.state())).not.toContain(secret);
});

it('keeps a native authentication rejection visible without echoing the submitted key', async () => {
  setup('login-error');
  const secret = 'test-only-rejected-secret';
  await expect(bridge.login({ method: 'api-key', apiKey: secret })).rejects.toThrow(
    'account/login/start',
  );
  expect(JSON.stringify(requests())).not.toContain(secret);
  expect(store.events()).toEqual([]);
});

it('binds a versioned MCP to one Agent through a context-preserving native fork without starting a turn', async () => {
  setup();
  const connection = coordinator.mcp!.save({
    name: 'Docker fixture',
    kind: 'docker',
    url: 'http://localhost:8811/mcp',
    auth: { method: 'bearer' },
    secret: 'test-only-mcp-secret',
  });
  await coordinator.execute(create);
  const other = await coordinator.execute({
    ...create,
    commandId: 'unrelated-project',
    projectRoot: '/another/project',
  });
  await coordinator.execute(start('before-mcp', '保留原对话'));
  await expect.poll(() => store.state().agents[0].state).toBe('idle');
  const before = structuredClone(session().routes);
  const command = {
    version: 1,
    commandId: 'bind-mcp',
    type: 'agent.mcp.configure',
    agentId: 'agent/codex/process-create',
    connections: [{ id: connection.id, revision: 1 }],
  } as const;
  const bound = await coordinator.execute({ ...command, connections: [...command.connections] });
  expect(bound.status).toBe('acknowledged');
  expect(session().routes).toEqual(before);
  expect(session().connections).toEqual(command.connections);
  expect(project(store.events()).sessions[other.agentId].connections).toBeUndefined();
  const receipt = store.events().find((event) => event.data.type === 'session.mcp.configured')!;
  expect(
    project(store.events(), receipt.seq - 1).sessions[command.agentId].connections,
  ).toBeUndefined();
  expect(store.agent(command.agentId).thread_id).not.toBe('fixture-thread');
  expect(await coordinator.execute({ ...command, connections: [...command.connections] })).toEqual(
    bound,
  );
  expect(requests().filter((request) => request.method === 'thread/fork')).toHaveLength(1);
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(1);
  expect(JSON.stringify(store.state())).not.toContain('test-only-mcp-secret');
  expect(JSON.stringify(requests())).not.toContain('test-only-mcp-secret');
  const oldSource = store
    .events()
    .filter((event) => event.runtime?.streamId === 'before-mcp')
    .at(-1)!.runtime!;
  store.ingest(command.agentId, {
    version: 1,
    streamId: 'before-mcp',
    sourceSeq: oldSource.sourceSeq + 1,
    packet: {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'fixture-thread',
        turnId: 'fixture-turn-1',
        tokenUsage: { total: { inputTokens: 15, outputTokens: 6 } },
      },
    },
  });
  expect(store.events().at(-1)!.runtime!.sessionRef).toBe('fixture-thread');
  expect(store.agent(command.agentId).thread_id).not.toBe('fixture-thread');
  expect(store.agent(command.agentId).state).toBe('idle');
  coordinator.mcp!.save({
    name: 'New config',
    id: connection.id,
    baseRevision: 1,
    kind: 'docker',
    url: connection.url,
    auth: { method: 'bearer' },
    secret: 'test-only-rotated-key',
  });
  const branch = await coordinator.execute(fork('mcp-child', 'fixture-turn-1', 'after'));
  expect(project(store.events()).sessions[branch.agentId].connections).toEqual(command.connections);
  expect(session().connections).toEqual(command.connections);
});

it('retains an unknown MCP binding command and never repeats its native fork', async () => {
  setup('fork-hang');
  await coordinator.execute(create);
  await coordinator.execute(start('mcp-unknown-prefix', '保留已结束回合'));
  await expect.poll(() => store.state().agents[0].state).toBe('idle');
  const command: RuntimeCommand = {
    version: 1,
    commandId: 'unknown-mcp',
    type: 'agent.mcp.configure',
    agentId: 'agent/codex/process-create',
    connections: [],
  };
  expect((await coordinator.execute(command)).status).toBe('unknown');
  expect((await coordinator.execute(command)).status).toBe('unknown');
  expect(requests().filter((request) => request.method === 'thread/fork')).toHaveLength(1);
  expect(store.agent(command.agentId).state).toBe('unknown');
  expect(session().connections).toBeUndefined();
});

it('settles a known background command from its actual late completion without replay', async () => {
  setup('late-command');
  await coordinator.execute(create);
  await coordinator.execute(start('late-command-message', '启动后台任务'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  expect(store.agent('agent/codex/process-create').state).toBe('unknown');
  expect(session().routes[0].rounds[0].calls[0].receipt).toBeUndefined();
  await bridge.status();
  await expect.poll(() => store.agent('agent/codex/process-create').state).toBe('idle');
  expect(session().routes[0].rounds[0].calls[0]).toMatchObject({
    status: 'returned',
    result: 'late output',
    receipt: expect.stringContaining('item-completed'),
  });
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(1);
});

it('rejects a late completion whose command differs from the admitted tool', async () => {
  setup('late-command-mismatch');
  await coordinator.execute(create);
  await coordinator.execute(start('late-command-mismatch', '验证迟到回执来源'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  await expect(bridge.status()).rejects.toThrow('completion contract mismatch');
  expect(store.agent('agent/codex/process-create').state).toBe('unknown');
  expect(session().routes[0].rounds[0].calls[0].receipt).toBeUndefined();
});

it('keeps read-state metadata separate from turn completion and accepts later turns', async () => {
  setup('read-state');
  await coordinator.execute(create);
  await coordinator.execute(start('read-state-first', '第一轮'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  await coordinator.execute(start('read-state-second', '继续对话'));
  await expect.poll(() => session().routes[0].rounds[1].outcome).toBe('completed');
  expect(store.agent('agent/codex/process-create').state).toBe('idle');
  expect(session().routes[0].connected).toBe(true);
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(2);
  expect(store.events().some((event) => event.data.type === 'connection.lost')).toBe(false);
});

it('rejects malformed native read-state metadata without fabricating a turn outcome', async () => {
  setup('invalid-read-state');
  await coordinator.execute(create);
  await coordinator.execute(start('read-state-invalid', '验证协议边界'));
  await expect.poll(() => store.agent('agent/codex/process-create').state).toBe('unknown');
  expect(session().routes[0].connectionError).toContain('thread/readState/changed');
  expect(session().routes[0].rounds[0].outcome).toBeUndefined();
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(1);
});

it('reports an unsupported item type without leaking its body or fabricating a completed reply', async () => {
  setup('unsupported-item');
  await coordinator.execute(create);
  await coordinator.execute(start('unsupported-message', '上海今天天气怎么样'));
  await expect.poll(() => store.state().agents[0].state).toBe('unknown');
  const route = session().routes[0],
    round = route.rounds[0];
  expect(route.connected).toBe(false);
  expect(route.connectionError).toContain('item.type=fixtureUnknownTool');
  expect(route.connectionError).toContain('params.item.type');
  expect(route.connectionError).not.toContain('fake-sensitive-token');
  expect(round.response).toBe('正在查询天气。');
  expect(round.outcome).toBeUndefined();
  expect(round.complete).toBe(false);
  expect(round.calls).toEqual([]);
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(1);
  expect(JSON.stringify(store.events())).not.toContain('fake-sensitive-token');
});
it('finishes native item streams without disconnecting and exposes exact tool references to canvas inspect', async () => {
  setup('native-items');
  await coordinator.execute(create);
  await coordinator.execute(start('native-message', '检查工具与预览'));
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('completed');
  expect(store.state().agents[0].state).toBe('idle');
  expect(session().routes[0].connected).toBe(true);
  const round = session().routes[0].rounds[0];
  expect(round.calls).toHaveLength(6);
  expect(round.calls.every((call) => call.status === 'returned' && call.receipt)).toBe(true);
  expect(round.calls.filter((call) => call.previews?.length)).toHaveLength(3);
  expect(store.agents()).toHaveLength(1);
  const inspection = requests().find(
    (request) => request.id === 'native-inspect' && request.result,
  );
  const content = JSON.parse(inspection.result.contentItems[0].text);
  expect(content.toolRefs).toEqual([
    'tool:mcp',
    'tool:web',
    'tool:patch',
    'tool:view',
    'tool:sleep',
    'tool:image',
  ]);
  expect(content.tools[1]).toMatchObject({
    toolRef: 'tool:web',
    tool: 'codex.webSearch',
    status: 'item/completed',
  });
  expect(content.tools[0]).toMatchObject({ tool: 'codex.mcpToolCall', status: 'completed' });
  expect(requests().filter((request) => request.method === 'turn/start')).toHaveLength(1);
  const db = new DatabaseSync(join(directory, 'runtime.sqlite'), { readOnly: true });
  const frames = JSON.stringify(db.prepare('SELECT body FROM frames').all());
  db.close();
  expect(frames).not.toContain('private-hook-instructions');
  expect(frames).not.toContain('private-transport-metadata');
  expect(frames).not.toContain('private-raw-reasoning');
  expect(frames).not.toContain('aggregate-diff-not-canvas-content');
});
for (const mode of ['exit', 'rpc-error', 'approval', 'hang'])
  it('retains an unknown dispatch without replay when transport mode is ' + mode, async () => {
    setup(mode, 500);
    await coordinator.execute(create);
    const command = start('unknown-message', '不要重复派发');
    const result = await coordinator.execute(command);
    expect(result.status).toBe('unknown');
    expect(result.error).not.toContain('fake-sensitive-token');
    expect(store.state().agents[0].state).toBe('unknown');
    expect(await coordinator.execute(command)).toEqual(result);
    expect(requests().filter((r) => r.method === 'turn/start')).toHaveLength(1);
  });
it('separates an interrupt request from its observed terminal notification', async () => {
  setup('slow');
  await coordinator.execute(create);
  await coordinator.execute(start('slow-message', '长一点的任务'));
  const result = await coordinator.execute({
    version: 1,
    commandId: 'stop-message',
    type: 'turn.interrupt',
    agentId: 'agent/codex/process-create',
    turnId: 'fixture-turn-1',
  });
  expect(result.status).toBe('acknowledged');
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('interrupted');
  expect(session().routes[0].rounds[0].interruptRequested).toBe(true);
});
it('admits a new correction after confirmed interruption without inventing a pending tool result', async () => {
  setup('interrupt-open-tool');
  await coordinator.execute(create);
  await coordinator.execute(start('waiting-message', '等待任务'));
  await expect.poll(() => session().routes[0].rounds[0].calls.length).toBe(1);
  await coordinator.execute({
    version: 1,
    commandId: 'interrupt-pending',
    type: 'turn.interrupt',
    agentId: 'agent/codex/process-create',
    turnId: 'fixture-turn-1',
  });
  await expect.poll(() => session().routes[0].rounds[0].outcome).toBe('interrupted');
  expect(store.state().agents[0].state).toBe('idle');
  expect(session().routes[0].rounds[0].calls[0]).toMatchObject({ status: 'unknown' });
  const correction = start('correction-message', '换个方向，不重放旧命令');
  expect((await coordinator.execute(correction)).status).toBe('acknowledged');
  await coordinator.execute(correction);
  expect(requests().filter((r) => r.method === 'turn/start')).toHaveLength(2);
  expect(session().routes[0].rounds[0].calls[0].receipt).toBeUndefined();
  expect(
    session().routes[0].rounds[0].assessments.some((entry) => entry.source === '终端交互'),
  ).toBe(true);
  expect(JSON.stringify(store.events())).not.toContain('private-stdin-not-for-canvas');
});
