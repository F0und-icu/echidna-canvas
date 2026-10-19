import { expect, it } from 'vitest';
import { graphWorkspace } from '../fixtures/canvas-graph';
import { project } from '../../web/model/projection';
import {
  projectArchiveKey,
  projectArchivePosition,
  projectRegionBounds,
} from '../../web/canvas/projectRegions';
import { attachRuntimeAgent } from '../../web/runtime/placement';

it('groups the confirmed Agent and archive by project, preserves attachment position, and grows with content', () => {
  const workspace = graphWorkspace();
  const created = workspace.events[0].data;
  if (created.type !== 'session.created') throw new Error('Missing creation fixture');
  created.projectRoot = '/projects/alpha';
  const originalEvents = workspace.events;
  let attached = attachRuntimeAgent(workspace, 'graph-agent');
  expect(attached.events).toBe(originalEvents);
  expect(attached.canvases[0].projectRoots).toEqual(['/projects/alpha']);
  attached = attachRuntimeAgent(attached, 'graph-agent', { x: 999, y: 999 });
  expect(attached.canvases[0].positions['graph-agent']).toEqual({ x: 40, y: 300 });
  const view = project(attached.events),
    board = attached.canvases[0];
  const archive = projectArchivePosition('/projects/alpha', view, board);
  const before = projectRegionBounds('/projects/alpha', view, board);
  expect(before.y).toBeLessThan(300);
  expect(before.y + before.h).toBeGreaterThan(archive.y + 290);
  const moved = {
    ...board,
    positions: { ...board.positions, [projectArchiveKey('/projects/alpha')]: { x: 2500, y: 1800 } },
  };
  const after = projectRegionBounds('/projects/alpha', view, moved);
  expect(after.x + after.w).toBeGreaterThan(2650);
  expect(after.y + after.h).toBeGreaterThan(2090);
  expect(projectArchivePosition('/projects/alpha', view, moved)).toEqual({ x: 2500, y: 1800 });
  expect(attached.events).toBe(originalEvents);
});

it('expands the project region for archive revisions while excluding another project Agent', () => {
  const workspace = graphWorkspace(),
    view = project(workspace.events),
    board = workspace.canvases[0];
  view.sessions['graph-agent'].projectRoot = '/projects/alpha';
  const before = projectRegionBounds('/projects/alpha', view, board);
  const index = {
    root: '/projects/alpha',
    files: [
      {
        path: 'notes.md',
        revisions: Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          hash: 'a'.repeat(64),
          source: 'editor' as const,
          createdAt: '2026-10-19T00:00:00Z',
        })),
      },
    ],
  };
  expect(projectRegionBounds('/projects/alpha', view, board, index).w).toBeGreaterThan(before.w);
  view.sessions['graph-agent'].projectRoot = '/projects/beta';
  expect(projectArchivePosition('/projects/alpha', view, board)).toEqual({ x: 64, y: 320 });
});
