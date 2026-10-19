import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpStore } from '../../server/mcp-store';
import { saveMcpSchema } from '../../contracts/mcp';
import { mergeMcp } from '../../web/runtime/useMcp';

let root: string, store: McpStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'canvas-mcp-store-'));
  store = new McpStore(join(root, 'mcp.sqlite'), join(root, 'credentials'));
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});
const input = {
  name: 'Docker MCP',
  kind: 'docker' as const,
  url: 'http://localhost:8811/mcp',
  auth: { method: 'bearer' as const },
  secret: 'test-only-mcp-credential',
};
it('keeps immutable public revisions and stores credentials separately with owner-only access', () => {
  const first = store.save(input);
  expect(JSON.stringify(first)).not.toContain(input.secret);
  expect(readFileSync(join(root, 'mcp.sqlite'), 'utf8')).not.toContain(input.secret);
  const file = join(root, 'credentials', readdirSync(join(root, 'credentials'))[0]);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  const second = store.save({
    ...input,
    secret: undefined,
    id: first.id,
    baseRevision: first.revision,
    name: 'Updated Docker',
  });
  expect(second.revision).toBe(2);
  expect(store.get(first).name).toBe('Docker MCP');
  expect(store.resolve([first])[0].headers.Authorization).toBe('Bearer ' + input.secret);
  expect(store.resolve([second])[0].headers.Authorization).toBe('Bearer ' + input.secret);
  expect(store.list().connections).toEqual([second]);
  expect(mergeMcp([second], [first])).toEqual([second]);
  expect(mergeMcp([second], [])).toEqual([second]);
});
it('does not transfer an old credential to a changed endpoint and refuses stale edits', () => {
  const first = store.save(input);
  expect(() =>
    store.save({
      ...input,
      secret: undefined,
      id: first.id,
      baseRevision: 1,
      url: 'https://different.example/mcp',
    }),
  ).toThrow('认证密钥');
  expect(() => store.save({ ...input, id: first.id, baseRevision: 2 })).toThrow('已变更');
  expect(store.list().connections).toEqual([first]);
});
it('validates endpoint and header boundaries and rejects static secrets for OAuth', () => {
  for (const url of [
    'https://user:pass@example.com/mcp',
    'https://example.com/mcp?key=secret',
    'ftp://external.example/mcp',
  ])
    expect(saveMcpSchema.safeParse({ ...input, url }).success).toBe(false);
  expect(
    saveMcpSchema.safeParse({ ...input, auth: { method: 'header', headerName: 'Cookie' } }).success,
  ).toBe(false);
  expect(() => store.save({ ...input, auth: { method: 'oauth' } })).toThrow('不接收静态密钥');
});
