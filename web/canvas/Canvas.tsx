import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { BookOpen, CircleDashed, MessageCircle } from 'lucide-react';
import { useApp } from '../app/context';
import { Character } from '../agents/Character';
import { executionPose, sessionPose } from '../agents/characterPose';
import { visibleSessions, conversationRounds } from '../model/projection';
import type { Brush, Draft, Point } from '../model/schema';
import { editDrafts, newId, removeDrafts, sourceFor, updateCanvas } from '../model/workspace';
import { RoundView } from '../records/RoundView';
import { referencedCall } from '../records/references';
import { ArchiveCanvas } from '../files/ArchiveCanvas';
import { archivePositionKey } from '../files/archiveLayout';
import { useProjectArchive } from '../files/archive';
import { projectArchiveKey, projectArchivePosition, projectRegionBounds } from './projectRegions';
import { recordWidth, runtimeLayout } from '../records/runtimeLayout';
import { McpIcon } from '../runtime/McpPanel';
import {
  agentPosition,
  draftBounds,
  draftPath,
  rectBetween,
  roundHeight,
  roundPosition,
  roundWidth,
  screenToWorld,
  translateDrafts,
  zoomAt,
} from './geometry';

type Gesture =
  | { type: 'mcp'; id: string; origin: Point; start: Point; at: Point }
  | { type: 'pan'; start: Point; at: Point }
  | { type: 'agent'; id: string; origin: Point; start: Point; at: Point }
  | { type: 'archive'; key: string; root?: string; origin: Point; start: Point; at: Point }
  | { type: 'draft'; ids: string[]; start: Point; at: Point }
  | { type: 'box'; start: Point; at: Point }
  | { type: 'draw'; kind: Draft['kind']; start: Point; at: Point }
  | { type: 'ink'; points: Point[] }
  | {
      type: 'connect';
      from: string;
      endpointKind: 'agent' | 'draft' | 'mcp';
      start: Point;
      at: Point;
    };
const sizes = {
  action: [180, 76],
  decision: [170, 114],
  material: [196, 100],
  frame: [380, 220],
  note: [204, 86],
} as const;
const titles = {
  action: '计划步骤',
  decision: '需要验证？',
  material: '材料来源',
  frame: '新区域',
  note: '旁注',
};

export function Canvas({
  brush,
  setBrush,
  boardRef,
  children,
}: {
  brush: Brush;
  setBrush: (brush: Brush) => void;
  boardRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { workspace, canvas, view, panel, setWorkspace, openPanel, notify, focusArchive, mcp } =
    useApp();
  const [gesture, setGesture] = useState<Gesture | null>(null),
    [space, setSpace] = useState(false);
  const [connectFrom, setConnectFrom] = useState<{
    id: string;
    kind: 'agent' | 'draft' | 'mcp';
  } | null>(null);
  const sessions = visibleSessions(view, canvas.rootSessions);
  const archive = useProjectArchive();
  const point = (event: { clientX: number; clientY: number }) =>
    screenToWorld(
      { x: event.clientX, y: event.clientY },
      boardRef.current!.getBoundingClientRect(),
      canvas.viewport,
    );
  let display = canvas;
  if (gesture?.type === 'agent' || gesture?.type === 'mcp')
    display = {
      ...canvas,
      positions: {
        ...canvas.positions,
        [gesture.type === 'mcp' ? 'mcp:' + gesture.id : gesture.id]: {
          x: gesture.origin.x + gesture.at.x - gesture.start.x,
          y: gesture.origin.y + gesture.at.y - gesture.start.y,
        },
      },
    };
  if (gesture?.type === 'archive')
    display = {
      ...canvas,
      positions: {
        ...canvas.positions,
        [gesture.key]: {
          x: gesture.origin.x + gesture.at.x - gesture.start.x,
          y: gesture.origin.y + gesture.at.y - gesture.start.y,
        },
      },
    };
  if (gesture?.type === 'draft')
    display = {
      ...canvas,
      drafts: translateDrafts(canvas.drafts, gesture.ids, {
        x: gesture.at.x - gesture.start.x,
        y: gesture.at.y - gesture.start.y,
      }),
    };
  if (gesture?.type === 'pan')
    display = {
      ...canvas,
      viewport: {
        ...canvas.viewport,
        x: canvas.viewport.x + gesture.at.x - gesture.start.x,
        y: canvas.viewport.y + gesture.at.y - gesture.start.y,
      },
    };
  const viewport = display.viewport;
  useEffect(() => {
    setGesture(null);
    setConnectFrom(null);
  }, [canvas.id, brush]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(e.target as HTMLElement).closest('input,textarea,select,button')
      ) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      setGesture(null);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    const board = boardRef.current!;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.inspector,.main-menu,.files-dialog')) return;
      e.preventDefault();
      const rect = board.getBoundingClientRect();
      setWorkspace((w) =>
        updateCanvas(w, (c) => ({
          ...c,
          follow: false,
          viewport:
            e.ctrlKey || e.metaKey
              ? zoomAt(c.viewport, Math.exp(-e.deltaY * 0.008), {
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                })
              : { ...c.viewport, x: c.viewport.x - e.deltaX, y: c.viewport.y - e.deltaY },
        })),
      );
    };
    board.addEventListener('wheel', wheel, { passive: false });
    return () => board.removeEventListener('wheel', wheel);
  }, [boardRef, setWorkspace]);

  const endpoint = (target: Element | null) => {
    const el = target?.closest<HTMLElement>('[data-agent],[data-draft],[data-mcp]');
    if (el?.dataset.agent) return { id: el.dataset.agent, kind: 'agent' as const };
    if (el?.dataset.mcp) return { id: el.dataset.mcp, kind: 'mcp' as const };
    const draft = display.drafts.find((draft) => draft.id === el?.dataset.draft);
    return draft && !['relation', 'ink'].includes(draft.kind)
      ? { id: draft.id, kind: 'draft' as const }
      : null;
  };
  const finishConnection = (
    from: { id: string; kind: 'agent' | 'draft' | 'mcp' },
    to: ReturnType<typeof endpoint>,
  ) => {
    if (
      to &&
      ((from.kind === 'mcp' && to.kind === 'agent') || (from.kind === 'agent' && to.kind === 'mcp'))
    ) {
      openPanel({
        kind: 'mcp-bind',
        connectionId: from.kind === 'mcp' ? from.id : to.id,
        agentId: from.kind === 'agent' ? from.id : to.id,
      });
      setConnectFrom(null);
      setBrush('select');
      return;
    }
    if (!to || to.kind !== from.kind || to.id === from.id || to.kind === 'mcp') {
      notify('请选择同类的另一个端点');
      return;
    }
    if (from.kind === 'agent') openPanel({ kind: 'link', from: from.id, to: to.id });
    else {
      const id = newId();
      setWorkspace((w) =>
        updateCanvas(
          editDrafts(w, [
            ...w.canvases.find((c) => c.id === w.activeCanvas)!.drafts,
            {
              id,
              kind: 'relation',
              title: '',
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              points: [],
              from: from.id,
              to: to.id,
            },
          ]),
          (c) => ({ ...c, selectedDrafts: [id] }),
        ),
      );
    }
    setConnectFrom(null);
    setBrush('select');
  };
  const down = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement,
      hit = endpoint(target);
    if (
      target.closest(
        '.floating-bar,.main-menu,.canvas-switcher,.brushes,.appearance-trigger,.archive-entry,.inspector,.runtime-relation-key',
      )
    )
      return;
    if (
      target.closest('button,input,select,textarea,a') &&
      !target.closest('[data-agent],[data-draft],[data-archive-root],[data-mcp]')
    )
      return;
    const p = point(e),
      at = { x: e.clientX, y: e.clientY };
    if (brush === 'hand' || space || e.button === 1) setGesture({ type: 'pan', start: at, at });
    else if (brush === 'connect') {
      if (!hit) {
        notify('先选择一个 Agent、MCP 接入或草稿端点');
        return;
      }
      if (connectFrom) {
        finishConnection(connectFrom, hit);
        return;
      }
      setGesture({ type: 'connect', from: hit.id, endpointKind: hit.kind, start: p, at: p });
    } else if (brush === 'eraser') {
      const draftId = target.closest<HTMLElement>('[data-draft]')?.dataset.draft;
      if (draftId) setWorkspace((w) => removeDrafts(w, [draftId]));
      else if (hit?.kind === 'agent' || target.closest('.round-record'))
        notify('橡皮只作用于手工草稿，执行记录保留');
      return;
    } else if (brush === 'agent') {
      openPanel({ kind: 'create', point: p });
      setBrush('select');
      return;
    } else if (brush === 'ink') setGesture({ type: 'ink', points: [p] });
    else if (brush !== 'select') setGesture({ type: 'draw', kind: brush, start: p, at: p });
    else if (target.closest('[data-archive-root]')) {
      const entry = target.closest<HTMLElement>('[data-archive-root]')!;
      const root = entry.dataset.archiveRoot || undefined;
      setGesture({
        type: 'archive',
        key: entry.dataset.archiveKey!,
        root,
        origin: root
          ? projectArchivePosition(root, view, canvas)
          : canvas.positions[archivePositionKey],
        start: p,
        at: p,
      });
    } else if (hit?.kind === 'mcp') {
      setGesture({
        type: 'mcp',
        id: hit.id,
        origin: display.positions['mcp:' + hit.id] ?? { x: 64, y: 64 },
        start: p,
        at: p,
      });
    } else if (hit?.kind === 'agent') {
      const session = view.sessions[hit.id];
      setGesture({
        type: 'agent',
        id: hit.id,
        origin: agentPosition(session, view, canvas),
        start: p,
        at: p,
      });
    } else if (hit?.kind === 'draft') {
      const ids = e.shiftKey
        ? [...new Set([...canvas.selectedDrafts, hit.id])]
        : canvas.selectedDrafts.includes(hit.id)
          ? canvas.selectedDrafts
          : [hit.id];
      setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, selectedDrafts: ids })));
      setGesture({ type: 'draft', ids, start: p, at: p });
    } else setGesture({ type: 'box', start: p, at: p });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    if (!gesture) return;
    const p = point(e);
    if (gesture.type === 'ink') setGesture({ ...gesture, points: [...gesture.points, p] });
    else
      setGesture({ ...gesture, at: gesture.type === 'pan' ? { x: e.clientX, y: e.clientY } : p });
  };
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    if (!gesture) return;
    const p = point(e);
    const moved =
      gesture.type === 'ink'
        ? true
        : Math.hypot(
            (gesture.type === 'pan' ? e.clientX : p.x) - gesture.start.x,
            (gesture.type === 'pan' ? e.clientY : p.y) - gesture.start.y,
          ) >
          4 / canvas.viewport.zoom;
    if (gesture.type === 'pan')
      setWorkspace((w) =>
        updateCanvas(w, (c) => ({
          ...c,
          follow: false,
          viewport: {
            ...c.viewport,
            x: c.viewport.x + e.clientX - gesture.start.x,
            y: c.viewport.y + e.clientY - gesture.start.y,
          },
        })),
      );
    if (gesture.type === 'agent') {
      setWorkspace((w) =>
        updateCanvas(w, (c) => ({
          ...c,
          selectedSession: gesture.id,
          selectedDrafts: [],
          follow: false,
          positions: moved
            ? {
                ...c.positions,
                [gesture.id]: {
                  x: gesture.origin.x + p.x - gesture.start.x,
                  y: gesture.origin.y + p.y - gesture.start.y,
                },
              }
            : c.positions,
        })),
      );
      if (!moved) {
        const route = view.sessions[gesture.id].routes.at(-1);
        openPanel(
          route
            ? { kind: 'chat', source: sourceFor(workspace, gesture.id, route.id, null) }
            : { kind: 'agent', sessionId: gesture.id },
        );
      }
    }
    if (gesture.type === 'mcp') {
      if (moved)
        setWorkspace((workspace) =>
          updateCanvas(workspace, (board) => ({
            ...board,
            follow: false,
            positions: {
              ...board.positions,
              ['mcp:' + gesture.id]: {
                x: gesture.origin.x + p.x - gesture.start.x,
                y: gesture.origin.y + p.y - gesture.start.y,
              },
            },
          })),
        );
      else openPanel({ kind: 'mcp', id: gesture.id });
    }
    if (gesture.type === 'archive') {
      if (moved)
        setWorkspace((w) =>
          updateCanvas(w, (c) => ({
            ...c,
            follow: false,
            positions: {
              ...c.positions,
              [gesture.key]: {
                x: gesture.origin.x + p.x - gesture.start.x,
                y: gesture.origin.y + p.y - gesture.start.y,
              },
            },
          })),
        );
      else openPanel({ kind: 'files', root: gesture.root });
    }
    if (gesture.type === 'draft') {
      if (moved)
        setWorkspace((w) =>
          editDrafts(
            w,
            translateDrafts(canvas.drafts, gesture.ids, {
              x: p.x - gesture.start.x,
              y: p.y - gesture.start.y,
            }),
          ),
        );
      else if (gesture.ids.length === 1) openPanel({ kind: 'draft', id: gesture.ids[0] });
    }
    if (gesture.type === 'box') {
      const box = rectBetween(gesture.start, p),
        selected = canvas.drafts
          .filter((draft) => {
            if (draft.kind === 'relation') return false;
            const b = draftBounds(draft);
            return (
              b.x >= box.x &&
              b.y >= box.y &&
              b.x + b.w <= box.x + box.w &&
              b.y + b.h <= box.y + box.h
            );
          })
          .map((draft) => draft.id);
      setWorkspace((w) =>
        updateCanvas(w, (c) => ({ ...c, selectedDrafts: selected, follow: false })),
      );
      if (!moved) openPanel(null);
    }
    if (gesture.type === 'draw' && gesture.kind in sizes) {
      const kind = gesture.kind as keyof typeof sizes,
        [w, h] = sizes[kind],
        box = rectBetween(gesture.start, p);
      const draft: Draft = {
        id: newId(),
        kind,
        title: titles[kind],
        x: moved ? box.x : p.x,
        y: moved ? box.y : p.y,
        w: moved ? Math.max(80, box.w) : w,
        h: moved ? Math.max(56, box.h) : h,
        points: [],
        from: null,
        to: null,
      };
      setWorkspace((w) =>
        updateCanvas(editDrafts(w, [...canvas.drafts, draft]), (c) => ({
          ...c,
          selectedDrafts: [draft.id],
        })),
      );
      openPanel({ kind: 'draft', id: draft.id });
      setBrush('select');
    }
    if (gesture.type === 'ink' && gesture.points.length > 1) {
      const id = newId();
      setWorkspace((w) =>
        updateCanvas(
          editDrafts(w, [
            ...canvas.drafts,
            {
              id,
              kind: 'ink',
              title: '',
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              points: gesture.points,
              from: null,
              to: null,
            },
          ]),
          (c) => ({ ...c, selectedDrafts: [id] }),
        ),
      );
    }
    if (gesture.type === 'connect') {
      if (moved)
        finishConnection(
          { id: gesture.from, kind: gesture.endpointKind },
          endpoint(document.elementFromPoint(e.clientX, e.clientY)),
        );
      else {
        setConnectFrom({ id: gesture.from, kind: gesture.endpointKind });
        notify('再选择另一个端点');
      }
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setGesture(null);
  };

  const focus = panel?.kind === 'round' ? panel : null;
  const focusRound = focus
    ? view.sessions[focus.sessionId]?.routes
        .find((r) => r.id === focus.routeId)
        ?.rounds.find((n) => n.id === focus.roundId)
    : null;
  return (
    <section
      ref={boardRef}
      className={`canvas-board paper-${canvas.paper} brush-${space ? 'hand' : brush}`}
      data-density={viewport.zoom < 0.68 ? 'overview' : 'detailed'}
      aria-label="Agent 生长画布"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setGesture(null)}
      style={{
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        backgroundSize: `${(canvas.paper === 'grid' ? 40 : 24) * viewport.zoom}px ${(canvas.paper === 'grid' ? 40 : 24) * viewport.zoom}px`,
      }}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
      >
        {canvas.projectRoots?.map((root) => {
          const bounds = projectRegionBounds(root, view, display, archive.indexes[root]);
          return (
            <section
              className="project-region"
              key={root}
              aria-label={`项目区域：${root.split('/').at(-1)}`}
              style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }}
            >
              <div className="project-region-title" title={root}>
                <BookOpen size={14} />
                <strong>{root.split('/').at(-1)}</strong>
              </div>
            </section>
          );
        })}
        <svg className="world-wires" aria-hidden="true" viewBox="-5000 -5000 15000 15000">
          <g>
            {sessions.flatMap((session) =>
              (session.connections ?? [])
                .filter((ref) => canvas.connectionIds?.includes(ref.id))
                .map((ref) => {
                  const from = display.positions['mcp:' + ref.id] ?? { x: 64, y: 64 },
                    to = agentPosition(session, view, display);
                  return (
                    <g key={ref.id + '/' + session.id} data-mcp-edge={ref.id + '/' + session.id}>
                      <path
                        className="mcp-wire"
                        d={`M ${from.x + 65} ${from.y + 45} C ${from.x + 180} ${from.y + 45} ${to.x - 50} ${to.y + 65} ${to.x + 55} ${to.y + 65}`}
                      />
                      <text x={(from.x + to.x) / 2 + 60} y={(from.y + to.y) / 2 + 40}>
                        MCP · v{ref.revision}
                      </text>
                    </g>
                  );
                }),
            )}
            {sessions
              .filter((session) => session.branch)
              .map((session) => {
                const origin = session.branch!;
                const entry = conversationRounds(view, origin.agentId).find(
                  (item) => item.round.id === origin.roundId,
                )!;
                if (!sessions.some((candidate) => candidate.id === entry.sessionId)) return null;
                const from = roundPosition(
                  view.sessions[entry.sessionId],
                  entry.routeId,
                  entry.round.id,
                  view,
                  display,
                );
                const to = agentPosition(session, view, display);
                const checkpoint =
                  origin.side === 'at'
                    ? view.events.find((event) => event.id === origin.eventId)!
                    : undefined;
                const node = checkpoint
                  ? runtimeLayout(entry.round).placed.find((item) =>
                      checkpoint.data.type === 'canvas.noted'
                        ? item.node.id === 'note:' + checkpoint.data.noteId
                        : 'callId' in checkpoint.data &&
                          item.node.id === 'tool:' + checkpoint.data.callId,
                    )
                  : undefined;
                const x =
                  from.x +
                  (origin.side === 'at'
                    ? node!.x + node!.width / 2
                    : origin.side === 'after'
                      ? recordWidth(entry.round)
                      : 0);
                const y = from.y + (origin.side === 'at' ? node!.y + node!.height : 40);
                return (
                  <g key={session.id + '/branch'}>
                    <title>从此对话创建上下文分支</title>
                    <path
                      className="context-branch-wire"
                      data-edge="context-branch"
                      d={`M ${x} ${y} C ${x} ${y + 80} ${to.x + 50} ${to.y - 80} ${to.x + 50} ${to.y}`}
                    />
                    <circle className="context-branch-point" cx={x} cy={y} r={4} />
                  </g>
                );
              })}
            {sessions.flatMap((session) =>
              session.routes
                .filter((_, i) => canvas.showPast || i === session.routes.length - 1)
                .flatMap((route) =>
                  route.rounds.map((round, index) => {
                    if (!index && route.originKind === 'user') return null;
                    const target = roundPosition(session, route.id, round.id, view, display),
                      root = agentPosition(session, view, display),
                      previous = index
                        ? roundPosition(
                            session,
                            route.id,
                            route.rounds[index - 1].id,
                            view,
                            display,
                          )
                        : root;
                    return (
                      <path
                        key={`${session.id}/${route.id}/${round.id}`}
                        className={route.originKind === 'user' ? 'correction-wire' : ''}
                        d={
                          index
                            ? `M ${previous.x + recordWidth(route.rounds[index - 1])} ${previous.y + 55} C ${previous.x + recordWidth(route.rounds[index - 1]) + 50} ${previous.y + 55} ${target.x - 45} ${target.y + 55} ${target.x} ${target.y + 55}`
                            : `M ${root.x + 92} ${root.y + 55} C ${root.x + 200} ${root.y + 55} ${target.x - 80} ${target.y + 55} ${target.x} ${target.y + 55}`
                        }
                      />
                    );
                  }),
                ),
            )}
            {sessions.flatMap((session) =>
              session.routes
                .filter((_, i) => canvas.showPast || i === session.routes.length - 1)
                .flatMap((route) =>
                  route.rounds.flatMap((round) =>
                    round.refs.map((ref, i) => {
                      const source = referencedCall(route, ref);
                      if (!source || !['returned', 'failed'].includes(source.call.status))
                        return null;
                      const from = roundPosition(session, route.id, source.round.id, view, display),
                        to = roundPosition(session, route.id, round.id, view, display),
                        x =
                          from.x +
                          (source.round.calls.length === 1 ? 165 : 80 + source.index * 170),
                        targetX = to.x + (round.refs.length === 1 ? 165 : 78 + i * 174),
                        bottom = from.y + roundHeight + 24;
                      return (
                        <path
                          key={`${session.id}/${route.id}/${round.id}/${ref}`}
                          data-edge="feedback"
                          className="feedback-wire"
                          d={`M ${x} ${from.y + 315} L ${x} ${bottom - 12} Q ${x} ${bottom} ${x + 12} ${bottom} L ${to.x - 35} ${bottom} Q ${to.x - 23} ${bottom} ${to.x - 23} ${bottom - 12} L ${to.x - 23} ${to.y + 61} Q ${to.x - 23} ${to.y + 49} ${to.x - 11} ${to.y + 49} L ${targetX} ${to.y + 49}`}
                        />
                      );
                    }),
                  ),
                ),
            )}
            {sessions.flatMap((session) =>
              session.routes
                .filter((route) => route.originKind === 'user' && route.rounds.length)
                .map((route) => {
                  const origin = route.origin!,
                    sourceSession = view.sessions[origin.sessionId],
                    from = origin.roundId
                      ? roundPosition(sourceSession, origin.routeId, origin.roundId, view, display)
                      : agentPosition(sourceSession, view, display),
                    to = roundPosition(session, route.id, route.rounds[0].id, view, display);
                  return (
                    <path
                      key={`${session.id}/${route.id}/fork`}
                      className="correction-wire"
                      d={`M ${from.x + roundWidth / 2} ${from.y + roundHeight} C ${from.x + roundWidth / 2} ${to.y - 55} ${to.x + roundWidth / 2} ${to.y - 55} ${to.x + roundWidth / 2} ${to.y}`}
                    />
                  );
                }),
            )}
            {Object.values(view.delegations)
              .filter(
                (link) =>
                  sessions.some((session) => session.id === link.parentId) &&
                  view.sessions[link.childId],
              )
              .map((link) => {
                const source = roundPosition(
                    view.sessions[link.parentId],
                    link.routeId,
                    link.roundId,
                    view,
                    display,
                  ),
                  target = agentPosition(view.sessions[link.childId], view, display);
                return (
                  <g key={link.id}>
                    <path
                      className="delegation-wire"
                      d={`M ${source.x + 245} ${source.y + 325} L ${source.x + 245} ${target.y - 35} Q ${source.x + 245} ${target.y} ${target.x + 85} ${target.y + 30}`}
                    />
                    <text x={source.x + 255} y={target.y - 100}>
                      {
                        {
                          sent: '待接收',
                          working: '工作中',
                          returned: '已回传',
                          adopted: '已采纳 · 有限范围',
                        }[link.status]
                      }
                    </text>
                  </g>
                );
              })}
            {view.collaborations
              .filter(
                (link) =>
                  sessions.some((s) => s.id === link.from) &&
                  sessions.some((s) => s.id === link.to),
              )
              .map((link) => {
                const a = agentPosition(view.sessions[link.from], view, display),
                  b = agentPosition(view.sessions[link.to], view, display);
                return (
                  <path
                    key={link.id}
                    className="delegation-wire"
                    d={`M ${a.x + 80} ${a.y + 80} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 60} ${b.x + 80} ${b.y + 80}`}
                  />
                );
              })}
          </g>
        </svg>
        {display.drafts.map((draft) => {
          if (draft.kind === 'ink')
            return (
              <svg
                key={draft.id}
                className="world-wires ink-wire"
                viewBox="-5000 -5000 15000 15000"
                data-draft={draft.id}
              >
                <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')} />
              </svg>
            );
          if (draft.kind === 'relation') {
            const from = display.drafts.find((d) => d.id === draft.from)!,
              to = display.drafts.find((d) => d.id === draft.to)!;
            return (
              <svg
                key={draft.id}
                className="world-wires draft-relation"
                viewBox="-5000 -5000 15000 15000"
                data-draft={draft.id}
              >
                <path
                  d={`M ${from.x + from.w / 2} ${from.y + from.h / 2} L ${to.x + to.w / 2} ${to.y + to.h / 2}`}
                />
              </svg>
            );
          }
          return (
            <button
              key={draft.id}
              data-draft={draft.id}
              className={`draft draft-${draft.kind} ${canvas.selectedDrafts.includes(draft.id) ? 'selected' : ''}`}
              aria-label={`草稿 ${draft.title}`}
              style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
              onClick={(e) => {
                if (!e.detail) openPanel({ kind: 'draft', id: draft.id });
              }}
            >
              {!['note', 'frame'].includes(draft.kind) && (
                <svg viewBox={`0 0 ${draft.w} ${draft.h}`} aria-hidden="true">
                  <path d={draftPath(draft)} />
                </svg>
              )}
              <span>{draft.title}</span>
              <small>草稿</small>
            </button>
          );
        })}
        {(canvas.connectionIds ?? []).map((id) => {
          const connection = mcp.connections.find((connection) => connection.id === id),
            at = display.positions['mcp:' + id] ?? { x: 64, y: 64 };
          return (
            <button
              className="mcp-node"
              key={id}
              data-mcp={id}
              aria-label={`配置接入：${connection?.name ?? 'MCP'}`}
              style={{ left: at.x, top: at.y }}
              onClick={(event) => {
                if (!event.detail) openPanel({ kind: 'mcp', id });
              }}
            >
              <McpIcon kind={connection?.kind ?? 'mcp'} size={54} />
              <strong>{connection?.name ?? 'MCP 接入'}</strong>
              <small>MCP</small>
            </button>
          );
        })}
        {sessions.map((session) => {
          const at = agentPosition(session, view, display),
            route = session.routes.at(-1),
            pose = sessionPose(session, view.events, panel);
          return (
            <div key={session.id} className="agent-root" style={{ left: at.x, top: at.y }}>
              <button
                className={`agent-character ${canvas.selectedSession === session.id ? 'selected' : ''}`}
                data-agent={session.id}
                aria-label={`与${session.config.name}对话`}
                onClick={(e) => {
                  if (!e.detail) {
                    setWorkspace((w) =>
                      updateCanvas(w, (c) => ({ ...c, selectedSession: session.id })),
                    );
                    openPanel(
                      route
                        ? { kind: 'chat', source: sourceFor(workspace, session.id, route.id, null) }
                        : { kind: 'agent', sessionId: session.id },
                    );
                  }
                }}
              >
                <Character avatar={session.config.avatar} pose={pose} />
                <span className="agent-name">{session.config.name}</span>
                {session.source === 'fixture' && (
                  <span className="agent-origin">
                    <CircleDashed size={10} /> 离线演示
                  </span>
                )}
                <MessageCircle className="character-chat" size={15} />
              </button>
            </div>
          );
        })}
        {sessions.flatMap((session) =>
          session.routes
            .filter((_, index) => canvas.showPast || index === session.routes.length - 1)
            .flatMap((route) =>
              route.rounds.map((round, index) => {
                const related =
                  !focus ||
                  (focus.sessionId === session.id &&
                    focus.routeId === route.id &&
                    (focus.roundId === round.id ||
                      focusRound?.refs.some((ref) => ref.startsWith(`${round.id}/`)) ||
                      round.refs.some((ref) => ref.startsWith(`${focus.roundId}/`))));
                return (
                  <RoundView
                    key={`${session.id}/${route.id}/${round.id}`}
                    session={session}
                    route={route}
                    round={round}
                    index={index}
                    position={roundPosition(session, route.id, round.id, view, display)}
                    current={round === route.rounds.at(-1)}
                    dimmed={!related}
                  />
                );
              }),
            ),
        )}
        {workspace.appearance.flowCharacters &&
          sessions.map((session) => {
            const route = session.routes.at(-1),
              round = route?.rounds.at(-1);
            if (!round || !route || session.config.avatar === 'none') return null;
            const at = roundPosition(session, route.id, round.id, view, display);
            return (
              <button
                key={session.id}
                className="flow-character"
                style={{ left: at.x + recordWidth(round) + 24, top: at.y + 115 }}
                aria-label={`查看${session.config.name}当前步骤`}
                onClick={() =>
                  openPanel({
                    kind: 'round',
                    sessionId: session.id,
                    routeId: route.id,
                    roundId: round.id,
                  })
                }
              >
                <Character
                  avatar={session.config.avatar}
                  height={120}
                  pose={executionPose(session.id, round, route, view.events)}
                />
              </button>
            );
          })}
        {canvas.projectRoots?.length ? (
          canvas.projectRoots.map((root) => (
            <ArchiveCanvas
              key={root}
              root={root}
              positionKey={projectArchiveKey(root)}
              position={projectArchivePosition(root, view, display)}
            />
          ))
        ) : (
          <ArchiveCanvas position={display.positions[archivePositionKey]} />
        )}
        {gesture &&
          ['box', 'draw'].includes(gesture.type) &&
          'start' in gesture &&
          'at' in gesture && (
            <div
              className="selection-box"
              style={{
                left: Math.min(gesture.start.x, gesture.at.x),
                top: Math.min(gesture.start.y, gesture.at.y),
                width: Math.abs(gesture.start.x - gesture.at.x),
                height: Math.abs(gesture.start.y - gesture.at.y),
              }}
            />
          )}
        {gesture?.type === 'ink' && (
          <svg
            className="world-wires ink-wire"
            viewBox="-5000 -5000 15000 15000"
            aria-hidden="true"
          >
            <polyline points={gesture.points.map((p) => `${p.x},${p.y}`).join(' ')} />
          </svg>
        )}
        {gesture?.type === 'connect' && (
          <svg className="world-wires" viewBox="-5000 -5000 15000 15000" aria-hidden="true">
            <path
              className="delegation-wire"
              d={`M ${gesture.start.x} ${gesture.start.y} L ${gesture.at.x} ${gesture.at.y}`}
            />
          </svg>
        )}
      </div>
      {!sessions.length && !canvas.drafts.length && (
        <div className="empty-canvas">
          <p>让第一个 Agent，从这里开始。</p>
          <button
            className="text-button"
            onClick={() => openPanel({ kind: 'create', point: { x: 64, y: 320 } })}
          >
            创建 Agent
          </button>
        </div>
      )}
      <button
        className="archive-entry"
        aria-label={
          canvas.projectRoots?.length || canvas.positions[archivePositionKey]
            ? '定位档案修改路线'
            : '项目档案'
        }
        onClick={() =>
          canvas.projectRoots?.length || canvas.positions[archivePositionKey]
            ? focusArchive()
            : openPanel({ kind: 'files' })
        }
      >
        {canvas.positions[archivePositionKey] ? (
          <BookOpen size={22} />
        ) : (
          <Character
            avatar="archivist"
            height={138}
            pose={panel?.kind === 'files' ? 'reading' : 'idle'}
          />
        )}
        <span>{canvas.positions[archivePositionKey] ? '档案路线' : '项目档案'}</span>
      </button>
      {brush !== 'select' && !panel && (
        <div className="brush-hint" aria-live="polite">
          {brush === 'connect'
            ? '连接两个 Agent，或两个草稿图形'
            : brush === 'hand'
              ? '拖动纸面 · Ctrl / ⌘ 滚轮缩放'
              : brush === 'eraser'
                ? '擦除手工草稿'
                : brush === 'agent'
                  ? '点击纸面，放置 Agent'
                  : '在纸面点击或拖动画笔'}
        </div>
      )}
      {children}
    </section>
  );
}
