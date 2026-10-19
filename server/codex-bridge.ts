import { z } from 'zod';
import type { AgentConfig } from '../web/model/schema.ts';
import type {
  RuntimeCommand,
  BackendStatus,
  LoginResult,
  HarnessLogin,
} from '../contracts/runtime.ts';
import { loginResultSchema } from '../contracts/runtime.ts';
import { canonical } from '../contracts/runtime.ts';
import { RuntimeRequestRejected, type RuntimeBridge, type RuntimeFrame } from './runtime-port.ts';
import { codexCodec, notificationSchema } from './codex-protocol.ts';
import { nativeTool } from './codex-items.ts';
import { StdioRpc } from './stdio-rpc.ts';
import { mcpServerName } from '../contracts/mcp.ts';
import type { ResolvedMcp } from './mcp-store.ts';
import {
  CanvasNoteRejected,
  canvasCallSchema,
  canvasTool,
  canvasGuidance,
  canvasInspectTool,
  type CanvasNote,
} from '../contracts/canvas.ts';

const accountSchema = z.object({
  requiresOpenaiAuth: z.boolean(),
  account: z.object({ type: z.string() }).nullable().optional(),
});
const modelPage = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      model: z.string(),
      displayName: z.string(),
      description: z.string(),
      isDefault: z.boolean(),
      defaultReasoningEffort: z.string().min(1),
      supportedReasoningEfforts: z.array(
        z.object({ reasoningEffort: z.string().min(1), description: z.string() }),
      ),
      supportsPersonality: z.boolean().default(false),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});
const threadResponse = z.object({
  model: z.string(),
  cwd: z.string(),
  sandbox: z.object({ type: z.string() }),
  thread: z.object({ id: z.string(), sessionId: z.string() }),
});
const turnResponse = z.object({ turn: z.object({ id: z.string() }) });
const forkResponse = threadResponse.extend({
  thread: z.object({
    id: z.string(),
    sessionId: z.string(),
    forkedFromId: z.string(),
    turns: z.array(z.object({ id: z.string() })),
  }),
});
const controlMethods = new Set([
  'thread/started',
  'thread/status/changed',
  'thread/name/updated',
  'account/updated',
  'account/login/completed',
  'account/rateLimits/updated',
  'skills/changed',
  'app/list/updated',
  'serverRequest/resolved',
]);
type AdmittedTurn = {
  commandId: string;
  turnId: string | null;
  seq: number;
  emit: (frame: RuntimeFrame) => void;
  fault: (error: Error) => void;
  tools: Map<
    string,
    {
      toolRef: string;
      commandPreview: string;
      tool: string;
      status: string;
      exitCode?: number | null;
    }
  >;
  notes: Map<string, { noteRef: string; title: string; kind: CanvasNote['kind'] }>;
};

export class CodexBridge implements RuntimeBridge {
  readonly descriptor = {
    id: 'codex',
    label: 'Codex',
    mode: 'live' as const,
    capabilities: { chat: true, interrupt: true, login: true, fork: true, mcp: true },
  };
  readonly codec = codexCodec;
  private rpc: StdioRpc;
  private initialized: Promise<void> | null = null;
  private sessions = new Set<string>();
  private forkedTurns = new Map<string, Set<string>>();
  private active = new Map<string, AdmittedTurn>();
  private notices = new Set<string>();
  private mcpStartup = new Map<string, { state: string; error?: string }>();
  private completed = new Map<string, AdmittedTurn & { sessionRef: string }>();
  private projectDir: string;
  constructor(options: {
    file: string;
    args: string[];
    projectDir: string;
    env: NodeJS.ProcessEnv;
    requestTimeoutMs?: number;
  }) {
    this.projectDir = options.projectDir;
    this.rpc = new StdioRpc({
      file: options.file,
      args: options.args,
      cwd: options.projectDir,
      env: options.env,
      requestTimeoutMs: options.requestTimeoutMs,
      onNotification: (message) => this.receive(message),
      onRequest: (message) => this.toolCall(message),
      onFailure: (error) => {
        this.notices.add(error.message);
        for (const turn of this.active.values()) turn.fault(error);
        this.active.clear();
      },
    });
  }
  private initialize() {
    if (!this.initialized)
      this.initialized = this.rpc
        .request('initialize', {
          clientInfo: { name: 'echidna_canvas', title: 'Echidna Canvas', version: '0.1.0' },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: ['item/reasoning/textDelta'],
          },
        })
        .then(() => {
          this.rpc.notify('initialized', {});
        });
    return this.initialized;
  }
  async status(): Promise<BackendStatus> {
    await this.initialize();
    const account = accountSchema.parse(
      await this.rpc.request('account/read', { refreshToken: false }),
    );
    const signedIn = Boolean(account.account) || !account.requiresOpenaiAuth;
    const models: BackendStatus['models'] = [];
    if (signedIn) {
      let cursor: string | null = null;
      const cursors = new Set<string>();
      do {
        const page = modelPage.parse(
          await this.rpc.request('model/list', {
            limit: 100,
            includeHidden: false,
            ...(cursor ? { cursor } : {}),
          }),
        );
        models.push(
          ...page.data.map((m) => ({
            id: m.model,
            label: m.displayName,
            description: m.description,
            isDefault: m.isDefault,
            settings: [
              ...(m.supportedReasoningEfforts.length
                ? [
                    {
                      key: 'reasoningEffort' as const,
                      label: '思考强度',
                      description: '由当前模型声明的思考强度。',
                      defaultValue: m.defaultReasoningEffort,
                      options: m.supportedReasoningEfforts.map((option) => ({
                        value: option.reasoningEffort,
                        label: option.reasoningEffort,
                        description: option.description,
                      })),
                    },
                  ]
                : []),
              ...(m.supportsPersonality
                ? [
                    {
                      key: 'personality' as const,
                      label: '内置人格',
                      description: '使用 Codex 原生人格设置；不会追加自定义开发者提示。',
                      defaultValue: '',
                      options: [
                        {
                          value: '',
                          label: 'Harness 默认',
                          description: '沿用当前 Codex 的内置人格。',
                        },
                        {
                          value: 'none',
                          label: '关闭内置人格',
                          description: '省略 Codex 内置人格指令。',
                        },
                      ],
                    },
                  ]
                : []),
            ],
          })),
        );
        cursor = page.nextCursor ?? null;
        if (cursor) {
          if (cursors.has(cursor)) throw new Error('Codex model catalog cursor repeated');
          cursors.add(cursor);
        }
      } while (cursor);
    }
    return {
      backend: this.descriptor,
      account: signedIn ? 'signed-in' : 'signed-out',
      models,
      authentication: {
        methods: ['browser', 'device-code', 'api-key'],
        activeMethod:
          account.account?.type === 'apiKey'
            ? 'api-key'
            : account.account?.type === 'chatgpt'
              ? 'browser'
              : null,
      },
      notices: [...this.notices],
    };
  }
  async login(request: HarnessLogin = { method: 'device-code' }): Promise<LoginResult> {
    await this.initialize();
    if (request.method === 'api-key') {
      z.object({ type: z.literal('apiKey') }).parse(
        await this.rpc.request('account/login/start', { type: 'apiKey', apiKey: request.apiKey }),
      );
      return { type: 'api-key' };
    }
    if (request.method === 'browser') {
      const result = z
        .object({ type: z.literal('chatgpt'), loginId: z.string(), authUrl: z.string() })
        .parse(await this.rpc.request('account/login/start', { type: 'chatgpt' }));
      return loginResultSchema.parse({ flowId: result.loginId, url: result.authUrl });
    }
    const response = z
      .object({
        type: z.literal('chatgptDeviceCode'),
        loginId: z.string(),
        verificationUrl: z.string(),
        userCode: z.string(),
      })
      .parse(await this.rpc.request('account/login/start', { type: 'chatgptDeviceCode' }));
    return loginResultSchema.parse({
      flowId: response.loginId,
      url: response.verificationUrl,
      userCode: response.userCode,
    });
  }
  async createSession(
    _commandId: string,
    config: AgentConfig,
    _task: string,
    projectRoot = this.projectDir,
    connections: ResolvedMcp[] = [],
  ) {
    const status = await this.status();
    if (status.account !== 'signed-in')
      throw new RuntimeRequestRejected('请先通过此应用启动的运行时登录。');
    if (!status.models.some((model) => model.id === config.model))
      throw new RuntimeRequestRejected('所选模型不在当前运行时目录中。');
    const model = status.models.find((model) => model.id === config.model)!;
    for (const [key, value] of Object.entries(config.harnessSettings ?? {})) {
      if (
        !model.settings!.some(
          (field) => field.key === key && field.options.some((option) => option.value === value),
        )
      )
        throw new RuntimeRequestRejected('所选配置不在当前模型支持的选项中。');
    }
    const result = threadResponse.parse(
      await this.rpc.request('thread/start', {
        model: config.model,
        cwd: projectRoot,
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        developerInstructions: canvasGuidance,
        dynamicTools: [canvasTool, canvasInspectTool],
        config: this.threadConfig(config, connections),
      }),
    );
    if (result.sandbox.type !== 'dangerFullAccess')
      throw new Error('Codex 没有确认用户要求的完整访问模式。');
    if (result.cwd !== projectRoot) throw new Error('Codex 返回的工作目录与所选项目档案不一致。');
    this.sessions.add(result.thread.id);
    return {
      sessionRef: result.thread.id,
      model: result.model,
      executionRef: result.thread.sessionId,
    };
  }
  async forkSession(
    commandId: string,
    sessionRef: string,
    turnIds: string[],
    config: AgentConfig,
    partial?: { input: string; records: string }[],
    projectRoot = this.projectDir,
    connections: ResolvedMcp[] = [],
  ) {
    const result = await this.forkPrefix(
      commandId,
      sessionRef,
      turnIds,
      config,
      projectRoot,
      connections,
    );
    for (const snapshot of partial ?? []) {
      z.object({}).parse(
        await this.rpc.request('thread/inject_items', {
          threadId: result.sessionRef,
          items: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: snapshot.input }],
            },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: snapshot.records }],
            },
          ],
        }),
      );
    }
    return result;
  }
  private async forkPrefix(
    commandId: string,
    sessionRef: string,
    turnIds: string[],
    config: AgentConfig,
    projectRoot: string,
    connections: ResolvedMcp[],
  ) {
    if (!turnIds.length) return this.createSession(commandId, config, '', projectRoot, connections);
    await this.initialize();
    const result = await this.rpc.request(
      'thread/fork',
      {
        threadId: sessionRef,
        lastTurnId: turnIds.at(-1),
        model: config.model,
        cwd: projectRoot,
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        developerInstructions: canvasGuidance,
        config: this.threadConfig(config, connections),
      },
      (raw) => {
        const result = forkResponse.parse(raw);
        if (
          result.thread.id === sessionRef ||
          result.thread.forkedFromId !== sessionRef ||
          canonical(result.thread.turns.map((turn) => turn.id)) !== canonical(turnIds)
        )
          throw new Error('Codex 返回的分支历史与选定上下文前缀不一致。');
        if (result.sandbox.type !== 'dangerFullAccess')
          throw new Error('Codex 没有确认用户要求的完整访问模式。');
        if (result.cwd !== projectRoot)
          throw new Error('Codex 返回的工作目录与分支项目档案不一致。');
        this.sessions.add(result.thread.id);
        this.forkedTurns.set(result.thread.id, new Set(turnIds));
        return result;
      },
    );
    return {
      sessionRef: result.thread.id,
      model: result.model,
      executionRef: result.thread.sessionId,
    };
  }
  async startTurn(
    command: Extract<RuntimeCommand, { type: 'turn.start' }>,
    sessionRef: string,
    emit: (frame: RuntimeFrame) => void,
    fault: (error: Error) => void,
  ) {
    if (command.scenario !== undefined)
      throw new RuntimeRequestRejected('真实运行时不接受协议演示场景。');
    if (!this.sessions.has(sessionRef))
      throw new RuntimeRequestRejected(
        '此会话尚未在当前进程加载。服务重启后的真实会话恢复尚未接入，请保留历史并创建新 Agent。',
      );
    const owner: AdmittedTurn = {
      commandId: command.commandId,
      turnId: null,
      seq: 0,
      emit,
      fault,
      tools: new Map(),
      notes: new Map(),
    };
    this.active.set(sessionRef, owner);
    const result = turnResponse.parse(
      await this.rpc.request('turn/start', {
        threadId: sessionRef,
        input: [{ type: 'text', text: command.text }],
        sandboxPolicy: { type: 'dangerFullAccess' },
        approvalPolicy: 'never',
      }),
    );
    if (owner.turnId !== null && owner.turnId !== result.turn.id)
      throw new Error('Codex 回合确认与事件身份不一致。');
    owner.turnId = result.turn.id;
    return { turnId: result.turn.id };
  }
  async interrupt(sessionRef: string, turnId: string) {
    await this.rpc.request('turn/interrupt', { threadId: sessionRef, turnId });
  }
  private threadConfig(config: AgentConfig, connections: ResolvedMcp[]) {
    return {
      ...(config.harnessSettings?.reasoningEffort
        ? { model_reasoning_effort: config.harnessSettings.reasoningEffort }
        : {}),
      ...(config.harnessSettings?.personality
        ? { personality: config.harnessSettings.personality }
        : {}),
      mcp_servers: Object.fromEntries(
        connections.map(({ connection, headers }) => [
          mcpServerName(connection.id),
          {
            url: connection.url,
            ...(Object.keys(headers).length ? { http_headers: headers } : {}),
          },
        ]),
      ),
    };
  }
  async mcpStatus(sessionRef: string) {
    if (!this.sessions.has(sessionRef))
      throw new RuntimeRequestRejected('此会话未在当前进程加载，请保留历史并创建新 Agent。');
    const results: {
      id: string;
      authStatus: string;
      toolCount: number;
      state?: string;
      error?: string;
    }[] = [];
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      const page = z
        .object({
          data: z.array(
            z.object({
              name: z.string(),
              authStatus: z.string(),
              tools: z.record(z.string(), z.unknown()),
              runtimeStatus: z.string().optional(),
              toolsError: z.string().nullable().optional(),
            }),
          ),
          nextCursor: z.string().nullable(),
        })
        .parse(
          await this.rpc.request('mcpServerStatus/list', {
            threadId: sessionRef,
            ...(cursor ? { cursor } : {}),
          }),
        );
      results.push(
        ...page.data.map((server) => {
          const startup = this.mcpStartup.get(sessionRef + '/' + server.name);
          const state = server.runtimeStatus ?? startup?.state;
          return {
            id: server.name,
            authStatus: server.authStatus,
            toolCount: Object.keys(server.tools).length,
            ...(state ? { state } : {}),
            // MCP errors can include an HTTP response body. Keep the failure visible
            // without publishing a remote service's possible credential echo.
            ...(server.toolsError
              ? { error: 'MCP 工具目录读取失败，请核对接入地址与认证。' }
              : startup?.error
                ? { error: startup.error }
                : {}),
          };
        }),
      );
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error('Codex MCP 状态目录游标重复。');
        cursors.add(cursor);
      }
    } while (cursor);
    return results;
  }
  async loginMcp(sessionRef: string, name: string) {
    if (!this.sessions.has(sessionRef))
      throw new RuntimeRequestRejected('此会话未在当前进程加载。');
    const response = z
      .object({ authorizationUrl: z.string() })
      .parse(await this.rpc.request('mcpServer/oauth/login', { threadId: sessionRef, name }));
    return { url: response.authorizationUrl };
  }
  private toolCall(message: { method: string; params: unknown }) {
    if (message.method !== 'item/tool/call')
      throw new Error('Unsupported Codex server request: ' + message.method);
    const request = z
      .object({
        threadId: z.string(),
        turnId: z.string(),
        callId: z.string(),
        tool: z.enum(['echidna_canvas_note', 'echidna_canvas_inspect']),
        namespace: z.string().nullable().optional(),
        arguments: z.unknown(),
      })
      .parse(message.params);
    const owner = this.active.get(request.threadId);
    if (!owner || owner.turnId !== request.turnId)
      throw new Error('Canvas request has no admitted active turn');
    const parsed = canvasCallSchema.safeParse({ tool: request.tool, arguments: request.arguments });
    const reject = (text: string) => ({
      success: false,
      contentItems: [{ type: 'inputText', text }],
    });
    if (!parsed.success)
      return reject(parsed.error.issues.map((issue) => issue.message).join('; '));
    try {
      this.receive({ method: 'item/tool/call', params: { ...request, ...parsed.data } });
    } catch (error) {
      if (error instanceof CanvasNoteRejected) return reject(error.message);
      throw error;
    }
    if (parsed.data.tool === 'echidna_canvas_note') {
      const note = parsed.data.arguments;
      owner.notes.set(request.callId, {
        noteRef: 'note:' + request.callId,
        title: note.title,
        kind: note.kind,
      });
    }
    return {
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: JSON.stringify({
            ...(request.tool === 'echidna_canvas_note'
              ? { noteRef: 'note:' + request.callId }
              : {}),
            toolRefs: [...owner.tools.values()].map((tool) => tool.toolRef),
            tools: [...owner.tools.values()].slice(-8),
            recentNotes: [...owner.notes.values()].slice(-8),
          }),
        },
      ],
    };
  }
  private receive(message: { method: string; params: unknown }) {
    if (message.method === 'mcpServer/startupStatus/updated') {
      const update = z
        .object({
          threadId: z.string().nullable(),
          name: z.string(),
          status: z.enum(['starting', 'ready', 'failed', 'cancelled']),
          error: z.string().nullable(),
          failureReason: z.literal('reauthenticationRequired').nullable(),
        })
        .parse(message.params);
      if (update.threadId)
        this.mcpStartup.set(update.threadId + '/' + update.name, {
          state: update.status,
          ...(update.status === 'failed'
            ? {
                error:
                  update.failureReason === 'reauthenticationRequired'
                    ? '此 MCP 需要重新授权。'
                    : 'MCP 初始化失败，请核对接入地址与认证。',
              }
            : {}),
        });
      this.notices.add(`MCP ${update.name}: ${update.status}`);
      return;
    }
    if (message.method === 'remoteControl/status/changed') {
      const { status } = z
        .object({
          status: z.enum(['disabled', 'connecting', 'connected', 'errored']),
          serverName: z.string(),
          installationId: z.string(),
          environmentId: z.string().nullable().optional(),
        })
        .parse(message.params);
      this.notices.add(`运行时远程控制状态：${status}`);
      return;
    }
    if (['warning', 'configWarning', 'deprecationNotice'].includes(message.method)) {
      const warning = z
        .union([z.object({ message: z.string() }), z.object({ summary: z.string() })])
        .parse(message.params);
      this.notices.add('message' in warning ? warning.message : warning.summary);
      return;
    }
    if (message.method === 'thread/readState/changed') {
      z.object({
        threadId: z.string(),
        readState: z.object({
          revision: z.string(),
          firstUnread: z
            .discriminatedUnion('type', [
              z.object({ type: z.literal('threadStart') }),
              z.object({ type: z.literal('turn'), turnId: z.string() }),
            ])
            .nullable()
            .optional(),
        }),
      }).parse(message.params);
      // Native read/unread metadata is independent of execution completion.
      this.notices.add('已处理运行时控制通知：thread/readState/changed');
      return;
    }
    if (controlMethods.has(message.method)) {
      z.record(z.string(), z.unknown()).parse(message.params);
      this.notices.add(`已处理运行时控制通知：${message.method}`);
      return;
    }
    const packet = notificationSchema.parse(message),
      source = this.codec.validate(packet);
    const current = this.active.get(source.sessionRef);
    // Native forks report usage for copied turn IDs, possibly after their new
    // turn starts. It belongs to inherited metadata, not a live parent turn.
    if (
      packet.method === 'thread/tokenUsage/updated' &&
      this.forkedTurns.get(source.sessionRef)?.has(source.turnId)
    ) {
      const total = packet.params.tokenUsage.total;
      this.notices.add(
        `分支继承历史的线程累计用量：输入 ${total.inputTokens}，输出 ${total.outputTokens}；这是初始化元数据，不是新回合用量。`,
      );
      return;
    }
    const owner =
      current &&
      (current.turnId === source.turnId ||
        (current.turnId === null && packet.method === 'turn/started'))
        ? current
        : this.completed.get(source.turnId);
    if (!owner) throw new Error('Codex event has no admitted active request');
    if ('sessionRef' in owner && owner.sessionRef !== source.sessionRef)
      throw new Error('Codex mixed session identities');
    if (owner.turnId && owner.turnId !== source.turnId)
      throw new Error('Codex mixed turn identities');
    owner.turnId = source.turnId;
    owner.emit({ version: 1, streamId: owner.commandId, sourceSeq: owner.seq + 1, packet });
    owner.seq++;
    if (packet.method === 'item/started' || packet.method === 'item/completed') {
      const item = packet.params.item;
      const description = nativeTool(item);
      if (description)
        owner.tools.set(item.id, {
          toolRef: 'tool:' + item.id,
          tool: description.tool,
          commandPreview: (item.type === 'commandExecution'
            ? item.command
            : description.title + ' ' + JSON.stringify(description.args)
          ).slice(0, 120),
          status: 'status' in item ? item.status : packet.method,
          ...(item.type === 'commandExecution' && item.exitCode !== undefined
            ? { exitCode: item.exitCode }
            : {}),
        });
    }
    if (packet.method === 'turn/completed') {
      this.active.delete(source.sessionRef);
      this.completed.set(source.turnId, { ...owner, sessionRef: source.sessionRef });
    }
  }
  close() {
    this.rpc.close();
  }
}
