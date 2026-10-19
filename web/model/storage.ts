import { createWorkspace, parseWorkspace } from './workspace';
import type { Workspace } from './schema';

export const storageKey = 'echidna-canvas.offline.v1';
export type LoadResult =
  { ok: true; workspace: Workspace } | { ok: false; message: string; raw: string | null };
export function loadWorkspace(storage: Pick<Storage, 'getItem'>): LoadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(storageKey);
    return { ok: true, workspace: raw === null ? createWorkspace() : parseWorkspace(raw) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), raw };
  }
}

let database: Promise<IDBDatabase> | undefined;
function workspaceDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('echidna-canvas', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const db = await workspaceDatabase();
  const raw = JSON.stringify(workspace);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite');
    transaction.objectStore('workspace').put(raw, storageKey);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadSavedWorkspace(): Promise<LoadResult> {
  let raw: string | null = null;
  try {
    const db = await workspaceDatabase();
    const stored = await new Promise<string | undefined>((resolve, reject) => {
      const transaction = db.transaction('workspace');
      const request = transaction.objectStore('workspace').get(storageKey);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
    if (stored === undefined) return loadWorkspace(localStorage);
    raw = stored;
    return { ok: true, workspace: parseWorkspace(raw) };
  } catch (error) {
    return { ok: false, message: String(error), raw };
  }
}
