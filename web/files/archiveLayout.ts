import type { ArchivedFile } from '../../contracts/files';
import type { CanvasDocument, Point } from '../model/schema';
import type { Projection } from '../model/projection';
import { visibleSessions } from '../model/projection';
import { agentPosition, roundPosition } from '../canvas/geometry';
import { recordHeight } from '../records/runtimeLayout';
import { revisionGraphWidth } from './RevisionGraph';

export const archivePositionKey = 'project-archive';
export const archiveGraphX = 366,
  archiveRowHeight = 260;
export function archiveBounds(files: ArchivedFile[]) {
  return {
    w: Math.max(
      410,
      ...files.map((file) => archiveGraphX + revisionGraphWidth(file.revisions.length)),
    ),
    h: Math.max(290, files.length * archiveRowHeight),
  };
}
export function initialArchivePosition(view: Projection, canvas: CanvasDocument): Point {
  const bottoms = visibleSessions(view, canvas.rootSessions).flatMap((session) => [
    agentPosition(session, view, canvas).y + 212,
    ...session.routes.flatMap((route) =>
      route.rounds.map(
        (round) => roundPosition(session, route.id, round.id, view, canvas).y + recordHeight(round),
      ),
    ),
  ]);
  return { x: 64, y: Math.max(120, ...bottoms) + 240 };
}
