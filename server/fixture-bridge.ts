import { CodexJsonlDecoder, codexCodec, type CodexNotification } from './codex-protocol.ts';
import type { RuntimeCommand } from '../contracts/runtime.ts';
import type { AgentConfig } from '../web/model/schema.ts';
import { RuntimeRequestRejected, type RuntimeBridge, type RuntimeFrame } from './runtime-port.ts';

// Offline fixture, not an app-server process and not a model call.
export class FixtureCodexBridge implements RuntimeBridge {
  readonly descriptor = {
    id: 'codex-fixture',
    label: '协议演示',
    mode: 'fixture' as const,
    capabilities: { chat: true, interrupt: true, login: false, fork: true },
  };
  readonly codec = codexCodec;
  async status() {
    return {
      backend: this.descriptor,
      account: 'not-required' as const,
      models: [{ id: 'Codex（协议夹具）', label: '协议示例（固定回复）' }],
      notices: ['离线模式仅验证消息和事件链，固定示例回复不会理解输入。'],
    };
  }
  async login(): Promise<never> {
    throw new RuntimeRequestRejected('协议演示不需要登录');
  }
  private turns = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout> | null;
      next: number;
      send: (packet: CodexNotification) => void;
      packets: CodexNotification[];
      disconnect: (error: Error) => void;
    }
  >();
  async createSession(commandId: string) {
    return { sessionRef: `thr_${commandId}`, model: 'Codex（协议夹具）' };
  }
  async forkSession(
    commandId: string,
    _sessionRef: string,
    _turnIds: string[],
    config: AgentConfig,
  ) {
    return { sessionRef: `thr_${commandId}`, model: config.model };
  }
  async startTurn(
    command: Extract<RuntimeCommand, { type: 'turn.start' }>,
    threadId: string,
    emit: (frame: RuntimeFrame) => void,
    disconnected: (error: Error) => void,
  ) {
    if (command.scenario === 'dispatch-unknown')
      throw new Error('Fixture disconnected after dispatch and before acknowledgement');
    const turnId = `turn_${command.commandId}`,
      scope = { threadId, turnId },
      decoder = new CodexJsonlDecoder();
    let seq = 0;
    const send = (packet: CodexNotification) => {
      const bytes = new TextEncoder().encode(`${JSON.stringify(packet)}\n`);
      // Deliberately split UTF-8 and JSON across writes, just as stdio can.
      for (let i = 0; i < bytes.length; i += 7)
        for (const parsed of decoder.push(bytes.slice(i, i + 7)))
          emit({ version: 1, streamId: command.commandId, sourceSeq: ++seq, packet: parsed });
    };
    const commandItem = {
      type: 'commandExecution' as const,
      id: 'cmd_1',
      command: 'rg --files',
      cwd: '/fixture/project',
      status: 'inProgress' as const,
    };
    const packets: CodexNotification[] = [
      {
        method: 'item/started',
        params: { ...scope, item: { type: 'reasoning', id: 'reason_1', summary: [] } },
      },
      {
        method: 'item/reasoning/summaryTextDelta',
        params: { ...scope, itemId: 'reason_1', summaryIndex: 0, delta: '先核对项目文件，' },
      },
      {
        method: 'item/completed',
        params: {
          ...scope,
          item: {
            type: 'reasoning',
            id: 'reason_1',
            summary: ['先核对项目文件，再说明可确认的范围。'],
          },
        },
      },
      { method: 'item/started', params: { ...scope, item: commandItem } },
      {
        method: 'item/commandExecution/outputDelta',
        params: { ...scope, itemId: 'cmd_1', delta: 'README.md\n' },
      },
      {
        method: 'item/completed',
        params: {
          ...scope,
          item: {
            ...commandItem,
            status: command.scenario === 'tool-failure' ? 'failed' : 'completed',
            exitCode: command.scenario === 'tool-failure' ? 2 : 0,
            aggregatedOutput:
              command.scenario === 'tool-failure'
                ? 'fixture: path unavailable'
                : 'README.md\nsrc/main.ts\n',
          },
        },
      },
      {
        method: 'item/started',
        params: { ...scope, item: { type: 'agentMessage', id: 'answer_1', text: '' } },
      },
      {
        method: 'item/agentMessage/delta',
        params: { ...scope, itemId: 'answer_1', delta: '已收到演示命令的回传。' },
      },
      {
        method: 'item/completed',
        params: {
          ...scope,
          item: {
            type: 'agentMessage',
            id: 'answer_1',
            text:
              command.scenario === 'tool-failure'
                ? '协议演示：命令失败，未据此宣布任务完成。'
                : '协议演示：已列出两个文件；没有读取或修改真实项目。',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed', error: null } },
      },
    ];
    const turn = {
      timer: null as ReturnType<typeof setTimeout> | null,
      next: 0,
      send,
      packets,
      disconnect: disconnected,
    };
    this.turns.set(turnId, turn);
    send({
      method: 'turn/started',
      params: { threadId, turn: { id: turnId, status: 'inProgress' } },
    });
    const next = () => {
      try {
        if (command.scenario === 'disconnect' && turn.next === 5) {
          disconnected(new Error('协议夹具连接中断；命令结果待核对。'));
          this.turns.delete(turnId);
          return;
        }
        send(packets[turn.next++]);
        if (turn.next < packets.length) turn.timer = setTimeout(next, 90);
        else {
          decoder.finish();
          this.turns.delete(turnId);
        }
      } catch (error) {
        disconnected(error instanceof Error ? error : new Error(String(error)));
        this.turns.delete(turnId);
      }
    };
    turn.timer = setTimeout(next, 90);
    return { turnId };
  }
  async interrupt(threadId: string, turnId: string) {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error('Fixture turn is no longer active');
    if (turn.timer) clearTimeout(turn.timer);
    // Acknowledgement is not completion. The executor confirmation is a later frame.
    turn.timer = setTimeout(() => {
      try {
        turn.send({
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'interrupted', error: null } },
        });
      } catch (error) {
        turn.disconnect(error instanceof Error ? error : new Error(String(error)));
      }
      this.turns.delete(turnId);
    }, 50);
  }
  close() {
    for (const turn of this.turns.values()) {
      if (turn.timer) clearTimeout(turn.timer);
      turn.disconnect(new Error('运行时服务关闭；没有执行器终态。'));
    }
    this.turns.clear();
  }
}
