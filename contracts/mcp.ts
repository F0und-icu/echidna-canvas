import { z } from 'zod';

export const mcpRefSchema = z
  .object({ id: z.uuid(), revision: z.number().int().positive() })
  .strict();
export type McpRef = z.infer<typeof mcpRefSchema>;
export const mcpRefsSchema = z
  .array(mcpRefSchema)
  .refine(
    (refs) => new Set(refs.map((ref) => ref.id)).size === refs.length,
    '同一个接入不能重复绑定。',
  );
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    ['http:', 'https:'].includes(url.protocol)
  );
}, '使用 HTTP(S) 地址；凭据请放在认证字段，地址不能含账号、查询参数或片段。');
export const mcpAuthSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('none') }).strict(),
  z.object({ method: z.literal('bearer') }).strict(),
  z.object({ method: z.literal('oauth') }).strict(),
  z
    .object({
      method: z.literal('header'),
      headerName: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/)
        .refine(
          (value) =>
            !['host', 'cookie', 'origin', 'connection', 'content-length'].includes(
              value.toLowerCase(),
            ),
        ),
    })
    .strict(),
]);
export const mcpConnectionSchema = mcpRefSchema.extend({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['docker', 'mcp']),
  url: endpoint,
  auth: mcpAuthSchema,
  hasSecret: z.boolean(),
});
export type McpConnection = z.infer<typeof mcpConnectionSchema>;
export const saveMcpSchema = mcpConnectionSchema
  .omit({ revision: true, hasSecret: true, id: true })
  .extend({
    id: z.uuid().optional(),
    baseRevision: z.number().int().positive().optional(),
    secret: z
      .string()
      .min(1)
      .max(8192)
      .refine((value) => !/[\r\n]/.test(value))
      .optional(),
  })
  .strict()
  .refine((value) => (value.id !== undefined) === (value.baseRevision !== undefined));
export type SaveMcp = z.infer<typeof saveMcpSchema>;
export const mcpIndexSchema = z.object({ connections: z.array(mcpConnectionSchema) });
export const mcpStatusSchema = z.array(
  z.object({
    id: z.string(),
    authStatus: z.string(),
    toolCount: z.number().int().nonnegative(),
    state: z.string().optional(),
    error: z.string().optional(),
  }),
);
export const mcpServerName = (id: string) => 'canvas_' + id.replaceAll('-', '_');
