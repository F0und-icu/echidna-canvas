import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  archiveIndexSchema,
  type ArchiveIndex,
  type ArchivedFile,
  type ProjectFile,
  fileProjectsSchema,
  type FileProjects,
} from '../../contracts/files';
import { requestRuntime } from '../runtime/connection';
import { requestProject } from './api';

// A file read/save can finish while the initial metadata request is still in flight.
// Revisions are append-only; merging by durable ID keeps that response from erasing a newer node.
export function mergeArchive(current: ArchiveIndex | null, incoming: ArchiveIndex): ArchiveIndex {
  if (!current || current.root !== incoming.root) return incoming;
  const files = new Map(current.files.map((file) => [file.path, file]));
  for (const file of incoming.files) {
    const revisions = new Map(
      files.get(file.path)?.revisions.map((revision) => [revision.id, revision]),
    );
    for (const revision of file.revisions) revisions.set(revision.id, revision);
    files.set(file.path, {
      ...file,
      revisions: [...revisions.values()].sort((a, b) => b.id - a.id),
    });
  }
  return {
    root: incoming.root,
    files: [...files.values()].sort((a, b) => a.revisions.at(-1)!.id - b.revisions.at(-1)!.id),
  };
}
const ArchiveContext = createContext<{
  index: ArchiveIndex | null;
  indexes: Record<string, ArchiveIndex>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  busy: boolean;
  error: string;
  refresh: (root?: string) => Promise<void>;
  switchProject: (root: string) => Promise<FileProjects>;
  remember: (root: string, file: ProjectFile) => void;
}>(null!);
export function ProjectArchiveProvider({ children }: { children: ReactNode }) {
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [indexes, setIndexes] = useState<Record<string, ArchiveIndex>>({});
  const generation = useRef<Record<string, number>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({ '': true }),
    [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = useCallback(async (root?: string) => {
    const key = root ?? '';
    const request = (generation.current[key] ?? 0) + 1;
    generation.current[key] = request;
    setLoading((current) => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: '' }));
    try {
      await requestRuntime('/session');
      const selected =
        root ?? fileProjectsSchema.parse(await requestRuntime('/file-projects')).root;
      const data = archiveIndexSchema.parse(await requestProject(selected, '/file-history'));
      if (request === generation.current[key]) {
        setIndexes((current) => ({
          ...current,
          [selected]: mergeArchive(current[selected] ?? null, data),
        }));
        if (!root) setSelectedRoot(selected);
      }
    } catch (cause) {
      if (request === generation.current[key])
        setErrors((current) => ({ ...current, [key]: String(cause) }));
    } finally {
      if (request === generation.current[key])
        setLoading((current) => ({ ...current, [key]: false }));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const remember = (root: string, { path, revisions }: ArchivedFile) =>
    setIndexes((current) => ({
      ...current,
      [root]: mergeArchive(current[root] ?? null, { root, files: [{ path, revisions }] }),
    }));
  const switchProject = async (root: string) => {
    const selected = fileProjectsSchema.parse(
      await requestRuntime('/file-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      }),
    );
    generation.current[''] = (generation.current[''] ?? 0) + 1;
    setLoading((current) => ({ ...current, '': false }));
    setErrors((current) => ({ ...current, '': '' }));
    setSelectedRoot(selected.root);
    await refresh(selected.root);
    return selected;
  };
  return (
    <ArchiveContext.Provider
      value={{
        index: selectedRoot ? (indexes[selectedRoot] ?? null) : null,
        indexes,
        loading,
        errors,
        busy: !!loading[''] || !!(selectedRoot && loading[selectedRoot]),
        error: errors[''] || (selectedRoot ? errors[selectedRoot] : '') || '',
        refresh,
        remember,
        switchProject,
      }}
    >
      {children}
    </ArchiveContext.Provider>
  );
}
export const useProjectArchive = () => useContext(ArchiveContext);
