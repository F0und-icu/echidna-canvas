import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  commandSchema,
  backendStatusSchema,
  loginResultSchema,
  loginRequestSchema,
} from '../contracts/runtime.ts';
import { CommandConflict } from './runtime-store.ts';
import { Coordinator } from './coordinator.ts';
import { readImagePreview, readInlineImage, ImagePreviewUnavailable } from './image-preview.ts';
import { ProjectFileStore, FileProblem, fileSystemProblem } from './project-files.ts';
import { saveFileSchema, selectFileProjectSchema, MAX_FILE_BYTES } from '../contracts/files.ts';
import type { EventData } from '../web/model/schema.ts';
import { saveMcpSchema, mcpServerName } from '../contracts/mcp.ts';
import { RuntimeRequestRejected } from './runtime-port.ts';
import { z } from 'zod';
import { project } from '../web/model/projection.ts';

class HttpProblem extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function createRuntimeServer(
  coordinator: Coordinator,
  imageRoot: string,
  files: ProjectFileStore,
) {
  const secret = randomBytes(32).toString('hex');
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (error instanceof HttpProblem || error instanceof FileProblem)
        json(res, error.status, { error: error.message });
      else if (error instanceof CommandConflict || error instanceof RuntimeRequestRejected)
        json(res, 409, { error: error.message });
      else {
        console.error('Runtime service failure', error);
        json(res, 500, { error: '运行时服务内部错误；没有自动重试命令。' });
      }
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Runtime listener has no TCP address');
    const host = `127.0.0.1:${address.port}`;
    if (req.headers.host !== host) throw new HttpProblem(403, '拒绝非本机服务 Host');
    const allowed = [`http://${host}`, 'http://127.0.0.1:4173', 'http://127.0.0.1:4174'];
    if (
      (req.headers.origin && !allowed.includes(req.headers.origin)) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new HttpProblem(403, '拒绝跨站运行时访问');
    const url = new URL(req.url!, `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/api/runtime/session') {
      res.setHeader(
        'Set-Cookie',
        `echidna_canvas_session=${secret}; HttpOnly; SameSite=Strict; Path=/api/runtime`,
      );
      json(res, 200, { backend: coordinator.bridge.descriptor });
      return;
    }
    const cookie = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('echidna_canvas_session='))
      ?.slice('echidna_canvas_session='.length);
    if (
      !cookie ||
      !/^[a-f0-9]{64}$/.test(cookie) ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(secret))
    )
      throw new HttpProblem(401, '请先连接本地运行时');
    if (req.method === 'POST') {
      if (!req.headers.origin || !allowed.includes(req.headers.origin))
        throw new HttpProblem(403, '命令需要受信任的页面来源');
      if (req.headers['content-type'] !== 'application/json')
        throw new HttpProblem(415, '命令需要 application/json');
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime/backend') {
      json(res, 200, backendStatusSchema.parse(await coordinator.bridge.status()));
      return;
    }
    if (url.pathname === '/api/runtime/mcp-connections') {
      if (!coordinator.mcp) throw new HttpProblem(409, '此服务未启动 MCP 配置存储。');
      if (req.method === 'GET') {
        json(res, 200, coordinator.mcp.list());
        return;
      }
      if (req.method === 'POST') {
        const parsed = saveMcpSchema.safeParse(await readJson(req));
        if (!parsed.success)
          throw new HttpProblem(
            400,
            'MCP 地址或认证配置无效；使用 HTTP(S)，凭据只能填写在认证字段。',
          );
        json(res, 200, coordinator.mcp.save(parsed.data));
        return;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime/mcp-status') {
      if (!coordinator.bridge.mcpStatus) throw new HttpProblem(409, '此运行时未提供 MCP 状态。');
      const agent = coordinator.store.agent(url.searchParams.get('agentId') ?? '');
      json(res, 200, await coordinator.bridge.mcpStatus(agent.thread_id));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/runtime/mcp-login') {
      const input = z
        .object({ agentId: z.string(), connectionId: z.uuid() })
        .strict()
        .safeParse(await readJson(req));
      if (!input.success) throw new HttpProblem(400, 'MCP 登录请求无效。');
      if (!coordinator.mcp || !coordinator.bridge.loginMcp)
        throw new HttpProblem(409, '此运行时未提供 MCP 登录。');
      const session = project(coordinator.store.events()).sessions[input.data.agentId];
      const ref = session?.connections?.find((ref) => ref.id === input.data.connectionId);
      if (!ref || coordinator.mcp.get(ref).auth.method !== 'oauth')
        throw new HttpProblem(409, '请先将此 OAuth 接入绑定到 Agent。');
      const result = await coordinator.bridge.loginMcp(
        coordinator.store.agent(input.data.agentId).thread_id,
        mcpServerName(ref.id),
      );
      json(
        res,
        200,
        z
          .object({
            url: z.url().refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)),
          })
          .parse(result),
      );
      return;
    }
    if (
      [
        '/api/runtime/files',
        '/api/runtime/file',
        '/api/runtime/file-revision',
        '/api/runtime/file-history',
        '/api/runtime/file-projects',
        '/api/runtime/file-projects/register',
      ].includes(url.pathname)
    ) {
      try {
        if (url.pathname === '/api/runtime/file-projects/register' && req.method === 'POST') {
          const input = selectFileProjectSchema.safeParse(await readJson(req));
          if (!input.success) throw new HttpProblem(400, '无效的项目绑定请求。');
          json(res, 200, files.registerProject(input.data.root));
          return;
        }
        if (url.pathname === '/api/runtime/file-projects') {
          if (req.method === 'GET') {
            json(res, 200, files.projects());
            return;
          }
          if (req.method === 'POST') {
            const input = selectFileProjectSchema.safeParse(await readJson(req));
            if (!input.success) throw new HttpProblem(400, '无效的项目切换请求。');
            json(res, 200, files.selectProject(input.data.root));
            return;
          }
        }
        const header = req.headers['x-echidna-project'];
        if (typeof header !== 'string') throw new HttpProblem(400, '文件请求需要明确的项目来源。');
        let root: string;
        try {
          root = decodeURIComponent(header);
        } catch {
          throw new HttpProblem(400, '无效的项目来源编码。');
        }
        const bound = req.headers['x-echidna-project-bound'];
        if (bound !== undefined && bound !== 'true')
          throw new HttpProblem(400, '无效的项目绑定标记。');
        const requireProject = () =>
          bound === 'true' ? files.requireRegisteredProject(root) : files.requireProject(root);
        if (req.method !== 'POST') requireProject();
        if (req.method === 'GET' && url.pathname === '/api/runtime/file-history') {
          json(res, 200, files.index(root));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/runtime/files') {
          json(res, 200, files.list(url.searchParams.get('directory') ?? '', root));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/runtime/file') {
          const path = url.searchParams.get('path');
          if (!path) throw new HttpProblem(400, '请指定项目文件。');
          json(res, 200, files.open(path, root));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/runtime/file-revision') {
          const path = url.searchParams.get('path'),
            revision = url.searchParams.get('revision');
          if (
            !path ||
            !revision ||
            !/^[1-9]\d*$/.test(revision) ||
            !Number.isSafeInteger(Number(revision))
          )
            throw new HttpProblem(400, '无效的文件版本请求。');
          json(res, 200, files.history(path, Number(revision), root));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/runtime/file') {
          const input = saveFileSchema.safeParse(await readJson(req, MAX_FILE_BYTES * 6 + 8192));
          if (!input.success) throw new HttpProblem(400, '无效的文件保存请求。');
          requireProject();
          json(
            res,
            200,
            files.save(input.data.path, input.data.baseHash, input.data.content, root),
          );
          return;
        }
      } catch (cause) {
        throw fileSystemProblem(cause) ?? cause;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime/image') {
      const events = coordinator.store.events();
      const event = events.find((entry) => entry.id === url.searchParams.get('event'));
      const part = url.searchParams.get('part') ?? '0';
      if (!event || event.data.type !== 'tool.finished' || !/^\d+$/.test(part))
        throw new HttpProblem(404, '没有此图像的运行时来源记录');
      const preview = (event.data.previews ?? (event.data.preview ? [event.data.preview] : []))[
        Number(part)
      ];
      if (preview?.kind !== 'image') throw new HttpProblem(404, '没有此图像的运行时来源记录');
      try {
        const creation = events.find((entry) => entry.sessionId === event.sessionId)!
          .data as Extract<EventData, { type: 'session.created' }>;
        const source =
          preview.sourceIndex === undefined
            ? { type: 'file' as const, path: preview.path!, generated: false }
            : coordinator.store.imageSource(event, preview.sourceIndex);
        const image =
          source.type === 'inline'
            ? readInlineImage(source)
            : await readImagePreview(
                creation.projectRoot ?? imageRoot,
                source.path,
                source.generated,
              );
        res.writeHead(200, {
          'Content-Type': image.type,
          'Content-Length': image.bytes.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        });
        res.end(image.bytes);
      } catch (error) {
        if (error instanceof ImagePreviewUnavailable) throw new HttpProblem(422, error.message);
        throw error;
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/runtime/login') {
      const login = loginRequestSchema.safeParse(await readJson(req));
      if (!login.success) throw new HttpProblem(400, '无效的登录请求');
      if (!coordinator.bridge.descriptor.capabilities.login)
        throw new HttpProblem(409, '当前运行时不使用登录');
      json(res, 200, loginResultSchema.parse(await coordinator.bridge.login(login.data)));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime') {
      json(res, 200, coordinator.store.state());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/runtime/commands') {
      const raw = await readJson(req);
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) throw new HttpProblem(400, '命令版本、结构或字段无效');
      if (
        parsed.data.type === 'agent.create' &&
        parsed.data.projectRoot &&
        !coordinator.store.hasCommand(parsed.data.commandId)
      ) {
        try {
          const canonical = files.registerProject(parsed.data.projectRoot).root;
          if (canonical !== parsed.data.projectRoot)
            throw new HttpProblem(400, '请先选择规范化后的项目目录，再创建 Agent。');
        } catch (cause) {
          throw fileSystemProblem(cause) ?? cause;
        }
      }
      json(res, 200, await coordinator.execute(parsed.data));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime/events') {
      const cursorText = req.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0';
      if (typeof cursorText !== 'string' || !/^\d+$/.test(cursorText))
        throw new HttpProblem(400, '无效的事件游标');
      let cursor = Number(cursorText);
      if (!Number.isSafeInteger(cursor) || cursor > coordinator.store.cursor())
        throw new HttpProblem(409, '事件游标超出持久化记录');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      const send = () => {
        const state = coordinator.store.state();
        const events = coordinator.store.events(cursor);
        // State-only changes (e.g. dispatch acknowledgement) keep the event cursor.
        res.write(`id: ${state.cursor}\ndata: ${JSON.stringify({ ...state, events })}\n\n`);
        cursor = state.cursor;
      };
      send();
      coordinator.changes.on('change', send);
      res.on('close', () => coordinator.changes.off('change', send));
      return;
    }
    throw new HttpProblem(404, '不存在的本地接口');
  }
  return server;
}

async function readJson(req: IncomingMessage, limit = 32 * 1024): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw new HttpProblem(413, `请求超过 ${limit} 字节`);
    parts.push(part);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new HttpProblem(400, '命令不是有效 JSON');
  }

  return raw;
}
