import { afterEach, expect, it, vi } from 'vitest';
import {
  requestRuntime,
  RuntimeHttpError,
  RuntimeCommandRejected,
  sendRuntimeCommand,
} from '../../web/runtime/connection';

afterEach(() => vi.unstubAllGlobals());
it('reports an empty unavailable backend without exposing a JSON parser error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(requestRuntime('/mcp-connections')).rejects.toMatchObject({
    message: expect.stringContaining('HTTP 503'),
  });
});
it('preserves an invalid response cause without echoing the response body', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('private-response-body', { status: 200 })),
  );
  const error = await requestRuntime('/backend').catch((cause: unknown) => cause);
  expect(error).not.toBeInstanceOf(RuntimeHttpError);
  expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  expect(String(error)).not.toContain('private-response-body');
});
it('keeps the network failure cause and gives a concrete recovery action', async () => {
  const cause = new TypeError('Failed to fetch');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  await expect(requestRuntime('/session')).rejects.toMatchObject({
    cause,
    message: expect.stringContaining('启动服务'),
  });
});
it('keeps a server rejection status and explicit message', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: '项目未登记' }), { status: 409 })),
  );
  await expect(requestRuntime('/file-projects')).rejects.toMatchObject({
    status: 409,
    message: '项目未登记',
  });
});
it('does not treat a malformed command response as a confirmed rejection permitting redispatch', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 409 })));
  const error = await sendRuntimeCommand({
    version: 1,
    type: 'turn.start',
    commandId: 'response-check',
    agentId: 'test-agent',
    text: '测试',
  }).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(RuntimeCommandRejected);
});
