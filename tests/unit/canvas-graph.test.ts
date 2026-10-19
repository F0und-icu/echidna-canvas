import { expect, it } from 'vitest';
import { graphWorkspace } from '../fixtures/canvas-graph';
import { project } from '../../web/model/projection';
import {
  recordWidth,
  recordHeight,
  runtimeNodes,
  runtimeLayout,
  focusedReferences,
  runtimeReferencePoints,
  runtimeReferencePath,
  commandPreview,
  runtimeGeometry,
} from '../../web/records/runtimeLayout';
import { canvasNoteSchema, canvasCallSchema } from '../../contracts/canvas';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuntimeRound } from '../../web/records/RuntimeRound';
import type { Round } from '../../web/model/projection';

function renderRuntime(round: Round, fixture = false) {
  return renderToStaticMarkup(
    createElement(RuntimeRound, {
      round,
      sessionName: '测试',
      fixture,
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
}

it('projects task-specific shapes in observed order and retains earlier node positions in history', () => {
  const workspace = graphWorkspace();
  const before = project(workspace.events, 5).sessions['graph-agent'].routes[0].rounds[0];
  const after = project(workspace.events).sessions['graph-agent'].routes[0].rounds[0];
  expect(runtimeNodes(after).map((n) => n.kind)).toEqual([
    'input',
    'intent',
    'decision',
    'tool',
    'material',
    'result',
    'answer',
  ]);
  expect(runtimeNodes(after).slice(0, 3)).toEqual(runtimeNodes(before));
  expect(recordWidth(after)).toBeGreaterThan(recordWidth(before));
  expect(after.notes[2].note.refs).toEqual(['tool:read']);
  expect(after.decisions).toEqual([]);
});
it('rejects fictitious references and malformed choices instead of drawing invented relationships', () => {
  const workspace = graphWorkspace();
  const invalid = structuredClone(workspace.events);
  const event = invalid[4].data;
  if (event.type !== 'canvas.noted') throw new Error('Expected note fixture');
  event.note.refs = ['tool:unseen'];
  expect(() => project(invalid)).toThrow('Unknown canvas reference');
  expect(() =>
    canvasNoteSchema.parse({
      ...event.note,
      refs: [],
      options: event.note.options.map((o) => ({ ...o, selected: true })),
    }),
  ).toThrow('exactly one');
});
it('limits source inspection to the admitted current turn instead of accepting a session or file selector', () => {
  expect(
    canvasCallSchema.parse({ tool: 'echidna_canvas_inspect', arguments: {} }).arguments,
  ).toEqual({});
  expect(() =>
    canvasCallSchema.parse({
      tool: 'echidna_canvas_inspect',
      arguments: { sessionRef: 'another-session' },
    }),
  ).toThrow();
  expect(() =>
    canvasCallSchema.parse({
      tool: 'echidna_canvas_inspect',
      arguments: { path: '/private-file' },
    }),
  ).toThrow();
});
it('shows only the focused node references and never exposes future references in history', () => {
  const workspace = graphWorkspace();
  const nodes = runtimeNodes(project(workspace.events).sessions['graph-agent'].routes[0].rounds[0]);
  expect(focusedReferences(nodes, null)).toEqual([]);
  expect(focusedReferences(nodes, 'note:choice')).toHaveLength(1);
  expect(focusedReferences(nodes, 'note:result')).toHaveLength(2);
  const history = runtimeNodes(
    project(workspace.events, 5).sessions['graph-agent'].routes[0].rounds[0],
  );
  expect(focusedReferences(history, 'note:result')).toEqual([]);
});
it('keeps semantic lanes and all existing positions stable throughout a growing event prefix', () => {
  const workspace = graphWorkspace();
  let previous = new Map<string, number[]>();
  let previousWidth = 0;
  for (let seq = 3; seq <= workspace.events.length; seq++) {
    const round = project(workspace.events, seq).sessions['graph-agent'].routes[0].rounds[0];
    const layout = runtimeLayout(round);
    const positions = new Map(layout.placed.map((entry) => [entry.node.id, [entry.x, entry.y]]));
    for (const [id, point] of previous) expect(positions.get(id)).toEqual(point);
    expect(layout.width).toBeGreaterThanOrEqual(previousWidth);
    for (const entry of layout.placed) {
      expect(entry.x + entry.width).toBeLessThanOrEqual(layout.width);
      if (entry.node.kind === 'material') expect(entry.lane).toBe('material');
      if (entry.node.kind === 'tool') expect(entry.lane).toBe('action');
      if (entry.node.kind === 'decision') expect(entry.lane).toBe('judgment');
    }
    previous = positions;
    previousWidth = layout.width;
  }
});
it('expands crowded chapters without overlapping records or fabricating a decision for tool-only work', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  round.notes = [];
  round.calls = Array.from({ length: 6 }, (_, i) => ({
    ...round.calls[0],
    id: 'read-' + i,
    firstSeq: 10 + i,
  }));
  const layout = runtimeLayout(round);
  expect(layout.chapters).toHaveLength(2);
  expect(layout.chapters[1].heading?.node.kind).toBe('answer');
  expect(layout.placed.filter((entry) => entry.lane === 'action')).toHaveLength(6);
  for (const [i, a] of layout.placed.entries()) {
    for (const b of layout.placed.slice(i + 1)) {
      expect(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      ).toBe(true);
    }
  }
  expect(layout.placed.some((entry) => entry.node.kind === 'decision')).toBe(false);
});
it('renders compact commands and genuine choice branches while keeping raw output in the inspector', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  round.calls[0].tool = 'codex.commandExecution';
  round.calls[0].title = 'rg --files ' + 'a'.repeat(120) + 'raw-command-tail-marker';
  round.calls[0].result = 'raw-output-marker';
  const html = renderRuntime(round);
  expect(html).toContain('终端命令 01');
  expect(html).toContain('rg --fil');
  expect(html.match(/<code class="command-preview">(.*?)<\/code>/)?.[1]).not.toContain(
    'raw-command-tail-marker',
  );
  expect(html).not.toContain('raw-output-marker');
  expect(html).toContain('SSE');
  expect(html).toContain('WebSocket');
  expect(html).toContain('lane-judgment kind-decision');
  expect(html).not.toContain('class="reference"');
  expect(html).toContain('展开回复');
  expect(html).not.toContain('明确的单向推送需求。');
  expect(html).toContain('查看依据：连续推送任务进展');
  expect(html).toContain('data-edge="local-reference"');
  expect(html).not.toContain('node-outline');
});

it('keeps different command targets recognizable when the shell wrapper is identical', () => {
  const snapshot = commandPreview('/bin/zsh -lc "sed -n 1,240p snapshot.json"');
  const log = commandPreview('/bin/zsh -lc "sed -n 1,240p sample.log"');
  expect(snapshot).toContain('snapshot.json');
  expect(log).toContain('sample.log');
  expect(snapshot).not.toEqual(log);
  expect(snapshot).toBe('sed -n 1,240p snapshot.json');
  expect(commandPreview('python3 validate.py --mode compatibility')).toBe(
    'python3 validate.py --mode compatibility',
  );
  expect(commandPreview('/bin/zsh -lc "' + 'x'.repeat(120) + '"')).toBe('x'.repeat(72) + '…');
});

it('renders source-linked image and webpage previews without loading a remote page', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  round.calls[0].previews = [
    {
      kind: 'image',
      path: 'generated.png',
      title: '生成的图像',
      eventId: 'runtime/test/10',
      seq: 10,
      part: 0,
    },
  ];
  const before = runtimeLayout(round);
  const image = before.placed.find((entry) => entry.node.id === 'preview:read')!;
  expect(image.node.refs).toEqual(['tool:read']);
  expect(image.lane).toBe('action');
  let html = renderRuntime(round);
  expect(html).toContain('<img');
  expect(html).toContain('/api/runtime/image?event=runtime%2Ftest%2F10');
  expect(html).not.toContain('查看图像来源');
  expect(html).not.toContain('src="generated.png"');
  round.calls.push({
    ...round.calls[0],
    id: 'web',
    firstSeq: 11,
    tool: 'codex.webSearch',
    title: '打开网页',
    previews: [
      {
        kind: 'webpage',
        url: 'https://example.invalid/page',
        title: 'https://example.invalid/page',
        eventId: 'runtime/test/12',
        seq: 12,
        part: 0,
      },
    ],
  });
  html = renderRuntime(round);
  expect(html).toContain('href="https://example.invalid/page"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('example.invalid');
  expect(html).not.toContain('<iframe');
  const after = runtimeLayout(round);
  for (const prior of before.placed) {
    const current = after.placed.find((entry) => entry.node.id === prior.node.id)!;
    expect([current.x, current.y]).toEqual([prior.x, prior.y]);
  }
});

it('places only recorded references above a heading and limits the visible source strip', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  round.notes[3].note.refs.push('tool:read');
  const layout = runtimeLayout(round);
  const choice = layout.chapters.find((chapter) => chapter.heading?.node.id === 'note:choice')!;
  const result = layout.chapters.find((chapter) => chapter.heading?.node.id === 'note:result')!;
  expect(choice.sources.map((source) => source.node.id)).toEqual(['note:goal']);
  expect(result.sources.map((source) => source.node.id)).toEqual(['note:choice', 'note:source']);
  expect(layout.chapters[0].sources).toEqual([]);
  const html = renderRuntime(round);
  expect(html).toContain('查看全部 3 份依据');
  expect(html).not.toContain('class="reference"');
  expect(html).toContain('查看依据：样本运行说明');
  // A source portal navigates to an existing record; it must not create another fact node.
  expect(html.match(/data-node-id="note:source"/g)).toHaveLength(1);
});

it('keeps source strips clear when a later material arrives in the same chapter', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  const layout = runtimeLayout(round);
  const chapter = layout.chapters.find((chapter) => chapter.heading?.node.id === 'note:choice')!;
  const source = chapter.sources[0],
    material = chapter.materials[0];
  expect(source.x + source.width).toBeLessThan(material.x);
  expect(material.x + material.width).toBeLessThanOrEqual(chapter.left + chapter.width);
});

it('puts a final reply under its result and starts later work clear of the existing reply', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  const before = runtimeLayout(round);
  const result = before.placed.find((entry) => entry.node.id === 'note:result')!;
  const reply = before.placed.find((entry) => entry.node.id === 'answer')!;
  expect(reply.lane).toBe('response');
  expect(reply.chapterLeft).toBe(result.chapterLeft);
  expect(reply.y).toBeGreaterThan(result.y + result.height);
  round.calls.push({ ...round.calls[0], id: 'late', firstSeq: round.responseSeq! + 1 });
  const after = runtimeLayout(round);
  expect(after.placed.find((entry) => entry.node.id === 'answer')).toEqual(reply);
  expect(after.placed.find((entry) => entry.node.id === 'tool:late')!.chapterLeft).toBeGreaterThan(
    reply.chapterLeft,
  );
});

it('puts an ordinary reply on the canvas without inventing a decision or reserving empty tool lanes', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  round.notes = [];
  round.calls = [];
  round.response = '这是这一次对话实际返回的简短回答。';
  const layout = runtimeLayout(round);
  const html = renderRuntime(round);
  expect(layout.placed.map((entry) => entry.node.kind)).toEqual(['input', 'answer']);
  expect(html).toContain('这是这一次对话实际返回的简短回答。');
  expect(html).toContain('reply-card-excerpt');
  expect(html).not.toContain('runtime-options');
  expect(html).not.toContain('runtime-chapter-label');
  expect(html).not.toContain('固定示例');
  expect(recordHeight(round)).toBeLessThan(332);
  const reply = layout.placed.find((entry) => entry.node.kind === 'answer')!;
  round.calls = [
    {
      ...project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0].calls[0],
      firstSeq: round.responseSeq! + 1,
    },
  ];
  const later = runtimeLayout(round);
  expect(later.placed.find((entry) => entry.node.kind === 'answer')).toEqual(reply);
  expect(later.placed.find((entry) => entry.node.kind === 'tool')!.y).toBeGreaterThan(
    reply.y + reply.height,
  );
  round.calls = project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0].calls;
  expect(recordHeight(round)).toBeGreaterThan(layout.height);
});

it('retains an already visible reply while later annotations and a longer answer arrive', () => {
  const workspace = graphWorkspace();
  const response = workspace.events.splice(9, 1)[0];
  workspace.events.splice(3, 0, response);
  workspace.events.splice(-1, 0, {
    ...response,
    id: 'graph/later-response',
    data: { type: 'response.updated', roundId: 'turn-1', text: '追加记录后的实际回答。' },
  });
  workspace.events = workspace.events.map((e, index) => ({ ...e, seq: index + 1 }));
  let initial: number[] | undefined;
  for (let seq = 4; seq <= workspace.events.length; seq++) {
    const round = project(workspace.events, seq).sessions['graph-agent'].routes[0].rounds[0];
    const answer = runtimeLayout(round).placed.find((entry) => entry.node.id === 'answer')!;
    const position = [answer.x, answer.y];
    if (initial) expect(position).toEqual(initial);
    initial = position;
  }
  expect(
    renderRuntime(project(workspace.events).sessions['graph-agent'].routes[0].rounds[0]),
  ).toContain('追加记录后的实际回答。');
});

it('keeps fixed fixture replies visibly labeled on the canvas instead of implying a live answer', () => {
  const round = project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0];
  const html = renderRuntime(round, true);
  expect(html).toContain('固定示例');
  expect(html).toContain('不会理解输入');
  expect(html).toContain('示例回复');
  expect(html).toContain('在此虚构样本中');
});

it('keeps early tools compact and stationary when a later decision needs space for options', () => {
  const workspace = graphWorkspace(),
    source = workspace.events;
  workspace.events = [
    ...source.slice(0, 3),
    source[5],
    source[6],
    source[4],
    ...source.slice(7),
  ].map((event, index) => ({ ...event, seq: index + 1 }));
  const choice = workspace.events[5].data;
  if (choice.type !== 'canvas.noted') throw new Error('Expected decision fixture');
  choice.note.refs = ['tool:read'];
  let initial: number[] | undefined;
  for (let seq = 4; seq <= workspace.events.length; seq++) {
    const round = project(workspace.events, seq).sessions['graph-agent'].routes[0].rounds[0];
    const layout = runtimeLayout(round);
    const tool = layout.placed.find((entry) => entry.node.id === 'tool:read')!;
    const position = [tool.x, tool.y];
    if (initial) expect(position).toEqual(initial);
    initial = position;
    const decision = layout.placed.find((entry) => entry.node.id === 'note:choice');
    if (decision) expect(decision.chapterLeft).toBeGreaterThan(tool.chapterLeft);
  }
  const simple = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  const annotated = recordHeight(simple);
  simple.notes = [];
  expect(recordHeight(simple)).toBeLessThan(annotated);
});

it('routes decision references around nearby tools and all three option buttons', () => {
  const round = structuredClone(
    project(graphWorkspace().events).sessions['graph-agent'].routes[0].rounds[0],
  );
  round.notes[1].note.options.push({ id: 'hold', label: '先保留现状再独立检查', selected: false });
  round.calls.push({ ...round.calls[0], id: 'read-2', firstSeq: 7 });
  const layout = runtimeLayout(round);
  const nodes = runtimeNodes(round);
  for (const target of ['note:result', 'note:choice', 'note:source']) {
    for (const [index, edge] of focusedReferences(nodes, target).entries()) {
      const from = nodes[edge.from].id,
        to = nodes[edge.to].id;
      const points = runtimeReferencePoints(layout, from, to, index);
      expect(runtimeReferencePath(points)).not.toMatch(/NaN|Infinity/);
      const boxes = [
        ...layout.placed.filter((entry) => entry.node.id !== from && entry.node.id !== to),
        ...layout.placed
          .filter((entry) => entry.node.options.length)
          .map((entry) => ({
            ...entry,
            y: runtimeGeometry.optionTop,
            height: runtimeGeometry.optionHeight,
          })),
        ...layout.chapters.flatMap((chapter) =>
          chapter.sources
            .filter((source) => source.portal)
            .map((source) => ({
              ...source,
              y: runtimeGeometry.materialTop,
              height: 32,
            })),
        ),
      ];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const box of boxes) {
          const crosses =
            a.x === b.x
              ? a.x > box.x &&
                a.x < box.x + box.width &&
                Math.min(a.y, b.y) < box.y + box.height &&
                Math.max(a.y, b.y) > box.y
              : a.y > box.y &&
                a.y < box.y + box.height &&
                Math.min(a.x, b.x) < box.x + box.width &&
                Math.max(a.x, b.x) > box.x;
          expect(crosses, `${from} → ${to} crosses ${box.node.id}`).toBe(false);
        }
      }
    }
  }
});

it('rounds reference bends even when a local source and heading share the same gutter', () => {
  const path = runtimeReferencePath([
    { x: 20, y: 40 },
    { x: 0, y: 40 },
    { x: 0, y: 120 },
    { x: 0, y: 120 },
    { x: 0, y: 60 },
    { x: 40, y: 60 },
  ]);
  expect(path).not.toMatch(/NaN|Infinity/);
  expect(path).toContain('Q');
  expect(path.endsWith('L 40 60')).toBe(true);
});
