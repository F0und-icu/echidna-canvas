import { project, visibleSessions } from '../model/projection';
import { currentCanvas, updateCanvas } from '../model/workspace';
import { agentPosition, roundPosition } from '../canvas/geometry';
import { recordHeight } from '../records/runtimeLayout';
import type { Point, Workspace } from '../model/schema';

export function attachRuntimeAgent(workspace: Workspace, id: string, point?: Point): Workspace {
  const canvas = currentCanvas(workspace),
    view = project(workspace.events);
  const bottom = Math.max(
    80,
    ...visibleSessions(view, canvas.rootSessions).flatMap((session) => [
      agentPosition(session, view, canvas).y + 200,
      ...session.routes.flatMap((route) =>
        route.rounds.map(
          (round) =>
            roundPosition(session, route.id, round.id, view, canvas).y + recordHeight(round),
        ),
      ),
    ]),
  );
  return updateCanvas(workspace, (board) => ({
    ...board,
    rootSessions: [...new Set([...board.rootSessions, id])],
    ...(view.sessions[id].projectRoot
      ? {
          projectRoots: [
            ...new Set([...(board.projectRoots ?? []), view.sessions[id].projectRoot]),
          ],
        }
      : {}),
    positions: board.rootSessions.includes(id)
      ? board.positions
      : { ...board.positions, [id]: point ?? { x: 64, y: bottom + 240 } },
    selectedSession: id,
    historySeq: null,
    follow: true,
  }));
}
