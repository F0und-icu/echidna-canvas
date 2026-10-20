// Build documentation graphics from preserved native screenshots and an explicit contract diagram.
// Usage: node scripts/build_readme_media.mjs <bundled-node_modules> <CJK-font-file>
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [modules, font] = process.argv.slice(2);
if (!modules || !font) throw new Error('Pass node_modules and a CJK font file.');
const require = createRequire(import.meta.url);
const { createCanvas, loadImage, GlobalFonts } = require(join(resolve(modules), '@napi-rs/canvas'));
if (!GlobalFonts.registerFromPath(resolve(font), 'DocSans')) throw new Error('Cannot load font.');
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'docs/media');
await mkdir(output, { recursive: true });
const C = {
  paper: '#F6F3ED',
  card: '#FAF8F4',
  ink: '#2C2B27',
  muted: '#777266',
  edge: '#D9D2C7',
  green: '#536B50',
  greenSoft: '#E8ECE3',
  brown: '#866046',
  brownSoft: '#EEE1D4',
  orange: '#B38B65',
};
const manifest = {
  version: 1,
  imageSize: [1600, 1000],
  originals: {},
  images: [],
  animation: null,
};
function rounded(ctx, x, y, w, h, fill, stroke = C.edge, radius = 20) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
function text(ctx, value, x, y, size = 28, color = C.ink, weight = 400) {
  ctx.font = `${weight} ${size}px DocSans`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
}
function lines(ctx, values, x, y, size = 28, color = C.muted, leading = 1.6) {
  values.forEach((s, i) => text(ctx, s, x, y + i * size * leading, size, color));
}
function arrow(ctx, points, color = C.green, dashed = false, width = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [9, 8] : []);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  points.slice(1).forEach((p) => ctx.lineTo(...p));
  ctx.stroke();
  ctx.setLineDash([]);
  const end = points.at(-1),
    prev = points.at(-2);
  const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  ctx.beginPath();
  ctx.moveTo(...end);
  ctx.lineTo(end[0] - 12 * Math.cos(angle - 0.45), end[1] - 12 * Math.sin(angle - 0.45));
  ctx.moveTo(...end);
  ctx.lineTo(end[0] - 12 * Math.cos(angle + 0.45), end[1] - 12 * Math.sin(angle + 0.45));
  ctx.stroke();
}
function pill(ctx, label, x, y, w, green = true) {
  rounded(ctx, x, y, w, 44, green ? C.greenSoft : C.brownSoft, null, 22);
  text(ctx, label, x + 18, y + 10, 21, green ? C.green : C.brown, 500);
}
function miniNode(ctx, label, x, y, w, green = false) {
  rounded(ctx, x, y, w, 70, green ? C.greenSoft : C.card, green ? C.green : C.edge, 16);
  text(ctx, label, x + 18, y + 22, 22, green ? C.green : C.ink, 500);
}
function branchSketch(ctx, x, y) {
  miniNode(ctx, '共同前缀', x, y + 60, 160, true);
  miniNode(ctx, '主线后续', x + 270, y, 160);
  miniNode(ctx, '独立支线', x + 270, y + 130, 160, true);
  arrow(ctx, [
    [x + 160, y + 95],
    [x + 210, y + 95],
    [x + 210, y + 35],
    [x + 268, y + 35],
  ]);
  arrow(
    ctx,
    [
      [x + 210, y + 95],
      [x + 210, y + 165],
      [x + 268, y + 165],
    ],
    C.brown,
    true,
  );
}
const cards = [
  {
    id: 'fragment-branch',
    number: '01',
    tag: 'CONTEXT BRANCH',
    title: ['从一个片段，', '探索另一个想法。'],
    description: ['选中工具回执，直接写下替代方案。', '共同前缀保留，后续对话各自继续。'],
    bullets: ['选择具体起点', '输入新的方向', '发送并开启独立支线'],
    crop: [725, 295, 680, 725],
    note: '真实界面 · 示例草稿未发送',
    sketch: 'branch',
  },
  {
    id: 'create-agent',
    number: '02',
    tag: 'HARNESS + PROJECT',
    title: ['选好能力与项目，', '再开始一段任务。'],
    description: ['自动连接已接入的 Codex harness。', '模型来自实际目录，工作目录明确绑定。'],
    bullets: ['自动或手动选择 harness', '选择真实项目目录', '发送第一条消息后开始执行'],
    crop: [575, 410, 820, 860],
    note: '真实界面 · 未创建新 Agent',
    sketch: 'create',
  },
  {
    id: 'file-history-diff',
    number: '03',
    tag: 'FILES + HISTORY',
    title: ['沿着版本路线，', '看清文件改了哪里。'],
    description: ['从档案角色进入真实项目文件。', '选择历史版本，直接比较逐行增删。'],
    bullets: ['版本连线保留观察顺序', '旧行与新行并排定位', '保存前核对外部修改'],
    crop: [620, 590, 775, 450],
    note: '真实记录 + 文档摘录 · notes.md：v3 → v4，+3 / −2 行',
    sketch: 'files',
  },
  {
    id: 'mcp-config',
    number: '04',
    tag: 'SHARED CAPABILITIES',
    title: ['把工具放到画布，', '连接给需要的 Agent。'],
    description: ['MCP 接入独立保存，绑定引用具体版本。', '多个项目可使用同一网关，各自保持会话。'],
    bullets: ['配置网关地址与认证方式', '从图标连线到目标角色', '明确应用，再核对工具就绪'],
    crop: [725, 295, 680, 610],
    note: '真实配置 · 本地样本网关，未执行 Docker 操作',
    sketch: 'mcp',
  },
  {
    id: 'conversation-controls',
    number: '05',
    tag: 'HUMAN IN THE LOOP',
    title: ['方向变了，', '随时回来纠正。'],
    description: ['在当前会话追加纠正，或保留另一种想法。', '运行时请求打断，等待确认后再继续。'],
    bullets: ['纠正草稿先保留', '中断请求与确认分开显示', '旧路线和未知结果继续可见'],
    crop: [725, 295, 680, 725],
    note: '真实界面 · 回合已结束，打断按钮禁用',
    sketch: 'steer',
  },
];
for (const card of cards) {
  const source = join(root, 'docs/screenshots', card.id + '.png');
  const sourceBytes = await readFile(source);
  const sourceImage = await loadImage(sourceBytes);
  manifest.originals[card.id] = {
    path: `docs/screenshots/${card.id}.png`,
    width: sourceImage.width,
    height: sourceImage.height,
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  };
  const canvas = createCanvas(1600, 1000),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, 1600, 1000);
  text(ctx, 'ECHIDNA CANVAS', 64, 48, 23, C.brown, 600);
  text(ctx, `${card.number} / ${card.tag}`, 64, 104, 21, C.muted);
  lines(ctx, card.title, 64, 176, 48, C.ink, 1.35);
  lines(ctx, card.description, 64, 338, 25, C.muted, 1.7);
  if (card.sketch === 'branch' || card.sketch === 'steer') branchSketch(ctx, 72, 465);
  if (card.sketch === 'create') {
    miniNode(ctx, 'Codex', 72, 510, 140, true);
    miniNode(ctx, '独立 Agent', 300, 510, 170);
    miniNode(ctx, '项目档案', 300, 625, 170);
    arrow(ctx, [
      [212, 545],
      [298, 545],
    ]);
    arrow(
      ctx,
      [
        [384, 580],
        [384, 623],
      ],
      C.brown,
      true,
    );
  }
  if (card.sketch === 'files') {
    miniNode(ctx, 'v3', 72, 520, 120);
    miniNode(ctx, 'v4', 300, 520, 120, true);
    arrow(ctx, [
      [192, 555],
      [298, 555],
    ]);
    pill(ctx, '+3 行  /  −2 行', 200, 640, 220);
  }
  if (card.sketch === 'mcp') {
    text(ctx, '支持的认证方式 / 文档注解', 850, 802, 19, C.muted);
    text(ctx, '无需认证 · Bearer · API Key · OAuth', 850, 845, 23, C.brown);
  }
  if (card.sketch === 'mcp') {
    miniNode(ctx, 'MCP · v1', 72, 535, 155, true);
    miniNode(ctx, '项目 A · Agent', 340, 470, 215);
    miniNode(ctx, '项目 B · Agent', 340, 600, 215);
    arrow(
      ctx,
      [
        [227, 570],
        [275, 570],
        [275, 505],
        [338, 505],
      ],
      C.brown,
      true,
    );
    arrow(
      ctx,
      [
        [275, 570],
        [275, 635],
        [338, 635],
      ],
      C.brown,
      true,
    );
  }
  card.bullets.forEach((label, i) => {
    pill(ctx, String(i + 1), 66, 768 + i * 46, 44);
    text(ctx, label, 125, 777 + i * 46, 23, C.ink);
  });
  rounded(ctx, 802, 88, 744, 820, '#FAF8F4', C.edge, 28);
  text(ctx, '应用实屏 / 原始 PNG 取景', 828, 108, 19, C.muted);
  const [sx, sy, sw, sh] = card.crop;
  const scale = Math.min(680 / sw, 730 / sh);
  const dw = sw * scale,
    dh = sh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(830, 160, 688, 730, 16);
  ctx.clip();
  ctx.drawImage(sourceImage, sx, sy, sw, sh, 1174 - dw / 2, 160, dw, dh);
  ctx.restore();
  if (card.sketch === 'files') {
    text(ctx, '修改要点 / 文档摘录', 850, 585, 19, C.muted);
    const excerpts = [
      ['− 状态：外部编辑新增，不应被旧草稿覆盖', false],
      ['+ 状态：已从画布保存并核对外部变化', true],
      ['+ 外部记录：外部编辑新增，不应被旧草稿覆盖', true],
    ];
    excerpts.forEach(([label, added], i) => {
      rounded(ctx, 845, 633 + i * 70, 660, 58, added ? C.greenSoft : C.brownSoft, null, 10);
      text(ctx, label, 860, 651 + i * 70, 21, added ? C.green : C.brown);
    });
  }
  text(ctx, card.note, 64, 945, 20, C.muted);
  text(ctx, `${card.number} / 05`, 1430, 945, 20, C.brown);
  const path = join(output, `${card.id}.png`);
  await writeFile(path, canvas.toBuffer('image/png'));
  manifest.images.push({
    path: `docs/media/${card.id}.png`,
    source: `docs/screenshots/${card.id}.png`,
    crop: card.crop,
    kind: 'annotated-native-screenshot',
  });
}

// The animated diagram illustrates the documented context contract; it is not a new execution.
const width = 1600,
  height = 1000,
  fps = 12,
  seconds = 18;
const frames = await mkdtemp(join(tmpdir(), 'echidna-readme-frames-'));
const chapters = [
  { at: 0, title: '先保留一段共同经历', detail: '输入、材料与工具回执形成公开记录。' },
  { at: 3, title: '在片段处，提出另一个想法', detail: '选择一个已记录的起点，再写下替代方向。' },
  { at: 6, title: '从这里创建独立支线', detail: '支线继承截至此处的公开记录。' },
  { at: 9, title: '主线继续，支线独立探索', detail: '主线后来的对话不会混入支线上下文。' },
  { at: 13, title: '分别保留两条路线的结果', detail: '对话隔离；共享文件与外部状态仍是当前版本。' },
];
function node(ctx, label, subtitle, x, y, w, active, color = C.green) {
  rounded(ctx, x, y, w, 100, active ? C.card : '#F0EDE7', active ? color : C.edge, 20);
  text(ctx, label, x + 20, y + 20, 27, active ? C.ink : '#B4AFA6', 600);
  text(ctx, subtitle, x + 20, y + 62, 18, active ? C.muted : '#B4AFA6');
}
for (let i = 0; i < fps * seconds; i++) {
  const t = i / fps,
    chapter = chapters.filter((x) => x.at <= t).at(-1);
  const canvas = createCanvas(width, height),
    ctx = canvas.getContext('2d');
  ctx.scale(1.25, 1.25);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, 1280, 800);
  text(ctx, 'ECHIDNA CANVAS / CONTEXT BRANCH', 58, 40, 19, C.brown, 600);
  pill(ctx, '功能示意动画', 1040, 30, 180, false);
  text(ctx, chapter.title, 58, 108, 40, C.ink, 600);
  text(ctx, chapter.detail, 58, 174, 24, C.muted);
  node(ctx, '任务输入', '共同前缀', 58, 360, 190, true);
  node(ctx, '工具回执', '选择这个片段', 310, 360, 220, t >= 1);
  arrow(
    ctx,
    [
      [248, 410],
      [308, 410],
    ],
    t >= 1 ? C.green : C.edge,
  );
  node(ctx, '主线后续', '新的对话', 700, 275, 205, t >= 9);
  node(ctx, '主线结果', '保留原路线', 1000, 275, 210, t >= 13);
  node(ctx, '另一种想法', '独立上下文', 700, 515, 205, t >= 6, C.brown);
  node(ctx, '支线结果', '独立探索', 1000, 515, 210, t >= 13, C.brown);
  if (t >= 3) {
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(300, 350, 240, 120, 25);
    ctx.stroke();
    pill(ctx, '从此片段对话', 320, 290, 200);
  }
  if (t >= 6) {
    const progress = Math.min(1, (t - 6) / 1.2);
    arrow(
      ctx,
      [
        [530, 410],
        [610, 410],
        [610, 565],
        [610 + 88 * progress, 565],
      ],
      C.brown,
      true,
    );
    text(ctx, '继承到此处', 544, 604, 20, C.brown);
  }
  if (t >= 9)
    arrow(ctx, [
      [530, 410],
      [610, 410],
      [610, 325],
      [698, 325],
    ]);
  if (t >= 13) {
    arrow(ctx, [
      [905, 325],
      [998, 325],
    ]);
    arrow(
      ctx,
      [
        [905, 565],
        [998, 565],
      ],
      C.brown,
      true,
    );
    pill(ctx, '后续互不混入', 738, 420, 200, false);
  }
  ctx.fillStyle = C.edge;
  ctx.fillRect(58, 716, 1162, 2);
  text(ctx, '对话隔离 · 文件保持当前状态 · 旧工具不重放', 58, 742, 21, C.muted);
  ctx.fillStyle = C.green;
  ctx.fillRect(58, 716, 1162 * ((i + 1) / (fps * seconds)), 3);
  const bytes = canvas.toBuffer('image/png');
  await writeFile(join(frames, `${String(i).padStart(4, '0')}.png`), bytes);
  if (i === 16 * fps) await writeFile(join(output, 'context-branch-poster.png'), bytes);
}
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`ffmpeg failed: ${result.stderr}`, { cause: result.error });
}
ffmpeg([
  '-framerate',
  String(fps),
  '-i',
  join(frames, '%04d.png'),
  '-c:v',
  'libx264',
  '-crf',
  '16',
  '-preset',
  'slow',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  join(output, 'context-branch.mp4'),
]);
ffmpeg([
  '-framerate',
  String(fps),
  '-i',
  join(frames, '%04d.png'),
  '-filter_complex',
  '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a',
  '-loop',
  '0',
  join(output, 'context-branch.gif'),
]);
manifest.animation = {
  kind: 'illustrated-contract-explainer',
  duration: seconds,
  fps,
  width,
  height,
  chapters,
  gif: 'docs/media/context-branch.gif',
  video: 'docs/media/context-branch.mp4',
  audio: false,
};
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await rm(frames, { recursive: true });
console.log(JSON.stringify({ images: manifest.images.length, duration: seconds, output }));
