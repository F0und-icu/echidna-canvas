import { FolderOpen, Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FileProjects } from '../../contracts/files';

export function ProjectPicker({
  projects,
  busy,
  error,
  onSelect,
  onClose,
}: {
  projects: FileProjects | null;
  busy: boolean;
  error: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!busy) input.current!.focus();
  }, [busy]);
  return (
    <section className="files-project-picker" aria-label="切换项目档案">
      <header>
        <strong>切换项目档案</strong>
        <button className="icon-button" aria-label="收起项目切换" disabled={busy} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSelect(path.trim());
        }}
      >
        <label htmlFor="file-project-path">打开本地项目目录</label>
        <div>
          <input
            id="file-project-path"
            ref={input}
            placeholder="输入目录的绝对路径，如 /Users/你的名字/项目"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !path.trim()}>
            <FolderOpen size={14} />
            打开项目
          </button>
        </div>
      </form>
      {error && (
        <p className="files-message error" role="alert">
          {error}
        </p>
      )}
      {projects && (
        <div className="files-recent-projects">
          <small>最近项目</small>
          {projects.projects.map((root) => (
            <button
              key={root}
              disabled={busy}
              onClick={() => onSelect(root)}
              title={root}
              aria-label={`切换到项目 ${root}`}
              aria-current={projects.root === root ? 'true' : undefined}
            >
              <FolderOpen size={16} />
              <span>
                <strong>{root.split('/').at(-1) || root}</strong>
                <small>{root}</small>
              </span>
              {projects.root === root && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
      <p>文件与修改记录按项目分别显示。已有 Agent 会话继续使用原工作目录。</p>
    </section>
  );
}
