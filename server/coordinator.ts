import { EventEmitter } from 'node:events';
import type { RuntimeCommand } from '../contracts/runtime.ts';
import type { RecordedEvent } from '../web/model/schema.ts';
import { RuntimeStore } from './runtime-store.ts';
import { RuntimeRequestRejected, type RuntimeBridge } from './runtime-port.ts';
import type { McpStore } from './mcp-store.ts';
import type { McpRef } from '../contracts/mcp.ts';

export class Coordinator {
  readonly changes = new EventEmitter();
  readonly store: RuntimeStore;
  readonly bridge: RuntimeBridge;
  readonly mcp?: McpStore;
  constructor(store: RuntimeStore, bridge: RuntimeBridge, mcp?: McpStore) {
    this.store = store;
    this.bridge = bridge;
    this.mcp = mcp;
  }
  private connections(refs: McpRef[]) {
    if (!refs.length) return [];
    if (!this.mcp || !this.bridge.descriptor.capabilities.mcp)
      throw new RuntimeRequestRejected('当前运行时未提供 MCP 接入。');
    return this.mcp.resolve(refs);
  }
  private publish(events: RecordedEvent[] = []) {
    this.changes.emit('change', events);
  }
  async execute(command: RuntimeCommand) {
    const admitted = this.store.admit(command);
    if (!admitted.fresh) return admitted.record;
    const agentId = admitted.record.agentId;
    this.publish();
    const unknown = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RuntimeRequestRejected) {
        this.store.reject(command.commandId, message);
        this.publish();
        return this.store.command(command.commandId);
      }
      this.publish(this.store.uncertain(command.commandId, message));
      return this.store.command(command.commandId);
    };
    if (command.type === 'agent.create' || command.type === 'agent.fork') {
      let result: { sessionRef: string; model: string; executionRef?: string };
      try {
        if (command.type === 'agent.create')
          result = await this.bridge.createSession(
            command.commandId,
            command.config,
            command.task,
            command.projectRoot,
            this.connections(command.connections ?? []),
          );
        else {
          const point = this.store.forkContext(command);
          result = await this.bridge.forkSession(
            command.commandId,
            point.sessionRef,
            point.turnIds,
            point.config,
            point.partial,
            point.projectRoot,
            this.connections(point.connections),
          );
        }
      } catch (error) {
        return unknown(error);
      }
      this.publish(
        this.store.created(command.commandId, result.sessionRef, result.model, result.executionRef),
      );
    } else if (command.type === 'agent.mcp.configure') {
      let result: { sessionRef: string; model: string; executionRef?: string };
      try {
        const context = this.store.configurationContext(command.agentId);
        result = await this.bridge.forkSession(
          command.commandId,
          context.sessionRef,
          context.turnIds,
          context.config,
          context.partial,
          context.projectRoot,
          this.connections(command.connections),
        );
      } catch (error) {
        return unknown(error);
      }
      this.publish(
        this.store.mcpConfigured(
          command.commandId,
          command.connections,
          result.sessionRef,
          result.model,
          result.executionRef,
        ),
      );
    } else if (command.type === 'turn.start') {
      const agent = this.store.agent(agentId);
      let result: { turnId: string };
      try {
        result = await this.bridge.startTurn(
          command,
          agent.thread_id,
          (frame) => this.publish(this.store.ingest(agentId, frame)),
          (error) => this.publish(this.store.disconnected(agentId, error.message)),
        );
      } catch (error) {
        return unknown(error);
      }
      this.store.acknowledge(command.commandId, result);
      this.publish();
    } else {
      try {
        await this.bridge.interrupt(this.store.agent(agentId).thread_id, command.turnId);
      } catch (error) {
        return unknown(error);
      }
      this.publish(this.store.interruptRequested(command.commandId, command.turnId));
    }
    return this.store.command(command.commandId);
  }
  close() {
    this.bridge.close();
    this.changes.removeAllListeners();
    this.store.close();
    this.mcp?.close();
  }
}
