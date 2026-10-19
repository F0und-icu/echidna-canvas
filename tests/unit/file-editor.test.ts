import { expect, it } from 'vitest';
import { bufferDirty, newFileBuffer, refreshFileBuffer } from '../../web/files/fileBuffers';
import { parentDirectories, visibleFileRows, type FileEntry } from '../../web/files/treeRows';
import type { ProjectFile } from '../../contracts/files';

const file: ProjectFile = {
  path: 'docs/notes.md',
  content: '# Notes\r\n',
  hash: 'a'.repeat(64),
  revisions: [
    { id: 1, hash: 'a'.repeat(64), source: 'observed', createdAt: '2026-10-18T10:00:00Z' },
  ],
};
it('preserves a dirty draft while explicitly adopting the newly read disk base for comparison', () => {
  const draft = { ...newFileBuffer(file), editing: true, draft: '# Unsaved\r\n' };
  const next = { ...file, content: '# External edit\r\n', hash: 'b'.repeat(64) };
  const refreshed = refreshFileBuffer(draft, next);
  expect(refreshed).toEqual({ ...draft, file: next, compareDisk: true });
  expect(bufferDirty(refreshed)).toBe(true);
  expect(draft.file).toBe(file);
  expect(refreshFileBuffer(newFileBuffer(file), next)).toEqual(newFileBuffer(next));
});
it('keeps folder siblings and loaded children in a stable visible tree', () => {
  const entries: Record<string, FileEntry[]> = {
    '': [
      { path: 'docs', kind: 'directory' },
      { path: 'src', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
    ],
    docs: [
      { path: 'docs/design', kind: 'directory' },
      { path: 'docs/notes.md', kind: 'file' },
    ],
    'docs/design': [{ path: 'docs/design/route.md', kind: 'file' }],
  };
  expect(
    visibleFileRows(entries, new Set(['docs', 'docs/design']), '').map((row) => [
      row.entry.path,
      row.depth,
      row.parent,
    ]),
  ).toEqual([
    ['docs', 1, ''],
    ['docs/design', 2, 'docs'],
    ['docs/design/route.md', 3, 'docs/design'],
    ['docs/notes.md', 2, 'docs'],
    ['src', 1, ''],
    ['README.md', 1, ''],
  ]);
  expect(
    visibleFileRows(entries, new Set(), 'route').map((row) => [row.entry.path, row.expanded]),
  ).toEqual([
    ['docs', true],
    ['docs/design', true],
    ['docs/design/route.md', false],
  ]);
  expect(visibleFileRows(entries, new Set(), 'SRC').map((row) => row.entry.path)).toEqual(['src']);
  expect(visibleFileRows(entries, new Set(['src']), 'missing')).toEqual([]);
  expect(parentDirectories('docs/design/route.md')).toEqual(['docs', 'docs/design']);
  expect(parentDirectories('README.md')).toEqual([]);
});
