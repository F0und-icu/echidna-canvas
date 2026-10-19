import type { ProjectFile } from '../../contracts/files';

export type FileBuffer = {
  file: ProjectFile;
  draft: string;
  editing: boolean;
  compareDisk: boolean;
};
export function newFileBuffer(file: ProjectFile): FileBuffer {
  return { file, draft: file.content, editing: false, compareDisk: false };
}
export const bufferDirty = (buffer: FileBuffer) => buffer.draft !== buffer.file.content;
export function refreshFileBuffer(buffer: FileBuffer, file: ProjectFile): FileBuffer {
  return bufferDirty(buffer) ? { ...buffer, file, compareDisk: true } : newFileBuffer(file);
}
