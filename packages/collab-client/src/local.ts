/**
 * Browser-local storage for a document's binary files (original .docx/.xlsx, images),
 * so documents keep working offline and before the server knows about them.
 * The editable content itself lives in y-indexeddb.
 */

const DB = 'oel-docs-files';
const STORE = 'files';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StoredFile {
  mime: string;
  bytes: Uint8Array;
}

export const localFiles = {
  async put(key: string, file: StoredFile) {
    try {
      await tx('readwrite', (s) => s.put(file, key));
    } catch {
      /* private mode / quota: the server copy is the fallback */
    }
  },
  async get(key: string): Promise<StoredFile | null> {
    try {
      return ((await tx('readonly', (s) => s.get(key))) as StoredFile | undefined) ?? null;
    } catch {
      return null;
    }
  },
  /** Copy every file of `from` to `to` (a local document published to the server). */
  async rekey(from: string, to: string) {
    try {
      const keys = (await tx('readonly', (s) => s.getAllKeys())) as string[];
      for (const k of keys.filter((k) => k.startsWith(`${from}|`))) {
        const f = await this.get(k);
        if (f) await this.put(`${to}|${k.slice(from.length + 1)}`, f);
      }
    } catch {
      /* ignore */
    }
  },
  /** Keys starting with `prefix` (a document's files: `${docId}|`). */
  async keys(prefix: string): Promise<string[]> {
    try {
      return ((await tx('readonly', (s) => s.getAllKeys())) as string[]).filter((k) => typeof k === 'string' && k.startsWith(prefix));
    } catch {
      return [];
    }
  },
  async remove(key: string) {
    try {
      await tx('readwrite', (s) => s.delete(key));
    } catch {
      /* ignore */
    }
  },
};

export const packageKey = (docId: string) => `${docId}|package`;
export const mediaKey = (docId: string, path: string) => `${docId}|media|${path}`;
