import type { FileList } from '../../contracts/files';
export type FileEntry = FileList['entries'][number];
export type TreeRow = { entry: FileEntry; depth: number; parent: string; expanded: boolean };
export function parentDirectories(path: string) {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
export function visibleFileRows(
  directories: Record<string, FileEntry[]>,
  expanded: ReadonlySet<string>,
  query: string,
): TreeRow[] {
  const term = query.trim().toLocaleLowerCase();
  const walk = (parent: string, depth: number): TreeRow[] =>
    (directories[parent] ?? []).flatMap((entry) => {
      const children =
        entry.kind === 'directory' && (term || expanded.has(entry.path))
          ? walk(entry.path, depth + 1)
          : [];
      if (term && !entry.path.toLocaleLowerCase().includes(term) && !children.length) return [];
      return [
        {
          entry,
          depth,
          parent,
          expanded:
            entry.kind === 'directory' &&
            (expanded.has(entry.path) || Boolean(term && children.length)),
        },
        ...children,
      ];
    });
  return walk('', 1);
}
