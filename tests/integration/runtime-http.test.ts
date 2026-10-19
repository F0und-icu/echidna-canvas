import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { request } from 'node:http';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  truncateSync,
  readFileSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeStore } from '../../server/runtime-store';
import { FixtureCodexBridge } from '../../server/fixture-bridge';
import { Coordinator } from '../../server/coordinator';
import { createRuntimeServer } from '../../server/http';
import { ProjectFileStore } from '../../server/project-files';
import { archiveIndexSchema, fileProjectsSchema } from '../../contracts/files';
import {
  runtimeStateSchema,
  commandRecordSchema,
  backendStatusSchema,
  loginResultSchema,
  type RuntimeCommand,
} from '../../contracts/runtime';
import { project, conversationRounds } from '../../web/model/projection';
import { McpStore } from '../../server/mcp-store';
import { mcpConnectionSchema } from '../../contracts/mcp';

let coordinator: Coordinator,
  server: ReturnType<typeof createRuntimeServer>,
  base: string,
  cookie: string,
  imageRoot: string;
let files: ProjectFileStore;
beforeEach(async () => {
  const bridge = new FixtureCodexBridge();
  imageRoot = mkdtempSync(join(tmpdir(), 'canvas-image-http-'));
  coordinator = new Coordinator(
    new RuntimeStore(':memory:', bridge),
    bridge,
    new McpStore(':memory:', join(imageRoot, 'credentials')),
  );
  files = new ProjectFileStore(imageRoot, ':memory:');
  server = createRuntimeServer(coordinator, imageRoot, files);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  base = `http://127.0.0.1:${address.port}`;
  const session = await fetch(`${base}/api/runtime/session`);
  cookie = session.headers.get('set-cookie')!.split(';')[0];
});
afterEach(async () => {
  coordinator.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  files.close();
  rmSync(imageRoot, { recursive: true, force: true });
});
const create = {
  version: 1,
  commandId: 'http-create',
  type: 'agent.create',
  config: { name: 'Codex', avatar: 'echidna', model: 'fixture', personality: '' },
  task: '只读检查',
};
const post = (value: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/runtime/commands`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });

it('browses, edits and retrieves durable file revisions through the authenticated local boundary', async () => {
  writeFileSync(join(imageRoot, 'notes.md'), '# before\n');
  const url = `${base}/api/runtime/file?path=notes.md`;
  expect((await fetch(url)).status).toBe(401);
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Echidna-Project': encodeURIComponent(files.root),
  };
  const before = await (await fetch(url, { headers })).json();
  const eventsBefore = coordinator.store.cursor();
  const save = (baseHash: string, content: string, customHeaders = headers) =>
    fetch(`${base}/api/runtime/file`, {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify({ path: 'notes.md', baseHash, content }),
    });
  expect(
    (await save(before.hash, 'bad', { ...headers, Origin: 'https://evil.example' })).status,
  ).toBe(403);
  const edited = await save(before.hash, '# after\n');
  expect(edited.status).toBe(200);
  const current = await edited.json();
  expect(readFileSync(join(imageRoot, 'notes.md'), 'utf8')).toBe('# after\n');
  expect(current.revisions).toHaveLength(2);
  expect((await fetch(`${base}/api/runtime/file-history`)).status).toBe(401);
  const index = archiveIndexSchema.parse(
    await (await fetch(`${base}/api/runtime/file-history`, { headers })).json(),
  );
  expect(index.files).toEqual([{ path: 'notes.md', revisions: current.revisions }]);
  expect(JSON.stringify(index)).not.toContain('# after');
  expect((await save(before.hash, 'stale\n')).status).toBe(409);
  const revision = await fetch(
    `${base}/api/runtime/file-revision?path=notes.md&revision=${before.revisions[0].id}`,
    { headers },
  );
  expect(await revision.json()).toEqual({ content: '# before\n', hash: before.hash });
  expect((await fetch(`${base}/api/runtime/files`, { headers })).status).toBe(200);
  expect(
    (await fetch(`${base}/api/runtime/file?path=${encodeURIComponent('../outside')}`, { headers }))
      .status,
  ).toBe(400);
  expect((await fetch(`${base}/api/runtime/file?path=missing`, { headers })).status).toBe(404);
  expect((await save('wrong', 'test')).status).toBe(400);
  expect(coordinator.store.cursor()).toBe(eventsBefore);
  expect(coordinator.store.state().commands).toHaveLength(0);
});

it('switches archives without redirecting an old file save or changing runtime execution', async () => {
  writeFileSync(join(imageRoot, 'shared.txt'), 'project A\n');
  const originalRoot = files.root,
    other = join(imageRoot, '项目乙');
  mkdirSync(other);
  writeFileSync(join(other, 'shared.txt'), 'project B\n');
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const bound = { ...headers, 'X-Echidna-Project': encodeURIComponent(originalRoot) };
  const first = await (
    await fetch(`${base}/api/runtime/file?path=shared.txt`, { headers: bound })
  ).json();
  const url = `${base}/api/runtime/file-projects`;
  expect((await fetch(url)).status).toBe(401);
  const select = (root: string, customHeaders = headers) =>
    fetch(url, { method: 'POST', headers: customHeaders, body: JSON.stringify({ root }) });
  expect((await select(other, { ...headers, Origin: 'https://evil.example' })).status).toBe(403);
  expect((await select('relative')).status).toBe(400);
  const response = await select(other);
  expect(response.status).toBe(200);
  const selected = fileProjectsSchema.parse(await response.json());
  expect(selected.root).toBe(files.root);
  expect(selected.projects).toContain(originalRoot);
  const stale = await fetch(`${base}/api/runtime/file`, {
    method: 'POST',
    headers: bound,
    body: JSON.stringify({
      path: 'shared.txt',
      baseHash: first.hash,
      content: 'wrong project write',
    }),
  });
  expect(stale.status).toBe(409);
  expect((await fetch(`${base}/api/runtime/files`, { headers })).status).toBe(400);
  expect(
    (
      await fetch(`${base}/api/runtime/files`, {
        headers: { ...headers, 'X-Echidna-Project': '%broken' },
      })
    ).status,
  ).toBe(400);
  const activeHeaders = { ...headers, 'X-Echidna-Project': encodeURIComponent(selected.root) };
  const second = await (
    await fetch(`${base}/api/runtime/file?path=shared.txt`, { headers: activeHeaders })
  ).json();
  expect(second.content).toBe('project B\n');
  expect(
    (
      await fetch(
        `${base}/api/runtime/file-revision?path=shared.txt&revision=${first.revisions[0].id}`,
        { headers: activeHeaders },
      )
    ).status,
  ).toBe(404);
  expect(readFileSync(join(imageRoot, 'shared.txt'), 'utf8')).toBe('project A\n');
  expect(readFileSync(join(other, 'shared.txt'), 'utf8')).toBe('project B\n');
  expect(coordinator.store.cursor()).toBe(0);
  expect(coordinator.store.state().commands).toHaveLength(0);
  await select(originalRoot);
  const restored = await (
    await fetch(`${base}/api/runtime/file?path=shared.txt`, { headers: bound })
  ).json();
  expect(restored.revisions).toEqual(first.revisions);
});

it('rechecks project identity after receiving a slow save body', async () => {
  const firstRoot = files.root,
    other = join(imageRoot, 'second');
  mkdirSync(other);
  for (const root of [firstRoot, other]) writeFileSync(join(root, 'same.txt'), 'identical base\n');
  const file = files.open('same.txt');
  const body = JSON.stringify({
    path: 'same.txt',
    baseHash: file.hash,
    content: 'must not cross projects',
  });
  const received = once(server, 'request');
  let slowRequest: ReturnType<typeof request>;
  const response = new Promise<number>((resolve, reject) => {
    slowRequest = request(
      `${base}/api/runtime/file`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: base,
          'Content-Type': 'application/json',
          'X-Echidna-Project': encodeURIComponent(firstRoot),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      },
    );
    slowRequest.on('error', reject);
    slowRequest.write(body.slice(0, 20));
  });
  await received;
  const changed = await fetch(`${base}/api/runtime/file-projects`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: other }),
  });
  expect(changed.status).toBe(200);
  slowRequest!.end(body.slice(20));
  expect(await response).toBe(409);
  expect(readFileSync(join(firstRoot, 'same.txt'), 'utf8')).toBe('identical base\n');
  expect(readFileSync(join(other, 'same.txt'), 'utf8')).toBe('identical base\n');
});

async function recordedMedia(items: { start: unknown; completed: unknown }[]) {
  await post(create);
  const agentId = 'agent/codex-fixture/http-create';
  coordinator.store.admit({
    version: 1,
    commandId: 'image-turn',
    type: 'turn.start',
    agentId,
    text: '生成图像',
  });
  let seq = 0;
  const scope = { threadId: 'thr_http-create', turnId: 'image-turn' };
  const push = (method: string, params: Record<string, unknown>) =>
    coordinator.store.ingest(agentId, {
      version: 1,
      streamId: 'image-turn',
      sourceSeq: ++seq,
      packet: { method, params: { ...scope, ...params } },
    });
  push('turn/started', { turn: { id: scope.turnId, status: 'inProgress' } });
  for (const item of items) {
    push('item/started', { item: item.start });
    push('item/completed', { item: item.completed });
  }
  return coordinator.store
    .events()
    .filter((event) => event.data.type === 'tool.finished')
    .map((event) => `${base}/api/runtime/image?event=${encodeURIComponent(event.id)}`);
}
function recordedImages(
  paths: string[],
  type: 'imageGeneration' | 'imageView' = 'imageGeneration',
) {
  return recordedMedia(
    paths.map((path, index) => {
      const start =
        type === 'imageView'
          ? { type, id: 'image-' + index, path }
          : { type, id: 'image-' + index, status: 'in_progress', result: '' };
      return {
        start,
        completed:
          type === 'imageView'
            ? start
            : { ...start, status: 'completed', result: 'runtime-result', savedPath: path },
      };
    }),
  );
}

const inlinePng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5wAAAABJRU5ErkJggg==';
it('serves each inline image by its completion and part, without exposing base64 in runtime state', async () => {
  const start = {
    type: 'mcpToolCall',
    id: 'multi',
    server: 'fixture',
    tool: 'images',
    arguments: {},
    status: 'inProgress',
  };
  const image = { type: 'image', data: inlinePng, mimeType: 'image/png' };
  const [url] = await recordedMedia([
    {
      start,
      completed: {
        ...start,
        status: 'completed',
        result: { content: [image, { type: 'text', text: 'caption' }, image] },
      },
    },
  ]);
  for (const part of [0, 1]) {
    const response = await fetch(url + '&part=' + part, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(inlinePng, 'base64'));
  }
  for (const part of ['2', '-1', 'NaN', '0.1'])
    expect((await fetch(url + '&part=' + part, { headers: { Cookie: cookie } })).status).toBe(404);
  const state = await (await fetch(`${base}/api/runtime`, { headers: { Cookie: cookie } })).text();
  expect(state).not.toContain(inlinePng);
  expect(state).toContain('caption');
});

it('shows encoding, MIME and size failures for returned images without pretending the tool failed', async () => {
  const parts = [
    { type: 'image', data: 'not-base64', mimeType: 'image/png' },
    { type: 'image', data: inlinePng, mimeType: 'image/jpeg' },
    {
      type: 'image',
      data: 'A'.repeat(Math.ceil((20 * 1024 * 1024) / 3) * 4 + 4),
      mimeType: 'image/png',
    },
  ];
  const start = {
    type: 'mcpToolCall',
    id: 'invalid',
    server: 'fixture',
    tool: 'images',
    arguments: {},
    status: 'inProgress',
  };
  const [url] = await recordedMedia([
    { start, completed: { ...start, status: 'completed', result: { content: parts } } },
  ]);
  for (const [part, message] of ['编码无效', '类型与内容不符', '20 MiB'].entries()) {
    const response = await fetch(url + '&part=' + part, { headers: { Cookie: cookie } });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain(message);
  }
  expect(
    project(coordinator.store.events()).sessions['agent/codex-fixture/http-create'].routes[0]
      .rounds[0].calls[0].status,
  ).toBe('returned');
});

it('can read the exact native generated output outside the project, without lifting imageView boundaries', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'canvas-generated-output-'));
  try {
    const path = join(outside, 'output.png');
    writeFileSync(path, Buffer.from(inlinePng, 'base64'));
    const [generated, viewed] = await recordedMedia([
      {
        start: { type: 'imageGeneration', id: 'generated', status: 'in_progress', result: '' },
        completed: {
          type: 'imageGeneration',
          id: 'generated',
          status: 'completed',
          result: '',
          savedPath: path,
        },
      },
      {
        start: { type: 'imageView', id: 'viewed', path },
        completed: { type: 'imageView', id: 'viewed', path },
      },
    ]);
    expect((await fetch(generated, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(viewed, { headers: { Cookie: cookie } })).status).toBe(422);
    expect(
      (await fetch(generated.replace('runtime%', 'other%'), { headers: { Cookie: cookie } }))
        .status,
    ).toBe(404);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

it('serves only source-linked raster images behind the local session boundary', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5wAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(join(imageRoot, 'generated.png'), png);
  const [url] = await recordedImages(['generated.png']);
  expect((await fetch(url)).status).toBe(401);
  const image = await fetch(url, { headers: { Cookie: cookie } });
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(image.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  expect(
    (await fetch(url, { headers: { Cookie: cookie, Origin: 'https://untrusted.example' } })).status,
  ).toBe(403);
  expect(
    (await fetch(`${base}/api/runtime/image?path=generated.png`, { headers: { Cookie: cookie } }))
      .status,
  ).toBe(404);
  expect(
    (
      await fetch(`${base}/api/runtime/image?event=runtime/other-store/1`, {
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(404);
});

it('rejects missing, active, oversized, and out-of-project image files including symlinks', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'canvas-outside-image-'));
  try {
    const target = join(outside, 'private.png');
    writeFileSync(target, 'not-an-image');
    symlinkSync(target, join(imageRoot, 'symlink.png'));
    writeFileSync(
      join(imageRoot, 'active.png'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    writeFileSync(join(imageRoot, 'oversized.png'), '');
    truncateSync(join(imageRoot, 'oversized.png'), 20 * 1024 * 1024 + 1);
    const urls = await recordedImages(
      [target, 'symlink.png', 'active.png', 'missing.png', 'oversized.png'],
      'imageView',
    );
    for (const url of urls)
      expect((await fetch(url, { headers: { Cookie: cookie } })).status).toBe(422);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

it('exposes runtime metadata and an explicit login route behind the same local access boundary', async () => {
  expect((await fetch(`${base}/api/runtime/backend`)).status).toBe(401);
  const status = backendStatusSchema.parse(
    await (await fetch(`${base}/api/runtime/backend`, { headers: { Cookie: cookie } })).json(),
  );
  expect(status.backend.id).toBe('codex-fixture');
  expect(status.account).toBe('not-required');
  const login = (value: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/runtime/login`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(value),
    });
  expect((await login({ version: 1 }, { Origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await login({ version: 2 })).status).toBe(400);
  expect((await login({ version: 1 })).status).toBe(409);
  coordinator.bridge.descriptor.capabilities.login = true;
  coordinator.bridge.login = async () => ({
    flowId: 'test-flow',
    url: 'https://auth.example.invalid/authorize',
  });
  const result = loginResultSchema.parse(await (await login({ version: 1 })).json());
  expect(result).toMatchObject({ flowId: 'test-flow' });
  expect(
    (await login({ version: 1, authentication: { method: 'api-key', apiKey: ' ' } })).status,
  ).toBe(400);
  expect(
    (await login({ version: 1, authentication: { method: 'browser', apiKey: 'test-only' } }))
      .status,
  ).toBe(400);
  let received: unknown;
  coordinator.bridge.login = async (request) => {
    received = request;
    return { type: 'api-key' };
  };
  const key = 'test-only-http-key';
  const authenticated = await login({
    version: 1,
    authentication: { method: 'api-key', apiKey: key },
  });
  expect(await authenticated.json()).toEqual({ type: 'api-key' });
  expect(received).toEqual({ method: 'api-key', apiKey: key });
  expect(JSON.stringify(coordinator.store.state())).not.toContain(key);
  expect(coordinator.store.events()).toEqual([]);
});

it('stores a separate MCP node behind the local boundary without exposing credentials', async () => {
  const url = base + '/api/runtime/mcp-connections';
  const input = {
    name: 'Docker HTTP fixture',
    kind: 'docker',
    url: 'http://localhost:8811/mcp',
    auth: { method: 'bearer' },
    secret: 'test-only-http-mcp-key',
  };
  const save = (value: unknown, origin = base) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  expect((await fetch(url)).status).toBe(401);
  expect((await save(input, 'https://untrusted.example')).status).toBe(403);
  expect((await save({ ...input, url: input.url + '?key=bad' })).status).toBe(400);
  const response = await save(input);
  expect(response.status).toBe(200);
  const connection = mcpConnectionSchema.parse(await response.json());
  const listed = await (await fetch(url, { headers: { Cookie: cookie } })).text();
  expect(listed).toContain(connection.id);
  expect(listed).not.toContain(input.secret);
  expect(coordinator.store.events()).toEqual([]);
  coordinator.bridge.descriptor.capabilities.mcp = true;
  const created = commandRecordSchema.parse(await (await post(create)).json());
  const command: RuntimeCommand = {
    version: 1,
    commandId: 'http-mcp-bind',
    type: 'agent.mcp.configure',
    agentId: created.agentId,
    connections: [{ id: connection.id, revision: connection.revision }],
  };
  const fork = vi.spyOn(coordinator.bridge, 'forkSession');
  const receipt = commandRecordSchema.parse(await (await post(command)).json());
  expect(receipt.status).toBe('acknowledged');
  expect(fork).toHaveBeenCalledTimes(1);
  expect(fork.mock.calls[0][6]![0].headers.Authorization).toBe('Bearer ' + input.secret);
  expect(await (await post(command)).json()).toEqual(receipt);
  expect(fork).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(coordinator.store.state())).not.toContain(input.secret);
});

it('requires the local session, checks Host and Origin, and rejects malformed commands', async () => {
  expect((await fetch(`${base}/api/runtime`)).status).toBe(401);
  expect(
    (
      await fetch(`${base}/api/runtime/session`, {
        headers: { Origin: 'https://untrusted.example' },
      })
    ).status,
  ).toBe(403);
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${base}/api/runtime/session`,
      { headers: { Host: 'attacker.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(hostStatus).toBe(403);
  expect((await post(create, { Origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await post(create, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await post({ ...create, version: 2 })).status).toBe(400);
  expect((await post({ ...create, task: 'x'.repeat(33000) })).status).toBe(413);
  expect(coordinator.store.events()).toEqual([]);
});
it('returns one durable creation on retries and rejects a conflicting identity', async () => {
  const first = commandRecordSchema.parse(await (await post(create)).json());
  expect(first.status).toBe('acknowledged');
  expect(await (await post(create)).json()).toEqual(first);
  expect((await post({ ...create, task: 'different' })).status).toBe(409);
  const snapshot = runtimeStateSchema.parse(
    await (await fetch(`${base}/api/runtime`, { headers: { Cookie: cookie } })).json(),
  );
  expect(snapshot.events).toHaveLength(2);
  expect(snapshot.agents).toHaveLength(1);
});
it('binds creation to the discovered harness and creates independent sessions without starting turns', async () => {
  const backend = backendStatusSchema.parse(
    await (await fetch(`${base}/api/runtime/backend`, { headers: { Cookie: cookie } })).json(),
  );
  const original = coordinator.store.state();
  const mismatch = await post({ ...create, harnessId: 'different-harness' });
  expect(mismatch.status).toBe(409);
  expect(await mismatch.json()).toEqual({
    error: '所选 harness 与当前本地服务不一致，请重新连接后创建。',
  });
  expect(coordinator.store.state()).toEqual(original);
  expect((await post({ ...create, harnessId: '../codex' })).status).toBe(400);
  const request = {
    ...create,
    harnessId: backend.backend.id,
    config: { ...create.config, model: backend.models[0].id },
  };
  const first = commandRecordSchema.parse(await (await post(request)).json());
  expect(first.status).toBe('acknowledged');
  expect(await (await post(request)).json()).toEqual(first);
  const second = commandRecordSchema.parse(
    await (await post({ ...request, commandId: 'second-agent' })).json(),
  );
  const state = coordinator.store.state();
  expect(state.agents).toHaveLength(2);
  expect(state.agents[0].sessionRef).not.toBe(state.agents[1].sessionRef);
  expect(state.agents.every((agent) => agent.state === 'idle' && agent.turnId === null)).toBe(true);
  expect(state.commands.map((command) => command.type)).toEqual(['agent.create', 'agent.create']);
  for (const id of [first.agentId, second.agentId]) {
    const events = state.events.filter((event) => event.sessionId === id);
    expect(events.map((event) => event.data.type)).toEqual(['session.created', 'route.started']);
    expect(events.every((event) => event.runtime?.backendId === backend.backend.id)).toBe(true);
  }
});
it('keeps an unknown creation under the same command identity without dispatching it again', async () => {
  const dispatch = vi
    .spyOn(coordinator.bridge, 'createSession')
    .mockRejectedValue(new Error('Connection lost after thread creation; acknowledgement unknown'));
  const request = { ...create, harnessId: coordinator.bridge.descriptor.id };
  const first = commandRecordSchema.parse(await (await post(request)).json());
  expect(first.status).toBe('unknown');
  expect(first.error).toContain('acknowledgement unknown');
  expect(await (await post(request)).json()).toEqual(first);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(coordinator.store.state().agents).toHaveLength(1);
  expect(coordinator.store.state().commands).toHaveLength(1);
  expect(coordinator.store.events()).toEqual([]);
});
it('creates against the selected project and keeps bound file operations isolated from the current archive selection', async () => {
  const other = join(imageRoot, 'project-b');
  mkdirSync(other);
  const canonical = realpathSync(other);
  writeFileSync(join(imageRoot, 'same.md'), 'project A\n');
  writeFileSync(join(other, 'same.md'), 'project B\n');
  const dispatch = vi.spyOn(coordinator.bridge, 'createSession');
  const created = commandRecordSchema.parse(
    await (await post({ ...create, projectRoot: canonical })).json(),
  );
  expect(created.status).toBe('acknowledged');
  expect(dispatch.mock.calls[0][3]).toBe(canonical);
  expect(project(coordinator.store.events()).sessions[created.agentId].projectRoot).toBe(canonical);
  expect(files.root).toBe(realpathSync(imageRoot));
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Echidna-Project': encodeURIComponent(canonical),
    'X-Echidna-Project-Bound': 'true',
  };
  const current = await (await fetch(base + '/api/runtime/file?path=same.md', { headers })).json();
  expect(current.content).toBe('project B\n');
  const cursor = coordinator.store.cursor();
  const saved = await fetch(base + '/api/runtime/file', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      path: 'same.md',
      baseHash: current.hash,
      content: 'project B edited\n',
    }),
  });
  expect(saved.status).toBe(200);
  expect(readFileSync(join(other, 'same.md'), 'utf8')).toBe('project B edited\n');
  expect(readFileSync(join(imageRoot, 'same.md'), 'utf8')).toBe('project A\n');
  const unregistered = await fetch(base + '/api/runtime/files', {
    headers: {
      ...headers,
      'X-Echidna-Project': encodeURIComponent(join(imageRoot, 'unregistered')),
    },
  });
  expect(unregistered.status).toBe(409);
  expect(coordinator.store.cursor()).toBe(cursor);
  expect(await (await post({ ...create, projectRoot: canonical })).json()).toEqual(created);
  expect(dispatch).toHaveBeenCalledTimes(1);
});
it('rejects invalid project directories before creating or dispatching an Agent', async () => {
  expect((await post({ ...create, projectRoot: 'relative/path' })).status).toBe(400);
  expect((await post({ ...create, projectRoot: join(imageRoot, 'missing') })).status).toBe(404);
  const privateRoot = join(imageRoot, '.codex');
  mkdirSync(privateRoot);
  expect((await post({ ...create, projectRoot: privateRoot })).status).toBe(403);
  expect(coordinator.store.state().commands).toEqual([]);
  expect(coordinator.store.state().agents).toEqual([]);
});
it('rechecks a committed creation without re-reading a directory that has since disappeared', async () => {
  const root = join(realpathSync(imageRoot), 'removed-project');
  mkdirSync(root);
  const request = { ...create, projectRoot: root };
  const first = commandRecordSchema.parse(await (await post(request)).json());
  expect(first.status).toBe('acknowledged');
  rmSync(root, { recursive: true });
  expect(await (await post(request)).json()).toEqual(first);
  expect(coordinator.store.state().agents).toHaveLength(1);
});
it('returns the committed creation after its HTTP acknowledgement is lost without creating another session', async () => {
  const dispatch = vi.spyOn(coordinator.bridge, 'createSession');
  const request = { ...create, harnessId: coordinator.bridge.descriptor.id };
  server.once('request', (_request, response) => {
    response.end = () => {
      response.destroy();
      return response;
    };
  });
  await expect(post(request)).rejects.toThrow('fetch failed');
  const saved = coordinator.store.command(create.commandId);
  expect(saved.status).toBe('acknowledged');
  expect(await (await post(request)).json()).toEqual(saved);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(coordinator.store.state().agents).toHaveLength(1);
  expect(coordinator.store.events().map((event) => event.data.type)).toEqual([
    'session.created',
    'route.started',
  ]);
});
it('forks a historical message through HTTP with a stable source ID and deduplicates creation', async () => {
  const forkCall = vi.spyOn(coordinator.bridge, 'forkSession');
  const created = commandRecordSchema.parse(
    await (await post({ ...create, projectRoot: files.root })).json(),
  );
  for (const [id, text] of [
    ['http-first', 'HTTP_PAST'],
    ['http-later', 'HTTP_FUTURE'],
  ]) {
    const result = commandRecordSchema.parse(
      await (
        await post({
          version: 1,
          commandId: id,
          type: 'turn.start',
          agentId: created.agentId,
          text,
        })
      ).json(),
    );
    await expect
      .poll(
        () =>
          conversationRounds(project(coordinator.store.events()), created.agentId).find(
            (entry) => entry.round.id === result.result!.turnId,
          )?.round.outcome,
        { timeout: 3000 },
      )
      .toBe('completed');
  }
  const first = conversationRounds(project(coordinator.store.events()), created.agentId)[0].round;
  const command = {
    version: 1,
    commandId: 'http-fork',
    type: 'agent.fork',
    sourceAgentId: created.agentId,
    roundId: first.id,
    side: 'after',
    eventId: first.terminalEventId,
  };
  expect((await post({ ...command, eventId: 'not-the-selected-message' })).status).toBe(409);
  const result = commandRecordSchema.parse(await (await post(command)).json());
  expect(result.status).toBe('acknowledged');
  expect(project(coordinator.store.events()).sessions[result.agentId].projectRoot).toBe(files.root);
  expect(forkCall.mock.calls[0][5]).toBe(files.root);
  expect(await (await post(command)).json()).toEqual(result);
  const state = runtimeStateSchema.parse(
    await (
      await fetch(`${base}/api/runtime`, {
        headers: { Cookie: cookie },
      })
    ).json(),
  );
  expect(
    conversationRounds(project(state.events), result.agentId).map(
      (entry) => entry.round.input.task,
    ),
  ).toEqual(['HTTP_PAST']);
  expect(state.agents).toHaveLength(2);
  expect(state.events.filter((event) => event.data.type === 'round.started')).toHaveLength(2);
});
it('replays only the missing SSE suffix and disconnecting the view does not cancel a turn', async () => {
  await post(create);
  const start = commandRecordSchema.parse(
    await (
      await post({
        version: 1,
        commandId: 'http-turn',
        type: 'turn.start',
        agentId: 'agent/codex-fixture/http-create',
        text: '检查',
        scenario: 'success',
      })
    ).json(),
  );
  const abort = new AbortController();
  const response = await fetch(`${base}/api/runtime/events?after=2`, {
    headers: { Cookie: cookie },
    signal: abort.signal,
  });
  const reader = response.body!.getReader(),
    first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  expect(text).toContain('round.started');
  expect(text).not.toContain('session.created');
  abort.abort();
  await new Promise<void>((resolve) => setTimeout(resolve, 1200));
  expect(coordinator.store.command(start.commandId).status).toBe('acknowledged');
  expect(coordinator.store.state().agents[0].state).toBe('idle');
  expect(coordinator.store.events().filter((e) => e.data.type === 'round.started')).toHaveLength(1);
  expect(
    (await fetch(`${base}/api/runtime/events?after=999999`, { headers: { Cookie: cookie } }))
      .status,
  ).toBe(409);
});
