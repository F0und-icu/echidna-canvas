import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileDiff } from '../../web/files/diffLines';
import { FileDiff } from '../../web/files/FileDiff';

it('locates replacements with exact old and new line numbers and retains spaces', () => {
  const diff = fileDiff('title\nold value\nend\n', 'title\nnew value  \nextra\nend\n');
  expect(diff.added).toBe(2);
  expect(diff.removed).toBe(1);
  expect(diff.hunks[0].lines).toEqual([
    { kind: 'context', oldLine: 1, newLine: 1, text: 'title', noNewline: false },
    { kind: 'remove', oldLine: 2, newLine: null, text: 'old value', noNewline: false },
    { kind: 'add', oldLine: null, newLine: 2, text: 'new value  ', noNewline: false },
    { kind: 'add', oldLine: null, newLine: 3, text: 'extra', noNewline: false },
    { kind: 'context', oldLine: 3, newLine: 4, text: 'end', noNewline: false },
  ]);
});
it('marks a missing final newline and exact CRLF changes without inventing visible text', () => {
  const eof = fileDiff('same\n', 'same');
  expect(eof.added).toBe(1);
  expect(eof.removed).toBe(1);
  expect(eof.hunks[0].lines.at(-1)).toMatchObject({ text: 'same', noNewline: true });
  const endings = fileDiff('one\r\n', 'one\n');
  expect(endings.hunks[0].lines.map((line) => line.text)).toEqual(['one\r', 'one']);
});
it('handles empty additions, full deletion and unchanged snapshots', () => {
  expect(fileDiff('', '一行\n').hunks[0].lines[0]).toMatchObject({
    kind: 'add',
    oldLine: null,
    newLine: 1,
    text: '一行',
  });
  expect(fileDiff('one\n', '').hunks[0].lines[0]).toMatchObject({
    kind: 'remove',
    oldLine: 1,
    newLine: null,
  });
  expect(fileDiff('same\n', 'same\n')).toEqual({ added: 0, removed: 0, hunks: [] });
});
it('collapses distant unchanged lines into separate navigable hunks and can expand the full file', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const after = before.replace('line 2\n', 'changed 2\n').replace('line 38\n', 'changed 38\n');
  const compact = fileDiff(before, after),
    full = fileDiff(before, after, true);
  expect(compact.hunks).toHaveLength(2);
  expect(full.hunks).toHaveLength(1);
  expect(compact.added).toBe(2);
  expect(full.added).toBe(2);
  expect(
    full.hunks[0].lines
      .filter((line) => line.kind !== 'add')
      .map((line) => line.text)
      .join('\n') + '\n',
  ).toBe(before);
});
it('renders safe marked additions and removals with explicit comparison identities', () => {
  const html = renderToStaticMarkup(
    createElement(FileDiff, {
      before: '<script>old</script>\n',
      after: '<script>new</script>\n',
      beforeLabel: 'v2',
      afterLabel: 'v3',
      wrap: true,
    }),
  );
  expect(html).toContain('旧：v2');
  expect(html).toContain('新：v3');
  expect(html).toContain('data-kind="remove"');
  expect(html).toContain('data-kind="add"');
  expect(html).toContain('&lt;script&gt;new&lt;/script&gt;');
  expect(html).not.toContain('<script>');
});
