import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { FixtureCodexBridge } from './fixture-bridge.ts';
import { CodexBridge } from './codex-bridge.ts';
import type { RuntimeBridge } from './runtime-port.ts';

export function createLocalRuntime(mode: 'fixture' | 'codex', projectPath: string): RuntimeBridge {
  if (mode === 'fixture') return new FixtureCodexBridge();
  const projectDir = realpathSync(projectPath);
  if (!statSync(projectDir).isDirectory())
    throw new Error('Agent project root must be a directory');
  const profile = join(homedir(), '.echidna-canvas', 'codex-profile');
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  // Codex owns this product-specific profile. No other app's login or API-key environment is inherited.
  env.CODEX_HOME = profile;
  return new CodexBridge({
    file: process.env.ECHIDNA_CANVAS_CODEX_BINARY ?? 'codex',
    args: [
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'analytics.enabled=false',
      '-c',
      'cli_auth_credentials_store="file"',
      '-c',
      'model_provider="echidna_http"',
      '-c',
      'model_providers.echidna_http={name="OpenAI",wire_api="responses",requires_openai_auth=true,supports_websockets=false,supports_standalone_web_search=true}',
      '-c',
      'web_search="live"',
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'approval_policy="never"',
    ],
    projectDir: resolve(projectDir),
    env,
  });
}
