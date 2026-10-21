import type { ArchiveIndex } from '../../contracts/files';
import type { CanvasDocument, Point } from '../model/schema';
import type { Projection } from '../model/projection';
import { visibleSessions } from '../model/projection';
import { agentPosition, roundPosition } from './geometry';
import { recordHeight, recordWidth } from '../records/runtimeLayout';
import { archiveBounds } from '../files/archiveLayout';

export const projectArchiveKey = (root: string) => 'project-archive:' + root;

function contentBoxes(root: string, view: Projection, canvas: CanvasDocument) {
  return visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions)
    .filter((session) => session.projectRoot === root)
    .flatMap((session) => [
      { ...agentPosition(session, view, canvas), w: 150, h: 212 },
      ...session.routes
        .filter((_, index) => canvas.showPast || index === session.routes.length - 1)
        .flatMap((route) =>
          route.rounds.map((round) => ({
            ...roundPosition(session, route.id, round.id, view, canvas),
            w: recordWidth(round) + 160,
            h: recordHeight(round),
          })),
        ),
    ]);
}

export function projectArchivePosition(
  root: string,
  view: Projection,
  canvas: CanvasDocument,
): Point {
  const saved = canvas.positions[projectArchiveKey(root)];
  if (saved) return saved;
  const boxes = contentBoxes(root, view, canvas);
  if (!boxes.length) return { x: 64, y: 320 };
  return {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.max(...boxes.map((box) => box.y + box.h)) + 100,
  };
}

export function projectRegionBounds(
  root: string,
  view: Projection,
  canvas: CanvasDocument,
  index?: ArchiveIndex,
) {
  const boxes = [
    ...contentBoxes(root, view, canvas),
    { ...projectArchivePosition(root, view, canvas), ...archiveBounds(index?.files ?? []) },
  ];
  const x = Math.min(...boxes.map((box) => box.x)) - 44,
    y = Math.min(...boxes.map((box) => box.y)) - 76;
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x + 44,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y + 44,
  };
}
