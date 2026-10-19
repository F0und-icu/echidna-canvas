import { z } from 'zod';

export const MAX_FILE_BYTES = 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const fileProjectsSchema = z.object({ root: z.string(), projects: z.array(z.string()) });
export const selectFileProjectSchema = z.object({ root: z.string().min(1).max(4096) }).strict();
export const fileListSchema = z.object({
  root: z.string(),
  directory: z.string(),
  entries: z.array(z.object({ path: z.string(), kind: z.enum(['directory', 'file']) })),
});
export const fileRevisionSchema = z.object({
  id: z.number().int().positive(),
  hash,
  source: z.enum(['observed', 'editor']),
  createdAt: z.string(),
});
export const projectFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  hash,
  revisions: z.array(fileRevisionSchema).min(1),
});
export const archivedFileSchema = projectFileSchema.pick({ path: true, revisions: true });
export const archiveIndexSchema = z.object({
  root: z.string(),
  files: z.array(archivedFileSchema),
});
export const historicalFileSchema = z.object({ content: z.string(), hash });
export const saveFileSchema = z
  .object({
    path: z.string().min(1).max(4096),
    baseHash: hash,
    content: z.string().max(MAX_FILE_BYTES),
  })
  .strict();
export type ProjectFile = z.infer<typeof projectFileSchema>;
export type FileList = z.infer<typeof fileListSchema>;
export type HistoricalFile = z.infer<typeof historicalFileSchema>;
export type ArchivedFile = z.infer<typeof archivedFileSchema>;
export type ArchiveIndex = z.infer<typeof archiveIndexSchema>;
export type FileProjects = z.infer<typeof fileProjectsSchema>;
