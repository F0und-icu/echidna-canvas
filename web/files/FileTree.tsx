import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronsDownUp,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { fileListSchema, type FileList } from '../../contracts/files';
import { requestProject } from './api';
import { parentDirectories, visibleFileRows, type FileEntry } from './treeRows';

export function FileTree({
  root,
  activePath,
  dirtyPaths,
  busy,
  onOpen,
  onHide,
}: {
  root: FileList;
  activePath: string | null;
  dirtyPaths: string[];
  busy: boolean;
  onOpen: (path: string) => void;
  onHide: () => void;
}) {
  const tree = useRef<HTMLDivElement>(null);
  const [directories, setDirectories] = useState<Record<string, FileEntry[]>>({ '': root.entries });
  const [expanded, setExpanded] = useState(new Set<string>());
  const [loading, setLoading] = useState(new Set<string>()),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState(''),
    [focused, setFocused] = useState<string | null>(null);
  const load = async (path: string, force = false) => {
    if (!force && (directories[path] || loading.has(path))) return;
    setLoading((current) => new Set(current).add(path));
    setErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    try {
      const result = fileListSchema.parse(
        await requestProject(root.root, `/files?directory=${encodeURIComponent(path)}`),
      );
      setDirectories((current) => ({ ...current, [path]: result.entries }));
    } catch (cause) {
      setErrors((current) => ({ ...current, [path]: String(cause) }));
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  };
  useEffect(() => {
    if (!activePath) return;
    const parents = parentDirectories(activePath);
    setExpanded((current) => new Set([...current, ...parents]));
    void Promise.all(parents.map((path) => load(path)));
  }, [activePath]);
  const rows = visibleFileRows(directories, expanded, query);
  const tabStop = rows.some((row) => row.entry.path === focused)
    ? focused
    : (rows.find((row) => row.entry.path === activePath)?.entry.path ?? rows[0]?.entry.path);
  const focus = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setFocused(row.entry.path);
    tree.current!.querySelectorAll<HTMLElement>('[role="treeitem"]')[index].focus();
  };
  const toggle = (path: string, open: boolean) => {
    setQuery('');
    if (open)
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    else {
      setExpanded((current) => new Set(current).add(path));
      void load(path);
    }
  };
  const refresh = () => void Promise.all(['', ...expanded].map((path) => load(path, true)));
  return (
    <>
      <div className="file-tree-heading">
        <strong>项目文件</strong>
        <div>
          <button
            className="icon-button"
            aria-label="收起全部目录"
            onClick={() => {
              setQuery('');
              setExpanded(new Set());
            }}
          >
            <ChevronsDownUp size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="刷新文件树"
            disabled={loading.size > 0}
            onClick={refresh}
          >
            <RefreshCw size={14} className={loading.size ? 'spinning' : ''} />
          </button>
          <button
            className="icon-button files-mobile-only"
            aria-label="关闭文件导航"
            onClick={onHide}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <label className="file-tree-search">
        <Search size={14} />
        <input
          aria-label="筛选文件树"
          placeholder="查找文件或目录"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="icon-button" aria-label="清空文件筛选" onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </label>
      {query && <small className="file-tree-hint">仅筛选已加载目录</small>}
      {errors[''] && (
        <p className="file-tree-error" role="alert">
          {errors['']}
          <br />
          当前保留上次目录。<button onClick={() => void load('', true)}>重新读取</button>
        </p>
      )}
      <div ref={tree} className="file-tree-rows" role="tree" aria-label="项目目录树">
        {rows.map(({ entry, depth, parent, expanded: open }, index) => {
          const label = entry.path.split('/').at(-1)!;
          const dirty = dirtyPaths.some(
            (path) => path === entry.path || path.startsWith(entry.path + '/'),
          );
          return (
            <div key={entry.path}>
              <button
                role="treeitem"
                aria-level={depth}
                aria-expanded={entry.kind === 'directory' ? open : undefined}
                aria-selected={activePath === entry.path}
                aria-label={entry.path}
                title={entry.path}
                tabIndex={tabStop === entry.path ? 0 : -1}
                className="file-tree-row"
                data-kind={entry.kind}
                style={{ paddingLeft: 8 + (depth - 1) * 16 }}
                disabled={entry.kind === 'file' && busy}
                onFocus={() => setFocused(entry.path)}
                onClick={() =>
                  entry.kind === 'directory' ? toggle(entry.path, open) : onOpen(entry.path)
                }
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    focus(index + 1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    focus(index - 1);
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    focus(0);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    focus(rows.length - 1);
                  } else if (event.key === 'ArrowRight' && entry.kind === 'directory') {
                    event.preventDefault();
                    if (!open) toggle(entry.path, open);
                    else if (rows[index + 1]?.parent === entry.path) focus(index + 1);
                  } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    if (entry.kind === 'directory' && open) toggle(entry.path, open);
                    else focus(rows.findIndex((row) => row.entry.path === parent));
                  }
                }}
              >
                <ChevronRight
                  size={12}
                  className={`file-tree-chevron ${entry.kind === 'file' ? 'empty' : open ? 'open' : ''}`}
                />
                {entry.kind === 'directory' ? (
                  open ? (
                    <FolderOpen size={15} />
                  ) : (
                    <Folder size={15} />
                  )
                ) : (
                  <FileText size={15} />
                )}
                <span className="file-tree-name">
                  {label.length > 24 ? (
                    <>
                      <span>{label.slice(0, -12)}</span>
                      <span>{label.slice(-12)}</span>
                    </>
                  ) : (
                    label
                  )}
                </span>
                {dirty && <span className="file-tree-dirty" aria-label="有未保存修改" />}
                {loading.has(entry.path) && <RefreshCw size={11} className="spinning" />}
              </button>
              {open && errors[entry.path] && (
                <p className="file-tree-error" role="alert">
                  {errors[entry.path]}
                  <button onClick={() => void load(entry.path, true)}>重新读取</button>
                </p>
              )}
              {open && directories[entry.path]?.length === 0 && (
                <small className="file-tree-hint" style={{ paddingLeft: 24 + depth * 16 }}>
                  空目录
                </small>
              )}
            </div>
          );
        })}
        {!rows.length && (
          <p className="file-tree-hint">
            {query ? '已加载目录中没有匹配项。' : '此目录没有可浏览文件。'}
          </p>
        )}
      </div>
      <small className="files-scope">
        单击文件预览 · 点击编辑开始修改
        <br />
        方向键导航 · 草稿保留在窗口中
      </small>
    </>
  );
}
