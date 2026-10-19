import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexBridge } from '../../server/codex-bridge';
import { RuntimeStore } from '../../server/runtime-store';
import { Coordinator } from '../../server/coordinator';
import { conversationRounds, project } from '../../web/model/projection';

// Optional offline contract check: real app-server, empty profile, loopback-only
// fixture Responses endpoint. No account credentials or remote inference.
const binary = process.env.ECHIDNA_CANVAS_TEST_CODEX_BINARY;
it.skipIf(!binary)(
  'native Codex forks omit future context from the actual next HTTP request',
  async () => {
    const requests: unknown[] = [];
    const root = mkdtempSync(join(tmpdir(), 'canvas-native-fork-'));
    const profile = join(root, 'profile');
    mkdirSync(profile);
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const n = requests.length;
      const message = {
        id: 'message-' + n,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'OFFLINE_FIXTURE_REPLY_' + n, annotations: [] }],
      };
      const response = {
        id: 'response-' + n,
        object: 'response',
        status: 'completed',
        model: 'offline-fixture',
        output: [message],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of [
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...message, status: 'in_progress', content: [] },
        },
        {
          type: 'response.output_text.delta',
          item_id: message.id,
          output_index: 0,
          content_index: 0,
          delta: message.content[0].text,
        },
        { type: 'response.output_item.done', output_index: 0, item: message },
        { type: 'response.completed', response },
      ])
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture endpoint');
    const bridge = new CodexBridge({
      file: binary!,
      args: [
        'app-server',
        '--listen',
        'stdio://',
        '-c',
        'analytics.enabled=false',
        '-c',
        'model_provider="fixture_http"',
        '-c',
        `model_providers.fixture_http={name="Offline fixture",base_url="http://127.0.0.1:${address.port}",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
      ],
      projectDir: root,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: profile },
    });
    const store = new RuntimeStore(':memory:', bridge);
    const coordinator = new Coordinator(store, bridge);
    try {
      const status = await bridge.status();
      const created = await coordinator.execute({
        version: 1,
        commandId: 'native-create',
        type: 'agent.create',
        config: {
          name: 'Native offline fixture',
          avatar: 'none',
          model: status.models[0].id,
          personality: '',
        },
        task: 'offline fixture',
      });
      expect(created.status, created.error ?? '').toBe('acknowledged');
      const getRounds = (id: string) => conversationRounds(project(store.events()), id);
      const send = async (id: string, commandId: string, text: string) => {
        const result = await coordinator.execute({
          version: 1,
          commandId,
          type: 'turn.start',
          agentId: id,
          text,
        });
        expect(result.status, result.error ?? '').toBe('acknowledged');
        await expect
          .poll(
            () =>
              getRounds(id).find((entry) => entry.round.id === result.result!.turnId)?.round
                .outcome,
            { timeout: 20000 },
          )
          .toBe('completed');
      };
      await send(created.agentId, 'native-first', 'EARLY_CONTEXT_ONLY_87521');
      const first = getRounds(created.agentId)[0].round;
      await send(created.agentId, 'native-later', 'FUTURE_CONTEXT_EXCLUDE_87521');
      const fork = await coordinator.execute({
        version: 1,
        commandId: 'native-fork',
        type: 'agent.fork',
        sourceAgentId: created.agentId,
        roundId: first.id,
        side: 'after',
        eventId: first.terminalEventId!,
      });
      expect(fork.status, fork.error ?? '').toBe('acknowledged');
      expect(requests).toHaveLength(2);
      await send(fork.agentId, 'native-branch-input', 'BRANCH_INPUT_ONLY_87521');
      const branchRequest = JSON.stringify(requests[2]);
      expect(branchRequest).toContain('EARLY_CONTEXT_ONLY_87521');
      expect(branchRequest).toContain('OFFLINE_FIXTURE_REPLY_1');
      expect(branchRequest).toContain('BRANCH_INPUT_ONLY_87521');
      expect(branchRequest).not.toContain('FUTURE_CONTEXT_EXCLUDE_87521');
      expect(branchRequest).not.toContain('OFFLINE_FIXTURE_REPLY_2');
      await send(created.agentId, 'native-parent-continue', 'PARENT_CONTINUES_87521');
      const parentRequest = JSON.stringify(requests[3]);
      expect(parentRequest).toContain('FUTURE_CONTEXT_EXCLUDE_87521');
      expect(parentRequest).not.toContain('BRANCH_INPUT_ONLY_87521');
      expect(requests).toHaveLength(4);
      const partial = await bridge.forkSession(
        'native-public-prefix',
        created.result!.sessionRef as string,
        [first.id],
        { name: 'Public prefix', avatar: 'none', model: status.models[0].id, personality: '' },
        [{ input: 'PARTIAL_USER_ORIGINAL_87521', records: 'PUBLIC_CHECKPOINT_ONLY_87521' }],
      );
      expect(requests).toHaveLength(4);
      let completed = false;
      let failure: Error | undefined;
      await bridge.startTurn(
        {
          version: 1,
          commandId: 'native-partial-input',
          type: 'turn.start',
          agentId: 'native-partial',
          text: 'PARTIAL_BRANCH_INPUT_87521',
        },
        partial.sessionRef,
        (frame) => {
          const packet = frame.packet as { method: string };
          if (packet.method === 'turn/completed') completed = true;
        },
        (error) => {
          failure = error;
        },
      );
      await expect.poll(() => completed || Boolean(failure), { timeout: 20000 }).toBe(true);
      expect(failure).toBeUndefined();
      const partialRequest = JSON.stringify(requests[4]);
      expect(partialRequest).toContain('EARLY_CONTEXT_ONLY_87521');
      expect(partialRequest).toContain('PARTIAL_USER_ORIGINAL_87521');
      expect(partialRequest).toContain('PUBLIC_CHECKPOINT_ONLY_87521');
      expect(partialRequest).toContain('PARTIAL_BRANCH_INPUT_87521');
      expect(partialRequest).not.toContain('FUTURE_CONTEXT_EXCLUDE_87521');
      expect(partialRequest).not.toContain('PARENT_CONTINUES_87521');
      expect(partialRequest).not.toContain('BRANCH_INPUT_ONLY_87521');
    } finally {
      coordinator.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // app-server can finish profile writes while its SIGTERM is being handled.
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  60000,
);
