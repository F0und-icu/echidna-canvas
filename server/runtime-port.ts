import type { AgentConfig, EventData, RecordedEvent } from '../web/model/schema.ts';
import type { ResolvedMcp } from './mcp-store.ts';
import type {
  BackendDescriptor,
  BackendStatus,
  LoginResult,
  HarnessLogin,
  RuntimeCommand,
} from '../contracts/runtime.ts';

export interface RuntimeFrame {
  version: 1;
  streamId: string;
  sourceSeq: number;
  packet: unknown;
}
export interface SourcePacket {
  payload: unknown;
  sessionRef: string;
  turnId: string;
  itemId?: string;
  method: string;
  images?: RuntimeImageSource[];
}
export type RuntimeImageSource =
  | { type: 'file'; path: string; generated: boolean }
  | { type: 'inline'; data: string; mimeType: string };
export interface RuntimeCodec {
  validate(packet: unknown): SourcePacket;
  project(
    packets: unknown[],
    context: { events: RecordedEvent[]; agentId: string; input: string; mode: 'fixture' | 'live' },
  ): EventData[];
}
export interface RuntimeBridge {
  readonly descriptor: BackendDescriptor;
  readonly codec: RuntimeCodec;
  status(): Promise<BackendStatus>;
  login(request?: HarnessLogin): Promise<LoginResult>;
  createSession(
    commandId: string,
    config: AgentConfig,
    task: string,
    projectRoot?: string,
    connections?: ResolvedMcp[],
  ): Promise<{ sessionRef: string; model: string; executionRef?: string }>;
  forkSession(
    commandId: string,
    sessionRef: string,
    turnIds: string[],
    config: AgentConfig,
    partial?: { input: string; records: string }[],
    projectRoot?: string,
    connections?: ResolvedMcp[],
  ): Promise<{ sessionRef: string; model: string; executionRef?: string }>;
  startTurn(
    command: Extract<RuntimeCommand, { type: 'turn.start' }>,
    sessionRef: string,
    emit: (frame: RuntimeFrame) => void,
    disconnected: (error: Error) => void,
  ): Promise<{ turnId: string }>;
  interrupt(sessionRef: string, turnId: string): Promise<void>;
  mcpStatus?(
    sessionRef: string,
  ): Promise<
    { id: string; authStatus: string; toolCount: number; state?: string; error?: string }[]
  >;
  loginMcp?(sessionRef: string, name: string): Promise<{ url: string }>;
  close(): void;
}
export class RuntimeRequestRejected extends Error {}
