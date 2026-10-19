import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectFileStore } from '../../server/project-files';
import { MAX_FILE_BYTES } from '../../contracts/files';

let root: string, database: string, store: ProjectFileStore;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'canvas-files-')));
  database = join(root, 'history.sqlite');
  store = new ProjectFileStore(root, database);
  writeFileSync(join(root, 'example.txt'), 'original\n中文\n');
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

it('persists exact before/after content and observes external edits without inventing authorship', () => {
  const baseline = store.open('example.txt');
  expect(baseline.revisions).toHaveLength(1);
  expect(store.open('example.txt').revisions).toHaveLength(1);
  const saved = store.save('example.txt', baseline.hash, 'edited\n中文\n');
  expect(readFileSync(join(root, 'example.txt'), 'utf8')).toBe(saved.content);
  expect(saved.revisions.map((r) => r.source)).toEqual(['editor', 'observed']);
  expect(store.history('example.txt', baseline.revisions[0].id)).toEqual({
    content: baseline.content,
    hash: baseline.hash,
  });
  expect(store.save('example.txt', saved.hash, saved.content).revisions).toHaveLength(2);
  store.close();
  store = new ProjectFileStore(root, database);
  expect(store.open('example.txt').revisions).toHaveLength(2);
  writeFileSync(join(root, 'example.txt'), 'external\n');
  const external = store.open('example.txt');
  expect(external.revisions.map((r) => r.source)).toEqual(['observed', 'editor', 'observed']);
  expect(() => store.history('example.txt', 999)).toThrow('版本记录');
});

it('retains a conflicting disk edit and its observed version rather than overwriting it', () => {
  const old = store.open('example.txt');
  writeFileSync(join(root, 'example.txt'), 'someone else\n');
  expect(() => store.save('example.txt', old.hash, 'my draft\n')).toThrow('文件已被外部修改');
  expect(readFileSync(join(root, 'example.txt'), 'utf8')).toBe('someone else\n');
  const current = store.open('example.txt');
  expect(current.revisions).toHaveLength(2);
  expect(current.revisions.every((r) => r.source === 'observed')).toBe(true);
});

it('contains browsing, saving and history within the project and excludes credential paths and symlinks', () => {
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'export const x=1;');
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.env'), 'PRIVATE');
  writeFileSync(join(root, 'auth.json'), 'PRIVATE');
  symlinkSync(join(root, '.env'), join(root, 'alias.txt'));
  symlinkSync(join(root, 'src'), join(root, 'linked-dir'));
  const entries = store.list('').entries.map((e) => e.path);
  expect(entries).toContain('src');
  for (const hidden of ['.git', '.env', 'auth.json', 'alias.txt', 'linked-dir'])
    expect(entries).not.toContain(hidden);
  for (const path of [
    '../outside',
    '/etc/hosts',
    '.env',
    'auth.json',
    'alias.txt',
    'linked-dir/a.ts',
  ]) {
    expect(() => store.open(path)).toThrow();
    expect(() => store.save(path, '0'.repeat(64), 'bad')).toThrow();
    expect(() => store.history(path, 1)).toThrow();
  }
  expect(store.list('src').entries).toEqual([{ path: 'src/a.ts', kind: 'file' }]);
});

it('rejects binary and oversized documents, preserves BOM, CRLF and executable mode', () => {
  writeFileSync(join(root, 'binary'), Buffer.from([0xff, 0x00, 0x01]));
  expect(() => store.open('binary')).toThrow('UTF-8');
  writeFileSync(join(root, 'large'), '');
  truncateSync(join(root, 'large'), MAX_FILE_BYTES + 1);
  expect(() => store.open('large')).toThrow('1 MiB');
  expect(() =>
    store.save('example.txt', store.open('example.txt').hash, '中'.repeat(MAX_FILE_BYTES / 2)),
  ).toThrow('1 MiB');
  const original = '\ufeff#!/bin/sh\r\necho old\r\n';
  writeFileSync(join(root, 'script.sh'), original);
  chmodSync(join(root, 'script.sh'), 0o755);
  const file = store.open('script.sh');
  expect(file.content).toBe(original);
  const content = original.replace('old', 'new');
  store.save('script.sh', file.hash, content);
  expect(readFileSync(join(root, 'script.sh'), 'utf8')).toBe(content);
  expect(statSync(join(root, 'script.sh')).mode & 0o777).toBe(0o755);
  chmodSync(join(root, 'example.txt'), 0o664);
  const plain = store.open('example.txt');
  store.save('example.txt', plain.hash, 'permission check\n');
  expect(statSync(join(root, 'example.txt')).mode & 0o777).toBe(0o664);
  expect(() => store.save('example.txt', plain.hash, '\ud800')).toThrow('Unicode');
});

it('does not mix revisions when a history database serves a different project root', () => {
  const first = store.open('example.txt');
  const other = join(root, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'example.txt'), 'unrelated');
  const second = new ProjectFileStore(other, database);
  try {
    second.selectProject(other);
    expect(second.open('example.txt').revisions).toHaveLength(1);
    expect(second.index().files).toHaveLength(1);
    expect(second.index().files[0].revisions[0].id).not.toBe(first.revisions[0].id);
    expect(() => second.history('example.txt', first.revisions[0].id)).toThrow('版本记录');
  } finally {
    second.close();
  }
});

it('switches and remembers projects while keeping matching file paths and revisions isolated', () => {
  const first = store.open('example.txt');
  const other = join(root, '另一个项目');
  mkdirSync(other);
  writeFileSync(join(other, 'example.txt'), 'second project\n');
  store.selectProject(other);
  const selected = store.root;
  expect(store.projects().root).toBe(selected);
  expect(store.projects().projects).toContain(root);
  expect(() => store.requireProject(root)).toThrow('项目档案已切换');
  const second = store.open('example.txt');
  expect(second.content).toBe('second project\n');
  expect(() => store.history('example.txt', first.revisions[0].id)).toThrow('版本记录');
  store.save('example.txt', second.hash, 'second edited\n');
  expect(readFileSync(join(root, 'example.txt'), 'utf8')).toBe(first.content);
  store.close();
  store = new ProjectFileStore(root, database);
  expect(store.root).toBe(selected);
  store.selectProject(root);
  expect(store.open('example.txt').revisions).toEqual(first.revisions);
  expect(store.projects().projects.filter((path) => path === root)).toHaveLength(1);
});
it('rejects invalid or private project roots without changing the active project', () => {
  mkdirSync(join(root, '.ssh'));
  mkdirSync(join(root, 'node_modules'));
  mkdirSync(join(root, 'safe'));
  symlinkSync(join(root, '.ssh'), join(root, 'alias'));
  for (const path of [
    'relative',
    join(root, 'missing'),
    join(root, 'example.txt'),
    join(root, '.ssh'),
    join(root, 'alias'),
    join(root, 'node_modules'),
  ]) {
    expect(() => store.selectProject(path)).toThrow();
    expect(store.root).toBe(root);
  }
  store.selectProject(join(root, 'safe'));
  rmSync(join(root, 'safe'), { recursive: true });
  store.close();
  store = new ProjectFileStore(root, database);
  expect(store.root).toBe(join(root, 'safe'));
  expect(() => store.list('')).toThrow();
  store.selectProject(root);
  expect(store.list('').root).toBe(root);
});
