import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_FILE_BYTES, type ProjectFile } from '../contracts/files.ts';

export class FileProblem extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}
const excludedDirectories = new Set(['.git', '.echidna-canvas', '.codex', '.ssh', 'node_modules']);
// This browser file surface must not copy local credentials into its history database.
const privateName = (name: string) =>
  /^\.env(?:\.|$)/i.test(name) ||
  /^(?:auth|credentials|secrets)(?:\.|$)/i.test(name) ||
  /\.(?:pem|key|p12|pfx)$/i.test(name) ||
  ['.npmrc', '.netrc', '.git-credentials', 'id_rsa', 'id_ed25519'].includes(name);
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function projectRoot(path: string) {
  if (!isAbsolute(path) || path.includes('\0'))
    throw new FileProblem(400, '请输入项目目录的绝对路径。');
  const root = realpathSync(path);
  if (root.split('/').some((part) => excludedDirectories.has(part) || privateName(part)))
    throw new FileProblem(403, '凭据、依赖及内部记录目录不能作为项目档案根目录。');
  if (!statSync(root).isDirectory()) throw new FileProblem(422, '请选择项目文件夹，而不是文件。');
  readdirSync(root);
  return root;
}

export class ProjectFileStore {
  private selectedRoot: string;
  get root() {
    return this.selectedRoot;
  }
  private db: DatabaseSync;
  constructor(root: string, database: string) {
    const initialRoot = projectRoot(root);
    this.selectedRoot = initialRoot;
    this.db = new DatabaseSync(database);
    try {
      this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS file_revisions (
        id INTEGER PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL,
        hash TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS file_revisions_path ON file_revisions(root, path, id);
      CREATE TABLE IF NOT EXISTS file_projects (
        root TEXT PRIMARY KEY, selected INTEGER NOT NULL, opened_at INTEGER NOT NULL
      );
      `);
      this.db
        .prepare('INSERT OR IGNORE INTO file_projects(root,selected,opened_at) VALUES(?,0,0)')
        .run(initialRoot);
      const selected = this.db.prepare('SELECT root FROM file_projects WHERE selected=1').get();
      // A moved/deleted selected project remains visible and can be switched away from in the UI.
      if (selected) this.selectedRoot = selected.root as string;
      else
        this.db
          .prepare('UPDATE file_projects SET selected=1,opened_at=? WHERE root=?')
          .run(Date.now(), initialRoot);
    } catch (cause) {
      this.db.close();
      throw cause;
    }
  }
  close() {
    this.db.close();
  }
  projects() {
    const rows = this.db
      .prepare('SELECT root FROM file_projects ORDER BY selected DESC,opened_at DESC,root')
      .all();
    return { root: this.root, projects: rows.map((row) => row.root as string) };
  }
  selectProject(path: string) {
    const root = projectRoot(path);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE file_projects SET selected=0 WHERE selected=1').run();
      this.db
        .prepare(
          'INSERT INTO file_projects(root,selected,opened_at) VALUES(?,1,?) ON CONFLICT(root) DO UPDATE SET selected=1,opened_at=excluded.opened_at',
        )
        .run(root, Date.now());
      this.db.exec('COMMIT');
    } catch (cause) {
      this.db.exec('ROLLBACK');
      throw cause;
    }
    this.selectedRoot = root;
    return this.projects();
  }
  registerProject(path: string) {
    const root = projectRoot(path);
    this.db
      .prepare(
        'INSERT INTO file_projects(root,selected,opened_at) VALUES(?,0,?) ON CONFLICT(root) DO UPDATE SET opened_at=excluded.opened_at',
      )
      .run(root, Date.now());
    return { root, projects: this.projects().projects };
  }
  requireRegisteredProject(root: string) {
    if (!this.db.prepare('SELECT root FROM file_projects WHERE root=?').get(root))
      throw new FileProblem(409, '项目档案尚未绑定，请先选择本地项目目录。');
  }
  requireProject(root: string) {
    if (root !== this.root)
      throw new FileProblem(
        409,
        '项目档案已切换；当前草稿未保存到其他项目，请重新选择项目后核对。',
      );
  }

  private target(path: string, allowRoot = false, root = this.root) {
    if (path.includes('\0') || isAbsolute(path) || path.split('/').includes('..'))
      throw new FileProblem(400, '文件路径必须位于当前项目内。');
    const parts = path.split('/').filter(Boolean);
    if (parts.some((part) => excludedDirectories.has(part) || privateName(part)))
      throw new FileProblem(403, '凭据、依赖及内部记录目录不在项目档案中开放。');
    const target = resolve(root, path);
    const actual = realpathSync(target);
    // Reject symlink aliases, including aliases to private paths inside the project.
    if (actual !== target || (!allowRoot && actual === root))
      throw new FileProblem(403, '项目档案不通过符号链接访问文件。');
    const child = relative(root, actual);
    if (child === '..' || child.startsWith('../') || isAbsolute(child))
      throw new FileProblem(403, '文件路径超出当前项目。');
    return actual;
  }

  list(directory: string, root = this.root) {
    const target = this.target(directory, true, root);
    const entries = readdirSync(target, { withFileTypes: true })
      .filter((entry) => !excludedDirectories.has(entry.name) && !privateName(entry.name))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        path: relative(root, resolve(target, entry.name)),
        kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'directory' ? -1 : 1,
      );
    return { root, directory: relative(root, target), entries };
  }

  private read(path: string, root: string) {
    const target = this.target(path, false, root);
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new FileProblem(422, '请选择普通文件。');
      if (stat.size > MAX_FILE_BYTES)
        throw new FileProblem(413, '文本编辑支持不超过 1 MiB 的文件。');
      const bytes = readFileSync(fd);
      if (bytes.length > MAX_FILE_BYTES) throw new FileProblem(413, '文件增长后超过 1 MiB。');
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch (cause) {
        throw new FileProblem(415, '此文件不是 UTF-8 文本，暂不支持在档案中编辑。', { cause });
      }
      if (content.includes('\0'))
        throw new FileProblem(415, '此文件包含二进制内容，暂不支持文本编辑。');
      return { target, content, hash: digest(bytes), mode: stat.mode & 0o777 };
    } finally {
      closeSync(fd);
    }
  }

  private record(
    path: string,
    content: string,
    hash: string,
    source: 'observed' | 'editor',
    root: string,
  ) {
    const last = this.db
      .prepare('SELECT hash FROM file_revisions WHERE root=? AND path=? ORDER BY id DESC LIMIT 1')
      .get(root, path);
    if (last?.hash === hash) return;
    this.db
      .prepare(
        'INSERT INTO file_revisions(root,path,hash,content,source,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(root, path, hash, content, source, new Date().toISOString());
  }
  private revisions(path: string, root: string): ProjectFile['revisions'] {
    return this.db
      .prepare(
        'SELECT id,hash,source,created_at AS createdAt FROM file_revisions WHERE root=? AND path=? ORDER BY id DESC',
      )
      .all(root, path) as ProjectFile['revisions'];
  }
  index(root = this.root) {
    const paths = this.db
      .prepare(
        'SELECT path, MIN(id) AS first FROM file_revisions WHERE root=? GROUP BY path ORDER BY first',
      )
      .all(root);
    return {
      root,
      files: paths.map((row) => ({
        path: row.path as string,
        revisions: this.revisions(row.path as string, root),
      })),
    };
  }
  open(path: string, root = this.root): ProjectFile {
    const file = this.read(path, root);
    const key = relative(root, file.target);
    this.record(key, file.content, file.hash, 'observed', root);
    return {
      path: key,
      content: file.content,
      hash: file.hash,
      revisions: this.revisions(key, root),
    };
  }
  history(path: string, id: number, root = this.root) {
    const key = relative(root, this.target(path, false, root));
    const row = this.db
      .prepare('SELECT content,hash FROM file_revisions WHERE root=? AND path=? AND id=?')
      .get(root, key, id);
    if (!row) throw new FileProblem(404, '没有这份文件的版本记录。');
    return row;
  }
  save(path: string, baseHash: string, content: string, root = this.root): ProjectFile {
    if (Buffer.from(content, 'utf8').toString('utf8') !== content)
      throw new FileProblem(415, '保存内容包含无效的 Unicode 字符。');
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES)
      throw new FileProblem(413, '保存内容超过 1 MiB。');
    if (content.includes('\0')) throw new FileProblem(415, '不能保存二进制内容。');
    const file = this.read(path, root);
    const key = relative(root, file.target);
    this.record(key, file.content, file.hash, 'observed', root);
    if (file.hash !== baseHash)
      throw new FileProblem(409, '文件已被外部修改，未覆盖。草稿已保留，请刷新文件并核对差异。');
    const hash = digest(content);
    if (hash !== file.hash) {
      const temporary = resolve(dirname(file.target), `.echidna-edit-${randomUUID()}`);
      const fd = openSync(temporary, 'wx', file.mode);
      try {
        try {
          fchmodSync(fd, file.mode);
          writeFileSync(fd, content);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, file.target);
      } catch (cause) {
        unlinkSync(temporary);
        throw cause;
      }
      this.record(key, content, hash, 'editor', root);
    }
    return { path: key, content, hash, revisions: this.revisions(key, root) };
  }
}

export function fileSystemProblem(error: unknown): FileProblem | undefined {
  if (error instanceof FileProblem) return error;
  if (!(error instanceof Error) || !('code' in error)) return;
  if (error.code === 'ENOENT')
    return new FileProblem(404, '文件或目录已不存在。', { cause: error });
  if (['EACCES', 'EPERM', 'ELOOP'].includes(String(error.code)))
    return new FileProblem(403, '文件不可访问，未自动重试。', { cause: error });
  if (['ENOTDIR', 'EISDIR'].includes(String(error.code)))
    return new FileProblem(422, '所选路径的文件类型已变化。', { cause: error });
}
