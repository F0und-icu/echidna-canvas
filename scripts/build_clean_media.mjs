// Compose documentation around captured UI. Never redraw or replace the UI itself.
// Usage: node scripts/build_clean_media.mjs <node_modules> <CJK-font-file>
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const [modules, font] = process.argv.slice(2);
if (!modules || !font) throw new Error('Pass node_modules and a CJK font file.');
const require = createRequire(import.meta.url);
const { createCanvas, loadImage, GlobalFonts } = require(join(resolve(modules), '@napi-rs/canvas'));
if (!GlobalFonts.registerFromPath(resolve(font), 'DocSans')) throw new Error('Cannot load font.');
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'docs/media');
const temp = await mkdtemp(join(tmpdir(), 'echidna-clean-media-'));
const ink = '#2C2B27',
  muted = '#777268',
  green = '#53684F',
  brown = '#825B42';
const cards = [
  {
    id: 'ui-branch',
    source: 'fragment-branch',
    title: ['从一个片段，', '开启另一个想法。'],
    subtitle: ['保留共同前缀。', '之后的对话各自继续。'],
    steps: ['选择工具片段', '写下想探索的新方向', '发送，生成独立角色与对话'],
    detail: ['录制环境：离线协议示例', '固定回复，不调用模型或执行命令。'],
    recording: true,
  },
  {
    id: 'ui-files',
    source: 'file-history-diff',
    title: ['每一次修改，', '都有迹可循。'],
    subtitle: ['文件写入真实样本目录。', '沿版本路线查看逐行变化。'],
    steps: ['打开项目笔记', '修改内容并显式保存', '查看 v1 → v2 的增删位置'],
    detail: ['真实文件操作 · 公开演示样本', '只修改独立样本，不改动原项目文件。'],
    recording: true,
  },
  {
    id: 'ui-create-agent',
    source: 'create-agent',
    title: ['能力与项目，', '在创建时一起选好。'],
    subtitle: ['自动发现本地 harness。', '绑定项目，预填可用模型。'],
    steps: ['自动或手动选择接入', '选择已有项目档案', '创建独立会话，再发送任务'],
    detail: ['实际配置界面 · 协议演示后端', '此张取景未再次创建 Agent。'],
  },
  {
    id: 'ui-version-route',
    source: 'file-version-route',
    title: ['沿着版本连线，', '回到每次变化。'],
    subtitle: ['首次读取与手动保存分别记录。', '选择版本，再检查内容差异。'],
    steps: ['项目档案作为入口', '版本按观察顺序连接', '切换对照范围，定位修改'],
    detail: ['真实文件版本 · v1 → v2', '连线不推测外部修改者。'],
  },
];

function text(ctx, value, x, y, size, color = ink, weight = 400) {
  ctx.font = `${weight} ${size}px DocSans`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
}
function background(card) {
  const canvas = createCanvas(1600, 1000),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F6F3ED';
  ctx.fillRect(0, 0, 1600, 1000);
  text(ctx, 'ECHIDNA CANVAS', 64, 58, 22, brown, 600);
  text(
    ctx,
    card.recording ? '实际界面录制 / 操作节选' : '实际界面 / 原生 PNG 取景',
    64,
    104,
    21,
    muted,
  );
  card.title.forEach((line, i) => text(ctx, line, 64, 205 + i * 74, 52, ink, 600));
  card.subtitle.forEach((line, i) => text(ctx, line, 66, 402 + i * 44, 27, muted));
  card.steps.forEach((line, i) => {
    const y = 578 + i * 72;
    ctx.beginPath();
    ctx.arc(84, y + 17, 19, 0, Math.PI * 2);
    ctx.fillStyle = '#E7EADF';
    ctx.fill();
    text(ctx, String(i + 1), 78, y + 3, 23, green, 600);
    text(ctx, line, 124, y, 26, ink);
  });
  card.detail.forEach((line, i) => text(ctx, line, 66, 864 + i * 34, 20, muted));
  ctx.beginPath();
  ctx.roundRect(898, 46, 646, 904, 16);
  ctx.fillStyle = '#FAF8F4';
  ctx.fill();
  return canvas;
}
function run(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`FFmpeg failed (${result.status}).`);
}
for (const card of cards) {
  const canvas = background(card),
    ctx = canvas.getContext('2d');
  const bg = join(temp, `${card.id}-bg.png`);
  await writeFile(bg, canvas.toBuffer('image/png'));
  const source = await loadImage(await readFile(join(output, 'clean', card.source + '.png')));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(899, 47, 644, 902, 14);
  ctx.clip();
  ctx.drawImage(source, 899, 47, 644, 900);
  ctx.restore();
  await writeFile(join(output, `${card.id}-poster.png`), canvas.toBuffer('image/png'));
  if (card.recording) {
    const native = join(output, 'recordings', `${card.id}-native.mp4`);
    const video = join(output, `${card.id}.mp4`);
    run([
      '-i',
      native,
      '-loop',
      '1',
      '-framerate',
      '12',
      '-i',
      bg,
      '-filter_complex',
      '[0:v]scale=644:900[ui];[1:v][ui]overlay=899:47:shortest=1,format=yuv420p[out]',
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-movflags',
      '+faststart',
      video,
    ]);
    run([
      '-i',
      video,
      '-filter_complex',
      '[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a',
      '-loop',
      '0',
      join(output, `${card.id}.gif`),
    ]);
  }
}
await rm(temp, { recursive: true });
