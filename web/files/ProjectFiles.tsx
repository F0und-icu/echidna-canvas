import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  FileText,
  Folder,
  GitBranch,
  History,
  PanelLeft,
  Pencil,
  RefreshCw,
  Save,
  WrapText,
  FolderOpen,
  X,
} from 'lucide-react';
import {
  fileListSchema,
  historicalFileSchema,
  projectFileSchema,
  type FileList,
  type HistoricalFile,
  type ProjectFile,
  fileProjectsSchema,
  type FileProjects,
} from '../../contracts/files';
import { requestRuntime } from '../runtime/connection';
import { useApp } from '../app/context';
import { MarkdownReply } from '../records/MarkdownReply';
import { useProjectArchive } from './archive';
import { RevisionGraph } from './RevisionGraph';
import { FileTree } from './FileTree';
import { CodeEditor, type EditorPosition } from './CodeEditor';
import { bufferDirty, newFileBuffer, refreshFileBuffer, type FileBuffer } from './fileBuffers';
import { FileDiff } from './FileDiff';
import { requestProject } from './api';
import { ProjectPicker } from './ProjectPicker';
import { useDialogBackdrop } from '../app/useDialogBackdrop';

type FileHistory = {
  id: number;
  version: number;
  file: HistoricalFile;
  previous: HistoricalFile | null;
};
async function readFileHistory(root: string, file: ProjectFile, id: number): Promise<FileHistory> {
  const index = file.revisions.findIndex((revision) => revision.id === id);
  if (index === -1) throw new Error('所选版本不属于当前文件记录。');
  const previous = file.revisions[index + 1];
  const read = (revisionId: number) =>
    requestProject(
      root,
      `/file-revision?path=${encodeURIComponent(file.path)}&revision=${revisionId}`,
    ).then((value) => historicalFileSchema.parse(value));
  const [selected, base] = await Promise.all([
    read(id),
    previous ? read(previous.id) : Promise.resolve(null),
  ]);
  return { id, version: file.revisions.length - index, file: selected, previous: base };
}

const name = (path: string) => path.split('/').at(-1) || path;
export function ProjectFiles({
  onClose,
  initialPath,
  initialRevision,
  initialRoot,
}: {
  onClose: () => void;
  initialPath?: string;
  initialRevision?: number;
  initialRoot?: string;
}) {
  const { focusArchive } = useApp();
  const { remember, switchProject } = useProjectArchive();
  const dialog = useRef<HTMLDialogElement>(null);
  const routeScroll = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<FileList | null>(null);
  const [projects, setProjects] = useState<FileProjects | null>(null);
  const [projectPicker, setProjectPicker] = useState(false),
    [pendingProject, setPendingProject] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [tab, setTab] = useState<'content' | 'history'>('content');
  const [historical, setHistorical] = useState<FileHistory | null>(null);
  const [comparison, setComparison] = useState<'previous' | 'current'>('previous');
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingLeave, setPendingLeave] = useState<'close' | 'canvas' | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false),
    [sidebarWidth, setSidebarWidth] = useState(280);
  const [fontSize, setFontSize] = useState(15),
    [wrap, setWrap] = useState(true);
  const [sourceView, setSourceView] = useState(false);
  const [position, setPosition] = useState<EditorPosition>({ line: 1, column: 1, lines: 1 });
  const buffer = activePath ? buffers[activePath] : undefined;
  const file = buffer?.file;
  const dirty = buffer ? bufferDirty(buffer) : false;
  const dirtyPaths = Object.keys(buffers).filter((path) => bufferDirty(buffers[path]));
  const isMarkdown = file && /\.(md|markdown)$/i.test(file.path);

  useEffect(() => {
    if (sidebarOpen)
      dialog.current!.querySelector<HTMLInputElement>('.file-tree-search input')?.focus();
  }, [sidebarOpen]);

  useEffect(() => {
    if (tab !== 'history' || !historical) return;
    const container = routeScroll.current!;
    const center = () => {
      const node = container.querySelector<HTMLElement>(`[data-revision="${historical.id}"]`)!;
      container.scrollLeft = node.offsetLeft - container.clientWidth / 2;
    };
    const observer = new ResizeObserver(center);
    observer.observe(container);
    center();
    return () => observer.disconnect();
  }, [tab, historical?.id]);

  useEffect(() => {
    dialog.current!.showModal();
    let active = true;
    void (async () => {
      try {
        await requestRuntime('/session');
        const selected = fileProjectsSchema.parse(await requestRuntime('/file-projects'));
        if (active) setProjects(selected);
        const listing = fileListSchema.parse(
          await requestProject(initialRoot ?? selected.root, '/files'),
        );
        if (active) setRoot(listing);
        if (initialPath) {
          const loaded = projectFileSchema.parse(
            await requestProject(listing.root, `/file?path=${encodeURIComponent(initialPath)}`),
          );
          if (active) {
            setBuffers({ [initialPath]: newFileBuffer(loaded) });
            setActivePath(initialPath);
            remember(listing.root, loaded);
          }
          if (initialRevision !== undefined) {
            const version = await readFileHistory(listing.root, loaded, initialRevision);
            if (active) {
              setHistorical(version);
              setTab('history');
            }
          }
        }
      } catch (cause) {
        if (active) setError(String(cause));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirtyPaths.length) return;
    const preventLoss = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirtyPaths.length]);

  const updateBuffer = (update: (current: FileBuffer) => FileBuffer) => {
    setBuffers((current) => ({ ...current, [activePath!]: update(current[activePath!]) }));
    setPendingLeave(null);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const select = (path: string) => {
    setActivePath(path);
    setHistorical(null);
    setTab('content');
    setSourceView(false);
    setSidebarOpen(false);
    setPendingLeave(null);
    setError('');
    setNotice('');
    setComparison('previous');
  };
  const selectRevision = (id: number) =>
    void run(async () => {
      const history = await readFileHistory(root!.root, file!, id);
      setHistorical(history);
      setComparison('previous');
    });
  const open = (path: string) => {
    if (buffers[path]) {
      select(path);
      return;
    }
    void run(async () => {
      const data = projectFileSchema.parse(
        await requestProject(root!.root, `/file?path=${encodeURIComponent(path)}`),
      );
      setBuffers((current) => ({ ...current, [path]: newFileBuffer(data) }));
      remember(root!.root, data);
      select(path);
    });
  };
  const refresh = () =>
    void run(async () => {
      const data = projectFileSchema.parse(
        await requestProject(root!.root, `/file?path=${encodeURIComponent(file!.path)}`),
      );
      updateBuffer((current) => refreshFileBuffer(current, data));
      remember(root!.root, data);
      setHistorical(null);
      if (dirty) setNotice('已读取最新磁盘版本，草稿已保留。请对照后保存。');
    });
  const save = () => {
    if (!file || !dirty || busy) return;
    void run(async () => {
      const data = projectFileSchema.parse(
        await requestProject(root!.root, '/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: file.path, baseHash: file.hash, content: buffer!.draft }),
        }),
      );
      updateBuffer(() => ({ ...newFileBuffer(data), editing: true }));
      remember(root!.root, data);
      setHistorical(null);
      setNotice('已保存，修改路线已更新。');
    });
  };
  const leave = (destination: 'close' | 'canvas') => {
    onClose();
    if (destination === 'canvas') focusArchive(root?.root);
  };
  const requestLeave = (destination: 'close' | 'canvas') => {
    if (busy) return;
    if (dirtyPaths.length) setPendingLeave(destination);
    else leave(destination);
  };
  const changeProject = (path: string) =>
    void run(async () => {
      const selected = await switchProject(path);
      setProjects(selected);
      setProjectPicker(false);
      setPendingProject(null);
      setBuffers({});
      setActivePath(null);
      setHistorical(null);
      setTab('content');
      setRoot(null);
      setSidebarOpen(false);
      const listing = fileListSchema.parse(await requestProject(selected.root, '/files'));
      setRoot(listing);
      setNotice(`已打开项目：${name(selected.root)}`);
    });
  const requestSwitch = (path: string) => {
    setPendingLeave(null);
    if (root?.root === path && projects?.root === path) {
      setProjectPicker(false);
      return;
    }
    if (dirtyPaths.length) {
      setPendingProject(path);
      setProjectPicker(false);
    } else changeProject(path);
  };
  const requestDismiss = () => {
    if (busy) return;
    if (projectPicker) {
      setProjectPicker(false);
      setPendingProject(null);
    } else if (pendingProject) setPendingProject(null);
    else if (sidebarOpen) setSidebarOpen(false);
    else requestLeave('close');
  };
  const backdrop = useDialogBackdrop(requestDismiss);
  return (
    <dialog
      ref={dialog}
      className="files-dialog"
      aria-labelledby="files-title"
      style={
        {
          '--file-font-size': `${fontSize}px`,
          '--files-sidebar-width': `${sidebarWidth}px`,
        } as CSSProperties
      }
      onCancel={(event) => {
        event.preventDefault();
        requestDismiss();
      }}
      onPointerDown={backdrop.onPointerDown}
      onClickCapture={(event) => {
        if (
          projectPicker &&
          !(event.target as Element).closest('.files-project-picker,.files-project-switch')
        ) {
          if (!busy) {
            setProjectPicker(false);
            setPendingProject(null);
          }
          event.stopPropagation();
          return;
        }
        backdrop.onClick(event);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          save();
        }
      }}
    >
      <header className="files-heading">
        <div>
          <h2 id="files-title">
            <Folder size={19} />
            项目档案
          </h2>
          <small title={root?.root ?? projects?.root}>
            {root?.root ?? projects?.root ?? '正在连接本地项目…'}
          </small>
        </div>
        <div className="files-heading-actions">
          <button
            className="files-project-switch"
            aria-expanded={projectPicker}
            disabled={busy}
            onClick={() => {
              setProjectPicker(!projectPicker);
              setPendingProject(null);
              if (!projectPicker)
                void run(async () =>
                  setProjects(fileProjectsSchema.parse(await requestRuntime('/file-projects'))),
                );
            }}
          >
            <FolderOpen size={15} />
            <span>切换项目</span>
          </button>
          <button
            aria-label="在画布查看路线"
            disabled={busy}
            onClick={() => requestLeave('canvas')}
          >
            <GitBranch size={15} />
            <span>在画布查看路线</span>
          </button>
          <button
            className="icon-button"
            aria-label="关闭项目档案"
            disabled={busy}
            onClick={() => requestLeave('close')}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      {projectPicker && (
        <ProjectPicker
          projects={projects}
          busy={busy}
          error={error}
          onSelect={requestSwitch}
          onClose={() => {
            setProjectPicker(false);
            setPendingProject(null);
          }}
        />
      )}
      {pendingProject && (
        <div className="files-close-confirm" role="alert">
          <span>
            {dirtyPaths.length} 个文件有未保存修改。切换到 {pendingProject} 将丢弃这些草稿。
          </span>
          <button
            onClick={() => {
              setPendingProject(null);
              setProjectPicker(false);
            }}
          >
            继续编辑
          </button>
          <button disabled={busy} onClick={() => changeProject(pendingProject)}>
            放弃草稿并切换
          </button>
        </div>
      )}
      {pendingLeave && (
        <div className="files-close-confirm" role="alert">
          <span>{dirtyPaths.length} 个文件有未保存修改，关闭后草稿将丢失。</span>
          <button onClick={() => setPendingLeave(null)}>继续编辑</button>
          <button onClick={() => leave(pendingLeave)}>
            放弃修改并{pendingLeave === 'canvas' ? '查看画布' : '关闭'}
          </button>
        </div>
      )}
      <div className="files-layout" data-sidebar-open={sidebarOpen}>
        {sidebarOpen && (
          <button
            className="files-sidebar-scrim"
            aria-label="收起文件导航"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <nav className="files-sidebar" aria-label="项目文件">
          {root && (
            <FileTree
              key={root.root}
              root={root}
              activePath={activePath}
              dirtyPaths={dirtyPaths}
              busy={busy}
              onOpen={open}
              onHide={() => setSidebarOpen(false)}
            />
          )}
        </nav>
        <div
          className="files-sidebar-resizer"
          role="separator"
          aria-label="调整文件导航宽度"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={208}
          aria-valuemax={420}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setSidebarWidth((width) =>
                Math.max(208, Math.min(420, width + (event.key === 'ArrowLeft' ? -16 : 16))),
              );
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              const left = event.currentTarget.parentElement!.getBoundingClientRect().left;
              setSidebarWidth(Math.max(208, Math.min(420, event.clientX - left)));
            }
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        />
        <section className="files-main" aria-label="文件工作区">
          <div className="files-file-heading">
            <button
              className="files-mobile-only"
              onClick={() => setSidebarOpen(true)}
              aria-expanded={sidebarOpen}
            >
              <PanelLeft size={15} />
              浏览文件
            </button>
            <div title={file?.path}>
              <strong>{file ? name(file.path) : '选择一份文件'}</strong>
              {file && <small>{file.path}</small>}
            </div>
            {dirty && <span>未保存</span>}
          </div>
          {Object.keys(buffers).length > 1 && (
            <nav className="files-open-tabs" aria-label="已打开文件">
              {Object.values(buffers).map((item) => (
                <button
                  key={item.file.path}
                  title={item.file.path}
                  aria-current={activePath === item.file.path ? 'page' : undefined}
                  disabled={busy}
                  onClick={() => select(item.file.path)}
                >
                  <FileText size={12} />
                  {name(item.file.path)}
                  {bufferDirty(item) && <span className="file-tree-dirty" aria-label="未保存" />}
                </button>
              ))}
            </nav>
          )}
          {error && !projectPicker && (
            <p className="files-message error" role="alert">
              {error}
              <br />
              <small>保存结果不明确时，请读取磁盘版本核对。</small>
            </p>
          )}
          {notice && (
            <p className="files-message" role="status">
              {notice}
            </p>
          )}
          {file && buffer ? (
            <>
              <div className="files-tabs" role="tablist" aria-label="文件视图">
                <button
                  role="tab"
                  aria-selected={tab === 'content'}
                  onClick={() => setTab('content')}
                >
                  <FileText size={14} />
                  文件内容
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'history'}
                  disabled={busy}
                  onClick={() => {
                    setTab('history');
                    if (!historical) selectRevision(file.revisions[0].id);
                  }}
                >
                  <History size={14} />
                  修改记录 <small>{file.revisions.length}</small>
                </button>
              </div>
              <div className="files-editor-toolbar">
                <div>
                  {tab === 'content' && (
                    <button
                      aria-pressed={buffer.editing}
                      disabled={busy}
                      onClick={() =>
                        updateBuffer((current) => ({ ...current, editing: !current.editing }))
                      }
                    >
                      <Pencil size={13} />
                      {buffer.editing ? '结束编辑' : '编辑文件'}
                    </button>
                  )}
                  {tab === 'content' && isMarkdown && !buffer.editing && (
                    <button aria-pressed={sourceView} onClick={() => setSourceView(!sourceView)}>
                      {sourceView ? '阅读视图' : '查看源码'}
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label="自动换行"
                    title="自动换行"
                    aria-pressed={wrap}
                    onClick={() => setWrap(!wrap)}
                  >
                    <WrapText size={16} />
                  </button>
                  <div className="files-font-control" aria-label="编辑器字号">
                    <button
                      className="icon-button"
                      aria-label="缩小字号"
                      disabled={fontSize === 12}
                      onClick={() => setFontSize((size) => size - 1)}
                    >
                      A−
                    </button>
                    <output aria-live="polite">{fontSize}px</output>
                    <button
                      className="icon-button"
                      aria-label="放大字号"
                      disabled={fontSize === 22}
                      onClick={() => setFontSize((size) => size + 1)}
                    >
                      A+
                    </button>
                  </div>
                </div>
                <div>
                  <button
                    className="icon-button"
                    aria-label={dirty ? '读取磁盘版本，保留草稿' : '刷新文件'}
                    title={dirty ? '读取磁盘版本，保留草稿' : '刷新文件'}
                    disabled={busy}
                    onClick={refresh}
                  >
                    <RefreshCw size={15} />
                  </button>
                  {(tab === 'content' || dirty) && (
                    <button className="primary-button" disabled={busy || !dirty} onClick={save}>
                      <Save size={14} />
                      保存修改
                    </button>
                  )}
                </div>
              </div>
              {tab === 'content' ? (
                <div className={`files-editors ${buffer.compareDisk ? 'comparing' : ''}`}>
                  <div className="files-code">
                    {buffer.compareDisk && <span>当前草稿</span>}
                    {isMarkdown && !buffer.editing && !sourceView ? (
                      <article className="file-markdown" aria-label="Markdown 阅读视图">
                        <MarkdownReply text={buffer.draft} />
                      </article>
                    ) : (
                      <CodeEditor
                        path={file.path}
                        value={buffer.draft}
                        readOnly={!buffer.editing || busy}
                        wrap={wrap}
                        onPosition={setPosition}
                        onChange={(draft) => updateBuffer((current) => ({ ...current, draft }))}
                      />
                    )}
                  </div>
                  {buffer.compareDisk && (
                    <div className="files-code">
                      <span>最新磁盘版本 · {file.hash.slice(0, 12)}</span>
                      <pre tabIndex={0} data-wrap={wrap}>
                        {file.content}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="files-history">
                  <div className="files-version-route">
                    <div className="files-version-route-heading">
                      <span>{historical ? `已选 v${historical.version}` : '修改路线'}</span>
                      <button
                        aria-expanded={routeExpanded}
                        onClick={() => setRouteExpanded(!routeExpanded)}
                      >
                        {routeExpanded ? '收起修改路线' : '展开修改路线'}
                      </button>
                    </div>
                    {routeExpanded && <small>实线 · 保存　虚线 · 读取观察；按记录顺序连接。</small>}
                    <div
                      hidden={!routeExpanded}
                      ref={routeScroll}
                      className="files-route-scroll"
                      tabIndex={0}
                      aria-label="版本路线图，可横向滚动"
                    >
                      <RevisionGraph
                        revisions={file.revisions}
                        selectedId={historical?.id}
                        disabled={busy}
                        onSelect={selectRevision}
                      />
                    </div>
                  </div>
                  {historical ? (
                    <>
                      <div className="files-diff-mode" aria-label="版本比较范围">
                        <button
                          aria-label="与上一版本比较"
                          aria-pressed={comparison === 'previous'}
                          onClick={() => setComparison('previous')}
                        >
                          上一版 → 所选版
                        </button>
                        <button
                          aria-label={`与${dirty ? '当前草稿' : '当前文件'}比较`}
                          aria-pressed={comparison === 'current'}
                          onClick={() => setComparison('current')}
                        >
                          所选版 → {dirty ? '当前草稿' : '当前文件'}
                        </button>
                      </div>
                      {comparison === 'current' ? (
                        <FileDiff
                          key={`${file.path}/${historical.id}/current`}
                          before={historical.file.content}
                          after={buffer.draft}
                          beforeLabel={`v${historical.version} · ${historical.file.hash.slice(0, 8)}`}
                          afterLabel={
                            dirty ? '当前草稿（未保存）' : `当前文件 · ${file.hash.slice(0, 8)}`
                          }
                          wrap={wrap}
                        />
                      ) : historical.previous ? (
                        <FileDiff
                          key={`${file.path}/${historical.id}/previous`}
                          before={historical.previous.content}
                          after={historical.file.content}
                          beforeLabel={`v${historical.version - 1} · ${historical.previous.hash.slice(0, 8)}`}
                          afterLabel={`v${historical.version} · ${historical.file.hash.slice(0, 8)}`}
                          wrap={wrap}
                        />
                      ) : (
                        <div className="files-code files-first-record">
                          <span>v1 首次读取 · 没有上一条记录，以下为完整快照。</span>
                          <pre tabIndex={0} data-wrap={wrap}>
                            {historical.file.content}
                          </pre>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="files-empty">
                      {busy ? '正在读取版本差异…' : '选择版本节点，查看本次修改。'}
                    </p>
                  )}
                </div>
              )}
              <footer className="files-footer">
                <small>
                  {busy
                    ? '正在处理…'
                    : tab === 'history'
                      ? '版本对照'
                      : dirty
                        ? '草稿未保存'
                        : buffer.editing
                          ? '编辑中'
                          : '只读预览'}{' '}
                  · UTF-8{' '}
                  {tab === 'content' && (!isMarkdown || buffer.editing || sourceView) && (
                    <span className="files-position">
                      · Ln {position.line}, Col {position.column}
                    </span>
                  )}
                </small>
                <div>
                  <small title={file.hash}>SHA {file.hash.slice(0, 8)}</small>
                  {dirty && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        updateBuffer(() => ({ ...newFileBuffer(file), editing: true }));
                        setError('');
                        setNotice('');
                      }}
                    >
                      放弃此文件草稿
                    </button>
                  )}
                </div>
              </footer>
            </>
          ) : (
            <div className="files-empty">
              <Folder size={36} />
              <p>{busy ? '正在读取项目文件…' : '选择文件开始预览'}</p>
              <small>
                文件内容与修改记录保存在本地项目。
                <br />
                草稿仅保留在当前窗口，保存后写入磁盘。
              </small>
              <button className="files-mobile-only" onClick={() => setSidebarOpen(true)}>
                浏览项目文件
              </button>
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}
