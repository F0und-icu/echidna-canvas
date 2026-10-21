import { BookOpen, Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from './context';
import { visibleSessions } from '../model/projection';
import { removeDrafts, updateCanvas } from '../model/workspace';
import { attachRuntimeAgent } from '../runtime/placement';
import { McpIcon } from '../runtime/McpPanel';
import { useProjectArchive } from '../files/archive';
import { archivePositionKey } from '../files/archiveLayout';

export function CanvasContents() {
  const {
    workspace,
    canvas,
    view,
    live,
    mcp,
    setWorkspace,
    requestRemoval,
    focusAgent,
    focusArchive,
    openPanel,
  } = useApp();
  const archive = useProjectArchive();
  const sessions = visibleSessions(view, canvas.rootSessions, canvas.hiddenSessions);
  const visibleIds = new Set(
    visibleSessions(live, canvas.rootSessions, canvas.hiddenSessions).map((session) => session.id),
  );
  const availableAgents = Object.values(live.sessions).filter(
    (session) => !visibleIds.has(session.id),
  );
  const projects = canvas.projectRoots ?? [];
  const availableProjects = [
    ...new Set([
      ...(canvas.hiddenProjectRoots ?? []),
      ...Object.keys(archive.indexes),
      ...Object.values(live.sessions).flatMap((session) =>
        session.projectRoot ? [session.projectRoot] : [],
      ),
    ]),
  ].filter((root) => !projects.includes(root));
  const availableConnections = mcp.connections.filter(
    (connection) => !canvas.connectionIds?.includes(connection.id),
  );
  return (
    <div className="stack canvas-contents">
      <p className="fine-print">
        仅整理「{canvas.name}」中的内容。任务记录、文件和接入配置独立保留。
      </p>
      <button onClick={() => openPanel({ kind: 'trash' })}>
        回收站 · 临时目录（{workspace.trash?.length ?? 0}）
      </button>
      <section className="stack">
        <h3>
          <Bot size={16} /> Agent <small>{sessions.length}</small>
        </h3>
        {!sessions.length && <small>画布中没有 Agent。</small>}
        {sessions.map((session) => (
          <div className="canvas-content-row" key={session.id}>
            <button
              className="content-label"
              onClick={() => {
                setWorkspace((workspace) =>
                  updateCanvas(workspace, (canvas) => ({
                    ...canvas,
                    selectedSession: session.id,
                    selectedDrafts: [],
                  })),
                );
                focusAgent(session.id);
                openPanel({ kind: 'agent', sessionId: session.id });
              }}
            >
              {session.config.name}
            </button>
            <button
              className="icon-button"
              aria-label={`移除 Agent：${session.config.name}`}
              title="从当前画布移除"
              onClick={() => requestRemoval({ kind: 'agent', id: session.id })}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {availableAgents.length > 0 && (
          <details>
            <summary>可放回的 Agent · {availableAgents.length}</summary>
            {availableAgents.map((session) => (
              <div className="canvas-content-row" key={session.id}>
                <span>
                  {session.config.name}
                  <small>
                    {session.config.model} · {session.id.slice(-8)}
                  </small>
                </span>
                <button
                  aria-label={`放回 Agent：${session.config.name}`}
                  title="放回现有 Agent，不创建新任务"
                  onClick={() => {
                    setWorkspace((workspace) => attachRuntimeAgent(workspace, session.id));
                    focusAgent(session.id);
                  }}
                >
                  <Plus size={14} /> 放回
                </button>
              </div>
            ))}
          </details>
        )}
      </section>
      <section className="stack">
        <h3>
          <BookOpen size={16} /> 项目档案 <small>{projects.length}</small>
        </h3>
        {projects.map((root) => (
          <div className="canvas-content-row" key={root}>
            <button className="content-label" title={root} onClick={() => focusArchive(root)}>
              {root.split('/').at(-1) || root}
              <small>{root}</small>
            </button>
            <button
              className="icon-button"
              aria-label={`移除项目档案：${root}`}
              title="从当前画布移除"
              onClick={() => requestRemoval({ kind: 'project', root })}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {canvas.projectRoots === undefined &&
          !canvas.archiveHidden &&
          canvas.positions[archivePositionKey] && (
            <div className="canvas-content-row">
              <span>当前项目档案</span>
              <button
                className="icon-button"
                aria-label="移除当前项目档案"
                onClick={() => requestRemoval({ kind: 'project' })}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        {canvas.archiveHidden && <button onClick={() => focusArchive()}>放回当前项目档案</button>}
        {availableProjects.length > 0 && (
          <details>
            <summary>可放回的项目 · {availableProjects.length}</summary>
            {availableProjects.map((root) => (
              <div className="canvas-content-row" key={root}>
                <span title={root}>
                  {root.split('/').at(-1) || root}
                  <small>{root}</small>
                </span>
                <button aria-label={`放回项目档案：${root}`} onClick={() => focusArchive(root)}>
                  <Plus size={14} /> 放回
                </button>
              </div>
            ))}
          </details>
        )}
      </section>
      <section className="stack">
        <h3>
          <McpIcon kind="mcp" size={16} /> MCP 接入{' '}
          <small>{canvas.connectionIds?.length ?? 0}</small>
        </h3>
        {mcp.error && (
          <div className="stack">
            <p role="alert">接入配置暂时不可用：{mcp.error}</p>
            <button onClick={() => void mcp.refresh()}>重新读取接入配置</button>
          </div>
        )}
        {(canvas.connectionIds ?? []).map((id) => {
          const connection = mcp.connections.find((connection) => connection.id === id);
          return (
            <div className="canvas-content-row" key={id}>
              <button className="content-label" onClick={() => openPanel({ kind: 'mcp', id })}>
                {connection?.name ?? 'MCP 接入'}
              </button>
              <button
                className="icon-button"
                aria-label={`移除 MCP：${connection?.name ?? id}`}
                title="移除图标，保留绑定"
                onClick={() => requestRemoval({ kind: 'mcp', id })}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        {availableConnections.length > 0 && (
          <details>
            <summary>可放回的接入 · {availableConnections.length}</summary>
            {availableConnections.map((connection) => (
              <div className="canvas-content-row" key={connection.id}>
                <span>{connection.name}</span>
                <button
                  aria-label={`放回 MCP：${connection.name}`}
                  onClick={() =>
                    setWorkspace((workspace) =>
                      updateCanvas(workspace, (canvas) => ({
                        ...canvas,
                        connectionIds: [...(canvas.connectionIds ?? []), connection.id],
                        positions: {
                          ...canvas.positions,
                          ['mcp:' + connection.id]: canvas.positions['mcp:' + connection.id] ?? {
                            x: (160 - canvas.viewport.x) / canvas.viewport.zoom,
                            y: (250 - canvas.viewport.y) / canvas.viewport.zoom,
                          },
                        },
                      })),
                    )
                  }
                >
                  <Plus size={14} /> 放回
                </button>
              </div>
            ))}
          </details>
        )}
        <button className="text-button" onClick={() => openPanel({ kind: 'mcp' })}>
          管理接入配置
        </button>
      </section>
      <section className="stack">
        <h3>
          <Pencil size={16} /> 手工图形 <small>{canvas.drafts.length}</small>
        </h3>
        {canvas.drafts.map((draft) => (
          <div className="canvas-content-row" key={draft.id}>
            <span>{draft.title || (draft.kind === 'ink' ? '自由笔迹' : '草稿连线')}</span>
            <button
              className="icon-button"
              aria-label={`删除草稿：${draft.title || draft.kind}`}
              title="删除手工图形，可撤销"
              onClick={() => setWorkspace((workspace) => removeDrafts(workspace, [draft.id]))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <small>删除图形时一并删除连接到它的草稿线，可用 ⌘/Ctrl Z 撤销。</small>
      </section>
      <details>
        <summary>删除范围</summary>
        <p>手工图形、批注、自由笔迹和草稿连线可删除。整张画布的删除入口在「画布」菜单。</p>
        <p>
          Agent、档案和 MCP
          节点只能从画布移除。对话、工具回执、事实连线、文件版本、磁盘文件、认证和接入配置不在删除范围内。
        </p>
        <p>断开 MCP 请使用接入配置中的解绑操作；停止任务请使用对话中的打断操作。</p>
      </details>
    </div>
  );
}
