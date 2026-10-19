import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevisionGraph, revisionGraphWidth } from '../../web/files/RevisionGraph';
import { mergeArchive } from '../../web/files/archive';
import { archiveBounds, archiveGraphX } from '../../web/files/archiveLayout';
import type { ArchivedFile } from '../../contracts/files';

const revisions: ArchivedFile['revisions'] = [
  { id: 26, hash: '4'.repeat(64), source: 'editor', createdAt: '2026-10-18T09:20:00Z' },
  { id: 19, hash: '3'.repeat(64), source: 'observed', createdAt: '2026-10-18T09:15:00Z' },
  { id: 11, hash: '2'.repeat(64), source: 'editor', createdAt: '2026-10-18T09:10:00Z' },
  { id: 7, hash: '1'.repeat(64), source: 'observed', createdAt: '2026-10-18T09:00:00Z' },
];
it('connects durable revisions in recorded order and distinguishes observations from saves', () => {
  const html = renderToStaticMarkup(
    createElement(RevisionGraph, {
      revisions,
      selectedId: 19,
      onSelect: () => {
        throw new Error('Rendering must not select or write a file');
      },
    }),
  );
  expect(
    [...html.matchAll(/data-from="(\d+)" data-to="(\d+)" data-kind="([^"]+)"/g)].map((match) =>
      match.slice(1),
    ),
  ).toEqual([
    ['7', '11', 'editor'],
    ['11', '19', 'observed'],
    ['19', '26', 'editor'],
  ]);
  expect(html).toContain('查看版本 v1 · 首次读取');
  expect(html).toContain('查看版本 v3 · 读取到变化');
  expect(html).toContain('class="revision-observed-wire"');
  expect(html).toContain(
    'data-revision="19" aria-label="查看版本 v3 · 读取到变化" aria-pressed="true"',
  );
  expect(html.match(/最新记录/g)).toHaveLength(1);
  expect(revisions.map((revision) => revision.id)).toEqual([26, 19, 11, 7]);
});
it('keeps a single first-read node without inventing an incoming edit', () => {
  const html = renderToStaticMarkup(
    createElement(RevisionGraph, { revisions: revisions.slice(-1), onSelect: () => {} }),
  );
  expect(html).not.toContain('data-from=');
  expect(html).toContain('首次读取');
  const bounds = archiveBounds([{ path: 'one.md', revisions }]);
  expect(bounds.w).toBe(archiveGraphX + revisionGraphWidth(4));
});
it('merges late metadata without erasing newer reads and keeps files ordered by their first record', () => {
  const current = { root: '/project', files: [{ path: 'a.md', revisions }] };
  const old = { root: '/project', files: [{ path: 'a.md', revisions: revisions.slice(2) }] };
  expect(mergeArchive(current, old)).toEqual(current);
  const another = { path: 'b.md', revisions: [{ ...revisions[0], id: 30 }] };
  expect(
    mergeArchive(current, { root: '/project', files: [another] }).files.map((file) => file.path),
  ).toEqual(['a.md', 'b.md']);
  const otherRoot = { root: '/different', files: [another] };
  expect(mergeArchive(current, otherRoot)).toBe(otherRoot);
});
