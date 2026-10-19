import { Bot } from 'lucide-react';
import echidnaChibi from '../../design/assets/characters/echidna-black-chibi.png';
import deepseek from '../../design/assets/characters/deepseek.webp';
import deepseekActions from '../../design/assets/characters/deepseek-actions.webp';
import claude from '../../design/assets/characters/claude.webp';
import archivist from '../../design/assets/characters/archivist.webp';
import type { Avatar } from '../model/schema';

export type Pose =
  'idle' | 'thinking' | 'working' | 'reporting' | 'reading' | 'pointing' | 'waiting' | 'talking';
export const avatarNames: Record<Avatar, string> = {
  echidna: 'Echidna 黑发 Q 版',
  deepseek: 'DeepSeek',
  'deepseek-chibi': 'DeepSeek Q 版',
  claude: 'Claude',
  'claude-chibi': 'Claude Q 版',
  none: '无形象',
};
export function Character({
  avatar,
  pose = 'idle',
  height = 150,
}: {
  avatar: Avatar | 'archivist';
  pose?: Pose;
  height?: number;
}) {
  if (avatar === 'none')
    return (
      <span className="character-empty" role="img" aria-label="无角色形象">
        <Bot size={36} />
      </span>
    );
  if (avatar === 'echidna') {
    const cells = [
      [0, 0, 445, 421],
      [445, 0, 390, 421],
      [835, 0, 419, 421],
      [0, 421, 445, 412],
      [445, 421, 390, 412],
      [835, 421, 419, 412],
      [0, 833, 445, 421],
      [445, 833, 390, 421],
      [835, 833, 419, 421],
    ];
    const cellForPose: Record<Pose, number> = {
      idle: 0,
      thinking: 1,
      working: 7,
      reporting: 8,
      reading: 5,
      pointing: 6,
      waiting: 4,
      talking: 0,
    };
    const frames = pose === 'thinking' ? [1, 2, 3, 4] : [cellForPose[pose]];
    return (
      <span
        className="character-figure character-thinking"
        data-pose={pose}
        role="img"
        aria-label={`${avatarNames.echidna} · ${pose}`}
        style={{ width: height, height }}
      >
        {frames.map((cell, index) => {
          const [x, y, width, frameHeight] = cells[cell];
          const scale = height / 445;
          return (
            <span
              key={index}
              className={
                pose === 'thinking'
                  ? `character-thinking-frame thinking-frame-${index}`
                  : 'character-chibi-frame'
              }
              aria-hidden="true"
              style={{
                top: 'auto',
                bottom: 0,
                width: width * scale,
                height: frameHeight * scale,
                backgroundImage: `url(${echidnaChibi})`,
                backgroundSize: `${1254 * scale}px ${1254 * scale}px`,
                backgroundPosition: `${-x * scale}px ${-y * scale}px`,
              }}
            />
          );
        })}
      </span>
    );
  }
  let image: string,
    x = 0,
    y = 0,
    w: number,
    h: number,
    sw: number,
    sh: number;
  if (avatar === 'deepseek-chibi') {
    image = deepseekActions;
    w = 384;
    h = 384;
    sw = 768;
    sh = 768;
    x = pose === 'thinking' || pose === 'reporting' ? 384 : 0;
    y = pose === 'working' || pose === 'reporting' ? 384 : 0;
  } else if (avatar === 'deepseek') {
    image = deepseek;
    w = 438;
    h = 512;
    sw = 768;
    sh = 512;
  } else if (avatar === 'archivist') {
    image = archivist;
    x = pose === 'reading' ? 384 : 0;
    w = 384;
    h = 512;
    sw = 768;
    sh = 512;
  } else {
    image = claude;
    sw = 1536;
    sh = 1024;
    x = avatar === 'claude' ? 145 : 949;
    y = avatar === 'claude' ? 0 : 226;
    w = avatar === 'claude' ? 502 : 432;
    h = avatar === 'claude' ? 1024 : 790;
  }
  return (
    <span
      className="character-figure"
      data-pose={pose}
      role="img"
      aria-label={`${avatar === 'archivist' ? '碧翠丝 · 项目档案' : avatarNames[avatar]} · ${pose}`}
      style={{
        width: (height * w) / h,
        height,
        backgroundImage: `url(${image})`,
        backgroundSize: `${(height * sw) / h}px ${(height * sh) / h}px`,
        backgroundPosition: `${(-height * x) / h}px ${(-height * y) / h}px`,
      }}
    />
  );
}
