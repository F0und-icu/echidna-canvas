import type { CanvasDocument, Draft, Point } from '../model/schema';
import type { Projection, Session } from '../model/projection';
import { recordWidth } from '../records/runtimeLayout';

export const roundWidth = 330,
  roundHeight = 390;
export function agentPosition(
  session: Session,
  projection: Projection,
  canvas: CanvasDocument,
): Point {
  const saved = canvas.positions[session.id];
  if (saved) return saved;
  if (session.parentId) {
    const parent = projection.sessions[session.parentId],
      root = agentPosition(parent, projection, canvas);
    const delegation = Object.values(projection.delegations).find(
      (link) => link.childId === session.id,
    );
    if (delegation) {
      const position = roundPosition(
        parent,
        delegation.routeId,
        delegation.roundId,
        projection,
        canvas,
      );
      return { x: position.x + 20, y: position.y + 680 };
    }
    return { x: root.x + 260, y: root.y + 520 };
  }
  return { x: 64, y: 320 };
}
export function roundPosition(
  session: Session,
  routeId: string,
  roundId: string,
  projection: Projection,
  canvas: CanvasDocument,
): Point {
  const root = agentPosition(session, projection, canvas),
    routeIndex = session.routes.findIndex((route) => route.id === routeId),
    route = session.routes[routeIndex];
  const index = route.rounds.findIndex((round) => round.id === roundId);
  return {
    x:
      root.x +
      240 +
      route.rounds
        .slice(0, index)
        .reduce((sum, round) => sum + recordWidth(round) + (round.unit === 'turn' ? 48 : 100), 0),
    y: root.y - 180 + routeIndex * 1120,
  };
}
export function screenToWorld(
  client: Point,
  rect: Pick<DOMRect, 'left' | 'top'>,
  viewport: CanvasDocument['viewport'],
): Point {
  return {
    x: (client.x - rect.left - viewport.x) / viewport.zoom,
    y: (client.y - rect.top - viewport.y) / viewport.zoom,
  };
}
export function zoomAt(
  viewport: CanvasDocument['viewport'],
  factor: number,
  anchor: Point,
): CanvasDocument['viewport'] {
  const zoom = Math.max(0.3, Math.min(1.6, viewport.zoom * factor)),
    ratio = zoom / viewport.zoom;
  return {
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
    zoom,
  };
}
export function rectBetween(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}
export function translateDrafts(
  drafts: readonly Draft[],
  ids: readonly string[],
  delta: Point,
): Draft[] {
  return drafts.map((draft) =>
    ids.includes(draft.id)
      ? {
          ...draft,
          x: draft.x + delta.x,
          y: draft.y + delta.y,
          points: draft.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
        }
      : draft,
  );
}
export function draftBounds(draft: Draft) {
  if (draft.kind !== 'ink') return { x: draft.x, y: draft.y, w: draft.w, h: draft.h };
  const xs = draft.points.map((point) => point.x),
    ys = draft.points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}
export function draftPath(draft: Pick<Draft, 'kind' | 'w' | 'h'>): string {
  const { w, h } = draft;
  if (draft.kind === 'decision')
    return `M ${w / 2} 2 Q ${w / 2 + 8} 2 ${w - 5} ${h / 2 - 6} Q ${w + 1} ${h / 2} ${w - 5} ${h / 2 + 6} L ${w / 2 + 8} ${h - 4} Q ${w / 2} ${h + 2} ${w / 2 - 8} ${h - 4} L 5 ${h / 2 + 6} Q -1 ${h / 2} 5 ${h / 2 - 6} Z`;
  if (draft.kind === 'material')
    return `M 12 3 Q 3 3 3 13 L 2 ${h - 13} Q 2 ${h - 3} 13 ${h - 3} L ${w - 13} ${h - 3} Q ${w - 3} ${h - 3} ${w - 3} ${h - 14} L ${w - 3} 20 L ${w - 22} 3 Z M ${w - 22} 3 L ${w - 22} 20 L ${w - 3} 20`;
  return `M 19 3 Q 3 3 3 19 L 3 ${h - 19} Q 3 ${h - 3} 19 ${h - 3} L ${w - 19} ${h - 3} Q ${w - 3} ${h - 3} ${w - 3} ${h - 19} L ${w - 3} 19 Q ${w - 3} 3 ${w - 19} 3 Z`;
}
