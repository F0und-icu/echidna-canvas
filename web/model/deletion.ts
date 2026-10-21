import { project, visibleSessions } from './projection';
import { currentCanvas, emptyCanvas, newId, updateCanvas } from './workspace';
import type { Workspace } from './schema';
import { archiveCanvasContent } from './trash';

export type RemovalTarget =
  | { kind: 'agent'; id: string }
  | { kind: 'project'; root?: string }
  | { kind: 'mcp'; id: string }
  | { kind: 'canvas'; id: string };

// These operations own view membership only. Events, replays, drafts in other
// canvases, runtime bindings and project files retain their original owners.
export function removeCanvasItem(workspace: Workspace, target: RemovalTarget): Workspace {
  const canvas =
    target.kind === 'canvas'
      ? workspace.canvases.find((canvas) => canvas.id === target.id)!
      : currentCanvas(workspace);
  const view = project(workspace.events);
  const content =
    target.kind === 'canvas'
      ? { kind: 'canvas' as const, canvas }
      : target.kind === 'agent'
        ? { ...target, position: canvas.positions[target.id] }
        : target.kind === 'mcp'
          ? { ...target, position: canvas.positions['mcp:' + target.id] }
          : {
              ...target,
              position:
                canvas.positions[
                  target.root ? 'project-archive:' + target.root : 'project-archive'
                ],
            };
  const label =
    target.kind === 'canvas'
      ? canvas.name
      : target.kind === 'agent'
        ? view.sessions[target.id].config.name
        : target.kind === 'project'
          ? (target.root ?? '项目档案')
          : 'MCP 接入';
  workspace = archiveCanvasContent(workspace, canvas, label, content);
  if (target.kind === 'canvas') {
    const remaining = workspace.canvases.filter((canvas) => canvas.id !== target.id);
    if (!remaining.length) remaining.push(emptyCanvas(newId(), '新画布'));
    return {
      ...workspace,
      canvases: remaining,
      activeCanvas: workspace.activeCanvas === target.id ? remaining[0].id : workspace.activeCanvas,
    };
  }
  if (target.kind === 'agent') {
    // An offline child can be visible through its parent without being a root.
    // Keep those independent sessions on the canvas when removing their parent.
    const children = visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions)
      .filter((session) => session.parentId === target.id)
      .map((session) => session.id);
    return updateCanvas(workspace, (canvas) => ({
      ...canvas,
      rootSessions: [
        ...new Set([...canvas.rootSessions.filter((id) => id !== target.id), ...children]),
      ],
      hiddenSessions: [...new Set([...(canvas.hiddenSessions ?? []), target.id])],
      selectedSession: canvas.selectedSession === target.id ? null : canvas.selectedSession,
      follow: false,
      proposal: canvas.proposal?.source.sessionId === target.id ? null : canvas.proposal,
    }));
  }
  return updateCanvas(workspace, (canvas) =>
    target.kind === 'mcp'
      ? { ...canvas, connectionIds: canvas.connectionIds?.filter((id) => id !== target.id) }
      : target.root
        ? {
            ...canvas,
            projectRoots: canvas.projectRoots?.filter((root) => root !== target.root),
            hiddenProjectRoots: [...new Set([...(canvas.hiddenProjectRoots ?? []), target.root])],
          }
        : { ...canvas, archiveHidden: true },
  );
}

export function restoreCanvasContent(workspace: Workspace, trashId: string): Workspace {
  const entry = workspace.trash!.find((item) => item.id === trashId)!;
  const content = entry.content;
  let next = workspace;
  if (content.kind === 'canvas') {
    if (workspace.canvases.some((canvas) => canvas.id === content.canvas.id))
      throw new Error('这张画布已存在，请保留当前版本。');
    next = {
      ...workspace,
      canvases: [...workspace.canvases, content.canvas],
      activeCanvas: content.canvas.id,
    };
  } else if (content.kind === 'drafts') {
    const canvas = currentCanvas(workspace);
    const drafts = [
      ...canvas.drafts,
      ...content.drafts.filter(
        (draft) => !canvas.drafts.some((existing) => existing.id === draft.id),
      ),
    ];
    for (const draft of drafts.filter((draft) => draft.kind === 'relation'))
      if (![draft.from, draft.to].every((id) => drafts.some((endpoint) => endpoint.id === id)))
        throw new Error('这条连线的端点尚未恢复，请先恢复对应图形。');
    next = updateCanvas(workspace, (canvas) => ({
      ...canvas,
      drafts,
      undo: [...canvas.undo, canvas.drafts].slice(-100),
      redo: [],
      selectedDrafts: content.drafts.map((draft) => draft.id),
      selectedSession: null,
    }));
  } else if (content.kind === 'agent') {
    if (!project(workspace.events).sessions[content.id])
      throw new Error('此 Agent 的来源记录不在当前浏览器中，请先连接所属运行时补齐记录。');
    next = updateCanvas(workspace, (canvas) => ({
      ...canvas,
      rootSessions: [...new Set([...canvas.rootSessions, content.id])],
      hiddenSessions: canvas.hiddenSessions?.filter((id) => id !== content.id),
      positions: content.position
        ? { ...canvas.positions, [content.id]: content.position }
        : canvas.positions,
      selectedSession: content.id,
      selectedDrafts: [],
      historySeq: null,
      follow: false,
    }));
  } else if (content.kind === 'mcp') {
    next = updateCanvas(workspace, (canvas) => ({
      ...canvas,
      connectionIds: [...new Set([...(canvas.connectionIds ?? []), content.id])],
      positions: content.position
        ? { ...canvas.positions, ['mcp:' + content.id]: content.position }
        : canvas.positions,
    }));
  } else {
    if (!content.root && currentCanvas(workspace).projectRoots?.length)
      throw new Error('请在空白画布恢复这份未绑定项目的旧档案路线。');
    const key = content.root ? 'project-archive:' + content.root : 'project-archive';
    next = updateCanvas(workspace, (canvas) => ({
      ...canvas,
      archiveHidden: false,
      projectRoots: content.root
        ? [...new Set([...(canvas.projectRoots ?? []), content.root])]
        : undefined,
      hiddenProjectRoots: canvas.hiddenProjectRoots?.filter((root) => root !== content.root),
      positions: content.position
        ? { ...canvas.positions, [key]: content.position }
        : canvas.positions,
    }));
  }
  return { ...next, trash: workspace.trash!.filter((item) => item.id !== trashId) };
}
