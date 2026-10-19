import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  canonical,
  commandSchema,
  runtimeStateSchema,
  type CommandRecord,
  type RuntimeCommand,
  type RuntimeState,
  type BackendDescriptor,
} from '../contracts/runtime.ts';
import {
  eventSchema,
  type EventData,
  type RecordedEvent,
  type AgentConfig,
} from '../web/model/schema.ts';
import {
  project,
  resolveBranchPoint,
  publicBranchContext,
  conversationRounds,
} from '../web/model/projection.ts';
import type { McpRef } from '../contracts/mcp.ts';
import type { RuntimeBridge, RuntimeCodec, RuntimeFrame } from './runtime-port.ts';

export class CommandConflict extends Error {}
interface AgentRow {
  id: string;
  thread_id: string;
  config: string;
  task: string;
  state: 'idle' | 'running' | 'unknown';
  turn_id: string | null;
}
interface CommandRow {
  id: string;
  body: string;
  agent_id: string;
  status: CommandRecord['status'];
  result: string | null;
  error: string | null;
}

export class RuntimeStore {
  readonly storeId: string;
  readonly backend: BackendDescriptor;
  private codec: RuntimeCodec;
  private db: DatabaseSync;
  private eventCache: RecordedEvent[] = [];
  constructor(path: string, runtime: Pick<RuntimeBridge, 'descriptor' | 'codec'>) {
    this.backend = runtime.descriptor;
    this.codec = runtime.codec;
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
      if (version !== 0 && version !== 1 && version !== 2)
        throw new Error('Unsupported runtime database version');
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, config TEXT NOT NULL, task TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT);
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, body TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agents(id), status TEXT NOT NULL, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS frames (stream_id TEXT NOT NULL REFERENCES commands(id), source_seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(stream_id, source_seq));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
    `);
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?, ?)').run('store_id', randomUUID());
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?, ?)').run('revision', '0');
      this.storeId = this.db.prepare('SELECT value FROM meta WHERE key=?').get('store_id')!
        .value as string;
      const recordedBackend = this.db
        .prepare("SELECT value FROM meta WHERE key='backend_id'")
        .get();
      if (recordedBackend && recordedBackend.value !== this.backend.id)
        throw new Error('Runtime database belongs to a different backend');
      if (!recordedBackend && this.agents().length && this.backend.id !== 'codex-fixture')
        throw new Error('P2 database requires its original fixture backend');
      this.db
        .prepare('INSERT OR IGNORE INTO meta VALUES (?, ?)')
        .run('backend_id', this.backend.id);
      runtimeStateSchema.parse(this.state());
      // A restart never restarts dispatched work. Pending effects need reconciliation.
      this.transaction(() => {
        const pending = this.db
          .prepare("SELECT id,agent_id FROM commands WHERE status='dispatching'")
          .all();
        this.db.exec(
          "UPDATE commands SET status='unknown', error='服务重启；派发结果待核对。' WHERE status='dispatching'",
        );
        const ids = new Set([
          ...pending
            .filter((r) => !this.hasTerminalOutcome(r.id as string))
            .map((r) => r.agent_id as string),
          ...this.agents()
            .filter((a) => a.state === 'running')
            .map((a) => a.id),
        ]);
        for (const id of ids) this.markUnknown(id, '服务重启；执行结果待核对。');
      });
      project(this.events());
      this.db.exec('PRAGMA user_version=2');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'");
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.eventCache = [];
      throw error;
    }
  }
  agents() {
    return this.db.prepare('SELECT * FROM agents ORDER BY rowid').all() as unknown as AgentRow[];
  }
  agent(id: string) {
    const row = this.db.prepare('SELECT * FROM agents WHERE id=?').get(id) as unknown as
      AgentRow | undefined;
    if (!row) throw new CommandConflict('Agent 不存在');
    return row;
  }
  events(after = 0): RecordedEvent[] {
    const known = this.eventCache.length;
    const added = this.db
      .prepare('SELECT seq,body FROM events WHERE seq>? ORDER BY seq')
      .all(known)
      .map((row, index) => {
        const event = eventSchema.parse(JSON.parse(row.body as string));
        if (
          row.seq !== known + index + 1 ||
          event.seq !== row.seq ||
          event.runtime?.cursor !== row.seq ||
          event.runtime.storeId !== this.storeId ||
          event.id !== `runtime/${this.storeId}/${row.seq}`
        )
          throw new Error('Stored runtime event identity or sequence is inconsistent');
        return event;
      });
    this.eventCache.push(...added);
    return this.eventCache.slice(after);
  }
  cursor() {
    return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM events').get()!
      .cursor as number;
  }
  imageSource(event: RecordedEvent, index: number) {
    const origin = event.runtime!;
    const row = this.db
      .prepare('SELECT body FROM frames WHERE stream_id=? AND source_seq=?')
      .get(origin.streamId, origin.sourceSeq);
    if (!row) throw new Error('Recorded image source frame is missing');
    const source = this.codec.validate(JSON.parse(row.body as string)).images?.[index];
    if (!source) throw new Error('Recorded image part is missing from its source frame');
    return source;
  }
  command(id: string): CommandRecord {
    const row = this.db.prepare('SELECT * FROM commands WHERE id=?').get(id) as unknown as
      CommandRow | undefined;
    if (!row) throw new CommandConflict('命令不存在');
    const body = commandSchema.parse(JSON.parse(row.body));
    return {
      commandId: id,
      type: body.type,
      agentId: row.agent_id,
      status: row.status,
      result: row.result === null ? null : JSON.parse(row.result),
      error: row.error,
    };
  }
  hasCommand(id: string) {
    return !!this.db.prepare('SELECT id FROM commands WHERE id=?').get(id);
  }
  state(): RuntimeState {
    return {
      version: 2,
      backend: this.backend,
      storeId: this.storeId,
      revision: Number(this.db.prepare("SELECT value FROM meta WHERE key='revision'").get()!.value),
      cursor: this.cursor(),
      events: this.events(),
      commands: this.db
        .prepare('SELECT id FROM commands ORDER BY rowid')
        .all()
        .map((r) => this.command(r.id as string)),
      agents: this.agents().map((a) => ({
        id: a.id,
        sessionRef: a.thread_id,
        state: a.state,
        turnId: a.turn_id,
      })),
    };
  }
  admit(command: RuntimeCommand): { fresh: boolean; record: CommandRecord } {
    if (
      command.type === 'agent.create' &&
      command.harnessId !== undefined &&
      command.harnessId !== this.backend.id
    )
      throw new CommandConflict('所选 harness 与当前本地服务不一致，请重新连接后创建。');
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT body FROM commands WHERE id=?')
        .get(command.commandId);
      if (existing) {
        if (existing.body !== canonical(command))
          throw new CommandConflict('同一个 commandId 不能绑定不同的请求');
        return { fresh: false, record: this.command(command.commandId) };
      }
      const agentId =
        command.type === 'agent.create' || command.type === 'agent.fork'
          ? `agent/${this.backend.id}/${command.commandId}`
          : command.agentId;
      if (command.type === 'agent.create')
        this.db
          .prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?, NULL)')
          .run(agentId, '', JSON.stringify(command.config), command.task, 'idle');
      else if (command.type === 'agent.fork') {
        const point = this.forkContext(command);
        this.db
          .prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?, NULL)')
          .run(agentId, '', JSON.stringify(point.config), point.task, 'idle');
      } else {
        const agent = this.agent(agentId);
        if (
          command.type === 'agent.mcp.configure' &&
          (!this.backend.capabilities.mcp || agent.state !== 'idle' || !agent.thread_id)
        )
          throw new CommandConflict('MCP 接入只能应用到支持该能力的已知空闲 Agent。');
        if (
          (command.type === 'turn.start' || command.type === 'agent.mcp.configure') &&
          this.db
            .prepare("SELECT id FROM commands WHERE agent_id=? AND status='dispatching'")
            .get(agentId)
        )
          throw new CommandConflict('此 Agent 有命令正在确认，请先核对结果。');
        if (command.type === 'turn.start' && (agent.state !== 'idle' || !agent.thread_id))
          throw new CommandConflict('Agent 不处于可开始新回合的已知空闲状态');
        if (
          command.type === 'turn.interrupt' &&
          (agent.state !== 'running' || agent.turn_id !== command.turnId)
        )
          throw new CommandConflict('只能中断当前已知的活跃回合');
        if (command.type === 'turn.start')
          this.db
            .prepare("UPDATE agents SET state='running', turn_id=NULL WHERE id=?")
            .run(agentId);
      }
      this.db
        .prepare('INSERT INTO commands VALUES (?, ?, ?, ?, NULL, NULL)')
        .run(command.commandId, canonical(command), agentId, 'dispatching');
      return { fresh: true, record: this.command(command.commandId) };
    });
  }
  forkContext(command: Extract<RuntimeCommand, { type: 'agent.fork' }>) {
    if (!this.backend.capabilities.fork)
      throw new CommandConflict('当前运行时尚未提供会话分叉接口');
    const source = this.agent(command.sourceAgentId);
    if (!source.thread_id) throw new CommandConflict('分支来源还没有确认的运行时会话');
    const projection = project(this.events());
    let point: ReturnType<typeof resolveBranchPoint>;
    try {
      point = resolveBranchPoint(
        projection,
        command.sourceAgentId,
        command.roundId,
        command.side,
        command.eventId,
      );
    } catch (cause) {
      throw new CommandConflict(cause instanceof Error ? cause.message : String(cause), { cause });
    }
    const config = JSON.parse(source.config) as AgentConfig;
    return {
      sessionRef: source.thread_id,
      projectRoot: projection.sessions[source.id].projectRoot,
      connections: projection.sessions[source.id].connections ?? [],
      turnIds: point.context.filter((entry) => entry.round.complete).map((entry) => entry.round.id),
      config: { ...config, name: config.name + ' · 分支' },
      task: point.entry.round.input.task,
      origin: point.origin,
      partial: [
        ...point.context
          .slice(point.context.findLastIndex((entry) => entry.round.complete) + 1)
          .map((entry) => publicBranchContext(entry.round)),
        ...(point.partial ? [publicBranchContext(point.partial)] : []),
      ],
    };
  }
  configurationContext(agentId: string) {
    const agent = this.agent(agentId),
      view = project(this.events());
    const context = conversationRounds(view, agentId);
    return {
      sessionRef: agent.thread_id,
      config: JSON.parse(agent.config) as AgentConfig,
      projectRoot: view.sessions[agentId].projectRoot,
      turnIds: context.filter((entry) => entry.round.complete).map((entry) => entry.round.id),
      partial: context
        .slice(context.findLastIndex((entry) => entry.round.complete) + 1)
        .map((entry) => publicBranchContext(entry.round)),
    };
  }
  mcpConfigured(
    commandId: string,
    connections: McpRef[],
    sessionRef: string,
    model: string,
    executionRef?: string,
  ) {
    return this.transaction(() => {
      const command = this.command(commandId);
      const events = this.append(
        command.agentId,
        [{ type: 'session.mcp.configured', connections, model }],
        {
          streamId: commandId,
          sourceSeq: 1,
          method: 'session/mcp:response',
          sessionRef,
          ...(executionRef ? { executionRef } : {}),
        },
      );
      const config = { ...(JSON.parse(this.agent(command.agentId).config) as AgentConfig), model };
      this.db
        .prepare('UPDATE agents SET thread_id=?,config=?,turn_id=NULL WHERE id=?')
        .run(sessionRef, JSON.stringify(config), command.agentId);
      this.setAcknowledged(commandId, { sessionRef, ...(executionRef ? { executionRef } : {}) });
      return events;
    });
  }
  private append(
    agentId: string,
    data: EventData[],
    origin: Omit<NonNullable<RecordedEvent['runtime']>, 'cursor' | 'storeId'>,
  ): RecordedEvent[] {
    const before = this.events();
    const added = data.map((entry, i) => {
      const seq = before.length + i + 1;
      return eventSchema.parse({
        id: `runtime/${this.storeId}/${seq}`,
        seq,
        sessionId: agentId,
        routeId: 'r1',
        source: this.backend.mode === 'fixture' ? 'fixture' : 'runtime',
        data: entry,
        runtime: { ...origin, backendId: this.backend.id, storeId: this.storeId, cursor: seq },
      });
    });
    project([...before, ...added]);
    const insert = this.db.prepare('INSERT INTO events VALUES (?, ?)');
    for (const event of added) insert.run(event.seq, JSON.stringify(event));
    return added;
  }
  created(
    commandId: string,
    sessionRef: string,
    model: string,
    executionRef?: string,
  ): RecordedEvent[] {
    return this.transaction(() => {
      const command = this.command(commandId),
        agent = this.agent(command.agentId);
      const request = commandSchema.parse(
        JSON.parse(
          this.db.prepare('SELECT body FROM commands WHERE id=?').get(commandId)!.body as string,
        ),
      );
      const fork = request.type === 'agent.fork' ? this.forkContext(request) : undefined;
      const branch = fork?.origin;
      const projectRoot = request.type === 'agent.create' ? request.projectRoot : fork?.projectRoot;
      const connections = request.type === 'agent.create' ? request.connections : fork?.connections;
      const added = this.append(
        agent.id,
        [
          {
            type: 'session.created',
            config: { ...(JSON.parse(agent.config) as AgentConfig), model },
            parentId: null,
            ...(projectRoot ? { projectRoot } : {}),
            ...(connections ? { connections } : {}),
            ...(branch ? { branch } : {}),
          },
          { type: 'route.started', task: agent.task, materials: [], origin: null },
        ],
        {
          streamId: commandId,
          sourceSeq: 1,
          method: branch ? 'session/fork:response' : 'session/create:response',
          sessionRef,
          ...(executionRef ? { executionRef } : {}),
        },
      );
      this.db
        .prepare('UPDATE agents SET thread_id=?,config=? WHERE id=?')
        .run(
          sessionRef,
          JSON.stringify({ ...(JSON.parse(agent.config) as AgentConfig), model }),
          agent.id,
        );
      this.setAcknowledged(commandId, { sessionRef, ...(executionRef ? { executionRef } : {}) });
      return added;
    });
  }
  acknowledge(id: string, result: Record<string, string>) {
    this.transaction(() => this.setAcknowledged(id, result));
  }
  private setAcknowledged(id: string, result: Record<string, string>) {
    this.db
      .prepare("UPDATE commands SET status='acknowledged', result=?, error=NULL WHERE id=?")
      .run(JSON.stringify(result), id);
  }
  uncertain(id: string, message: string) {
    return this.transaction(() => {
      this.db.prepare("UPDATE commands SET status='unknown', error=? WHERE id=?").run(message, id);
      // A lost RPC acknowledgement cannot erase an already observed terminal outcome.
      return this.hasTerminalOutcome(id) ? [] : this.markUnknown(this.command(id).agentId, message);
    });
  }
  private hasTerminalOutcome(id: string): boolean {
    const command = this.command(id);
    const request = commandSchema.parse(
      JSON.parse(this.db.prepare('SELECT body FROM commands WHERE id=?').get(id)!.body as string),
    );
    return this.events().some(
      (event) =>
        event.sessionId === command.agentId &&
        event.data.type === 'round.terminated' &&
        (request.type === 'turn.start'
          ? event.runtime?.streamId === id
          : request.type === 'turn.interrupt' && event.data.roundId === request.turnId),
    );
  }
  reject(id: string, message: string) {
    this.transaction(() => {
      const command = this.command(id);
      this.db.prepare("UPDATE commands SET status='rejected', error=? WHERE id=?").run(message, id);
      if (command.type === 'turn.start')
        this.db.prepare("UPDATE agents SET state='idle' WHERE id=?").run(command.agentId);
    });
  }
  private markUnknown(agentId: string, reason: string): RecordedEvent[] {
    const agent = this.agent(agentId);
    this.db.prepare("UPDATE agents SET state='unknown' WHERE id=?").run(agentId);
    if (!agent.thread_id || !project(this.events()).sessions[agentId]?.routes[0].connected)
      return [];
    return this.append(agentId, [{ type: 'connection.lost', reason }], {
      streamId: 'coordinator',
      sourceSeq: this.cursor() + 1,
      method: 'bridge/disconnected',
      sessionRef: agent.thread_id,
      ...(agent.turn_id ? { turnId: agent.turn_id } : {}),
    });
  }
  disconnected(agentId: string, reason: string): RecordedEvent[] {
    return this.transaction(() => this.markUnknown(agentId, reason));
  }
  interruptRequested(commandId: string, turnId: string): RecordedEvent[] {
    return this.transaction(() => {
      const command = this.command(commandId),
        agent = this.agent(command.agentId);
      const added = this.append(
        agent.id,
        [{ type: 'round.interrupt.requested', roundId: turnId }],
        {
          streamId: commandId,
          sourceSeq: 1,
          method: 'turn/interrupt:request',
          sessionRef: agent.thread_id,
          turnId,
        },
      );
      this.setAcknowledged(commandId, {});
      return added;
    });
  }
  ingest(agentId: string, frame: RuntimeFrame): RecordedEvent[] {
    if (frame.version !== 1) throw new Error('Unsupported bridge frame version');
    const packet = this.codec.validate(frame.packet);
    return this.transaction(() => {
      const duplicate = this.db
        .prepare('SELECT body FROM frames WHERE stream_id=? AND source_seq=?')
        .get(frame.streamId, frame.sourceSeq);
      const body = canonical(packet.payload);
      if (duplicate) {
        if (duplicate.body !== body)
          throw new Error('Runtime source identity was reused with different data');
        return [];
      }
      const prior = this.db
        .prepare('SELECT body,source_seq FROM frames WHERE stream_id=? ORDER BY source_seq')
        .all(frame.streamId);
      if (frame.sourceSeq !== prior.length + 1) throw new Error('Runtime source sequence gap');
      const command = this.command(frame.streamId),
        agent = this.agent(agentId);
      const initial = prior.length
        ? this.codec.validate(JSON.parse(prior[0].body as string))
        : undefined;
      if (
        command.agentId !== agentId ||
        command.type !== 'turn.start' ||
        packet.sessionRef !== (initial?.sessionRef ?? agent.thread_id)
      )
        throw new Error('Runtime source ownership mismatch');
      const request = commandSchema.parse(
        JSON.parse(
          this.db.prepare('SELECT body FROM commands WHERE id=?').get(frame.streamId)!
            .body as string,
        ),
      );
      if (request.type !== 'turn.start')
        throw new Error('Runtime turn requires its admitted input');
      const data = this.codec.project(
        [...prior.map((r) => JSON.parse(r.body as string)), packet.payload],
        { events: this.events(), agentId, input: request.text, mode: this.backend.mode },
      );
      // Only a contiguous suffix from the same admitted source can restore delivery.
      if (
        packet.sessionRef === agent.thread_id &&
        !project(this.events()).sessions[agentId].routes[0].connected
      )
        data.unshift({ type: 'connection.restored' });
      const turnId = packet.turnId;
      if (initial && initial.turnId !== turnId) throw new Error('Runtime turn identity changed');
      const itemId = packet.itemId;
      this.db
        .prepare('INSERT INTO frames VALUES (?, ?, ?)')
        .run(frame.streamId, frame.sourceSeq, body);
      const added = this.append(agentId, data, {
        streamId: frame.streamId,
        sourceSeq: frame.sourceSeq,
        method: packet.method,
        sessionRef: packet.sessionRef,
        turnId,
        ...(itemId ? { itemId } : {}),
      });
      if (data.some((event) => event.type === 'round.started'))
        this.db.prepare('UPDATE agents SET turn_id=? WHERE id=?').run(turnId, agentId);
      if (
        data.some((event) =>
          ['round.terminated', 'tool.finished', 'tool.failed'].includes(event.type),
        )
      ) {
        const round = project(this.events()).sessions[agentId].routes[0].rounds.at(-1)!;
        if (round.complete && round.id === turnId && packet.sessionRef === agent.thread_id) {
          const unresolved = round.calls.some((c) =>
            ['preparing', 'running', 'unknown'].includes(c.status),
          );
          this.db
            .prepare('UPDATE agents SET state=? WHERE id=?')
            .run(unresolved && round.outcome !== 'interrupted' ? 'unknown' : 'idle', agentId);
        }
      }
      return added;
    });
  }
}
