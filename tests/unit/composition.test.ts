import { expect, it, vi } from 'vitest';
const { launches } = vi.hoisted(() => ({
  launches: [] as { args: string[]; env: NodeJS.ProcessEnv }[],
}));
vi.mock('../../server/codex-bridge', () => ({
  CodexBridge: class {
    constructor(options: { args: string[]; env: NodeJS.ProcessEnv }) {
      launches.push(options);
    }
  },
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  mkdirSync: vi.fn(),
}));
import { createLocalRuntime } from '../../server/composition';

it('starts Codex with an explicitly selected HTTP-only provider, live search, and full access', () => {
  createLocalRuntime('codex', process.cwd());
  const launch = launches[0];
  expect(launch.args.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://']);
  expect(launch.args).toContain('model_provider="echidna_http"');
  expect(launch.args).toContain(
    'model_providers.echidna_http={name="OpenAI",wire_api="responses",requires_openai_auth=true,supports_websockets=false,supports_standalone_web_search=true}',
  );
  expect(launch.args).toContain('web_search="live"');
  expect(launch.args).toContain('sandbox_mode="danger-full-access"');
  expect(launch.args).toContain('approval_policy="never"');
  expect(launch.env.CODEX_HOME).toMatch(/\.echidna-canvas\/codex-profile$/);
  expect(launch.env).not.toHaveProperty('OPENAI_API_KEY');
});
