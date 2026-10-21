import {
  canonical,
  feedSchema,
  runtimeStateSchema,
  commandRecordSchema,
  type RuntimeCommand,
  type RuntimeState,
  type RuntimeFeed,
  type HarnessLogin,
  backendStatusSchema,
  loginResultSchema,
} from '../../contracts/runtime';
import { project } from '../model/projection';
import type { Workspace } from '../model/schema';

export function mergeRuntime(workspace: Workspace, feed: RuntimeFeed): Workspace {
  const existing = workspace.events.filter(
      (e) => e.runtime && runtimeBackend(e.runtime) === feed.backend.id,
    ),
    last = existing.at(-1)?.runtime;
  if (last && last.storeId !== feed.storeId)
    throw new Error('服务记录库已变更；原画布已保留，不能合并不同来源。');
  let cursor = last?.cursor ?? 0;
  let byId: Map<string, Workspace['events'][number]> | undefined;
  const added = [];
  for (const event of feed.events) {
    if (
      !event.runtime ||
      event.runtime.storeId !== feed.storeId ||
      runtimeBackend(event.runtime) !== feed.backend.id ||
      event.seq !== event.runtime.cursor
    )
      throw new Error('运行时事件来源无效');
    if (event.runtime.cursor <= cursor) {
      byId ??= new Map(existing.map((prior) => [prior.id, prior]));
      const prior = byId.get(event.id);
      if (!prior || canonical({ ...prior, seq: 0 }) !== canonical({ ...event, seq: 0 }))
        throw new Error('重复事件的来源内容不一致');
      continue;
    }
    if (event.runtime.cursor !== cursor + 1) throw new Error('运行时事件存在游标缺口；停止投影。');
    cursor++;
    added.push({ ...event, seq: workspace.events.length + added.length + 1 });
  }
  if (cursor !== Math.max(last?.cursor ?? 0, feed.cursor))
    throw new Error('运行时快照与游标不一致');
  if (!added.length) return workspace;
  const events = [...workspace.events, ...added];
  project(events);
  return { ...workspace, events };
}
export class RuntimeHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function requestRuntime(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`/api/runtime${path}`, init);
  } catch (cause) {
    throw new Error('无法连接本地服务，请先启动服务，再重新连接。', { cause });
  }
  const text = await response.text();
  // A malformed body cannot confirm command admission or rejection.
  if (!text.trim())
    throw new Error(`本地服务返回空响应（HTTP ${response.status}），请检查服务是否已启动。`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new Error(`本地服务返回了无效响应（HTTP ${response.status}），请检查服务地址与状态。`, {
      cause,
    });
  }
  if (!response.ok)
    throw new RuntimeHttpError(
      response.status,
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `本地服务请求失败 (${response.status})`,
    );
  return body;
}
// P2 persisted only fixture events and did not store a backend ID.
export function runtimeBackend(
  source: NonNullable<Workspace['events'][number]['runtime']>,
): string {
  return source.backendId ?? 'codex-fixture';
}
export async function readBackend() {
  return backendStatusSchema.parse(await requestRuntime('/backend'));
}
export async function loginRuntime(authentication: HarnessLogin = { method: 'device-code' }) {
  return loginResultSchema.parse(
    await requestRuntime('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, authentication }),
    }),
  );
}
export async function runtimeSnapshot(): Promise<RuntimeState> {
  return runtimeStateSchema.parse(await requestRuntime(''));
}
export class RuntimeCommandRejected extends Error {}
export async function sendRuntimeCommand(command: RuntimeCommand) {
  try {
    return commandRecordSchema.parse(
      await requestRuntime('/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      }),
    );
  } catch (cause) {
    if (cause instanceof RuntimeHttpError && cause.status >= 400 && cause.status < 500)
      throw new RuntimeCommandRejected(cause.message, { cause });
    throw cause;
  }
}
export const parseRuntimeFeed = (raw: string) => feedSchema.parse(JSON.parse(raw));
