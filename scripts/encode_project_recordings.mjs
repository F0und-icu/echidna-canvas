// Encode full application captures without crops, overlays, or synthetic UI frames.
// Usage: node scripts/encode_project_recordings.mjs /absolute/capture-directory
import { readFile, writeFile, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const source = process.argv[2];
if (!source) throw new Error('Pass the directory containing the full application captures.');
const output = resolve(import.meta.dirname, '../docs/media/project');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'echidna-full-recordings-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  capturedAt: '2026-10-20',
  size: [1920, 1080],
  capture: 'CUA, Page.captureScreenshot, PNG, explicit complete 1920x1080 viewport clip',
  provenance:
    'Existing real Codex task records and actual project files. No new model calls or tool replay.',
  canvas: '实屏 · 真实项目分支',
  agent: 'agent/codex/24670e49-f881-4ed4-a50f-9e3697d0d5e1',
  round: '01a15484-f70f-70b0-8ce1-4d92469b3b25',
  editing:
    'No crops, sidebars, overlays, interpolation or altered UI. Cuts between operation excerpts only.',
  screenshots: [],
  videos: [],
};
function pngSize(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('Expected a native PNG capture.');
  if (bytes.readUInt32BE(16) !== 1920 || bytes.readUInt32BE(20) !== 1080)
    throw new Error('Capture is not a complete 1920x1080 frame.');
}
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`FFmpeg failed (${result.status}).`);
}
for (const name of [
  'canvas',
  'terminal',
  'conclusion',
  'branch-result',
  'project-report',
  'file-history',
  'file-diff',
  'generated-image',
  'create-agent',
]) {
  const original = join(source, name + '.png'),
    bytes = await readFile(original);
  pngSize(bytes);
  await copyFile(original, join(output, name + '.png'));
  manifest.screenshots.push({ file: name + '.png', sha256: hash(bytes) });
}
for (const [name, ids] of [
  ['project-tour', [1, 2, 3, 5]],
  ['project-files', [6, 7, 8, 9, 10, 11, 13]],
  ['project-image', [12]],
]) {
  const concat = ['ffconcat version 1.0'],
    chapters = [];
  let elapsed = 0,
    last;
  for (const id of ids) {
    const dir = resolve(source, `full${id}`);
    const data = JSON.parse(await readFile(join(dir, 'frames.json'), 'utf8'));
    const inputHashes = [];
    for (const [index, frame] of data.frames.entries()) {
      if (!/^frame-\d+\.png$/.test(frame.file)) throw new Error('Unexpected capture filename.');
      const bytes = await readFile(join(dir, frame.file));
      pngSize(bytes);
      const end = data.frames[index + 1]?.ms ?? data.durationMs;
      if (!Number.isFinite(frame.ms) || !(end > frame.ms))
        throw new Error('Invalid capture timing.');
      // Use a local temporary copy so ffconcat never interprets caller-controlled path text.
      last = join(temp, `${name}-${id}-${frame.file}`);
      await copyFile(join(dir, frame.file), last);
      concat.push(`file '${last}'`, `duration ${((end - frame.ms) / 1000).toFixed(6)}`);
      inputHashes.push({ ms: frame.ms, sha256: hash(bytes) });
    }
    chapters.push({
      take: id,
      label: data.label,
      startSeconds: elapsed,
      durationMs: data.durationMs,
      inputFrames: inputHashes,
    });
    elapsed += data.durationMs / 1000;
  }
  concat.push(`file '${last}'`);
  const list = join(temp, name + '.ffconcat');
  await writeFile(list, concat.join('\n') + '\n');
  const video = join(output, name + '.mp4');
  ffmpeg([
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    'fps=12',
    '-t',
    elapsed.toFixed(6),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '12',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ]);
  if (name !== 'project-image') {
    ffmpeg([
      '-i',
      video,
      '-filter_complex',
      '[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a',
      '-loop',
      '0',
      join(output, name + '.gif'),
    ]);
  }
  manifest.videos.push({
    file: name + '.mp4',
    sha256: hash(await readFile(video)),
    durationSeconds: elapsed,
    playbackFps: 12,
    sampling:
      'Approximately 2 native PNG frames per second; playback repeats frames and preserves captured timing.',
    chapters,
  });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await rm(temp, { recursive: true });
