import type { CanvasDocument, TrashEntry, Workspace } from './schema';

export function archiveCanvasContent(
  workspace: Workspace,
  canvas: CanvasDocument,
  label: string,
  content: TrashEntry['content'],
): Workspace {
  return {
    ...workspace,
    trash: [
      ...(workspace.trash ?? []),
      {
        id: crypto.randomUUID(),
        deletedAt: new Date().toISOString(),
        canvasName: canvas.name,
        label,
        content: structuredClone(content),
      },
    ],
  };
}
