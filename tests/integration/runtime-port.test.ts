import { expect, it } from 'vitest';
import { z } from 'zod';
import { RuntimeStore } from '../../server/runtime-store';
import { Coordinator } from '../../server/coordinator';
import {
  RuntimeRequestRejected,
  type RuntimeBridge,
  type RuntimeCodec,
  type RuntimeFrame,
} from '../../server/runtime-port';
import type { RuntimeCommand } from '../../contracts/runtime';
import type { AgentConfig } from '../../web/model/schema';
import { project } from '../../web/model/projection';
import { FixtureCodexBridge } from '../../server/fixture-bridge';
import { createWorkspace } from '../../web/model/workspace';
import { mergeRuntime } from '../../web/runtime/connection';

// This intentionally uses a different source protocol: no Codex fields or decoder.
const ownPacket = z.object({
  kind: z.enum(['begin', 'text', 'end']),
  conversation: z.string(),
  cycle: z.string(),
  text: z.string(),
});
class OwnAgentFixture implements RuntimeBridge {
  readonly descriptor = {
    id: 'private-agent',
    label: '自有 Agent 协议测试',
    mode: 'fixture' as const,
    capabilities: { chat: true, interrupt: false, login: false },
  };
  readonly codec: RuntimeCodec = {
    validate(raw) {
      const packet = ownPacket.parse(raw);
      return {
        payload: packet,
        sessionRef: packet.conversation,
        turnId: packet.cycle,
        method: packet.kind,
      };
    },
    project(packets, context) {
      const packet = ownPacket.parse(packets.at(-1)),
        roundId = packet.cycle;
      const config = project(context.events).sessions[context.agentId].config;
      if (packet.kind === 'begin')
        return [
          {
            type: 'round.started',
            unit: 'turn',
            roundId,
            title: '自有 Agent 回合',
            refs: [],
            input: {
              task: context.input,
              model: config.model,
              personality: config.personality,
              materials: [],
              contractVersion: 'runtime-v1',
            },
          },
        ];
      if (packet.kind === 'text') return [{ type: 'response.delta', roundId, text: packet.text }];
      return [{ type: 'round.terminated', roundId, status: 'completed', error: null }];
    },
  };
  async status() {
    return {
      backend: this.descriptor,
      account: 'not-required' as const,
      models: [{ id: 'private-model', label: '测试模型' }],
      notices: ['测试适配器，不是真实模型'],
    };
  }
  async login(): Promise<never> {
    throw new RuntimeRequestRejected('本测试适配器不使用登录');
  }
  async createSession(_id: string, config: AgentConfig) {
    return { sessionRef: 'own-conversation', model: config.model };
  }
  async forkSession(): Promise<never> {
    throw new RuntimeRequestRejected('本测试适配器尚未提供分叉接口');
  }
  async startTurn(
    command: Extract<RuntimeCommand, { type: 'turn.start' }>,
    sessionRef: string,
    emit: (frame: RuntimeFrame) => void,
  ) {
    let sourceSeq = 0;
    for (const kind of ['begin', 'text', 'end'])
      emit({
        version: 1,
        streamId: command.commandId,
        sourceSeq: ++sourceSeq,
        packet: {
          kind,
          conversation: sessionRef,
          cycle: command.commandId,
          text: '测试适配器收到：' + command.text,
        },
      });
    return { turnId: command.commandId };
  }
  async interrupt(): Promise<never> {
    throw new RuntimeRequestRejected('本测试适配器不支持中断');
  }
  close() {}
}
const create: RuntimeCommand = {
  version: 1,
  commandId: 'shared-id',
  type: 'agent.create',
  config: { name: '自己的 Agent', avatar: 'deepseek', model: 'private-model', personality: '准确' },
  task: '解释问题',
};

it('runs a different protocol through unchanged coordinator, persistence and canvas projection', async () => {
  const bridge = new OwnAgentFixture(),
    store = new RuntimeStore(':memory:', bridge),
    coordinator = new Coordinator(store, bridge);
  try {
    const created = await coordinator.execute(create);
    await coordinator.execute({
      version: 1,
      commandId: 'my-message',
      type: 'turn.start',
      agentId: created.agentId,
      text: '这是一条自定义消息',
    });
    const session = project(store.events()).sessions[created.agentId];
    expect(session.routes[0].rounds[0].response).toBe('测试适配器收到：这是一条自定义消息');
    expect(session.routes[0].rounds[0].input.task).toBe('这是一条自定义消息');
    expect(session.runtime?.sessionRef).toBe('own-conversation');
    expect(session.runtime?.backendId).toBe('private-agent');
    expect(store.state().agents[0].state).toBe('idle');
  } finally {
    coordinator.close();
  }
});
it('keeps two backend histories separate while displaying them in one workspace', async () => {
  const own = new OwnAgentFixture(),
    fixture = new FixtureCodexBridge();
  const ownStore = new RuntimeStore(':memory:', own),
    fixtureStore = new RuntimeStore(':memory:', fixture);
  const a = new Coordinator(ownStore, own),
    b = new Coordinator(fixtureStore, fixture);
  try {
    const first = await a.execute(create),
      second = await b.execute(create);
    expect(first.agentId).not.toBe(second.agentId);
    let workspace = mergeRuntime(createWorkspace(), ownStore.state());
    workspace = mergeRuntime(workspace, fixtureStore.state());
    expect(project(workspace.events).sessions[first.agentId].runtime?.backendId).toBe(
      'private-agent',
    );
    expect(project(workspace.events).sessions[second.agentId].runtime?.backendId).toBe(
      'codex-fixture',
    );
    expect(mergeRuntime(workspace, ownStore.state()).events).toEqual(workspace.events);
  } finally {
    a.close();
    b.close();
  }
});
