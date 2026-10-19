import { z } from 'zod';
import { toolPreviewSchema, type EventData, type ToolPreview } from '../web/model/schema.ts';
import type { RuntimeImageSource } from './runtime-port.ts';
import { imageMimeType } from './image-preview.ts';

const named = { id: z.string().min(1) };
const status = z.enum(['inProgress', 'completed', 'failed']);
export const fileChangesSchema = z.array(
  z.object({
    path: z.string(),
    diff: z.string(),
    kind: z.discriminatedUnion('type', [
      z.object({ type: z.literal('add') }),
      z.object({ type: z.literal('delete') }),
      z.object({ type: z.literal('update'), move_path: z.string().nullable().optional() }),
    ]),
  }),
);
// Consumed fields from the generated Codex 0.149.0 ThreadItem schema.
// Unknown discriminators still fail; private reasoning and transport metadata are stripped.
export const itemSchema = z.discriminatedUnion('type', [
  z.object({ ...named, type: z.literal('agentMessage'), text: z.string() }),
  z.object({
    ...named,
    type: z.literal('userMessage'),
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  }),
  z.object({ ...named, type: z.literal('plan'), text: z.string() }),
  z.object({ ...named, type: z.literal('contextCompaction') }),
  z.object({
    ...named,
    type: z.literal('dynamicToolCall'),
    tool: z.string(),
    arguments: z.json(),
    status,
    success: z.boolean().nullable().optional(),
  }),
  z.object({ ...named, type: z.literal('reasoning'), summary: z.array(z.string()).default([]) }),
  z.object({
    ...named,
    type: z.literal('commandExecution'),
    command: z.string(),
    cwd: z.string(),
    status: z.enum(['inProgress', 'completed', 'failed', 'declined']),
    aggregatedOutput: z.string().nullable().optional(),
    exitCode: z.number().int().nullable().optional(),
  }),
  z.object({
    ...named,
    type: z.literal('mcpToolCall'),
    server: z.string(),
    tool: z.string(),
    arguments: z.json(),
    status,
    result: z
      .object({ content: z.array(z.json()), structuredContent: z.json().optional() })
      .nullable()
      .optional(),
    error: z.object({ message: z.string() }).nullable().optional(),
  }),
  z.object({
    ...named,
    type: z.literal('webSearch'),
    query: z.string(),
    action: z
      .discriminatedUnion('type', [
        z.object({
          type: z.literal('search'),
          query: z.string().nullable().optional(),
          queries: z.array(z.string()).nullable().optional(),
        }),
        z.object({ type: z.literal('openPage'), url: z.string().nullable().optional() }),
        z.object({
          type: z.literal('findInPage'),
          url: z.string().nullable().optional(),
          pattern: z.string().nullable().optional(),
        }),
        z.object({ type: z.literal('other') }),
      ])
      .nullable()
      .optional(),
    results: z.array(z.json()).nullable().optional(),
  }),
  z.object({
    ...named,
    type: z.literal('fileChange'),
    changes: fileChangesSchema,
    status: z.enum(['inProgress', 'completed', 'failed', 'declined']),
  }),
  z.object({ ...named, type: z.literal('imageView'), path: z.string() }),
  z.object({ ...named, type: z.literal('sleep'), durationMs: z.number().int().nonnegative() }),
  z.object({
    ...named,
    type: z.literal('imageGeneration'),
    status: z.string(),
    result: z.string(),
    savedPath: z.string().nullable().optional(),
    failure: z
      .object({
        type: z.literal('usageLimitExceeded'),
        limitId: z.string(),
        resetsAt: z.number().int().nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    ...named,
    type: z.literal('hookPrompt'),
    // Hook instructions are not public model output. Retain only run references.
    fragments: z.array(z.object({ hookRunId: z.string() })),
  }),
  z.object({
    ...named,
    type: z.enum(['enteredReviewMode', 'exitedReviewMode']),
    review: z.string(),
  }),
  z.object({
    ...named,
    type: z.literal('collabAgentToolCall'),
    tool: z.enum(['spawnAgent', 'sendInput', 'resumeAgent', 'wait', 'closeAgent']),
    status,
    senderThreadId: z.string(),
    receiverThreadIds: z.array(z.string()),
    agentsStates: z.record(
      z.string(),
      z.object({
        status: z.enum([
          'pendingInit',
          'running',
          'interrupted',
          'completed',
          'errored',
          'shutdown',
          'notFound',
        ]),
        message: z.string().nullable().optional(),
      }),
    ),
  }),
  z.object({
    ...named,
    type: z.literal('subAgentActivity'),
    agentPath: z.string(),
    agentThreadId: z.string(),
    kind: z.enum(['started', 'interacted', 'interrupted']),
  }),
]);
export type CodexItem = z.infer<typeof itemSchema>;

const mcpImage = z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() });
// Observed Codex openPage results contain one text_result per opened page, even
// when action.url only names the first URL in a batch. Search results stay raw.
const openedPageResult = z.object({
  type: z.literal('text_result'),
  ref_id: z.string().min(1),
  url: z.string(),
  title: z.string(),
});

function generatedInline(result: string): Extract<RuntimeImageSource, { type: 'inline' }> | null {
  const uri = /^data:(image\/[^;,]+);base64,([\s\S]*)$/.exec(result);
  if (uri) return { type: 'inline', mimeType: uri[1], data: uri[2] };
  // Codex's result can also be opaque text. Only recognize a raw base64 raster
  // when its decoded signature identifies an image; never guess a file/URL.
  const mimeType = imageMimeType(Buffer.from(result.slice(0, 24), 'base64'));
  return mimeType ? { type: 'inline', mimeType, data: result } : null;
}

export function nativeImages(item: CodexItem): RuntimeImageSource[] {
  switch (item.type) {
    case 'imageView':
      return [{ type: 'file', path: item.path, generated: false }];
    case 'imageGeneration': {
      if (item.failure || item.status === 'failed') return [];
      const inline = generatedInline(item.result);
      return inline
        ? [inline]
        : item.savedPath
          ? [{ type: 'file', path: item.savedPath, generated: true }]
          : [];
    }
    case 'mcpToolCall':
      if (item.status === 'failed' || !item.result) return [];
      return item.result.content.flatMap((part) => {
        if (
          part === null ||
          typeof part !== 'object' ||
          Array.isArray(part) ||
          part.type !== 'image'
        )
          return [];
        const image = mcpImage.parse(part);
        return [{ type: 'inline' as const, data: image.data, mimeType: image.mimeType }];
      });
    default:
      return [];
  }
}

// Standard MCP image blocks may also be repeated in structuredContent. Keep their
// bytes in source frames, not public tool text, browser storage or canvas exports.
function publicMcpResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicMcpResult);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        'type' in value && value.type === 'image' && key === 'data'
          ? '[图像数据见来源预览]'
          : publicMcpResult(child),
      ]),
    );
  return value;
}

// Descriptions also feed canvas_inspect. They describe observed native items,
// never authorize execution or create product-level child Agents.
export function nativeTool(
  item: CodexItem,
): Pick<Extract<EventData, { type: 'tool.started' }>, 'title' | 'tool' | 'args'> | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        title: item.command,
        tool: 'codex.commandExecution',
        args: { command: item.command, cwd: item.cwd },
      };
    case 'mcpToolCall':
      return {
        title: `${item.server} / ${item.tool}`,
        tool: 'codex.mcpToolCall',
        args: { server: item.server, tool: item.tool, arguments: item.arguments },
      };
    case 'webSearch':
      return {
        title:
          item.action?.type === 'openPage'
            ? '打开网页'
            : item.action?.type === 'findInPage'
              ? '页内查找'
              : '网页搜索',
        tool: 'codex.webSearch',
        args: { query: item.query, ...(item.action ? { action: item.action } : {}) },
      };
    case 'fileChange':
      return { title: '文件变更', tool: 'codex.fileChange', args: { changes: item.changes } };
    case 'imageView':
      return { title: '查看图像', tool: 'codex.imageView', args: { path: item.path } };
    case 'sleep':
      return { title: '等待', tool: 'codex.sleep', args: { durationMs: item.durationMs } };
    case 'imageGeneration':
      return { title: '生成图像', tool: 'codex.imageGeneration', args: {} };
    default:
      return null;
  }
}

export function nativeItemCompletion(
  item: CodexItem,
  threadId: string,
  roundId: string,
): EventData[] {
  const call = { roundId, callId: item.id };
  const receipt = `codex:${threadId}/${roundId}/${item.id}:item-completed`;
  const images = nativeImages(item);
  const imagePreviews: ToolPreview[] = images.map((_, sourceIndex) => ({
    kind: 'image',
    sourceIndex,
    title:
      item.type === 'imageGeneration'
        ? '生成的图像'
        : item.type === 'imageView'
          ? '查看的图像'
          : `工具返回的图像 ${sourceIndex + 1}`,
  }));
  const returned = (result: string, artifact: string, previews = imagePreviews): EventData[] => [
    {
      type: 'tool.finished',
      ...call,
      result,
      artifact,
      receipt,
      ...(previews.length ? { previews } : {}),
    },
  ];
  const failed = (error: string): EventData[] => [{ type: 'tool.failed', ...call, error, receipt }];
  const assessment = (source: string, text: string): EventData[] => [
    { type: 'assessment.recorded', roundId, source, text },
  ];
  switch (item.type) {
    case 'mcpToolCall':
      return item.status === 'failed'
        ? failed(item.error?.message ?? 'Codex 报告 MCP 工具失败，未提供错误详情。')
        : returned(
            item.result == null
              ? 'Codex 未提供结果内容。'
              : JSON.stringify(publicMcpResult(item.result), null, 2),
            '工具已返回',
          );
    case 'webSearch': {
      // This item has no success/status field. Completion is only a lifecycle observation.
      const url =
        item.action?.type === 'openPage' || item.action?.type === 'findInPage'
          ? item.action.url
          : null;
      const opening = item.action?.type === 'openPage' || item.action?.type === 'findInPage';
      const pages = opening
        ? (item.results ?? []).flatMap((result) => {
            const page = openedPageResult.safeParse(result);
            return page.success ? [{ url: page.data.url, title: page.data.title }] : [];
          })
        : [];
      const previews: ToolPreview[] = [];
      const seen = new Set<string>();
      for (const page of [...(url ? [{ url, title: url }] : []), ...pages]) {
        const preview = toolPreviewSchema.safeParse({ kind: 'webpage', ...page });
        if (preview.success && !seen.has(page.url)) {
          seen.add(page.url);
          previews.push(preview.data);
        }
      }
      return returned(
        item.results == null
          ? 'Codex 未提供结构化搜索结果。'
          : JSON.stringify(item.results, null, 2),
        '检索已结束 · 未报告成功状态',
        previews,
      );
    }
    case 'fileChange':
      if (item.status === 'declined')
        return [{ type: 'tool.rejected', ...call, error: 'Codex 拒绝文件变更；没有执行回执。' }];
      return item.status === 'failed'
        ? failed('Codex 报告文件变更失败。')
        : returned(JSON.stringify(item.changes, null, 2), '变更步骤已返回');
    case 'imageView':
      return returned(item.path, '查看步骤已结束');
    case 'sleep':
      return returned(JSON.stringify({ durationMs: item.durationMs }), '等待步骤已结束');
    case 'imageGeneration':
      return item.failure || item.status === 'failed'
        ? failed(
            item.failure
              ? JSON.stringify(item.failure)
              : 'Codex 报告图像生成失败，未提供错误详情。',
          )
        : returned(
            JSON.stringify({
              status: item.status,
              result: images.some((image) => image.type === 'inline')
                ? '[图像数据见来源预览]'
                : item.result,
              savedPath: item.savedPath,
            }),
            `图像步骤已结束 · ${item.status}`,
          );
    case 'hookPrompt':
      return assessment('运行时 Hook 提示', JSON.stringify(item.fragments));
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return assessment(
        item.type === 'enteredReviewMode' ? '进入审阅模式' : '退出审阅模式',
        item.review,
      );
    case 'collabAgentToolCall':
    case 'subAgentActivity':
      return assessment('运行时协作记录（未接入画布委派）', JSON.stringify(item));
    default:
      throw new Error('Codex item is not a native completion projection');
  }
}
