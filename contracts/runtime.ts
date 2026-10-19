import { z } from 'zod';
import { configSchema, eventSchema } from '../web/model/schema.ts';
import { mcpRefsSchema } from './mcp.ts';

const id = z.string().regex(/^[a-zA-Z0-9/_-]{1,256}$/);
const commandId = z.string().regex(/^[a-zA-Z0-9/_-]{1,160}$/);
const harnessId = z.string().regex(/^[a-z0-9-]{1,48}$/);
export const backendDescriptorSchema = z.object({
  id: harnessId,
  label: z.string().min(1),
  mode: z.enum(['fixture', 'live']),
  capabilities: z.object({
    chat: z.boolean(),
    interrupt: z.boolean(),
    login: z.boolean(),
    fork: z.boolean().optional(),
    mcp: z.boolean().optional(),
  }),
});
export type BackendDescriptor = z.infer<typeof backendDescriptorSchema>;
export const harnessSettingSchema = z.object({
  key: z.enum(['reasoningEffort', 'personality']),
  label: z.string().min(1),
  description: z.string(),
  defaultValue: z.string(),
  options: z
    .array(z.object({ value: z.string(), label: z.string(), description: z.string() }))
    .min(1),
});
export const authMethodSchema = z.enum(['browser', 'device-code', 'api-key']);
export const harnessLoginSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('api-key'), apiKey: z.string().trim().min(1).max(8192) }).strict(),
  z.object({ method: z.literal('browser') }).strict(),
  z.object({ method: z.literal('device-code') }).strict(),
]);
export type HarnessLogin = z.infer<typeof harnessLoginSchema>;
export const loginRequestSchema = z
  .object({
    version: z.literal(1),
    authentication: harnessLoginSchema.optional(),
  })
  .strict()
  .transform(({ authentication }) => authentication ?? { method: 'device-code' as const });
export const backendStatusSchema = z.object({
  backend: backendDescriptorSchema,
  account: z.enum(['not-required', 'signed-out', 'signed-in']),
  models: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
      settings: z.array(harnessSettingSchema).optional(),
    }),
  ),
  authentication: z
    .object({
      methods: z.array(authMethodSchema),
      activeMethod: authMethodSchema.nullable(),
    })
    .optional(),
  notices: z.array(z.string()),
});
export type BackendStatus = z.infer<typeof backendStatusSchema>;
export const loginResultSchema = z.union([
  z.object({ type: z.literal('api-key') }),
  z.object({
    flowId: z.string().min(1),
    userCode: z.string().min(1).optional(),
    url: z.url().refine((url) => new URL(url).protocol === 'https:', 'Login requires HTTPS'),
  }),
]);
export type LoginResult = z.infer<typeof loginResultSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      version: z.literal(1),
      commandId,
      type: z.literal('agent.mcp.configure'),
      agentId: id,
      connections: mcpRefsSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      commandId,
      type: z.literal('agent.fork'),
      sourceAgentId: id,
      roundId: id,
      side: z.enum(['before', 'after', 'at']),
      eventId: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      commandId,
      type: z.literal('agent.create'),
      harnessId: harnessId.optional(),
      projectRoot: z.string().min(1).max(4096).optional(),
      connections: mcpRefsSchema.optional(),
      config: configSchema.strict(),
      task: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      commandId,
      type: z.literal('turn.start'),
      agentId: id,
      text: z
        .string()
        .min(1)
        .max(4000)
        .refine((text) => Boolean(text.trim()), 'Message must contain non-whitespace text'),
      scenario: z.enum(['success', 'tool-failure', 'disconnect', 'dispatch-unknown']).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      commandId,
      type: z.literal('turn.interrupt'),
      agentId: id,
      turnId: id,
    })
    .strict(),
]);
export type RuntimeCommand = z.infer<typeof commandSchema>;
export const commandRecordSchema = z.object({
  commandId,
  type: z.enum([
    'agent.create',
    'agent.fork',
    'agent.mcp.configure',
    'turn.start',
    'turn.interrupt',
  ]),
  agentId: id,
  status: z.enum(['dispatching', 'acknowledged', 'rejected', 'unknown']),
  result: z.record(z.string(), z.string()).nullable(),
  error: z.string().nullable(),
});
export type CommandRecord = z.infer<typeof commandRecordSchema>;
export const runtimeStateSchema = z.object({
  version: z.literal(2),
  backend: backendDescriptorSchema,
  storeId: z.string(),
  revision: z.number().int().nonnegative(),
  cursor: z.number().int().nonnegative(),
  events: z.array(eventSchema),
  commands: z.array(commandRecordSchema),
  agents: z.array(
    z.object({
      id,
      sessionRef: z.string(),
      state: z.enum(['idle', 'running', 'unknown']),
      turnId: z.string().nullable(),
    }),
  ),
});
export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export const feedSchema = runtimeStateSchema;
export type RuntimeFeed = z.infer<typeof feedSchema>;

// Object key order is immaterial for request identity; array order remains significant.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
