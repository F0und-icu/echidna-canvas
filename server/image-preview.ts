import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { RuntimeImageSource } from './runtime-port.ts';

export class ImagePreviewUnavailable extends Error {}

const maxImageBytes = 20 * 1024 * 1024;
export function imageMimeType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
}

export function readInlineImage(source: Extract<RuntimeImageSource, { type: 'inline' }>) {
  if (source.data.length > Math.ceil(maxImageBytes / 3) * 4)
    throw new ImagePreviewUnavailable('预览需要不超过 20 MiB 的图像。');
  if (source.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data))
    throw new ImagePreviewUnavailable('运行时返回的图像编码无效。');
  const bytes = Buffer.from(source.data, 'base64'),
    type = imageMimeType(bytes);
  if (bytes.length > maxImageBytes)
    throw new ImagePreviewUnavailable('预览需要不超过 20 MiB 的图像。');
  if (!type || type !== source.mimeType)
    throw new ImagePreviewUnavailable('图像类型与内容不符；目前支持 PNG、JPEG 和 WebP。');
  return { bytes, type };
}

// Read only an observed image reference inside the configured project, never a
// caller-supplied path. The signature check excludes active documents such as SVG.
export async function readImagePreview(root: string, path: string, generated = false) {
  try {
    const canonicalRoot = await realpath(root);
    const canonicalPath = await realpath(resolve(canonicalRoot, path));
    const child = relative(canonicalRoot, canonicalPath);
    // Native generated outputs may be in Codex's temporary output directory.
    // Only that recorded producer can lift the project boundary, never a query path.
    if (!generated && (child === '..' || child.startsWith('../') || isAbsolute(child)))
      throw new ImagePreviewUnavailable('图像不在当前项目目录内，不能预览。');
    const file = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxImageBytes)
        throw new ImagePreviewUnavailable('预览需要不超过 20 MiB 的图像文件。');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new ImagePreviewUnavailable('图像读取未完成。');
        offset += bytesRead;
      }
      const type = imageMimeType(bytes);
      if (!type) throw new ImagePreviewUnavailable('目前支持 PNG、JPEG 和 WebP 图像预览。');
      return { bytes, type };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof ImagePreviewUnavailable) throw error;
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'EACCES', 'ELOOP'].includes(String(error.code))
    )
      throw new ImagePreviewUnavailable('图像文件已不存在或不可读取。', { cause: error });
    throw error;
  }
}
