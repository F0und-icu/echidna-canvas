import { describe, expect, it } from 'vitest';
import { removeCanvasItem, restoreCanvasContent } from '../../web/model/deletion';
import { project, visibleSessions } from '../../web/model/projection';
import {
  createWorkspace,
  currentCanvas,
  deliveryBlock,
  duplicateCanvas,
  parseWorkspace,
  planKey,
  receiveNext,
  updateCanvas,
  editDrafts,
  removeDrafts,
} from '../../web/model/workspace';
import { attachRuntimeAgent } from '../../web/runtime/placement';
import type { Workspace } from '../../web/model/schema';

function withChild() {
  let workspace = createWorkspace();
  const key = planKey('agent/main', 'r1');
  while (!deliveryBlock(workspace, key)) workspace = receiveNext(workspace, key);
  return workspace;
}
const visible = (workspace: Workspace) => {
  const canvas = currentCanvas(workspace);
  return visibleSessions(project(workspace.events), canvas.rootSessions, canvas.hiddenSessions).map(
    (session) => session.id,
  );
};

describe('deletion belongs to the canvas view', () => {
  it('restores a deleted canvas from the persisted recycle bin without replacing execution facts', () => {
    const initial = withChild();
    const removed = removeCanvasItem(initial, { kind: 'canvas', id: initial.activeCanvas });
    const saved = parseWorkspace(JSON.stringify(removed));
    const restored = restoreCanvasContent(saved, saved.trash![0].id);
    expect(currentCanvas(restored)).toEqual(currentCanvas(initial));
    expect(restored.events).toEqual(initial.events);
    expect(restored.trash).toEqual([]);
  });
  it('restores removed roles and bindings as view references without new execution events', () => {
    const initial = updateCanvas(createWorkspace(), (canvas) => ({
      ...canvas,
      connectionIds: ['demo'],
      projectRoots: ['/tmp/project'],
      positions: { ...canvas.positions, 'mcp:demo': { x: 50, y: 60 } },
    }));
    for (const target of [
      { kind: 'agent', id: 'agent/main' },
      { kind: 'mcp', id: 'demo' },
      { kind: 'project', root: '/tmp/project' },
    ] as const) {
      const removed = removeCanvasItem(initial, target);
      const restored = restoreCanvasContent(removed, removed.trash![0].id);
      expect(currentCanvas(restored).rootSessions).toEqual(currentCanvas(initial).rootSessions);
      expect(currentCanvas(restored).projectRoots).toEqual(currentCanvas(initial).projectRoots);
      expect(currentCanvas(restored).connectionIds).toEqual(currentCanvas(initial).connectionIds);
      expect(restored.events).toBe(initial.events);
      expect(restored.replays).toBe(initial.replays);
    }
  });
  it('restores draft endpoints and dependent lines together, while preserving a newer existing draft', () => {
    const initial = editDrafts(createWorkspace(), [
      {
        id: 'a',
        kind: 'action',
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        title: 'A',
        points: [],
        from: null,
        to: null,
      },
      {
        id: 'b',
        kind: 'action',
        x: 200,
        y: 0,
        w: 100,
        h: 60,
        title: 'B',
        points: [],
        from: null,
        to: null,
      },
      {
        id: 'line',
        kind: 'relation',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        title: '',
        points: [],
        from: 'a',
        to: 'b',
      },
    ]);
    const removed = removeDrafts(initial, ['a']);
    expect(removed.trash![0].content.kind).toBe('drafts');
    const restored = restoreCanvasContent(removed, removed.trash![0].id);
    expect(currentCanvas(restored).drafts).toHaveLength(3);
    expect(restored.events).toBe(initial.events);
    const missingBoth = removeDrafts(removed, ['b']);
    expect(() => restoreCanvasContent(missingBoth, missingBoth.trash![0].id)).toThrow(
      '端点尚未恢复',
    );
    expect(currentCanvas(missingBoth).drafts).toEqual([]);
    const existing = editDrafts(removed, [
      ...currentCanvas(removed).drafts,
      { ...currentCanvas(initial).drafts[0], title: '新版 A' },
    ]);
    expect(
      currentCanvas(restoreCanvasContent(existing, existing.trash![0].id)).drafts.find(
        (draft) => draft.id === 'a',
      )!.title,
    ).toBe('新版 A');
  });
  it('removes an inherited child without it reappearing on refresh or new events', () => {
    const initial = withChild();
    const removed = removeCanvasItem(initial, { kind: 'agent', id: 'agent/main/r1/review' });
    expect(visible(removed)).toEqual(['agent/main']);
    expect(visible(parseWorkspace(JSON.stringify(removed)))).toEqual(['agent/main']);
    expect(removed.events).toBe(initial.events);
    expect(removed.replays).toBe(initial.replays);
    expect(Object.values(project(removed.events).delegations)).toHaveLength(1);
    const restored = attachRuntimeAgent(removed, 'agent/main/r1/review');
    expect(visible(restored)).toHaveLength(2);
    expect(restored.events).toBe(initial.events);
  });

  it('keeps independent children, coordinates, draft inputs and other canvases when removing a parent', () => {
    let initial = withChild();
    initial = updateCanvas(initial, (canvas) => ({
      ...canvas,
      positions: { ...canvas.positions, 'agent/main': { x: 140, y: 230 } },
    }));
    initial = { ...initial, chatDrafts: { 'agent/main': '继续检查的草稿' } };
    const copy = duplicateCanvas(initial);
    const removed = removeCanvasItem(copy, { kind: 'agent', id: 'agent/main' });
    expect(visible(removed)).toEqual(['agent/main/r1/review']);
    expect(removed.canvases[0]).toBe(copy.canvases[0]);
    expect(removed.chatDrafts).toBe(initial.chatDrafts);
    expect(removed.events).toBe(initial.events);
    const restored = attachRuntimeAgent(removed, 'agent/main');
    expect(visible(restored)).toHaveLength(2);
    expect(currentCanvas(restored).positions['agent/main']).toEqual({ x: 140, y: 230 });
  });

  it('does not resurrect a previously removed child when its parent is put back', () => {
    let workspace = withChild();
    workspace = removeCanvasItem(workspace, { kind: 'agent', id: 'agent/main/r1/review' });
    workspace = removeCanvasItem(workspace, { kind: 'agent', id: 'agent/main' });
    workspace = attachRuntimeAgent(workspace, 'agent/main');
    expect(visible(workspace)).toEqual(['agent/main']);
  });

  it('keeps receiving an already dispatched tool result after removing its Agent', () => {
    const initial = createWorkspace();
    const removed = removeCanvasItem(initial, { kind: 'agent', id: 'agent/main' });
    const received = receiveNext(removed, planKey('agent/main', 'r1'));
    expect(received.events).toHaveLength(initial.events.length + 1);
    expect(visible(received)).toEqual([]);
    expect(
      project(received.events).sessions['agent/main'].routes[0].rounds[1].calls[0].status,
    ).toBe('returned');
  });

  it('removes project and MCP view membership while preserving the recorded binding', () => {
    let initial = createWorkspace();
    const event = initial.events[0];
    if (event.data.type !== 'session.created') throw new Error('Missing fixture creation');
    initial = {
      ...initial,
      events: [
        {
          ...event,
          data: {
            ...event.data,
            connections: [{ id: '00000000-0000-4000-8000-000000000001', revision: 3 }],
            projectRoot: '/tmp/public-project',
          },
        },
        ...initial.events.slice(1),
      ],
    };
    initial = updateCanvas(initial, (canvas) => ({
      ...canvas,
      projectRoots: ['/tmp/public-project'],
      connectionIds: ['00000000-0000-4000-8000-000000000001'],
      positions: {
        ...canvas.positions,
        'mcp:00000000-0000-4000-8000-000000000001': { x: 20, y: 50 },
      },
    }));
    const removed = removeCanvasItem(
      removeCanvasItem(initial, { kind: 'project', root: '/tmp/public-project' }),
      { kind: 'mcp', id: '00000000-0000-4000-8000-000000000001' },
    );
    expect(currentCanvas(removed).projectRoots).toEqual([]);
    expect(currentCanvas(removed).hiddenProjectRoots).toEqual(['/tmp/public-project']);
    expect(currentCanvas(removed).connectionIds).toEqual([]);
    expect(project(removed.events).sessions['agent/main'].connections).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', revision: 3 },
    ]);
    expect(removed.events).toBe(initial.events);
    expect(parseWorkspace(JSON.stringify(removed))).toEqual(removed);
  });

  it('persists removal of legacy archive views without destroying their positions', () => {
    const initial = updateCanvas(createWorkspace(), (canvas) => ({
      ...canvas,
      projectRoots: undefined,
      positions: { 'project-archive': { x: 40, y: 60 } },
    }));
    const removed = removeCanvasItem(initial, { kind: 'project' });
    const saved = currentCanvas(parseWorkspace(JSON.stringify(removed)));
    expect(saved.archiveHidden).toBe(true);
    expect(saved.positions['project-archive']).toEqual({ x: 40, y: 60 });
  });

  it('deletes only the chosen canvas and opens a blank replacement after the final canvas', () => {
    const initial = withChild();
    const copy = duplicateCanvas(initial);
    const removed = removeCanvasItem(copy, { kind: 'canvas', id: copy.activeCanvas });
    expect(removed.canvases).toEqual(initial.canvases);
    expect(removed.activeCanvas).toBe(initial.activeCanvas);
    const empty = removeCanvasItem(removed, { kind: 'canvas', id: removed.activeCanvas });
    expect(empty.canvases).toHaveLength(1);
    expect(currentCanvas(empty).id).not.toBe(initial.activeCanvas);
    expect(currentCanvas(empty).rootSessions).toEqual([]);
    expect(currentCanvas(empty).projectRoots).toEqual([]);
    expect(empty.events).toBe(initial.events);
    expect(empty.replays).toBe(initial.replays);
    expect(parseWorkspace(JSON.stringify(empty))).toEqual(empty);
  });
});
