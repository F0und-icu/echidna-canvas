import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { RuntimeStore } from './runtime-store.ts';
import { Coordinator } from './coordinator.ts';
import { createRuntimeServer } from './http.ts';
import { createLocalRuntime } from './composition.ts';
import { ProjectFileStore } from './project-files.ts';
import { McpStore } from './mcp-store.ts';
import { homedir } from 'node:os';

const directory = resolve('.echidna-canvas');
mkdirSync(directory, { recursive: true });
const mode = process.argv[2] ?? 'fixture';
if (mode !== 'fixture' && mode !== 'codex')
  throw new Error('Expected runtime mode fixture or codex');
const projectDir = process.env.ECHIDNA_CANVAS_PROJECT_DIR ?? process.cwd();
const bridge = createLocalRuntime(mode, projectDir);
let store: RuntimeStore;
try {
  store = new RuntimeStore(
    resolve(directory, mode === 'fixture' ? 'runtime.sqlite' : 'codex.sqlite'),
    bridge,
  );
} catch (error) {
  bridge.close();
  throw error;
}
let mcp: McpStore;
try {
  mcp = new McpStore(
    resolve(directory, 'mcp.sqlite'),
    resolve(homedir(), '.echidna-canvas', 'mcp-credentials'),
  );
} catch (cause) {
  bridge.close();
  store.close();
  throw cause;
}
const coordinator = new Coordinator(store, bridge, mcp);
let files: ProjectFileStore;
try {
  files = new ProjectFileStore(projectDir, resolve(directory, 'files.sqlite'));
} catch (error) {
  coordinator.close();
  throw error;
}
const server = createRuntimeServer(coordinator, projectDir, files);
server.listen(4181, '127.0.0.1', () =>
  console.log(`${bridge.descriptor.label}: http://127.0.0.1:4181 (${bridge.descriptor.mode})`),
);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  coordinator.close();
  server.closeAllConnections();
  server.close(() => files.close());
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
