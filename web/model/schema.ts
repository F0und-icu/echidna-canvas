import { z } from 'zod';
import { canvasNoteSchema } from '../../contracts/canvas.ts';
import { mcpRefsSchema } from '../../contracts/mcp.ts';

export const avatarSchema = z.enum([
  'echidna',
  'deepseek',
  'deepseek-chibi',
  'claude',
  'claude-chibi',
  'none',
]);
export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const sourceSchema = z.object({
  sessionId: z.string(),
  routeId: z.string(),
  roundId: z.string().nullable(),
  eventSeq: z.number().int().nonnegative(),
});
export const configSchema = z.object({
  name: z.string().min(1),
  avatar: avatarSchema,
  model: z.string().min(1),
  personality: z.string(),
  harnessSettings: z
    .object({
      reasoningEffort: z.string().min(1).max(64).optional(),
      personality: z.literal('none').optional(),
    })
    .strict()
    .optional(),
});
export const branchOriginSchema = z.object({
  agentId: z.string(),
  roundId: z.string(),
  side: z.enum(['before', 'after', 'at']),
  eventId: z.string(),
  throughTurnId: z.string().nullable(),
});
export type BranchOrigin = z.infer<typeof branchOriginSchema>;
const snapshotSchema = z.object({
  task: z.string(),
  model: z.string(),
  personality: z.string(),
  materials: z.array(z.string()),
  contractVersion: z.enum(['offline-v1', 'codex-p2-v1', 'runtime-v1']),
  canvasContract: z.enum(['canvas-v1', 'canvas-v2']).optional(),
});
const round = { roundId: z.string() };
const call = { ...round, callId: z.string() };
const args = z.record(z.string(), z.json());
export const toolPreviewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('image'),
      title: z.string(),
      // path reads existing records; new images reference their server-side source frame.
      path: z.string().min(1).optional(),
      sourceIndex: z.number().int().nonnegative().optional(),
    })
    .refine((image) => (image.path !== undefined) !== (image.sourceIndex !== undefined)),
  z.object({
    kind: z.literal('webpage'),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    }),
    title: z.string(),
  }),
]);
export type ToolPreview = z.infer<typeof toolPreviewSchema>;
const optionsSchema = z
  .array(z.object({ id: z.string(), label: z.string(), selected: z.boolean() }))
  .min(1)
  .refine(
    (items) => items.filter((item) => item.selected).length === 1,
    'A recorded decision must select one option',
  );

export const eventDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.created'),
    config: configSchema,
    connections: mcpRefsSchema.optional(),
    parentId: z.string().nullable(),
    projectRoot: z.string().optional(),
    branch: branchOriginSchema.optional(),
  }),
  z.object({ type: z.literal('session.configured'), config: configSchema }),
  z.object({
    type: z.literal('session.mcp.configured'),
    connections: mcpRefsSchema,
    model: z.string().min(1),
  }),
  z.object({
    type: z.literal('route.started'),
    task: z.string(),
    materials: z.array(z.string()),
    origin: sourceSchema.nullable(),
  }),
  z.object({
    type: z.literal('round.started'),
    ...round,
    title: z.string(),
    refs: z.array(z.string()),
    input: snapshotSchema,
    unit: z.literal('turn').optional(),
  }),
  z.object({ type: z.literal('summary.delta'), ...round, text: z.string() }),
  z.object({ type: z.literal('response.delta'), ...round, text: z.string() }),
  z.object({ type: z.literal('summary.updated'), ...round, text: z.string() }),
  z.object({ type: z.literal('response.updated'), ...round, text: z.string() }),
  z.object({
    type: z.literal('canvas.noted'),
    ...round,
    noteId: z.string(),
    note: canvasNoteSchema,
  }),
  z.object({ type: z.literal('tool.output.updated'), ...call, text: z.string() }),
  z.object({ type: z.literal('tool.rejected'), ...call, error: z.string() }),
  z.object({ type: z.literal('tool.unknown'), ...call, error: z.string() }),
  z.object({ type: z.literal('round.interrupt.requested'), ...round }),
  z.object({
    type: z.literal('round.terminated'),
    ...round,
    status: z.enum(['completed', 'failed', 'interrupted']),
    error: z.string().nullable(),
  }),
  z.object({
    type: z.literal('decision.recorded'),
    ...round,
    options: optionsSchema,
    reason: z.string(),
    refs: z.array(z.string()),
  }),
  z.object({
    type: z.literal('assessment.recorded'),
    ...round,
    text: z.string(),
    source: z.string(),
  }),
  z.object({ type: z.literal('tool.prepared'), ...call, title: z.string(), tool: z.string() }),
  z.object({ type: z.literal('tool.arguments.delta'), ...call, text: z.string() }),
  z.object({ type: z.literal('tool.started'), ...call, title: z.string(), tool: z.string(), args }),
  z.object({
    type: z.literal('tool.finished'),
    ...call,
    result: z.string(),
    artifact: z.string(),
    receipt: z.string(),
    preview: toolPreviewSchema.optional(),
    previews: z.array(toolPreviewSchema).optional(),
  }),
  z.object({ type: z.literal('tool.failed'), ...call, error: z.string(), receipt: z.string() }),
  z.object({ type: z.literal('tool.cancel.requested'), ...call }),
  z.object({ type: z.literal('model.completed'), ...round }),
  z.object({ type: z.literal('round.finished'), ...round }),
  z.object({
    type: z.literal('delegation.created'),
    ...round,
    delegationId: z.string(),
    childId: z.string(),
    task: z.string(),
    materials: z.array(z.string()),
    criterion: z.string(),
  }),
  z.object({ type: z.literal('delegation.accepted'), delegationId: z.string() }),
  z.object({
    type: z.literal('delegation.returned'),
    delegationId: z.string(),
    result: z.string(),
    artifact: z.string(),
  }),
  z.object({
    type: z.literal('delegation.adopted'),
    delegationId: z.string(),
    scope: z.string(),
    actor: z.string(),
  }),
  z.object({
    type: z.literal('usage.reported'),
    ...round,
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    scope: z.literal('thread-total').optional(),
  }),
  z.object({ type: z.literal('operator.paused') }),
  z.object({ type: z.literal('operator.resumed') }),
  z.object({ type: z.literal('connection.lost'), reason: z.string().optional() }),
  z.object({ type: z.literal('connection.restored') }),
  z.object({
    type: z.literal('collaboration.requested'),
    targetId: z.string(),
    question: z.string(),
    materials: z.array(z.string()),
    linkId: z.string(),
  }),
]);

export const eventSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  sessionId: z.string(),
  routeId: z.string(),
  source: z.enum(['fixture', 'user', 'runtime']),
  runtime: z
    .object({
      storeId: z.string(),
      cursor: z.number().int().positive(),
      streamId: z.string(),
      sourceSeq: z.number().int().positive(),
      method: z.string(),
      threadId: z.string().optional(),
      sessionRef: z.string().optional(),
      backendId: z.string().optional(),
      executionRef: z.string().optional(),
      turnId: z.string().optional(),
      itemId: z.string().optional(),
    })
    .optional(),
  data: eventDataSchema,
});
export const stepSchema = eventSchema.omit({ id: true, seq: true, source: true });
const replaySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  routeId: z.string(),
  steps: z.array(stepSchema),
  cursor: z.number().int().nonnegative(),
});
export const draftSchema = z.object({
  id: z.string(),
  kind: z.enum(['action', 'decision', 'material', 'frame', 'note', 'ink', 'relation']),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
  title: z.string(),
  points: z.array(pointSchema),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
const proposalSchema = z.object({ text: z.string(), source: sourceSchema });
export const canvasSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  scenario: z.enum(['feedback', 'steering', 'handoff']).nullable(),
  rootSessions: z.array(z.string()),
  projectRoots: z.array(z.string()).optional(),
  connectionIds: z.array(z.string()).optional(),
  positions: z.record(z.string(), pointSchema),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().min(0.3).max(1.6),
  }),
  paper: z.enum(['plain', 'dots', 'grid']),
  drafts: z.array(draftSchema),
  undo: z.array(z.array(draftSchema)),
  redo: z.array(z.array(draftSchema)),
  selectedSession: z.string().nullable(),
  selectedDrafts: z.array(z.string()),
  historySeq: z.number().int().nonnegative().nullable(),
  follow: z.boolean(),
  showPast: z.boolean(),
  proposal: proposalSchema.nullable(),
});
export const workspaceSchema = z.object({
  version: z.literal(1),
  events: z.array(eventSchema),
  replays: z.record(z.string(), replaySchema),
  canvases: z.array(canvasSchema).min(1),
  activeCanvas: z.string(),
  chatDrafts: z.record(z.string(), z.string().max(4000)).optional(),
  appearance: z.object({
    theme: z.enum(['paper', 'sage', 'night', 'custom']),
    colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).length(9),
    motion: z.boolean(),
    flowCharacters: z.boolean(),
  }),
});

export type Point = z.infer<typeof pointSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type AgentConfig = z.infer<typeof configSchema>;
export type Avatar = z.infer<typeof avatarSchema>;
export type EventData = z.infer<typeof eventDataSchema>;
export type RecordedEvent = z.infer<typeof eventSchema>;
export type FixtureStep = z.infer<typeof stepSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type CanvasDocument = z.infer<typeof canvasSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Brush =
  'select' | 'hand' | 'agent' | Exclude<Draft['kind'], 'relation'> | 'connect' | 'eraser';
