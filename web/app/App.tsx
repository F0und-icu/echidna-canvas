import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Canvas } from '../canvas/Canvas';
import { agentPosition, roundPosition, zoomAt } from '../canvas/geometry';
import { recordHeight, recordWidth } from '../records/runtimeLayout';
import { project, visibleSessions } from '../model/projection';
import { loadSavedWorkspace, saveWorkspace, type LoadResult } from '../model/storage';
import type { Brush, Workspace } from '../model/schema';
import {
  createWorkspace,
  currentCanvas,
  deliveryBlock,
  moveDraftHistory,
  planKey,
  receiveNext,
  removeDrafts,
  updateCanvas,
} from '../model/workspace';
import { AppContext, type Panel } from './context';
import { Chrome } from './Chrome';
import { Inspector } from './Inspector';
import { useRuntime } from '../runtime/useRuntime';
import { ProjectArchiveProvider, useProjectArchive } from '../files/archive';
import { archiveBounds, archivePositionKey, initialArchivePosition } from '../files/archiveLayout';
import { projectArchivePosition, projectRegionBounds } from '../canvas/projectRegions';
import { useMcp } from '../runtime/useMcp';
import { removeCanvasItem, type RemovalTarget } from '../model/deletion';
import { RemovalDialog } from './RemovalDialog';

export function App() {
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  useEffect(() => {
    void loadSavedWorkspace().then(setLoaded);
  }, []);
  if (loaded === null) return <main className="startup-error">正在读取本地画布…</main>;
  if (!loaded.ok)
    return (
      <main className="startup-error">
        <h1>浏览器记录暂时无法打开</h1>
        <p>原记录已保留，没有自动重置。</p>
        <pre>{loaded.message}</pre>
        {loaded.raw !== null && (
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([loaded.raw!], { type: 'application/json' }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = 'echidna-canvas-recovery.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载原记录
          </button>
        )}
        <button
          onClick={() => {
            const workspace = createWorkspace();
            void saveWorkspace(workspace)
              .then(() => setLoaded({ ok: true, workspace }))
              .catch((error) => setLoaded({ ok: false, raw: loaded.raw, message: String(error) }));
          }}
        >
          重置本地演示
        </button>
      </main>
    );
  return (
    <ProjectArchiveProvider>
      <WorkspaceApp initial={loaded.workspace} />
    </ProjectArchiveProvider>
  );
}

function WorkspaceApp({ initial }: { initial: Workspace }) {
  const [workspace, setWorkspace] = useState(initial),
    [panel, openPanel] = useState<Panel | null>(null),
    [brush, setBrush] = useState<Brush>('select');
  const [removal, requestRemoval] = useState<RemovalTarget | null>(null);
  const runtime = useRuntime(workspace, setWorkspace);
  const mcp = useMcp(runtime.connected);
  const archive = useProjectArchive();
  const [running, setRunning] = useState<string | null>(null),
    [toast, setToast] = useState(''),
    [saveError, setSaveError] = useState(''),
    [savedWorkspace, setSavedWorkspace] = useState<Workspace | null>(null);
  const boardRef = useRef<HTMLElement>(null),
    canvas = currentCanvas(workspace);
  const live = useMemo(() => project(workspace.events), [workspace.events]);
  const view = useMemo(
    () => (canvas.historySeq === null ? live : project(workspace.events, canvas.historySeq)),
    [live, workspace.events, canvas.historySeq],
  );
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void saveWorkspace(workspace)
        .then(() => {
          setSaveError('');
          setSavedWorkspace(workspace);
        })
        .catch((error) => {
          setSaveError(`浏览器保存失败：${String(error)}`);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [workspace]);
  useEffect(() => {
    // Flush the current offline document before a reload; this never resumes a task.
    const flush = () => {
      void saveWorkspace(workspace).catch((error) => {
        setSaveError(`浏览器保存失败：${String(error)}`);
      });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [workspace]);
  useEffect(() => {
    setRunning(null);
    setBrush('select');
  }, [canvas.id]);
  const focusAgent = useCallback((id: string, latest = false, preserveZoom = false) => {
    const board = boardRef.current!;
    setWorkspace((w) => {
      const c = currentCanvas(w),
        p = project(w.events, c.historySeq ?? w.events.length),
        session = p.sessions[id];
      if (!session) return w; // A history view can predate this Agent's creation.
      const route = session.routes.at(-1),
        round = latest ? route?.rounds.at(-1) : undefined;
      const at =
        round && route
          ? roundPosition(session, route.id, round.id, p, c)
          : agentPosition(session, p, c);
      if (round?.unit === 'turn') at.x += Math.max(0, recordWidth(round) - 330);
      const zoom = preserveZoom ? c.viewport.zoom : 1;
      return updateCanvas(w, (current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          zoom,
          x: board.clientWidth * (board.clientWidth < 700 ? 0.18 : 0.38) - at.x * zoom,
          y: Math.max(165, board.clientHeight * 0.28) - at.y * zoom,
        },
      }));
    });
  }, []);
  const focusArchive = (root?: string) => {
    setWorkspace((w) =>
      updateCanvas(w, (c) => {
        const agentRoot = c.selectedSession
          ? view.sessions[c.selectedSession]?.projectRoot
          : undefined;
        const selectedRoot =
          root ??
          (c.projectRoots?.length
            ? agentRoot && c.projectRoots.includes(agentRoot)
              ? agentRoot
              : c.projectRoots[0]
            : undefined);
        const at = selectedRoot
          ? projectArchivePosition(selectedRoot, view, c)
          : (c.positions[archivePositionKey] ?? initialArchivePosition(view, c));
        return {
          ...c,
          follow: false,
          archiveHidden: false,
          ...(selectedRoot
            ? {
                projectRoots: [...new Set([...(c.projectRoots ?? []), selectedRoot])],
                hiddenProjectRoots: c.hiddenProjectRoots?.filter(
                  (hidden) => hidden !== selectedRoot,
                ),
              }
            : { projectRoots: undefined }),
          positions: selectedRoot ? c.positions : { ...c.positions, [archivePositionKey]: at },
          viewport: { zoom: 1, x: 28 - at.x, y: 160 - at.y },
        };
      }),
    );
  };
  useEffect(() => {
    if (!canvas.follow || canvas.historySeq !== null || !canvas.selectedSession) return;
    focusAgent(canvas.selectedSession, true, true);
    // View-only changes must not trigger follow or move the viewport again.
  }, [workspace.events.length, focusAgent]);
  useEffect(() => {
    if (!running) return;
    if (deliveryBlock(workspace, running, live)) {
      setRunning(null);
      return;
    }
    const timer = setTimeout(() => setWorkspace((w) => receiveNext(w, running)), 750);
    return () => clearTimeout(timer);
  }, [running, workspace, live]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        document.querySelector('dialog[open]') ||
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],[role="textbox"]',
        )
      )
        return;
      const key = e.key.toLowerCase(),
        keys: Record<string, Brush> = {
          v: 'select',
          h: 'hand',
          a: 'agent',
          r: 'action',
          d: 'decision',
          e: 'material',
          l: 'connect',
          f: 'frame',
          t: 'note',
          p: 'ink',
          x: 'eraser',
        };
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        setWorkspace((w) => moveDraftHistory(w, e.shiftKey));
      } else if (key === 'escape') {
        openPanel(null);
        setBrush('select');
      } else if (['backspace', 'delete'].includes(key)) {
        if (canvas.selectedDrafts.length && (!panel || panel.kind === 'draft')) {
          e.preventDefault();
          setWorkspace((w) => removeDrafts(w, currentCanvas(w).selectedDrafts));
          openPanel(null);
        } else if (
          canvas.selectedSession &&
          (!panel || ['agent', 'chat', 'runtime-agent'].includes(panel.kind))
        ) {
          e.preventDefault();
          requestRemoval({ kind: 'agent', id: canvas.selectedSession });
        }
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && keys[key]) setBrush(keys[key]);
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [workspace, panel, canvas]);
  const zoom = (factor: number) =>
    setWorkspace((w) =>
      updateCanvas(w, (c) => ({
        ...c,
        follow: false,
        viewport: zoomAt(c.viewport, factor, {
          x: boardRef.current!.clientWidth / 2,
          y: boardRef.current!.clientHeight / 2,
        }),
      })),
    );
  const fit = () => {
    const board = boardRef.current!,
      sessions = visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions);
    const archiveEntry = board.querySelector<HTMLElement>('.archive-entry')!;
    const rightInset = archiveEntry.offsetWidth
      ? board.clientWidth - archiveEntry.offsetLeft + 24
      : 50;
    const availableWidth = board.clientWidth - 50 - rightInset;
    const boxes = [
      ...(canvas.connectionIds ?? []).map((id) => ({
        ...(canvas.positions['mcp:' + id] ?? { x: 64, y: 64 }),
        w: 130,
        h: 125,
      })),
      ...(canvas.projectRoots ?? []).map((root) =>
        projectRegionBounds(root, view, canvas, archive.indexes[root]),
      ),
      ...(canvas.projectRoots === undefined &&
      !canvas.archiveHidden &&
      canvas.positions[archivePositionKey] &&
      archive.index
        ? [{ ...canvas.positions[archivePositionKey], ...archiveBounds(archive.index.files) }]
        : []),
      ...sessions.flatMap((session) => [
        { ...agentPosition(session, view, canvas), w: 150, h: 212 },
        ...session.routes
          .filter((_, i) => canvas.showPast || i === session.routes.length - 1)
          .flatMap((route) =>
            route.rounds.map((round) => ({
              ...roundPosition(session, route.id, round.id, view, canvas),
              w:
                recordWidth(round) +
                (workspace.appearance.flowCharacters &&
                session.config.avatar !== 'none' &&
                round === session.routes.at(-1)?.rounds.at(-1)
                  ? 144
                  : 0),
              h: recordHeight(round),
            })),
          ),
      ]),
      ...canvas.drafts.filter((draft) => !['ink', 'relation'].includes(draft.kind)),
    ];
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((box) => box.x)),
      minY = Math.min(...boxes.map((box) => box.y)),
      maxX = Math.max(...boxes.map((box) => box.x + box.w)),
      maxY = Math.max(...boxes.map((box) => box.y + box.h));
    const zoom = Math.max(
      0.3,
      Math.min(1, availableWidth / (maxX - minX), (board.clientHeight - 200) / (maxY - minY)),
    );
    setWorkspace((w) =>
      updateCanvas(w, (c) => ({
        ...c,
        follow: false,
        viewport: {
          zoom,
          x: 50 + (availableWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
          y: 118 - minY * zoom,
        },
      })),
    );
  };
  const selected = canvas.selectedSession ? live.sessions[canvas.selectedSession] : undefined,
    route = selected?.routes.at(-1),
    selectedKey = selected && route ? planKey(selected.id, route.id) : null;
  const css = Object.fromEntries(
    ['bg', 'paper', 'title', 'text', 'muted', 'primary', 'green', 'line', 'code'].map((name, i) => [
      `--ec-${name}`,
      workspace.appearance.colors[i],
    ]),
  ) as CSSProperties;
  return (
    <AppContext.Provider
      value={{
        workspace,
        canvas,
        view,
        live,
        setWorkspace,
        panel,
        openPanel,
        notify,
        requestRemoval,
        focusAgent,
        focusArchive,
        runtime,
        mcp,
      }}
    >
      <main
        className="echidna-app"
        data-motion={workspace.appearance.motion ? 'on' : 'off'}
        style={{ ...css, colorScheme: workspace.appearance.theme === 'night' ? 'dark' : 'light' }}
      >
        <Canvas brush={brush} setBrush={setBrush} boardRef={boardRef}>
          <Chrome
            brush={brush}
            setBrush={setBrush}
            running={running === selectedKey && running !== null}
            togglePlayback={() => {
              if (running === selectedKey) setRunning(null);
              else if (selectedKey && !deliveryBlock(workspace, selectedKey, live))
                setRunning(selectedKey);
            }}
            step={() => {
              if (selectedKey) setWorkspace((w) => receiveNext(w, selectedKey));
            }}
            fit={fit}
            zoom={zoom}
          />
          <Inspector />
          {removal && (
            <RemovalDialog
              target={removal}
              onCancel={() => requestRemoval(null)}
              onConfirm={() => {
                setWorkspace((workspace) => removeCanvasItem(workspace, removal));
                requestRemoval(null);
                openPanel(null);
                notify(
                  removal.kind === 'canvas'
                    ? '画布已移入回收站，任务记录保留'
                    : '已从画布移除，可在回收站恢复',
                );
              }}
            />
          )}
          <span className="save-status" role="status">
            {saveError || (savedWorkspace === workspace ? '已保存在此浏览器' : '保存中…')}
          </span>
          {toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )}
        </Canvas>
      </main>
    </AppContext.Provider>
  );
}
