import { z } from 'zod';

const noteInput = z
  .object({
    kind: z.enum(['intent', 'material', 'observation', 'decision', 'result']),
    title: z.string().min(1).max(40),
    detail: z.string().min(1).max(1200),
    refs: z.array(z.string().min(1).max(256)).max(8),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).max(32),
            label: z.string().min(1).max(28),
            selected: z.boolean(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export const canvasNoteSchema = noteInput.superRefine((note, context) => {
  if (note.kind === 'decision') {
    if (
      note.options.length < 2 ||
      note.options.filter((o) => o.selected).length !== 1 ||
      new Set(note.options.map((o) => o.id)).size !== note.options.length
    )
      context.addIssue({
        code: 'custom',
        message: 'A decision needs 2-3 unique options and exactly one selected option.',
      });
  } else if (note.options.length)
    context.addIssue({ code: 'custom', message: 'Only a decision can contain options.' });
});
export type CanvasNote = z.infer<typeof canvasNoteSchema>;
export class CanvasNoteRejected extends Error {}
export const canvasInspectSchema = z.object({}).strict();
export const canvasCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('echidna_canvas_note'), arguments: canvasNoteSchema }),
  z.object({ tool: z.literal('echidna_canvas_inspect'), arguments: canvasInspectSchema }),
]);
export const canvasInspectTool = {
  type: 'function' as const,
  name: 'echidna_canvas_inspect',
  description:
    'Call with {} to retrieve current-turn toolRefs, up to 8 recent tool descriptions, and up to 8 recentNotes. Each tool description contains toolRef, tool, commandPreview, observed status, and exitCode when supplied by the runtime.',
  inputSchema: z.toJSONSchema(canvasInspectSchema),
};
export const canvasTool = {
  type: 'function' as const,
  name: 'echidna_canvas_note',
  description:
    'Append a canvas annotation with kind, title, detail, refs, and options. Kinds: intent, material, observation, decision, result. refs accepts existing current-turn noteRef/toolRef values. decision requires 2-3 options with unique id values and exactly one selected:true; other kinds use options:[]. Returns noteRef, toolRefs, tools, and recentNotes after persistence.',
  inputSchema: z.toJSONSchema(noteInput),
};
export const canvasGuidance = `Echidna Canvas tool usage
echidna_canvas_inspect({}) returns current-turn toolRefs, tools, and recentNotes. tools contains up to 8 recent entries with toolRef, tool, commandPreview, status, and optional exitCode. recentNotes contains up to 8 entries with noteRef, title, and kind.
echidna_canvas_note({kind,title,detail,refs,options}) appends an annotation and returns noteRef, toolRefs, tools, and recentNotes after persistence.
kind: intent | material | observation | decision | result.
title: 1-40 characters. detail: 1-1200 characters.
refs: 0-8 existing current-turn noteRef/toolRef values returned by these tools.
options: [] for non-decision annotations. A decision takes 2-3 objects {id,label,selected}; ids are unique, id is 1-32 characters, label is 1-28 characters, and exactly one option has selected:true.
Example: echidna_canvas_note({"kind":"intent","title":"标题","detail":"内容","refs":[],"options":[]}).`;
