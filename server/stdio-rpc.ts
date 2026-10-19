import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { JsonlDecoder } from './jsonl.ts';

const requestId = z.union([z.string(), z.number().int()]);
const envelopeSchema = z.union([
  z.object({ id: requestId, result: z.unknown() }).refine((v) => Object.hasOwn(v, 'result')),
  z.object({ id: requestId, error: z.object({ code: z.number().int() }) }),
  z.object({ method: z.string().min(1), params: z.unknown(), id: requestId.optional() }),
]);
export class RpcResponseError extends Error {
  constructor(method: string, code: number) {
    super(`Codex 拒绝了 ${method} 请求（JSON-RPC ${code}）；没有自动重试。`);
  }
}
class ProtocolMessageFailure extends Error {
  constructor(message: { method: string; params: unknown }, cause: unknown) {
    const detail =
      cause instanceof z.ZodError
        ? cause.issues.map((issue) => issue.code + '@' + issue.path.join('.')).join(', ')
        : cause instanceof Error
          ? cause.message
          : 'invalid message';
    // Only an identifier-shaped discriminator is safe diagnostic context; never echo item bodies.
    const item = z
      .object({ item: z.object({ type: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/) }) })
      .safeParse(message.params);
    const type =
      ['item/started', 'item/completed'].includes(message.method) && item.success
        ? ` [item.type=${item.data.item.type}]`
        : '';
    super(`Codex ${message.method}${type} 处理失败：${detail}`, { cause });
  }
}
export class StdioRpc {
  private child: ChildProcessWithoutNullStreams;
  private decoder = new JsonlDecoder();
  private nextId = 0;
  private pending = new Map<
    string | number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed: Error | null = null;
  constructor(options: {
    file: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    onNotification: (message: { method: string; params: unknown }) => void;
    onRequest?: (message: { method: string; params: unknown }) => unknown;
    onFailure: (error: Error) => void;
    requestTimeoutMs?: number;
  }) {
    this.options = options;
    this.child = spawn(options.file, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Stderr is transport diagnostics, not a source of execution facts or UI text.
    this.child.stderr.resume();
    this.child.stdin.on('error', () =>
      this.fail(new Error('Codex 输入管道断开；派发结果待核对。')),
    );
    this.child.on('error', () => this.fail(new Error('无法启动指定的 Codex 可执行文件。')));
    this.child.stdout.on('data', (bytes: Buffer) => {
      try {
        for (const raw of this.decoder.push(bytes)) this.receive(raw);
      } catch (cause) {
        this.fail(
          cause instanceof ProtocolMessageFailure
            ? cause
            : new Error('Codex 协议或事件提交失败；结果待核对。', { cause }),
        );
      }
    });
    this.child.stdout.on('end', () => {
      try {
        this.decoder.finish();
      } catch (cause) {
        this.fail(new Error('Codex 输出在消息中途结束。', { cause }));
      }
    });
    this.child.on('exit', () => this.fail(new Error('Codex 进程已退出；未确认的执行仍待核对。')));
  }
  private options: {
    onNotification: (message: { method: string; params: unknown }) => void;
    onRequest?: (message: { method: string; params: unknown }) => unknown;
    onFailure: (error: Error) => void;
    requestTimeoutMs?: number;
  };
  private receive(raw: unknown) {
    const message = envelopeSchema.parse(raw);
    if ('method' in message) {
      if (message.id !== undefined) {
        if (this.options.onRequest) {
          try {
            this.send({ id: message.id, result: this.options.onRequest(message) });
          } catch (cause) {
            throw new ProtocolMessageFailure(message, cause);
          }
          return;
        }
        this.send({
          id: message.id,
          error: {
            code: -32601,
            message: 'This client does not support server-initiated requests.',
          },
        });
        throw new Error(`Unsupported server request: ${message.method}`);
      }
      try {
        this.options.onNotification(message);
      } catch (cause) {
        throw new ProtocolMessageFailure(message, cause);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) throw new Error('Unmatched Codex response identity');
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if ('error' in message)
      pending.reject(new RpcResponseError(pending.method, message.error.code));
    else pending.resolve(message.result);
  }
  private send(message: unknown) {
    if (this.closed) throw this.closed;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request<T>(method: string, params: unknown, decode: (value: unknown) => T): Promise<T>;
  request(method: string, params: unknown): Promise<unknown>;
  request(
    method: string,
    params: unknown,
    decode = (value: unknown): unknown => value,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const id = `canvas-${++this.nextId}`;
      const timer = setTimeout(
        () => this.fail(new Error(`Codex ${method} 确认超时；没有重发请求。`)),
        this.options.requestTimeoutMs ?? 30000,
      );
      this.pending.set(id, {
        method,
        resolve: (value) => {
          try {
            resolve(decode(value));
          } catch (error) {
            reject(error);
          }
        },
        reject,
        timer,
      });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  notify(method: string, params: unknown) {
    this.send({ method, params });
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = error;
    this.child.kill('SIGTERM');
    const child = this.child;
    const kill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 1000);
    kill.unref();
    child.once('exit', () => clearTimeout(kill));
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.options.onFailure(error);
  }
  close() {
    this.fail(new Error('本地客户端关闭；未确认的执行保持未知。'));
  }
}
