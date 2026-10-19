import type { Page } from '@playwright/test';
import type { Workspace } from '../../web/model/schema';

export async function readWorkspace(page: Page): Promise<Workspace> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('echidna-canvas', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const transaction = db.transaction('workspace');
        const request = transaction.objectStore('workspace').get('echidna-canvas.offline.v1');
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
      return JSON.parse(raw);
    } finally {
      db.close();
    }
  });
}
