import { z } from 'zod';
import type { EventData, RecordedEvent } from '../web/model/schema.ts';
import { project } from '../web/model/projection.ts';
import type { RuntimeCodec } from './runtime-port.ts';
import { JsonlDecoder } from './jsonl.ts';
import { canvasCallSchema } from '../contracts/canvas.ts';
import { canonical } from '../contracts/runtime.ts';
import {
  itemSchema,
  fileChangesSchema,
  nativeTool,
  nativeItemCompletion,
  nativeImages,
  type CodexItem,
} from './codex-items.ts';

const scope = { threadId: z.string().min(1), turnId: z.string().min(1) };
const delta = { ...scope, itemId: z.string().min(1), delta: z.string() };
export const notificationSchema = z.discriminatedUnion('method', [
  // This provider metadata is not canvas content; retain only its ownership.
  z.object({ method: z.literal('turn/moderationMetadata'), params: z.object(scope) }),
  // Aggregate diff is redundant with the owned fileChange items; keep only scope.
  z.object({ method: z.literal('turn/diff/updated'), params: z.object(scope) }),
  z.object({
    method: z.literal('item/tool/call'),
    params: z
      .object({
        ...scope,
        callId: z.string(),
      })
      .and(canvasCallSchema),
  }),
  z.object({
    method: z.literal('turn/started'),
    params: z.object({
      threadId: scope.threadId,
      turn: z.object({ id: z.string(), status: z.literal('inProgress') }),
    }),
  }),
  z.object({
    method: z.literal('turn/completed'),
    params: z.object({
      threadId: scope.threadId,
      turn: z.object({
        id: z.string(),
        status: z.enum(['completed', 'failed', 'interrupted']),
        error: z.object({ message: z.string() }).nullable(),
      }),
    }),
  }),
  z.object({
    method: z.enum(['item/started', 'item/completed']),
    params: z.object({ ...scope, item: itemSchema }),
  }),
  z.object({ method: z.literal('item/agentMessage/delta'), params: z.object(delta) }),
  z.object({
    method: z.literal('item/reasoning/summaryTextDelta'),
    params: z.object({ ...delta, summaryIndex: z.number().int().min(0).max(63) }),
  }),
  z.object({ method: z.literal('item/commandExecution/outputDelta'), params: z.object(delta) }),
  z.object({
    method: z.literal('item/mcpToolCall/progress'),
    params: z.object({ ...scope, itemId: z.string(), message: z.string() }),
  }),
  z.object({
    method: z.literal('item/fileChange/patchUpdated'),
    params: z.object({ ...scope, itemId: z.string(), changes: fileChangesSchema }),
  }),
  // Interactive stdin is not canvas content. Only retain the process reference.
  z.object({
    method: z.literal('item/commandExecution/terminalInteraction'),
    params: z.object({ ...scope, itemId: z.string(), processId: z.string() }),
  }),
  z.object({
    method: z.literal('item/reasoning/summaryPartAdded'),
    params: z.object({
      ...scope,
      itemId: z.string(),
      summaryIndex: z.number().int().min(0).max(63),
    }),
  }),
  z.object({
    method: z.literal('item/reasoning/textDelta'),
    params: z.object({ ...scope, itemId: z.string(), contentIndex: z.number().int() }),
  }),
  z.object({ method: z.literal('item/plan/delta'), params: z.object(delta) }),
  z.object({
    method: z.literal('thread/tokenUsage/updated'),
    params: z.object({
      ...scope,
      tokenUsage: z.object({
        total: z.object({
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
        }),
      }),
    }),
  }),
  z.object({
    method: z.literal('error'),
    params: z.object({
      ...scope,
      error: z.object({ message: z.string() }),
      willRetry: z.boolean(),
    }),
  }),
  z.object({
    method: z.literal('turn/plan/updated'),
    params: z.object({
      ...scope,
      plan: z.array(
        z.object({ step: z.string(), status: z.enum(['pending', 'inProgress', 'completed']) }),
      ),
    }),
  }),
]);
export type CodexNotification = z.infer<typeof notificationSchema>;
export interface Frame {
  version: 1;
  streamId: string;
  sourceSeq: number;
  packet: CodexNotification;
}

export const codexCodec: RuntimeCodec = {
  validate(raw) {
    const payload = notificationSchema.parse(raw),
      p = payload.params;
    return {
      payload,
      sessionRef: p.threadId,
      turnId: 'turn' in p ? p.turn.id : p.turnId,
      ...('item' in p
        ? { itemId: p.item.id }
        : 'itemId' in p
          ? { itemId: p.itemId }
          : 'callId' in p
            ? { itemId: p.callId }
            : {}),
      method: payload.method,
      ...(payload.method === 'item/completed' ? { images: nativeImages(payload.params.item) } : {}),
    };
  },
  project(packets, context) {
    return projectCodexFrame(
      packets.map((p) => notificationSchema.parse(p)),
      context.events,
      context.agentId,
      context.input,
    ).map((event) =>
      event.type === 'round.started' && context.mode === 'live'
        ? {
            ...event,
            input: {
              ...event.input,
              contractVersion: 'runtime-v1' as const,
              canvasContract: 'canvas-v2' as const,
            },
          }
        : event,
    );
  },
};

// This decoder owns byte boundaries; stream order is assigned once by the transport.
export class CodexJsonlDecoder {
  private decoder = new JsonlDecoder();
  push(bytes: Uint8Array): CodexNotification[] {
    return this.decoder.push(bytes).map((packet) => notificationSchema.parse(packet));
  }
  finish() {
    this.decoder.finish();
  }
}

interface ItemText {
  type: CodexItem['type'];
  item: CodexItem;
  text: string;
  summary: string[];
  completed: boolean;
}
export function projectCodexFrame(
  packets: CodexNotification[],
  events: RecordedEvent[],
  agentId: string,
  task: string,
): EventData[] {
  const packet = packets.at(-1)!;
  const p = packet.params;
  const turnId = 'turn' in p ? p.turn.id : p.turnId;
  const session = project(events).sessions[agentId];
  if (!session) throw new Error('Codex packet references a missing Agent');
  const round = session.routes[0].rounds.find((round) => round.id === turnId);
  if (packet.method === 'turn/started') {
    if (round) throw new Error('Duplicate Codex turn start');
    return [
      {
        type: 'round.started',
        roundId: turnId,
        unit: 'turn',
        title: task.replace(/\s+/g, ' ').slice(0, 40),
        refs: [],
        input: {
          task,
          personality: session.config.personality,
          model: session.config.model,
          materials: [],
          contractVersion: 'codex-p2-v1',
        },
      },
    ];
  }
  if (!round) throw new Error('Codex packet outside its active turn');
  if (packet.method === 'turn/moderationMetadata' || packet.method === 'turn/diff/updated')
    return [];
  if (packet.method === 'item/tool/call') {
    const start = packets
      .slice(0, -1)
      .find(
        (entry) => entry.method === 'item/started' && entry.params.item.id === packet.params.callId,
      );
    if (
      !start ||
      !('item' in start.params) ||
      start.params.item.type !== 'dynamicToolCall' ||
      start.params.item.tool !== packet.params.tool ||
      canonical(start.params.item.arguments) !== canonical(packet.params.arguments)
    )
      throw new Error('Canvas tool request does not match its started item');
    if (packet.params.tool === 'echidna_canvas_inspect') return [];
    return [
      {
        type: 'canvas.noted',
        roundId: turnId,
        noteId: packet.params.callId,
        note: packet.params.arguments,
      },
    ];
  }
  if ('item' in p && p.item.type === 'dynamicToolCall') return [];
  if (packet.method === 'thread/tokenUsage/updated')
    return [
      {
        type: 'usage.reported',
        roundId: turnId,
        input: packet.params.tokenUsage.total.inputTokens,
        output: packet.params.tokenUsage.total.outputTokens,
        scope: 'thread-total',
      },
    ];
  if (packet.method === 'item/commandExecution/terminalInteraction') {
    if (
      !round.calls.some(
        (call) => call.id === packet.params.itemId && call.tool === 'codex.commandExecution',
      )
    )
      throw new Error('Codex terminal interaction references an unknown command');
    return [
      {
        type: 'assessment.recorded',
        roundId: turnId,
        source: '终端交互',
        text: `运行时报告进程 ${packet.params.processId} 的终端交互；输入内容不进入画布。`,
      },
    ];
  }
  const terminalCommandUpdate =
    packet.method === 'item/commandExecution/outputDelta' ||
    (packet.method === 'item/completed' && packet.params.item.type === 'commandExecution');
  if (round.complete && !terminalCommandUpdate)
    throw new Error('Codex packet outside its active turn');
  if (packet.method === 'error')
    return [
      {
        type: 'assessment.recorded',
        roundId: turnId,
        source: '运行时错误',
        text: `${packet.params.error.message}${packet.params.willRetry ? '（运行时报告将继续尝试）' : ''}`,
      },
    ];
  if (packet.method === 'turn/plan/updated')
    return [
      {
        type: 'assessment.recorded',
        roundId: turnId,
        source: '模型计划',
        text: packet.params.plan.map((step) => `${step.status}: ${step.step}`).join('\n'),
      },
    ];
  if (
    packet.method === 'item/reasoning/textDelta' ||
    packet.method === 'item/reasoning/summaryPartAdded' ||
    packet.method === 'item/plan/delta'
  )
    return [];
  if ('item' in p && ['userMessage', 'plan', 'contextCompaction'].includes(p.item.type)) {
    if (
      p.item.type === 'userMessage' &&
      p.item.content.map((part) => part.text).join('\n') !== task
    )
      throw new Error('Codex user message differs from the admitted input');
    if (packet.method === 'item/completed' && p.item.type === 'plan')
      return [
        { type: 'assessment.recorded', roundId: turnId, source: '模型计划', text: p.item.text },
      ];
    return [];
  }
  if (packet.method === 'turn/completed')
    return [
      {
        type: 'round.terminated',
        roundId: turnId,
        status: packet.params.turn.status,
        error: packet.params.turn.error?.message ?? null,
      },
    ];

  // Reconstruct item text from its exact recorded prefix. Final items replace deltas.
  const items = new Map<string, ItemText>();
  for (const entry of packets) {
    if (entry.method === 'item/reasoning/summaryPartAdded') {
      const prior = items.get(entry.params.itemId);
      if (!prior || prior.type !== 'reasoning' || entry.params.summaryIndex > prior.summary.length)
        throw new Error('Invalid Codex summary part');
      if (entry.params.summaryIndex === prior.summary.length) prior.summary.push('');
      continue;
    }
    if (
      entry.method === 'thread/tokenUsage/updated' ||
      entry.method === 'turn/moderationMetadata' ||
      entry.method === 'turn/diff/updated' ||
      entry.method === 'error' ||
      entry.method === 'turn/plan/updated' ||
      entry.method === 'item/reasoning/textDelta' ||
      entry.method === 'item/plan/delta' ||
      entry.method === 'item/tool/call'
    )
      continue;
    const ep = entry.params;
    if ('turn' in ep) continue;
    if (ep.turnId !== turnId) throw new Error('Codex stream mixed turn identities');
    if ('item' in ep) {
      const item = ep.item,
        prior = items.get(item.id);
      if (
        item.type === 'userMessage' ||
        item.type === 'plan' ||
        item.type === 'contextCompaction' ||
        item.type === 'dynamicToolCall'
      )
        continue;
      if (entry.method === 'item/started') {
        if (prior) throw new Error('Duplicate Codex item start');
        if (
          (item.type === 'commandExecution' ||
            item.type === 'mcpToolCall' ||
            item.type === 'fileChange' ||
            item.type === 'collabAgentToolCall') &&
          item.status !== 'inProgress'
        )
          throw new Error('Codex item started with terminal status');
        items.set(item.id, {
          type: item.type,
          item,
          text:
            item.type === 'agentMessage'
              ? item.text
              : item.type === 'commandExecution'
                ? (item.aggregatedOutput ?? '')
                : '',
          summary: item.type === 'reasoning' ? [...item.summary] : [],
          completed: false,
        });
      } else {
        if (!prior || prior.completed || prior.type !== item.type)
          throw new Error('Codex completion has no matching open item');
        if (
          (item.type === 'mcpToolCall' ||
            item.type === 'fileChange' ||
            item.type === 'collabAgentToolCall') &&
          item.status === 'inProgress'
        )
          throw new Error('Codex item completed with non-terminal status');
        if (
          item.type === 'commandExecution' &&
          prior.item.type === 'commandExecution' &&
          (item.status === 'inProgress' ||
            prior.item.command !== item.command ||
            prior.item.cwd !== item.cwd)
        )
          throw new Error('Codex command completion contract mismatch');
        if (
          item.type === 'mcpToolCall' &&
          prior.item.type === 'mcpToolCall' &&
          (prior.item.server !== item.server ||
            prior.item.tool !== item.tool ||
            canonical(prior.item.arguments) !== canonical(item.arguments))
        )
          throw new Error('Codex MCP completion contract mismatch');
        prior.completed = true;
        prior.item = item;
        if (item.type === 'agentMessage') prior.text = item.text;
        if (item.type === 'reasoning') prior.summary = [...item.summary];
        if (item.type === 'commandExecution') prior.text = item.aggregatedOutput ?? prior.text;
      }
    } else {
      const prior = items.get(ep.itemId);
      if (!prior || prior.completed) throw new Error('Codex delta has no matching open item');
      if (entry.method === 'item/mcpToolCall/progress') {
        if (prior.type !== 'mcpToolCall') throw new Error('Codex progress item type mismatch');
        prior.text += (prior.text ? '\n' : '') + entry.params.message;
      } else if (entry.method === 'item/fileChange/patchUpdated') {
        if (prior.item.type !== 'fileChange') throw new Error('Codex patch item type mismatch');
        prior.item = { ...prior.item, changes: entry.params.changes };
        prior.text = JSON.stringify(entry.params.changes, null, 2);
      } else if (entry.method === 'item/commandExecution/terminalInteraction') {
        if (prior.type !== 'commandExecution') throw new Error('Codex terminal item type mismatch');
      } else if (entry.method === 'item/reasoning/summaryTextDelta') {
        if (prior.type !== 'reasoning' || entry.params.summaryIndex > prior.summary.length)
          throw new Error('Invalid Codex summary index');
        const i = entry.params.summaryIndex;
        prior.summary[i] = (prior.summary[i] ?? '') + entry.params.delta;
      } else if (
        entry.method === 'item/agentMessage/delta' ||
        entry.method === 'item/commandExecution/outputDelta'
      ) {
        const expected =
          entry.method === 'item/agentMessage/delta' ? 'agentMessage' : 'commandExecution';
        if (prior.type !== expected) throw new Error('Codex delta item type mismatch');
        prior.text += entry.params.delta;
      } else throw new Error('Codex item progress has no projection');
    }
  }
  const data: EventData[] = [];
  const item = 'item' in p ? p.item : undefined;
  const itemId = item?.id ?? ('itemId' in p ? p.itemId : '');
  const current = items.get(itemId)!;
  if (current.type === 'reasoning')
    return [
      {
        type: 'summary.updated',
        roundId: turnId,
        text: [...items.values()]
          .filter((i) => i.type === 'reasoning')
          .map((i) => i.summary.join('\n'))
          .join('\n\n'),
      },
    ];
  if (current.type === 'agentMessage')
    return [
      {
        type: 'response.updated',
        roundId: turnId,
        text: [...items.values()]
          .filter((i) => i.type === 'agentMessage')
          .map((i) => i.text)
          .join('\n\n'),
      },
    ];
  if (current.type !== 'commandExecution') {
    const description = nativeTool(current.item);
    if (!description)
      return packet.method === 'item/completed'
        ? nativeItemCompletion(current.item, p.threadId, turnId)
        : [];
    const callScope = { roundId: turnId, callId: itemId };
    if (packet.method === 'item/started')
      return current.type === 'fileChange'
        ? [
            {
              type: 'tool.prepared',
              ...callScope,
              title: description.title,
              tool: description.tool,
            },
            { type: 'tool.arguments.delta', ...callScope, text: JSON.stringify(description.args) },
          ]
        : [{ type: 'tool.started', ...callScope, ...description }];
    if (packet.method === 'item/completed') {
      const completion = nativeItemCompletion(current.item, p.threadId, turnId);
      if (current.item.type === 'fileChange' && current.item.status !== 'declined')
        completion.unshift({ type: 'tool.started', ...callScope, ...description });
      return completion;
    }
    return [{ type: 'tool.output.updated', ...callScope, text: current.text }];
  }
  const call = round.calls.find((c) => c.id === itemId);
  const commandItem = packets
    .flatMap((entry) =>
      'item' in entry.params &&
      entry.params.item.id === itemId &&
      entry.params.item.type === 'commandExecution'
        ? [entry.params.item]
        : [],
    )
    .at(-1)!;
  const commandDescription = nativeTool(commandItem)!;
  const callScope = { roundId: turnId, callId: itemId };
  if (packet.method === 'item/started')
    return [
      {
        type: 'tool.prepared',
        ...callScope,
        title: commandDescription.title,
        tool: commandDescription.tool,
      },
      {
        type: 'tool.arguments.delta',
        ...callScope,
        text: JSON.stringify(commandDescription.args),
      },
    ];
  if (!call) throw new Error('Codex output references missing command');
  if (item?.type === 'commandExecution' && item.status === 'declined')
    return [{ type: 'tool.rejected', ...callScope, error: 'Codex 拒绝执行；没有执行回执。' }];
  if (
    item?.type === 'commandExecution' &&
    item.exitCode == null &&
    packet.method === 'item/completed'
  )
    return [{ type: 'tool.unknown', ...callScope, error: 'Codex 未提供退出码，执行结果待核对。' }];
  if (call.status === 'preparing')
    data.push({
      type: 'tool.started',
      ...callScope,
      ...commandDescription,
    });
  data.push({ type: 'tool.output.updated', ...callScope, text: current.text });
  if (item?.type === 'commandExecution' && packet.method === 'item/completed') {
    const receipt = `codex:${p.threadId}/${turnId}/${item.id}:item-completed`;
    data.push(
      item.status === 'completed' && item.exitCode === 0
        ? { type: 'tool.finished', ...callScope, result: current.text, artifact: '退出 0', receipt }
        : {
            type: 'tool.failed',
            ...callScope,
            error: `退出 ${item.exitCode}\n${current.text}`,
            receipt,
          },
    );
  }
  return data;
}
