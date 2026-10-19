import type { Round, ToolCall } from '../model/projection';
import type { CanvasNote } from '../../contracts/canvas';
import type { Point } from '../model/schema';

export interface RuntimeNode {
  id: string;
  kind: CanvasNote['kind'] | 'input' | 'tool' | 'answer' | 'image' | 'webpage';
  title: string;
  detail: string;
  excerpt?: string;
  seq: number;
  refs: string[];
  options: CanvasNote['options'];
  call?: ToolCall;
  preview?: NonNullable<ToolCall['previews']>[number];
}
export function toolLabel(call: ToolCall, index: number): string {
  return call.tool === 'codex.commandExecution'
    ? '终端命令 ' + String(index + 1).padStart(2, '0')
    : call.title;
}
export function recordPreview(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? compact.slice(0, limit) + '…' : compact;
}
export function commandPreview(command: string): string {
  const body = command.replace(/^(?:\S*\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+/, '');
  return recordPreview(body === command ? command : body.replace(/^['"]|['"]$/g, ''), 72);
}
export function focusedReferences(nodes: RuntimeNode[], focusedId: string | null) {
  const node = nodes.find((n) => n.id === focusedId);
  return node
    ? node.refs.map((ref) => ({
        from: nodes.findIndex((n) => n.id === ref),
        to: nodes.indexOf(node),
      }))
    : [];
}
export function runtimeNodes(round: Round): RuntimeNode[] {
  const nodes: RuntimeNode[] = [
    {
      id: 'input',
      kind: 'input',
      title: '当前任务',
      detail: round.input.task,
      seq: round.firstSeq,
      refs: [],
      options: [],
    },
  ];
  nodes.push(...round.notes.map(({ id, seq, note }) => ({ ...note, id: 'note:' + id, seq })));
  nodes.push(
    ...round.calls.map((call, index) => ({
      id: 'tool:' + call.id,
      kind: 'tool' as const,
      title: toolLabel(call, index),
      detail: call.result ?? call.argumentText,
      seq: call.firstSeq,
      refs: [],
      options: [],
      call,
    })),
  );
  for (const call of round.calls) {
    for (const preview of call.previews ?? []) {
      nodes.push({
        id: 'preview:' + call.id + (preview.part ? ':' + preview.part : ''),
        kind: preview.kind,
        title: preview.title,
        detail: preview.kind === 'image' ? (preview.path ?? '运行时返回的图像') : preview.url,
        seq: preview.seq,
        refs: ['tool:' + call.id],
        options: [],
        preview,
      });
    }
  }
  if (round.responseSeq !== undefined)
    nodes.push({
      id: 'answer',
      kind: 'answer',
      title: '对话记录',
      detail: round.response,
      excerpt: round.responsePreview,
      seq: round.responseSeq,
      refs: [],
      options: [],
    });
  return nodes.sort((a, b) => a.seq - b.seq);
}
export interface PlacedRuntimeNode {
  node: RuntimeNode;
  chapterLeft: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lane: 'material' | 'judgment' | 'action' | 'response';
}
export interface RuntimeChapter {
  left: number;
  width: number;
  heading: PlacedRuntimeNode | null;
  reply: PlacedRuntimeNode | null;
  materials: PlacedRuntimeNode[];
  actions: PlacedRuntimeNode[];
  sources: { node: RuntimeNode; x: number; width: number; portal: boolean }[];
}
export const runtimeGeometry = {
  materialTop: 58,
  headingTop: 118,
  headingHeight: 96,
  optionTop: 236,
  optionHeight: 34,
  actionTop: 274,
  decisionActionTop: 316,
  referenceTop: 460,
};

// Chapters group observed records for reading; they are not model sampling steps
// or inferred execution dependencies. Appending records never moves earlier nodes.
export function runtimeLayout(round: Round) {
  const chapters: RuntimeChapter[] = [];
  const placed: PlacedRuntimeNode[] = [];
  let chapter: RuntimeChapter = {
    left: 0,
    width: 340,
    heading: null,
    reply: null,
    materials: [],
    actions: [],
    sources: [],
  };
  chapters.push(chapter);
  for (const node of runtimeNodes(round)) {
    const lane =
      node.kind === 'input' || node.kind === 'material'
        ? 'material'
        : node.kind === 'tool' || node.preview
          ? 'action'
          : node.kind === 'answer' &&
              chapter.heading?.node.kind === 'result' &&
              !chapter.actions.length
            ? 'response'
            : 'judgment';
    if (
      (lane === 'judgment' &&
        (chapter.heading ||
          (['decision', 'answer'].includes(node.kind) && chapter.actions.length))) ||
      (lane === 'action' && chapter.reply)
    ) {
      chapter = {
        left: chapter.left + chapter.width + 48,
        width: 340,
        heading: null,
        reply: null,
        materials: [],
        actions: [],
        sources: [],
      };
      chapters.push(chapter);
    }
    const index =
      lane === 'material'
        ? chapter.materials.length + chapter.sources.filter((source) => source.portal).length
        : chapter.actions.length;
    const entry: PlacedRuntimeNode = {
      node,
      chapterLeft: chapter.left,
      x: chapter.left + (lane === 'judgment' || lane === 'response' ? 20 : 14 + index * 166),
      y:
        lane === 'material'
          ? runtimeGeometry.materialTop
          : lane === 'judgment'
            ? runtimeGeometry.headingTop
            : lane === 'response'
              ? chapter.heading!.y + chapter.heading!.height + 20
              : chapter.heading?.node.kind === 'answer'
                ? chapter.heading.y + chapter.heading.height + 20
                : chapter.heading?.node.kind === 'decision'
                  ? runtimeGeometry.decisionActionTop
                  : runtimeGeometry.actionTop,
      width: lane === 'judgment' || lane === 'response' ? 300 : 148,
      height:
        lane === 'response' || node.kind === 'answer'
          ? 176
          : lane === 'judgment'
            ? node.kind === 'result'
              ? 146
              : runtimeGeometry.headingHeight
            : lane === 'material'
              ? 32
              : node.kind === 'image'
                ? 144
                : 104,
      lane,
    };
    placed.push(entry);
    if (lane === 'judgment') {
      chapter.heading = entry;
      for (const ref of node.refs.slice(0, 2)) {
        const source = placed.find((candidate) => candidate.node.id === ref)!;
        const local = source.chapterLeft === chapter.left && source.lane === 'material';
        const slot =
          chapter.materials.length + chapter.sources.filter((source) => source.portal).length;
        const x = local ? source.x : chapter.left + 14 + slot * 166;
        chapter.sources.push({ node: source.node, x, width: 148, portal: !local });
        chapter.width = Math.max(chapter.width, x + 162 - chapter.left);
      }
    } else if (lane === 'response') chapter.reply = entry;
    else {
      (lane === 'material' ? chapter.materials : chapter.actions).push(entry);
      chapter.width = Math.max(chapter.width, entry.x + entry.width + 14 - chapter.left);
    }
  }
  const contentBottom = placed.reduce(
    (bottom, entry) =>
      Math.max(
        bottom,
        entry.y + entry.height,
        entry.node.options.length ? runtimeGeometry.optionTop + runtimeGeometry.optionHeight : 0,
      ),
    104,
  );
  const referenceCount = placed.reduce(
    (count, entry) => Math.max(count, entry.node.refs.length),
    0,
  );
  return {
    chapters,
    placed,
    width: chapter.left + chapter.width,
    height: Math.max(
      contentBottom + 20,
      referenceCount ? runtimeGeometry.referenceTop + (referenceCount - 1) * 18 + 28 : 0,
    ),
  };
}
export function recordWidth(round: Round): number {
  return round.unit === 'turn' ? runtimeLayout(round).width : 330;
}
export function recordHeight(round: Round): number {
  return round.unit === 'turn' ? runtimeLayout(round).height : 390;
}

export function runtimeReferencePoints(
  layout: ReturnType<typeof runtimeLayout>,
  fromId: string,
  toId: string,
  index: number,
): Point[] {
  const from = layout.placed.find((entry) => entry.node.id === fromId)!;
  const to = layout.placed.find((entry) => entry.node.id === toId)!;
  const lane = runtimeGeometry.referenceTop + index * 18;
  const fromX = from.x + from.width / 2,
    toX = to.x + to.width / 2,
    fromLeft = from.chapterLeft - 10 - index * 4,
    toLeft = to.chapterLeft - 10 - index * 4;
  let start: Point[];
  if (from.lane === 'material') {
    start = [
      { x: fromX, y: from.y },
      { x: fromX, y: runtimeGeometry.materialTop - 14 },
      { x: fromLeft, y: runtimeGeometry.materialTop - 14 },
      { x: fromLeft, y: lane },
    ];
  } else if (from.lane === 'judgment') {
    const chapter = layout.chapters.find((entry) => entry.left === from.chapterLeft)!;
    const right = chapter.left + chapter.width + 10 + index * 4;
    start = [
      { x: from.x + from.width, y: from.y + from.height / 2 },
      { x: right, y: from.y + from.height / 2 },
      { x: right, y: lane },
    ];
  } else {
    start = [
      { x: fromX, y: from.y + from.height },
      { x: fromX, y: lane },
    ];
  }
  const end: Point[] =
    to.lane === 'material'
      ? [
          { x: toLeft, y: lane },
          { x: toLeft, y: runtimeGeometry.materialTop - 14 },
          { x: toX, y: runtimeGeometry.materialTop - 14 },
          { x: toX, y: to.y },
        ]
      : to.lane === 'judgment'
        ? [
            { x: toLeft, y: lane },
            { x: toLeft, y: to.y + to.height / 2 },
            { x: to.x, y: to.y + to.height / 2 },
          ]
        : [
            { x: toX, y: lane },
            { x: toX, y: to.y + to.height },
          ];
  return [...start, ...end];
}

export function runtimeReferencePath(points: Point[]): string {
  const corners = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  let path = `M ${corners[0].x} ${corners[0].y}`;
  for (let i = 1; i < corners.length - 1; i++) {
    const previous = corners[i - 1],
      corner = corners[i],
      next = corners[i + 1];
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(8, before / 2, after / 2);
    path += ` L ${corner.x - ((corner.x - previous.x) / before) * radius} ${corner.y - ((corner.y - previous.y) / before) * radius}`;
    path += ` Q ${corner.x} ${corner.y} ${corner.x + ((next.x - corner.x) / after) * radius} ${corner.y + ((next.y - corner.y) / after) * radius}`;
  }
  const end = corners.at(-1)!;
  return path + ` L ${end.x} ${end.y}`;
}
