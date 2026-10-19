import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext, type AppContextValue } from '../../web/app/context';
import { RoundDetails } from '../../web/records/RoundDetails';
import { project } from '../../web/model/projection';
import { graphWorkspace } from '../fixtures/canvas-graph';

function renderRecord(nodeId?: string, prefix?: number, runtime = false, media = false) {
  const workspace = graphWorkspace();
  if (media) {
    const event = workspace.events.find((event) => event.data.type === 'tool.finished')!;
    if (event.data.type === 'tool.finished')
      event.data.previews = [
        { kind: 'image', sourceIndex: 0, title: '工具图像' },
        { kind: 'image', sourceIndex: 1, title: '第二张图像' },
        { kind: 'webpage', title: '已打开网页', url: 'https://example.com/observed' },
      ];
  }
  const view = project(workspace.events, prefix);
  if (runtime)
    view.sessions['graph-agent'].runtime = {
      backendId: 'codex',
      storeId: 'test-store',
      cursor: 1,
      sessionRef: 'test-session',
      streamId: 'test-stream',
      sourceSeq: 1,
      method: 'thread/started',
    };
  const value: AppContextValue = {
    workspace,
    canvas: workspace.canvases[0],
    view,
    live: view,
    setWorkspace: () => {},
    panel: null,
    openPanel: () => {},
    notify: () => {},
    focusAgent: () => {},
    focusArchive: () => {},
    mcp: { connections: [], error: '', refresh: async () => {}, remember: () => {} },
    runtime: {
      state: null,
      backend: null,
      error: '',
      connected: false,
      connect: async () => undefined,
      refreshBackend: async () => {},
      command: async () => {
        throw new Error('Rendering does not dispatch commands');
      },
      login: async () => {
        throw new Error('Rendering does not log in');
      },
    },
  };
  return renderToStaticMarkup(
    createElement(
      AppContext.Provider,
      { value },
      createElement(RoundDetails, {
        sessionId: 'graph-agent',
        routeId: 'r1',
        roundId: 'turn-1',
        nodeId,
      }),
    ),
  );
}

it('offers direct fragment conversation without the original-route continue action', () => {
  const html = renderRecord('note:choice', undefined, true);
  expect(html).toContain('片段对话消息');
  expect(html).toContain('发送并开支线');
  expect(html).toContain('继承到此处的公开记录');
  expect(html).not.toContain('与 Agent 继续对话');
  expect(renderRecord('tool:read', undefined, true)).toContain('片段对话消息');
  expect(renderRecord('input', undefined, true)).not.toContain('片段对话消息');
});

it('opens only the selected decision, its public basis, genuine choices and reference navigation', () => {
  const html = renderRecord('note:choice');
  expect(html).toContain('明确的单向推送需求。');
  expect(html).toContain('已选方向');
  expect(html).toContain('未选方向');
  expect(html).toContain('引用依据');
  expect(html).toContain('连续推送任务进展');
  expect(html).toContain('后续引用');
  expect(html).toContain('查看整轮记录');
  expect(html).not.toContain('Synthetic sample contents');
  expect(html).not.toContain('用户命令走 HTTP，进度由 SSE 返回。');
});
it('opens the selected tool raw arguments and output directly while retaining receipt provenance', () => {
  const html = renderRecord('tool:read');
  expect(html).toContain('class="command-content" open=""');
  expect(html).toContain('Synthetic sample contents');
  expect(html).toContain('fixture:receipt');
  expect(html).toContain('样本运行说明');
  expect(html).not.toContain('明确的单向推送需求。');
  const full = renderRecord();
  expect(full).toContain('明确的单向推送需求。');
  expect(full).toContain('用户命令走 HTTP，进度由 SSE 返回。');
  expect(full).not.toContain('本轮没有返回可见摘要。');
});
it('does not reveal a selected future node when the history prefix moves backwards', () => {
  const html = renderRecord('note:result', 5);
  expect(html).toContain('这个节点尚未出现在当前历史前缀中。');
  expect(html).not.toContain('命令与事件分离');
  expect(html).not.toContain('用户命令走 HTTP');
});

it('collects every image/page and lets a selected source tool show its own returned media', () => {
  for (const nodeId of ['media', 'tool:read']) {
    const html = renderRecord(nodeId, undefined, false, true);
    expect(html).toContain('工具图像');
    expect(html).toContain('第二张图像');
    expect(html).toContain('https://example.com/observed');
    expect(html).toContain('part=1');
    expect(html).toContain('查看工具来源');
    expect(html).not.toContain('<iframe');
  }
  const old = renderRecord('media', 6, false, true);
  expect(old).toContain('当前历史前缀还没有图片或网页记录');
  expect(old).not.toContain('第二张图像');
  expect(old).not.toContain('example.com');
});
