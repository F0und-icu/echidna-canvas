import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { commandSchema, type RuntimeCommand } from '../../contracts/runtime';
import { RuntimeStore } from '../../server/runtime-store';
import { Coordinator } from '../../server/coordinator';
import { FixtureCodexBridge } from '../../server/fixture-bridge';
import { CodexJsonlDecoder, notificationSchema, type Frame } from '../../server/codex-protocol';
import { project } from '../../web/model/projection';
import { createWorkspace } from '../../web/model/workspace';
import { mergeRuntime } from '../../web/runtime/connection';

const create: RuntimeCommand = {
  version: 1,
  commandId: 'create-1',
  type: 'agent.create',
  config: { name: 'Codex', avatar: 'echidna', model: 'fixture', personality: '只使用可确认的来源' },
  task: '检查项目',
};
const start = (
  scenario: 'success' | 'tool-failure' | 'disconnect' | 'dispatch-unknown' = 'success',
  commandId = 'start-1',
): Extract<RuntimeCommand, { type: 'turn.start' }> => ({
  version: 1,
  commandId,
  type: 'turn.start',
  agentId: 'agent/codex-fixture/create-1',
  text: '核对文件',
  scenario,
});
let store: RuntimeStore, coordinator: Coordinator, bridge: FixtureCodexBridge;
const dirs: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  bridge = new FixtureCodexBridge();
  store = new RuntimeStore(':memory:', bridge);
  coordinator = new Coordinator(store, bridge);
});
afterEach(() => {
  coordinator.close();
  vi.useRealTimers();
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
const round = () =>
  project(store.events()).sessions['agent/codex-fixture/create-1'].routes[0].rounds.at(-1)!;
async function ready() {
  await coordinator.execute(create);
}

describe('Codex protocol boundary', () => {
  it('decodes the same notifications across every UTF-8 byte split', () => {
    const packet = {
      method: 'item/agentMessage/delta',
      params: { threadId: 't', turnId: 'u', itemId: 'i', delta: '中文 🦋' },
    };
    const bytes = new TextEncoder().encode(`${JSON.stringify(packet)}\n`);
    for (let i = 0; i <= bytes.length; i++) {
      const decoder = new CodexJsonlDecoder();
      expect([...decoder.push(bytes.slice(0, i)), ...decoder.push(bytes.slice(i))]).toEqual([
        packet,
      ]);
      decoder.finish();
    }
  });
  it('rejects incomplete, malformed, unsupported and oversized wire data', () => {
    const decoder = new CodexJsonlDecoder();
    decoder.push(new TextEncoder().encode('{'));
    expect(() => decoder.finish()).toThrow('Truncated');
    expect(() => new CodexJsonlDecoder().push(new Uint8Array([0xff]))).toThrow();
    expect(() => new CodexJsonlDecoder().push(new TextEncoder().encode('{}\n'))).toThrow();
    expect(() =>
      new CodexJsonlDecoder().push(new TextEncoder().encode('x'.repeat(32 * 1024 * 1024 + 1))),
    ).toThrow('32 MiB');
    expect(() => notificationSchema.parse({ method: 'unrecognized', params: {} })).toThrow();
  });
  it('accepts a split inline image frame larger than the old 1 MiB limit', () => {
    const packet = {
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'u',
        item: {
          type: 'mcpToolCall',
          id: 'image',
          server: 'fixture',
          tool: 'image',
          arguments: {},
          status: 'completed',
          result: {
            content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(2 * 1024 * 1024) }],
          },
        },
      },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(packet) + '\n');
    const decoder = new CodexJsonlDecoder();
    expect(decoder.push(bytes.subarray(0, 1024 * 1024 + 1))).toEqual([]);
    expect(decoder.push(bytes.subarray(1024 * 1024 + 1))).toEqual([packet]);
    decoder.finish();
  });
  it('does not retain raw reasoning content or accept credentials in a command', () => {
    const packet = notificationSchema.parse({
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'u',
        item: { id: 'i', type: 'reasoning', summary: ['公开摘要'], content: ['private block'] },
      },
    });
    expect(JSON.stringify(packet)).not.toContain('private block');
    expect(() => commandSchema.parse({ ...create, apiKey: 'fake' })).toThrow();
    expect(() => commandSchema.parse({ ...create, version: 2 })).toThrow();
    const text = '  保留首尾空格\n以及换行\n';
    expect(commandSchema.parse({ ...start(), text })).toMatchObject({ text });
    expect(() => commandSchema.parse({ ...start(), text: ' \n ' })).toThrow();
  });
});

describe('durable command admission and source projection', () => {
  it('does not publish success or translate a persistence failure into a tool outcome', async () => {
    const published: unknown[] = [];
    coordinator.changes.on('change', (events) => {
      if (events.length) published.push(events);
    });
    vi.spyOn(store, 'created').mockImplementationOnce(() => {
      throw new Error('injected persistence failure');
    });
    await expect(coordinator.execute(create)).rejects.toThrow('injected persistence failure');
    expect(store.command('create-1').status).toBe('dispatching');
    expect(store.events()).toEqual([]);
    expect(published).toEqual([]);
  });
  it('deduplicates command retries and refuses reusing identity with different input', async () => {
    const spy = vi.spyOn(bridge, 'createSession');
    const first = await coordinator.execute(create),
      second = await coordinator.execute(create);
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.agents()).toHaveLength(1);
    expect(store.events()).toHaveLength(2);
    await expect(coordinator.execute({ ...create, task: '另一个任务' })).rejects.toThrow(
      'commandId',
    );
  });
  it('keeps turn scope, replaces final item text, and never invents sampling or decisions', async () => {
    await ready();
    await coordinator.execute(start());
    await vi.advanceTimersByTimeAsync(370);
    expect(round().calls[0].status).toBe('preparing');
    expect(round().calls[0].receipt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(round().summary).toBe('先核对项目文件，再说明可确认的范围。');
    expect(round().response).toBe('协议演示：已列出两个文件；没有读取或修改真实项目。');
    expect(round().unit).toBe('turn');
    expect(round().decisions).toEqual([]);
    expect(round().modelDone).toBe(false);
    expect(round().calls[0].result).toBe('README.md\nsrc/main.ts\n');
    expect(round().calls[0].receipt).toContain('item-completed');
    expect(round().outcome).toBe('completed');
    expect(store.state().agents[0].state).toBe('idle');
    const firstInput = structuredClone(round().input);
    await coordinator.execute(start('success', 'start-2'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(
      project(store.events()).sessions['agent/codex-fixture/create-1'].routes[0].rounds,
    ).toHaveLength(2);
    expect(
      project(store.events()).sessions['agent/codex-fixture/create-1'].routes[0].rounds[0].input,
    ).toEqual(firstInput);
  });
  it('serializes concurrent turns and preserves failed command output', async () => {
    await ready();
    await coordinator.execute(start('tool-failure'));
    await expect(coordinator.execute(start('success', 'concurrent'))).rejects.toThrow('空闲');
    await vi.advanceTimersByTimeAsync(1200);
    expect(round().calls[0].status).toBe('failed');
    expect(round().calls[0].result).toContain('path unavailable');
    expect(round().calls[0].error).toContain('退出 2');
    expect(round().response).toContain('未据此宣布任务完成');
  });
  it('keeps a dispatched command unknown and never dispatches it again on retry', async () => {
    await ready();
    const spy = vi.spyOn(bridge, 'startTurn');
    const first = await coordinator.execute(start('dispatch-unknown'));
    expect(first.status).toBe('unknown');
    expect(store.state().agents[0].state).toBe('unknown');
    expect(await coordinator.execute(start('dispatch-unknown'))).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(coordinator.execute(start('success', 'new-unsafe-turn'))).rejects.toThrow('空闲');
    expect(store.events().some((e) => e.data.type === 'tool.finished')).toBe(false);
  });
  it('keeps a disconnected command running with no fabricated cancellation or receipt', async () => {
    await ready();
    await coordinator.execute(start('disconnect'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(store.state().agents[0].state).toBe('unknown');
    expect(round().calls[0].status).toBe('running');
    expect(round().calls[0].receipt).toBeUndefined();
    expect(round().complete).toBe(false);
    expect(
      project(store.events()).sessions['agent/codex-fixture/create-1'].routes[0].connected,
    ).toBe(false);
  });
  it('separates interrupt acknowledgement from executor confirmation and unresolved commands', async () => {
    await ready();
    await coordinator.execute(start());
    await vi.advanceTimersByTimeAsync(460);
    await coordinator.execute({
      version: 1,
      commandId: 'interrupt',
      type: 'turn.interrupt',
      agentId: 'agent/codex-fixture/create-1',
      turnId: 'turn_start-1',
    });
    expect(round().interruptRequested).toBe(true);
    expect(round().outcome).toBeUndefined();
    expect(store.state().agents[0].state).toBe('running');
    await expect(
      coordinator.execute({ ...start(), commandId: 'too-early-correction' }),
    ).rejects.toThrow('Agent 不处于可开始新回合的已知空闲状态');
    await vi.advanceTimersByTimeAsync(60);
    expect(round().outcome).toBe('interrupted');
    expect(round().calls[0].receipt).toBeUndefined();
    expect(round().calls[0].status).toBe('unknown');
    expect(store.state().agents[0].state).toBe('idle');
  });
  it('deduplicates source frames and rejects gaps, conflicts, wrong owners and versions', async () => {
    await ready();
    store.admit(start());
    const frame: Frame = {
      version: 1,
      streamId: 'start-1',
      sourceSeq: 1,
      packet: {
        method: 'turn/started',
        params: { threadId: 'thr_create-1', turn: { id: 'turn_1', status: 'inProgress' } },
      },
    };
    const before = store.events().length;
    store.ingest('agent/codex-fixture/create-1', frame);
    const after = store.events().length;
    expect(after).toBe(before + 1);
    expect(store.ingest('agent/codex-fixture/create-1', frame)).toEqual([]);
    expect(store.events()).toHaveLength(after);
    expect(() => store.ingest('agent/codex-fixture/create-1', { ...frame, sourceSeq: 3 })).toThrow(
      'gap',
    );
    expect(() =>
      store.ingest('agent/codex-fixture/create-1', {
        ...frame,
        packet: {
          method: 'turn/started',
          params: { threadId: 'other', turn: { id: 'other', status: 'inProgress' } },
        },
      }),
    ).toThrow('identity');
    expect(() =>
      store.ingest('agent/codex-fixture/create-1', {
        ...frame,
        sourceSeq: 2,
        packet: {
          method: 'turn/started',
          params: { threadId: 'other', turn: { id: 'other', status: 'inProgress' } },
        },
      }),
    ).toThrow('ownership');
    expect(() =>
      store.ingest('agent/codex-fixture/create-1', { ...frame, version: 2 as 1 }),
    ).toThrow('version');
    expect(store.events()).toHaveLength(after);
  });
  it('keeps declined and missing-exit-code items distinct from verified executions', async () => {
    await ready();
    store.admit(start());
    let seq = 0;
    const push = (packet: Frame['packet']) =>
      store.ingest('agent/codex-fixture/create-1', {
        version: 1,
        streamId: 'start-1',
        sourceSeq: ++seq,
        packet,
      });
    const scope = { threadId: 'thr_create-1', turnId: 'turn_1' };
    push({
      method: 'turn/started',
      params: { threadId: scope.threadId, turn: { id: scope.turnId, status: 'inProgress' } },
    });
    for (const [id, status] of [
      ['declined', 'declined'],
      ['unknown', 'failed'],
    ] as const) {
      const item = {
        type: 'commandExecution' as const,
        id,
        command: 'check',
        cwd: '/fixture',
        status: 'inProgress' as const,
      };
      push({ method: 'item/started', params: { ...scope, item } });
      push({
        method: 'item/completed',
        params: { ...scope, item: { ...item, status, exitCode: null } },
      });
    }
    expect(round().calls.map((call) => call.status)).toEqual(['rejected', 'unknown']);
    expect(round().calls.every((call) => !call.receipt)).toBe(true);
  });
});

describe('restart and browser event prefixes', () => {
  it('retains a completed execution across restart with a still-unacknowledged interrupt', async () => {
    coordinator.close();
    const path = mkdtempSync(join(tmpdir(), 'echidna-interrupt-restart-'));
    dirs.push(path);
    store = new RuntimeStore(join(path, 'runtime.sqlite'), bridge);
    coordinator = new Coordinator(store, bridge);
    await ready();
    await coordinator.execute(start());
    await vi.advanceTimersByTimeAsync(20);
    store.admit({
      version: 1,
      commandId: 'pending-interrupt',
      type: 'turn.interrupt',
      agentId: start().agentId,
      turnId: 'turn_start-1',
    });
    await vi.advanceTimersByTimeAsync(1200);
    coordinator.close();
    store = new RuntimeStore(join(path, 'runtime.sqlite'), bridge);
    coordinator = new Coordinator(store, bridge);
    expect(store.command('pending-interrupt').status).toBe('unknown');
    expect(round().outcome).toBe('completed');
    expect(store.state().agents[0].state).toBe('idle');
  });
  it('migrates a P2 fixture database without rewriting historical event bytes', async () => {
    const path = mkdtempSync(join(tmpdir(), 'echidna-p2-migration-'));
    dirs.push(path);
    const file = join(path, 'runtime.sqlite');
    const seed = new RuntimeStore(file, bridge);
    seed.admit(create);
    seed.created(create.commandId, 'thr_create-1', 'Codex（协议夹具）');
    seed.close();
    const sql = new DatabaseSync(file);
    sql.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
    sql.exec("DELETE FROM meta WHERE key='backend_id'; PRAGMA user_version=1;");
    sql.prepare('UPDATE agents SET id=?').run('codex/create-1');
    sql
      .prepare('UPDATE commands SET agent_id=?,result=?')
      .run('codex/create-1', JSON.stringify({ threadId: 'thr_create-1' }));
    const legacy = sql
      .prepare('SELECT seq,body FROM events ORDER BY seq')
      .all()
      .map((row) => {
        const event = JSON.parse(row.body as string);
        event.sessionId = 'codex/create-1';
        delete event.runtime.backendId;
        delete event.runtime.sessionRef;
        event.runtime.threadId = 'thr_create-1';
        event.runtime.method = 'thread/start:response';
        const body = JSON.stringify(event);
        sql.prepare('UPDATE events SET body=? WHERE seq=?').run(body, row.seq);
        return body;
      });
    sql.exec('COMMIT');
    sql.close();
    expect(
      () =>
        new RuntimeStore(file, {
          ...bridge,
          descriptor: { ...bridge.descriptor, id: 'own-agent' },
          codec: bridge.codec,
        }),
    ).toThrow('original fixture');
    const migrated = new RuntimeStore(file, bridge);
    expect(migrated.state().agents[0]).toMatchObject({
      id: 'codex/create-1',
      sessionRef: 'thr_create-1',
    });
    const workspace = mergeRuntime(createWorkspace(), migrated.state());
    expect(project(workspace.events).sessions['codex/create-1'].runtime?.threadId).toBe(
      'thr_create-1',
    );
    migrated.close();
    const inspected = new DatabaseSync(file);
    expect(inspected.prepare('PRAGMA user_version').get()!.user_version).toBe(2);
    expect(
      inspected
        .prepare('SELECT body FROM events ORDER BY seq')
        .all()
        .map((r) => r.body),
    ).toEqual(legacy);
    inspected.close();
  });
  it('keeps observed completion when an interrupt acknowledgement is lost', async () => {
    await ready();
    await coordinator.execute(start());
    await vi.advanceTimersByTimeAsync(20);
    vi.spyOn(bridge, 'interrupt').mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(1200);
      throw new Error('interrupt acknowledgement lost');
    });
    const result = await coordinator.execute({
      version: 1,
      commandId: 'late-interrupt',
      type: 'turn.interrupt',
      agentId: start().agentId,
      turnId: 'turn_start-1',
    });
    expect(result.status).toBe('unknown');
    expect(round().outcome).toBe('completed');
    expect(store.state().agents[0].state).toBe('idle');
    expect(project(store.events()).sessions[start().agentId].routes[0].connected).toBe(true);
  });
  it('reconciles a contiguous late result from its original stream without another dispatch', async () => {
    await ready();
    store.admit(start());
    let seq = 0;
    const scope = { threadId: 'thr_create-1', turnId: 'turn-late' };
    const push = (packet: Frame['packet']) =>
      store.ingest('agent/codex-fixture/create-1', {
        version: 1,
        streamId: 'start-1',
        sourceSeq: ++seq,
        packet,
      });
    push({
      method: 'turn/started',
      params: { threadId: scope.threadId, turn: { id: scope.turnId, status: 'inProgress' } },
    });
    const item = {
      type: 'commandExecution' as const,
      id: 'command-late',
      command: 'read',
      cwd: '/fixture',
      status: 'inProgress' as const,
    };
    push({ method: 'item/started', params: { ...scope, item } });
    push({
      method: 'item/commandExecution/outputDelta',
      params: { ...scope, itemId: item.id, delta: 'prefix' },
    });
    store.disconnected('agent/codex-fixture/create-1', 'test transport disconnected');
    const prefix = store.events();
    push({
      method: 'item/completed',
      params: {
        ...scope,
        item: { ...item, status: 'completed', exitCode: 0, aggregatedOutput: 'complete result' },
      },
    });
    push({
      method: 'turn/completed',
      params: {
        threadId: scope.threadId,
        turn: { id: scope.turnId, status: 'completed', error: null },
      },
    });
    expect(store.events().slice(0, prefix.length)).toEqual(prefix);
    expect(round().calls[0].result).toBe('complete result');
    expect(store.state().agents[0].state).toBe('idle');
    expect(store.events().filter((e) => e.data.type === 'tool.started')).toHaveLength(1);
    expect(
      project(store.events()).sessions['agent/codex-fixture/create-1'].routes[0].connected,
    ).toBe(true);
  });
  it('rejects inconsistent persisted event identities without resetting the database', async () => {
    const path = mkdtempSync(join(tmpdir(), 'echidna-corrupt-'));
    dirs.push(path);
    const file = join(path, 'runtime.sqlite'),
      otherStore = new RuntimeStore(file, bridge),
      other = new Coordinator(otherStore, bridge);
    await other.execute(create);
    const event = otherStore.events()[0];
    other.close();
    const sql = new DatabaseSync(file);
    const bad = JSON.stringify({ ...event, seq: 99 });
    sql.prepare('UPDATE events SET body=? WHERE seq=1').run(bad);
    sql.close();
    expect(() => new RuntimeStore(file, bridge)).toThrow('inconsistent');
    const inspect = new DatabaseSync(file);
    expect(inspect.prepare('SELECT body FROM events WHERE seq=1').get()!.body).toBe(bad);
    inspect.close();
  });
  it('restores immutable facts and marks pending dispatches unknown without resending', async () => {
    coordinator.close();
    const path = mkdtempSync(join(tmpdir(), 'echidna-store-'));
    dirs.push(path);
    store = new RuntimeStore(join(path, 'runtime.sqlite'), bridge);
    coordinator = new Coordinator(store, bridge);
    await ready();
    store.admit(start());
    store.ingest('agent/codex-fixture/create-1', {
      version: 1,
      streamId: 'start-1',
      sourceSeq: 1,
      packet: {
        method: 'turn/started',
        params: { threadId: 'thr_create-1', turn: { id: 'turn_1', status: 'inProgress' } },
      },
    });
    const prefix = store.events(),
      id = store.storeId;
    coordinator.close();
    store = new RuntimeStore(join(path, 'runtime.sqlite'), bridge);
    coordinator = new Coordinator(store, bridge);
    expect(store.storeId).toBe(id);
    expect(store.events().slice(0, prefix.length)).toEqual(prefix);
    expect(store.command('start-1').status).toBe('unknown');
    expect(store.state().agents[0].state).toBe('unknown');
    expect(await coordinator.execute(start())).toMatchObject({ status: 'unknown' });
    expect(store.events().filter((e) => e.data.type === 'round.started')).toHaveLength(1);
  });
  it('imports a committed prefix exactly once and keeps old history frozen', async () => {
    await ready();
    const first = store.state();
    let w = mergeRuntime(createWorkspace(), first);
    const frozen = project(w.events),
      length = w.events.length;
    await coordinator.execute(start());
    await vi.advanceTimersByTimeAsync(1200);
    const full = store.state();
    w = mergeRuntime(w, full);
    expect(project(w.events, length)).toEqual(frozen);
    expect(mergeRuntime(w, full).events).toEqual(w.events);
    expect(mergeRuntime(w, first).events).toEqual(w.events);
    expect(w.events.at(-1)?.runtime?.cursor).toBe(full.cursor);
    expect(() => mergeRuntime(w, { ...full, storeId: 'another-store' })).toThrow('变更');
    expect(() =>
      mergeRuntime(createWorkspace(), { ...full, events: full.events.slice(1) }),
    ).toThrow('缺口');
    const bad = structuredClone(full);
    bad.events[0].data = { type: 'connection.lost' };
    expect(() => mergeRuntime(w, bad)).toThrow('不一致');
  });
});
