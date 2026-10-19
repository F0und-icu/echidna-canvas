import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexBridge } from '../../server/codex-bridge';
import { RuntimeStore } from '../../server/runtime-store';
import { Coordinator } from '../../server/coordinator';
import { McpStore } from '../../server/mcp-store';
import { project } from '../../web/model/projection';
import { startMcpFixture } from '../fixtures/mcp-gateway';

const binary = process.env.ECHIDNA_CANVAS_TEST_CODEX_BINARY;
it.skipIf(!binary)(
  'native MCP binding authenticates, preserves history, isolates Agents, and keeps credentials outside native history',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'canvas-native-mcp-')),
      profile = join(root, 'profile');
    mkdirSync(profile);
    const fixture = await startMcpFixture(true);
    const bridge = new CodexBridge({
      file: binary!,
      args: [
        'app-server',
        '-c',
        'analytics.enabled=false',
        '-c',
        'model_provider="fixture_http"',
        '-c',
        `model_providers.fixture_http={name="Offline fixture",base_url="${fixture.base}",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
      ],
      projectDir: root,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: profile },
    });
    const store = new RuntimeStore(':memory:', bridge),
      mcp = new McpStore(':memory:', join(root, 'credentials')),
      coordinator = new Coordinator(store, bridge, mcp);
    try {
      const status = await bridge.status();
      const config = {
        name: 'Native MCP fixture',
        avatar: 'none' as const,
        model: status.models[0].id,
        personality: '',
        harnessSettings: {
          reasoningEffort: status.models[0]
            .settings!.find((field) => field.key === 'reasoningEffort')!
            .options.find((option) => option.value === 'high')!.value,
        },
      };
      const first = await coordinator.execute({
        version: 1,
        commandId: 'mcp-first',
        type: 'agent.create',
        config,
        task: 'offline fixture',
      });
      const second = await coordinator.execute({
        version: 1,
        commandId: 'mcp-second',
        type: 'agent.create',
        config,
        task: 'offline fixture',
      });
      expect(first.status, first.error ?? '').toBe('acknowledged');
      expect(second.status).toBe('acknowledged');
      const turn = await coordinator.execute({
        version: 1,
        commandId: 'mcp-prefix',
        type: 'turn.start',
        agentId: first.agentId,
        text: 'LOCAL_CONTEXT_BEFORE_MCP',
      });
      expect(turn.status).toBe('acknowledged');
      await expect.poll(() => store.agent(first.agentId).state, { timeout: 20000 }).toBe('idle');
      const before = structuredClone(project(store.events()).sessions[first.agentId].routes);
      const connection = mcp.save({
        name: 'Docker local fixture',
        kind: 'docker',
        url: fixture.base + '/mcp',
        auth: { method: 'bearer' },
        secret: fixture.secret,
      });
      const bound = await coordinator.execute({
        version: 1,
        commandId: 'mcp-bind-native',
        type: 'agent.mcp.configure',
        agentId: first.agentId,
        connections: [{ id: connection.id, revision: 1 }],
      });
      expect(bound.status, bound.error ?? '').toBe('acknowledged');
      expect(await bridge.mcpStatus(store.agent(first.agentId).thread_id)).toMatchObject([
        { toolCount: 1 },
      ]);
      expect(await bridge.mcpStatus(store.agent(second.agentId).thread_id)).toEqual([]);
      expect(project(store.events()).sessions[first.agentId].routes).toEqual(before);
      expect(fixture.calls).toContain('tools/list');
      expect(fixture.modelRequests).toHaveLength(1);
      expect((fixture.modelRequests[0] as { reasoning: { effort: string } }).reasoning.effort).toBe(
        'high',
      );
      const next = await coordinator.execute({
        version: 1,
        commandId: 'mcp-next',
        type: 'turn.start',
        agentId: first.agentId,
        text: 'LOCAL_MCP_TOOLS_AVAILABLE',
      });
      expect(next.status, next.error ?? '').toBe('acknowledged');
      await expect.poll(() => store.agent(first.agentId).state, { timeout: 20000 }).toBe('idle');
      expect(fixture.modelRequests).toHaveLength(3);
      expect(fixture.calls.filter((method) => method === 'tools/call')).toHaveLength(1);
      expect(JSON.stringify(fixture.modelRequests[1]).includes('LOCAL_CONTEXT_BEFORE_MCP')).toBe(
        true,
      );
      expect(JSON.stringify(fixture.modelRequests).includes(fixture.secret)).toBe(false);
      expect(
        JSON.stringify(fixture.modelRequests[2]).includes('LOCAL_MCP_FIXTURE: NATIVE_MCP_PROBE'),
      ).toBe(true);
      const call = project(store.events())
        .sessions[first.agentId].routes[0].rounds.at(-1)!
        .calls.find((call) => call.tool === 'codex.mcpToolCall');
      expect(call).toMatchObject({ status: 'returned' });
      expect(call!.result).toContain('LOCAL_MCP_FIXTURE: NATIVE_MCP_PROBE');
      expect(JSON.stringify(store.state())).not.toContain(fixture.secret);
      const scan = (directory: string): string[] =>
        readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? scan(join(directory, entry.name)) : [join(directory, entry.name)],
        );
      for (const path of scan(profile))
        expect(readFileSync(path).includes(Buffer.from(fixture.secret)), path).toBe(false);
      const failed = mcp.save({
        ...connection,
        baseRevision: connection.revision,
        url: fixture.base + '/unavailable',
        secret: fixture.secret,
      });
      const failure = await coordinator.execute({
        version: 1,
        commandId: 'mcp-failed-address',
        type: 'agent.mcp.configure',
        agentId: first.agentId,
        connections: [{ id: failed.id, revision: failed.revision }],
      });
      expect(failure.status).toBe('acknowledged');
      await expect
        .poll(() => bridge.mcpStatus(store.agent(first.agentId).thread_id))
        .toMatchObject([
          {
            toolCount: 0,
            state: 'failed',
            error: expect.stringMatching(/^MCP (初始化失败|工具目录读取失败)/),
          },
        ]);
      const detached = await coordinator.execute({
        version: 1,
        commandId: 'mcp-detach-native',
        type: 'agent.mcp.configure',
        agentId: first.agentId,
        connections: [],
      });
      expect(detached.status, detached.error ?? '').toBe('acknowledged');
      expect(await bridge.mcpStatus(store.agent(first.agentId).thread_id)).toEqual([]);
      expect(fixture.modelRequests).toHaveLength(3);
    } finally {
      coordinator.close();
      await fixture.close();
      // app-server can finish profile writes while its SIGTERM is being handled.
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  60000,
);
