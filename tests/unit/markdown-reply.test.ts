import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownReply, ReplyCard } from '../../web/records/MarkdownReply';
import { RuntimeRound } from '../../web/records/RuntimeRound';
import { graphWorkspace } from '../fixtures/canvas-graph';
import { project } from '../../web/model/projection';
import { runtimeNodes } from '../../web/records/runtimeLayout';

const markdown = [
  '## 检查结果',
  '**已读取**材料。',
  '1. 对照版本\n2. 运行 `check`',
  '| 项目 | 状态 |\n| --- | --- |\n| 输入 | 已核对 |',
  '> 修复尚未验证',
  "~~~sh\nprintf '<raw>'\n~~~",
  '[来源](https://example.com/report)',
].join('\n\n');

it('shows the latest actual message in the reply card while preserving the complete transcript', () => {
  const workspace = graphWorkspace();
  const first = workspace.events.find((entry) => entry.data.type === 'response.updated')!;
  first.runtime = {
    storeId: 'test',
    cursor: first.seq,
    streamId: 'test',
    sourceSeq: 1,
    method: 'item/completed',
    itemId: 'opening',
  };
  if (first.data.type !== 'response.updated') throw new Error('Missing reply fixture');
  const opening = first.data.text;
  for (const [index, text] of ['', '## 实际结论\n\n已经核对。'].entries()) {
    const seq = workspace.events.length + 1;
    workspace.events.push({
      ...first,
      id: 'latest-' + index,
      seq,
      runtime: { ...first.runtime, cursor: seq, sourceSeq: index + 2, itemId: 'final' },
      data: { ...first.data, text: opening + '\n\n' + text },
    });
  }
  const round = project(workspace.events).sessions['graph-agent'].routes[0].rounds[0];
  expect(round.response).toContain(opening);
  expect(round.responsePreview).toBe('## 实际结论\n\n已经核对。');
  expect(runtimeNodes(round).find((node) => node.kind === 'answer')?.excerpt).toBe(
    round.responsePreview,
  );
});

it('renders headings, lists, GFM tables, quotes, code and links without truncating Markdown syntax', () => {
  const html = renderToStaticMarkup(createElement(MarkdownReply, { text: markdown }));
  expect(html).toContain('<h2>检查结果</h2>');
  expect(html).toContain('<strong>已读取</strong>');
  expect(html).toContain('<ol>');
  expect(html).toContain('<code>check</code>');
  expect(html).toContain('<table>');
  expect(html).toContain('<td>已核对</td>');
  expect(html).toContain('<blockquote>');
  expect(html).toContain('class="language-sh"');
  expect(html).toContain('&lt;raw&gt;');
  expect(html).toContain(
    'href="https://example.com/report" target="_blank" rel="noopener noreferrer"',
  );
});

it('keeps active HTML and script URLs inert and displays image references without fetching them', () => {
  const text =
    '<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![材料图](https://example.com/image.png)';
  const html = renderToStaticMarkup(createElement(MarkdownReply, { text }));
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('<img');
  expect(html).toContain('href="https://example.com/image.png"');
  expect(html).toContain('材料图');
});

it('keeps reply links separate from the expand action instead of nesting them inside a button', () => {
  const html = renderToStaticMarkup(
    createElement(ReplyCard, { text: markdown, onInspect: () => {} }),
  );
  expect(html).toContain('<article class="reply-card">');
  expect(html).not.toMatch(/<button[^>]*>[\s\S]*?<a /);
  expect(html).toContain('aria-label="回复：对话记录"');
  expect(html).toContain('<h2>检查结果</h2>');
});

it('renders the real canvas reply as Markdown without changing its stored response or adding decisions', () => {
  const workspace = graphWorkspace();
  const event = workspace.events.find((entry) => entry.data.type === 'response.updated')!;
  if (event.data.type !== 'response.updated') throw new Error('Missing reply fixture');
  event.data.text = markdown;
  const original = JSON.stringify(workspace.events);
  const round = project(workspace.events).sessions['graph-agent'].routes[0].rounds[0];
  const html = renderToStaticMarkup(
    createElement(RuntimeRound, {
      round,
      sessionName: '测试',
      fixture: true,
      phase: '已结束',
      uncertain: false,
      routeId: 'r1',
      index: 0,
      position: { x: 0, y: 0 },
      current: true,
      dimmed: false,
      selectedId: null,
      inspect: () => {},
      statusFor: () => '已回传',
    }),
  );
  expect(html).toContain('<h2>检查结果</h2>');
  expect(html).toContain('<table>');
  expect(round.response).toBe(markdown);
  expect(round.decisions).toEqual([]);
  expect(JSON.stringify(workspace.events)).toBe(original);
});
