import { structuredPatch } from 'diff';

export type DiffLine = {
  kind: 'add' | 'remove' | 'context';
  oldLine: number | null;
  newLine: number | null;
  text: string;
  noNewline: boolean;
};
export function fileDiff(before: string, after: string, full = false) {
  const patch = structuredPatch('before', 'after', before, after, undefined, undefined, {
    context: full ? Infinity : 3,
  });
  let added = 0,
    removed = 0;
  const hunks = patch.hunks.map((hunk) => {
    let oldLine = hunk.oldStart,
      newLine = hunk.newStart;
    const lines: DiffLine[] = [];
    for (const raw of hunk.lines) {
      const prefix = raw[0];
      if (prefix === '\\') {
        lines.at(-1)!.noNewline = true;
        continue;
      }
      const kind = prefix === '+' ? 'add' : prefix === '-' ? 'remove' : 'context';
      if (kind === 'add') added++;
      if (kind === 'remove') removed++;
      lines.push({
        kind,
        oldLine: kind === 'add' ? null : oldLine++,
        newLine: kind === 'remove' ? null : newLine++,
        text: raw.slice(1),
        noNewline: false,
      });
    }
    return { ...hunk, lines };
  });
  return { hunks, added, removed };
}
