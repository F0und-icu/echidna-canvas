import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';
const mode = process.env.ECHIDNA_TEST_RPC_MODE ?? 'normal';
const log = process.env.ECHIDNA_TEST_RPC_LOG;
let initialized = false,
  turns = 0;
const active = new Map();
const toolReplies = new Map();
const histories = new Map();
const lateCompletions = [];
let threadCount = 0;
function send(packet) {
  process.stdout.write(JSON.stringify(packet) + '\n');
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (log) {
    const safe = structuredClone(request);
    if (safe.method === 'account/login/start' && safe.params.type === 'apiKey')
      safe.params.apiKey = '[redacted]';
    for (const server of Object.values(safe.params?.config?.mcp_servers ?? {}))
      for (const name of Object.keys(server.http_headers ?? {}))
        server.http_headers[name] = '[redacted]';
    appendFileSync(log, JSON.stringify(safe) + '\n');
  }
  const reply = (result) => send({ id: request.id, result });
  if (!request.method) {
    const handler = toolReplies.get(request.id);
    if (handler) {
      toolReplies.delete(request.id);
      handler(request.result);
    }
    return;
  }
  if (request.method === 'initialize') {
    reply({ userAgent: 'fixture-cli/0.149.0' });
    return;
  }
  if (request.method === 'initialized') {
    initialized = true;
    send({
      method: 'remoteControl/status/changed',
      params: { status: 'disabled', serverName: 'fixture', installationId: 'fixture-install' },
    });
    return;
  }
  if (!initialized) {
    send({ id: request.id, error: { code: -32600, message: 'not initialized' } });
    return;
  }
  if (request.method === 'account/read') {
    reply({
      requiresOpenaiAuth: true,
      account: mode === 'signed-out' ? null : { type: 'chatgpt', email: 'fixture@example.invalid' },
    });
    for (const complete of lateCompletions.splice(0)) complete();
    return;
  }
  if (request.method === 'model/list') {
    reply({
      data: [
        {
          id: 'fixture-model',
          model: 'fixture-model',
          displayName: 'Fixture Model',
          description: 'Offline subprocess fixture',
          isDefault: true,
          defaultReasoningEffort: 'medium',
          supportsPersonality: true,
          supportedReasoningEfforts: [
            { reasoningEffort: 'low', description: 'Quick checks' },
            { reasoningEffort: 'medium', description: 'Balanced' },
            { reasoningEffort: 'high', description: 'Complex tasks' },
          ],
        },
      ],
      nextCursor: null,
    });
    return;
  }
  if (request.method === 'account/login/start') {
    if (request.params.type === 'apiKey') {
      if (mode === 'login-error')
        send({ id: request.id, error: { code: -32000, message: request.params.apiKey } });
      else reply({ type: 'apiKey' });
      return;
    }
    if (request.params.type === 'chatgpt') {
      reply({
        type: 'chatgpt',
        loginId: 'login-browser-fixture',
        authUrl: 'https://auth.openai.com/fixture-browser',
      });
      return;
    }
    reply({
      type: 'chatgptDeviceCode',
      loginId: 'login-fixture',
      verificationUrl: 'https://auth.openai.com/fixture-authorize',
      userCode: 'TEST-1234',
    });
    return;
  }
  if (request.method === 'thread/start') {
    const id = ++threadCount === 1 ? 'fixture-thread' : 'fixture-thread-' + threadCount;
    histories.set(id, {
      model: request.params.model,
      sessionId:
        id === 'fixture-thread' ? 'fixture-session-root' : 'fixture-session-' + threadCount,
      turns: [],
    });
    reply({
      model: request.params.model,
      cwd: request.params.cwd,
      sandbox: { type: mode === 'restricted-sandbox' ? 'readOnly' : 'dangerFullAccess' },
      thread: { id, sessionId: histories.get(id).sessionId },
    });
    return;
  }
  if (request.method === 'thread/fork') {
    if (mode === 'fork-hang') return;
    const source = histories.get(request.params.threadId);
    const index = source.turns.findIndex((turn) => turn.id === request.params.lastTurnId);
    if (index < 0) throw new Error('Fixture fork boundary missing');
    const id = 'fixture-thread-' + ++threadCount;
    const history = {
      model: request.params.model,
      sessionId: source.sessionId,
      inherited: true,
      turns: structuredClone(
        mode === 'fork-wrong-prefix' ? source.turns : source.turns.slice(0, index + 1),
      ),
    };
    histories.set(id, history);
    // One write reproduces a fork acknowledgement and initialization notice
    // decoded in the same input batch, before an awaited continuation can run.
    process.stdout.write(
      [
        {
          id: request.id,
          result: {
            model: history.model,
            cwd: request.params.cwd,
            sandbox: { type: 'dangerFullAccess' },
            thread: {
              id,
              sessionId: history.sessionId,
              forkedFromId: request.params.threadId,
              turns: history.turns,
            },
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: id,
            turnId: history.turns.at(-1).id,
            tokenUsage: { total: { inputTokens: 10, outputTokens: 5 } },
          },
        },
      ]
        .map((packet) => JSON.stringify(packet) + '\n')
        .join(''),
    );
    return;
  }
  if (request.method === 'turn/interrupt') {
    const turn = active.get(request.params.turnId);
    reply({});
    if (turn) {
      clearTimeout(turn.timer);
      send({
        method: 'turn/completed',
        params: {
          threadId: 'fixture-thread',
          turn: { id: request.params.turnId, status: 'interrupted', error: null },
        },
      });
      if (mode === 'interrupt-open-tool') active.set(request.params.turnId, { interrupted: true });
    }
    return;
  }
  if (request.method === 'turn/start') {
    if (mode === 'interrupt-open-tool')
      for (const [oldTurnId, old] of active) {
        if (!old.interrupted) continue;
        send({
          method: 'item/commandExecution/terminalInteraction',
          params: {
            threadId: request.params.threadId,
            turnId: oldTurnId,
            itemId: 'pending-command-1',
            processId: 'interrupted-process',
            stdin: 'private-stdin-not-for-canvas',
          },
        });
        active.delete(oldTurnId);
      }
    if (mode === 'exit') {
      process.exit(0);
      return;
    }
    if (mode === 'hang') return;
    if (mode === 'rpc-error') {
      send({ id: request.id, error: { code: -32603, message: 'fake-sensitive-token' } });
      return;
    }
    if (mode === 'approval') {
      send({
        id: 'server-approval',
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'fixture-thread', turnId: 'unstarted', itemId: 'approval' },
      });
      return;
    }
    const turnId = 'fixture-turn-' + ++turns,
      scope = { threadId: request.params.threadId, turnId },
      text = request.params.input[0].text;
    const packet = (method, params) => send({ method, params: { ...scope, ...params } });
    const inherited = histories.get(scope.threadId);
    if (inherited.inherited && inherited.turns.length)
      send({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: scope.threadId,
          turnId: inherited.turns.at(-1).id,
          tokenUsage: { total: { inputTokens: 10, outputTokens: 5 } },
        },
      });
    packet('turn/started', { turn: { id: turnId, status: 'inProgress' } });
    if (inherited.inherited && inherited.turns.length)
      send({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: scope.threadId,
          turnId: inherited.turns.at(-1).id,
          tokenUsage: { total: { inputTokens: 10, outputTokens: 5 } },
        },
      });
    packet('turn/moderationMetadata', { metadata: { opaque: 'not-canvas-content' } });
    reply({ turn: { id: turnId } });
    packet('item/started', {
      item: { type: 'userMessage', id: 'user', content: [{ type: 'text', text }] },
    });
    packet('item/completed', {
      item: { type: 'userMessage', id: 'user', content: [{ type: 'text', text }] },
    });
    packet('item/started', { item: { type: 'reasoning', id: 'thought' } });
    packet('item/reasoning/summaryPartAdded', { itemId: 'thought', summaryIndex: 0 });
    packet('item/reasoning/summaryTextDelta', {
      itemId: 'thought',
      summaryIndex: 0,
      delta: '公开摘要',
    });
    packet('item/reasoning/textDelta', {
      itemId: 'thought',
      contentIndex: 0,
      delta: 'private-raw-reasoning',
    });
    packet('item/completed', {
      item: {
        type: 'reasoning',
        id: 'thought',
        summary: ['公开摘要'],
        content: ['private-raw-reasoning'],
      },
    });
    if (mode === 'unsupported-item') {
      packet('item/started', { item: { type: 'agentMessage', id: 'partial', text: '' } });
      packet('item/completed', {
        item: { type: 'agentMessage', id: 'partial', text: '正在查询天气。' },
      });
      packet('item/started', {
        item: {
          id: 'unsupported',
          type: 'fixtureUnknownTool',
          arguments: { token: 'fake-sensitive-token' },
        },
      });
      return;
    }
    const finish = () => {
      packet('item/started', { item: { type: 'agentMessage', id: 'answer', text: '' } });
      packet('item/agentMessage/delta', { itemId: 'answer', delta: '模拟子进程收到：' });
      packet('item/completed', {
        item: { type: 'agentMessage', id: 'answer', text: '模拟子进程收到：' + text },
      });
      if (mode === 'read-state' || mode === 'invalid-read-state') {
        for (const firstUnread of [null, { type: 'threadStart' }, { type: 'turn', turnId }])
          send({
            method: 'thread/readState/changed',
            params: {
              threadId: scope.threadId,
              readState: { revision: 'fixture-read-revision', firstUnread },
            },
          });
        if (mode === 'invalid-read-state')
          send({
            method: 'thread/readState/changed',
            params: { threadId: scope.threadId, readState: { revision: 3 } },
          });
      }
      packet('turn/completed', { turn: { id: turnId, status: 'completed', error: null } });
      if (mode === 'read-state')
        send({
          method: 'thread/readState/changed',
          params: { threadId: scope.threadId, readState: { revision: 'fixture-late-revision' } },
        });
      histories.get(scope.threadId).turns.push({ id: turnId, status: 'completed' });
      packet('thread/tokenUsage/updated', {
        tokenUsage: { total: { inputTokens: turns * 10, outputTokens: turns * 5 } },
      });
      active.delete(turnId);
    };
    if (mode === 'native-items') {
      const samples = JSON.parse(
        readFileSync(new URL('./codex-native-items.json', import.meta.url), 'utf8'),
      );
      for (const sample of samples) {
        packet('item/started', { item: sample.start });
        if (sample.progress) packet(sample.progress.method, sample.progress.params);
        packet('item/completed', { item: sample.completed });
        if (sample.start.type === 'fileChange')
          packet('turn/diff/updated', { diff: 'aggregate-diff-not-canvas-content' });
      }
      const item = {
        id: 'native-inspect',
        type: 'dynamicToolCall',
        tool: 'echidna_canvas_inspect',
        arguments: {},
        status: 'inProgress',
      };
      packet('item/started', { item });
      toolReplies.set(item.id, (result) => {
        packet('item/completed', {
          item: { ...item, status: 'completed', success: result.success },
        });
        finish();
      });
      send({
        id: item.id,
        method: 'item/tool/call',
        params: { ...scope, callId: item.id, tool: item.tool, arguments: {} },
      });
    } else if (mode === 'canvas') {
      let count = 0;
      const callCanvas = (tool, arguments_, next) => {
        const id = (tool === 'echidna_canvas_note' ? 'note-' : 'inspect-') + ++count,
          item = {
            id,
            type: 'dynamicToolCall',
            tool,
            arguments: arguments_,
            status: 'inProgress',
          };
        packet('item/started', { item });
        toolReplies.set(id, (result) => {
          packet('item/completed', {
            item: { ...item, status: 'completed', success: result.success },
          });
          next(result);
        });
        send({
          id,
          method: 'item/tool/call',
          params: { ...scope, callId: id, tool: item.tool, arguments: arguments_ },
        });
      };
      const annotate = (arguments_, next) => callCanvas('echidna_canvas_note', arguments_, next);
      const note = {
        kind: 'intent',
        title: '比较通信方式',
        detail: '在本地单用户约束下比较。',
        refs: [],
        options: [],
      };
      annotate(note, () => {
        const command = {
          type: 'commandExecution',
          id: 'read-sample-' + turns,
          command: 'cat README.md',
          cwd: '/fixture/public-sample',
          status: 'inProgress',
        };
        packet('item/started', { item: command });
        packet('item/completed', {
          item: {
            ...command,
            status: 'completed',
            aggregatedOutput: 'Synthetic fixture sample',
            exitCode: 0,
          },
        });
        callCanvas('echidna_canvas_inspect', {}, () =>
          annotate({ ...note, refs: ['tool:missing'] }, () =>
            annotate(
              {
                kind: 'decision',
                title: '选择 SSE',
                detail: '只需要服务向浏览器连续推送。',
                refs: ['note:note-1'],
                options: [
                  { id: 'sse', label: 'SSE', selected: true },
                  { id: 'ws', label: 'WebSocket', selected: false },
                ],
              },
              finish,
            ),
          ),
        );
      });
    } else if (mode === 'late-command' || mode === 'late-command-mismatch') {
      const command = {
        type: 'commandExecution',
        id: 'late-command-' + turns,
        command: 'fixture-background-task',
        cwd: '/fixture',
        status: 'inProgress',
      };
      packet('item/started', { item: command });
      finish();
      lateCompletions.push(() => {
        packet('item/commandExecution/outputDelta', { itemId: command.id, delta: 'late output' });
        packet('item/completed', {
          item: {
            ...command,
            command: mode === 'late-command-mismatch' ? 'unrelated-command' : command.command,
            status: 'completed',
            aggregatedOutput: 'late output',
            exitCode: 0,
          },
        });
      });
    } else {
      if (mode === 'interrupt-open-tool')
        packet('item/started', {
          item: {
            type: 'commandExecution',
            id: 'pending-command-' + turns,
            command: 'python3 -c "import time; time.sleep(30)"',
            cwd: '/fixture',
            status: 'inProgress',
          },
        });
      active.set(turnId, {
        timer: setTimeout(finish, ['slow', 'interrupt-open-tool'].includes(mode) ? 1000 : 20),
      });
    }
    return;
  }
  send({ id: request.id, error: { code: -32601, message: 'method not implemented by fixture' } });
});
