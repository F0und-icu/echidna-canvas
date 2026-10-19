import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  Diamond,
  Eraser,
  FileText,
  Hand,
  Menu,
  MousePointer2,
  Pencil,
  Scan,
  Square,
  Type,
  Palette,
  Undo2,
  Redo2,
  Focus,
  Play,
  Pause,
  StepForward,
  ListTree,
  CornerLeftUp,
  Maximize,
} from 'lucide-react';
import type { Brush } from '../model/schema';
import {
  deliveryBlock,
  duplicateCanvas,
  emptyCanvas,
  moveDraftHistory,
  newId,
  openScenario,
  planKey,
  scenarioNames,
  updateCanvas,
} from '../model/workspace';
import { project } from '../model/projection';
import { useApp } from './context';
import { useOutsideDismiss } from './useOutsideDismiss';

const tools = [
  ['select', '选择', 'V', MousePointer2],
  ['hand', '漫游', 'H', Hand],
  ['agent', 'Agent', 'A', Bot],
  ['action', '行动', 'R', Square],
  ['decision', '判断', 'D', Diamond],
  ['material', '材料', 'E', FileText],
  ['connect', '连线', 'L', ArrowUpRight],
  ['frame', '区域', 'F', Scan],
  ['note', '批注', 'T', Type],
  ['ink', '自由画笔', 'P', Pencil],
  ['eraser', '橡皮', 'X', Eraser],
] as const;

export function Chrome({
  brush,
  setBrush,
  running,
  togglePlayback,
  step,
  fit,
  zoom,
}: {
  brush: Brush;
  setBrush: (brush: Brush) => void;
  running: boolean;
  togglePlayback: () => void;
  step: () => void;
  fit: () => void;
  zoom: (factor: number) => void;
}) {
  const { workspace, canvas, view, live, setWorkspace, openPanel, focusAgent, focusArchive } =
    useApp();
  const [menu, setMenu] = useState<string | null>(null);
  const menuElement = useRef<HTMLElement>(null),
    menuTriggers = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menu !== null, [menuElement, menuTriggers], () => setMenu(null));
  useEffect(() => {
    if (!menu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenu(null);
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [menu]);
  const selected = canvas.selectedSession ? view.sessions[canvas.selectedSession] : undefined;
  const liveSelected = canvas.selectedSession ? live.sessions[canvas.selectedSession] : undefined;
  const route = liveSelected?.routes.at(-1);
  const key = liveSelected && route ? planKey(liveSelected.id, route.id) : null;
  const plan = key ? workspace.replays[key] : undefined;
  const blocked = liveSelected?.runtime
    ? '运行时事件由本地服务接收'
    : key
      ? deliveryBlock(workspace, key, live)
      : '先选择一个 Agent';
  const act = (action: () => void) => {
    setMenu(null);
    action();
  };
  const section = (name: string, action: () => void) => (
    <button key={name} type="button" onClick={() => act(action)}>
      {name}
    </button>
  );

  return (
    <>
      <div className="canvas-switcher" ref={menuTriggers}>
        <button
          className="icon-button menu-trigger"
          aria-label="主菜单"
          aria-expanded={menu !== null}
          onClick={() => setMenu(menu ? null : 'home')}
        >
          <Menu size={18} />
        </button>
        <button
          className="canvas-title"
          aria-label="切换画布"
          onClick={() => setMenu(menu === 'canvases' ? null : 'canvases')}
        >
          {canvas.name}
          <ChevronDown size={14} />
        </button>
      </div>
      <nav className="brushes" aria-label="画笔">
        {tools.map(([id, title, shortcut, Icon], i) => (
          <button
            key={id}
            type="button"
            className={i === 2 || i === 6 ? 'tool-divider' : ''}
            aria-label={`${title}工具 ${shortcut}`}
            aria-pressed={brush === id}
            title={`${title} · ${shortcut}`}
            onClick={() => {
              setMenu(null);
              setBrush(id);
            }}
          >
            <Icon size={17} />
            <small>{shortcut}</small>
          </button>
        ))}
      </nav>
      <button
        className="appearance-trigger icon-button"
        aria-label="主题与外观"
        onClick={() => {
          setMenu(null);
          openPanel({ kind: 'appearance' });
        }}
      >
        <Palette size={19} />
      </button>
      {menu && (
        <nav className="main-menu" ref={menuElement} aria-label="菜单内容">
          {menu === 'home' && (
            <>
              <div className="menu-brand">Echidna</div>
              {[
                ['canvases', '画布'],
                ['scenarios', '示例场景'],
                ['view', '视图'],
                ['edit', '编辑'],
              ].map(([id, label]) => (
                <button key={id} onClick={() => setMenu(id)}>
                  {label}
                  <span aria-hidden="true">›</span>
                </button>
              ))}
              <hr />
              {section('项目档案', () => openPanel({ kind: 'files' }))}
              {section('定位档案修改路线', () => {
                openPanel(null);
                focusArchive();
              })}
              {section('Agent 连接', () => openPanel({ kind: 'runtime' }))}
              {section('接入与 MCP', () => openPanel({ kind: 'mcp' }))}
              {section('运行与恢复', () => openPanel({ kind: 'execution' }))}
              {section('交接记录', () => openPanel({ kind: 'handoffs' }))}
              {section('任务、能力与预算', () => openPanel({ kind: 'budget' }))}
              {section('连线与来源', () => openPanel({ kind: 'relations' }))}
              {section('主题与外观', () => openPanel({ kind: 'appearance' }))}
            </>
          )}
          {menu !== 'home' && (
            <button className="menu-back" onClick={() => setMenu('home')}>
              ‹ 返回菜单
            </button>
          )}
          {menu === 'canvases' && (
            <>
              {section('新建画布', () => {
                setWorkspace((w) => {
                  const c = emptyCanvas(newId(), '新画布');
                  return { ...w, canvases: [...w.canvases, c], activeCanvas: c.id };
                });
                openPanel(null);
              })}
              {section('复制当前画布', () => {
                setWorkspace(duplicateCanvas);
                openPanel(null);
              })}
              <label className="menu-field">
                画布名称
                <input
                  aria-label="画布名称"
                  value={canvas.name}
                  onChange={(e) =>
                    setWorkspace((w) =>
                      updateCanvas(w, (c) => ({ ...c, name: e.target.value || '未命名画布' })),
                    )
                  }
                />
              </label>
              <hr />
              {workspace.canvases.map((c) => (
                <button
                  key={c.id}
                  aria-current={c.id === canvas.id ? 'page' : undefined}
                  onClick={() =>
                    act(() => {
                      setWorkspace((w) => ({ ...w, activeCanvas: c.id }));
                      openPanel(null);
                    })
                  }
                >
                  {c.name}
                  <span>{c.id === canvas.id ? '✓' : ''}</span>
                </button>
              ))}
              <p>副本引用同一份演示记录。</p>
            </>
          )}
          {menu === 'scenarios' &&
            Object.entries(scenarioNames).map(([id, name]) =>
              section(name, () => {
                const next = openScenario(workspace, id as keyof typeof scenarioNames);
                setWorkspace(next);
                if (id === 'steering') {
                  const c = next.canvases.find((c) => c.id === next.activeCanvas)!,
                    session = project(next.events).sessions[c.selectedSession!],
                    route = session.routes.at(-1)!;
                  openPanel({
                    kind: 'chat',
                    source: {
                      sessionId: session.id,
                      routeId: route.id,
                      roundId: route.rounds.at(-1)!.id,
                      eventSeq: next.events.length,
                    },
                  });
                } else openPanel(null);
              }),
            )}
          {menu === 'view' && (
            <>
              {section('显示全部', fit)}
              {section('聚焦当前 Agent', () => {
                if (canvas.selectedSession) focusAgent(canvas.selectedSession, true);
              })}
              {section(canvas.showPast ? '隐藏旧路线' : '显示旧路线', () =>
                setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, showPast: !c.showPast }))),
              )}
              {section(
                workspace.appearance.flowCharacters ? '隐藏流程动作形象' : '显示流程动作形象',
                () =>
                  setWorkspace((w) => ({
                    ...w,
                    appearance: { ...w.appearance, flowCharacters: !w.appearance.flowCharacters },
                  })),
              )}
              {section(workspace.appearance.motion ? '关闭角色动画' : '开启角色动画', () =>
                setWorkspace((w) => ({
                  ...w,
                  appearance: { ...w.appearance, motion: !w.appearance.motion },
                })),
              )}
            </>
          )}
          {menu === 'edit' && (
            <>
              <button
                disabled={!canvas.undo.length}
                onClick={() => setWorkspace((w) => moveDraftHistory(w, false))}
              >
                撤销手工图形
              </button>
              <button
                disabled={!canvas.redo.length}
                onClick={() => setWorkspace((w) => moveDraftHistory(w, true))}
              >
                重做手工图形
              </button>
              <p>执行记录不受图形撤销影响。</p>
            </>
          )}
        </nav>
      )}
      <div className="view-controls floating-bar">
        <button
          aria-label="撤销手工图形"
          disabled={!canvas.undo.length}
          onClick={() => setWorkspace((w) => moveDraftHistory(w, false))}
        >
          <Undo2 size={15} />
        </button>
        <button
          aria-label="重做手工图形"
          disabled={!canvas.redo.length}
          onClick={() => setWorkspace((w) => moveDraftHistory(w, true))}
        >
          <Redo2 size={15} />
        </button>
        <span className="bar-separator" />
        <button
          aria-label="聚焦当前 Agent"
          disabled={!canvas.selectedSession}
          onClick={() => focusAgent(canvas.selectedSession!, true)}
        >
          <Focus size={16} />
        </button>
        <button
          aria-pressed={canvas.follow}
          onClick={() => setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, follow: !c.follow })))}
        >
          跟随
        </button>
      </div>
      {liveSelected && route && (
        <div className="replay floating-bar" aria-label="模型轮次与事件回放">
          <button
            className="replay-name"
            onClick={() =>
              openPanel({
                kind: 'chat',
                source: {
                  sessionId: liveSelected.id,
                  routeId: route!.id,
                  roundId: null,
                  eventSeq: canvas.historySeq ?? workspace.events.length,
                },
              })
            }
          >
            {liveSelected.config.name}
          </button>
          <select
            aria-label={liveSelected.runtime ? '查看 Agent 回合' : '查看模型采样轮次'}
            value={canvas.historySeq === null ? 'live' : String(canvas.historySeq)}
            onChange={(e) =>
              setWorkspace((w) =>
                updateCanvas(w, (c) => ({
                  ...c,
                  historySeq: e.target.value === 'live' ? null : Number(e.target.value),
                  follow: false,
                })),
              )
            }
          >
            <option value="live">实时视图</option>
            {selected?.routes.flatMap((r) =>
              r.rounds.map((n, i) => (
                <option key={`${r.id}/${n.id}`} value={n.lastSeq}>
                  {r.id} · {n.unit === 'turn' ? '回合' : '采样'} {String(i + 1).padStart(2, '0')}
                </option>
              )),
            )}
            {canvas.historySeq !== null &&
              !selected?.routes.some((r) =>
                r.rounds.some((n) => n.lastSeq === canvas.historySeq),
              ) && <option value={canvas.historySeq}>历史 #{canvas.historySeq}</option>}
          </select>
          <button
            aria-label={running ? '暂停事件回放' : '继续事件回放'}
            disabled={!!blocked && !running}
            title={blocked ?? undefined}
            onClick={togglePlayback}
          >
            {running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            aria-label="接收下一条演示事件"
            disabled={!!blocked}
            title={blocked ?? undefined}
            onClick={step}
          >
            <StepForward size={16} />
          </button>
          <span className="counter">
            {plan
              ? `${plan.cursor} / ${plan.steps.length}`
              : liveSelected.runtime
                ? '运行时记录'
                : '随父任务'}
          </span>
          <button aria-label="查看原始事件" onClick={() => openPanel({ kind: 'events' })}>
            <ListTree size={16} />
          </button>
          {liveSelected.parentId && (
            <button
              aria-label="返回父任务"
              onClick={() => {
                setWorkspace((w) =>
                  updateCanvas(w, (c) => ({ ...c, selectedSession: liveSelected.parentId })),
                );
                focusAgent(liveSelected.parentId!, true);
                openPanel(null);
              }}
            >
              <CornerLeftUp size={16} />
            </button>
          )}
          {canvas.historySeq !== null && (
            <button
              className="history-return"
              aria-label="返回实时视图"
              onClick={() =>
                setWorkspace((w) => updateCanvas(w, (c) => ({ ...c, historySeq: null })))
              }
            >
              历史 · {workspace.events.length - canvas.historySeq} 条新记录
            </button>
          )}
        </div>
      )}
      <div className="zoom-controls floating-bar">
        <button aria-label="缩小画布" onClick={() => zoom(0.85)}>
          −
        </button>
        <output>{Math.round(canvas.viewport.zoom * 100)}%</output>
        <button aria-label="放大画布" onClick={() => zoom(1 / 0.85)}>
          +
        </button>
        <button aria-label="显示全部" onClick={fit}>
          <Maximize size={13} />
        </button>
      </div>
      <div className="brand-signature">Echidna</div>
      <div className="demo-label">
        {selected
          ? selected.source === 'fixture'
            ? '离线演示 · 固定示例记录'
            : selected.runtime
              ? '运行时记录 · 公开标注与实际回执'
              : '手工 Agent · 画布记录'
          : '本地画布'}
      </div>
    </>
  );
}
