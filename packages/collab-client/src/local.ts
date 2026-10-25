/**
 * Browser-local storage for a document's binary files (original .docx/.xlsx, images),
 * so documents keep working offline and before the server knows about them.
 * The editable content itself lives in y-indexeddb.
 *
 * A write that fails (full disk, private window) is reported to `onStorageFailure`: in the
 * single-user edition this device holds the only copy, so the app must say so. The refused file
 * stays in memory for this tab, so editing and « Exporter le bureau » still have it.
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

/** Writes not yet committed, for `settleLocalFiles`. */
const writing = new Set<Promise<unknown>>();

/** Resolves once the writes started so far have committed or failed. */
export async function settleLocalFiles(): Promise<void> {
  await Promise.allSettled([...writing]);
}

/** Runs one request; a write resolves once its transaction commits (a full disk aborts it after the request succeeded). */
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const p = run(mode, fn);
  if (mode !== 'readonly') {
    writing.add(p);
    const done = () => void writing.delete(p);
    p.then(done, done);
  }
  return p;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onerror = () => reject(req.error);
    if (mode === 'readonly') req.onsuccess = () => resolve(req.result);
    else t.oncomplete = () => resolve(req.result);
    t.onabort = () => reject(t.error ?? req.error);
  });
}

/* ── failed writes ────────────────────────────────────────────────────────────────────────── */

export interface StorageFailure {
  /** `full`: the browser's quota for this site is used up; `unavailable`: it refuses to store (private window, blocked site data). */
  reason: 'full' | 'unavailable';
  error: unknown;
}

let failure: StorageFailure | null = null;
const failureSubs = new Set<(f: StorageFailure) => void>();

/** Record a write this device refused. Every write path calls it; tests and native shells may too. */
export function reportStorageFailure(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  // Once full, Firefox refuses later writes with InvalidStateError: still the full disk.
  failure = { reason: name === 'QuotaExceededError' || failure?.reason === 'full' ? 'full' : 'unavailable', error };
  console.warn('Écriture refusée par le stockage de l’appareil', error);
  for (const fn of failureSubs) fn(failure);
}

/** The last refused write, or null when every write so far went through. */
export const storageFailure = () => failure;

/** Called on each refused write (and at once when one already happened). */
export function onStorageFailure(fn: (f: StorageFailure) => void): () => void {
  failureSubs.add(fn);
  if (failure) fn(failure);
  return () => void failureSubs.delete(fn);
}

/** Report the writes y-indexeddb makes on `db`: they fail in transactions nobody awaits, whose abort reaches the database. */
export function watchDatabase(db: IDBDatabase) {
  db.addEventListener('abort', (e) => {
    const t = e.target as IDBTransaction | null;
    // A transaction aborted on purpose has no error.
    if (t?.error) reportStorageFailure(t.error);
  });
}

export interface StoredFile {
  mime: string;
  bytes: Uint8Array;
}

/** Files the device refused, kept for as long as the tab lives. */
const unsaved = new Map<string, StoredFile>();

export const localFiles = {
  /** False when the device refused it (reported to `onStorageFailure`). */
  async put(key: string, file: StoredFile): Promise<boolean> {
    try {
      await tx('readwrite', (s) => s.put(file, key));
      unsaved.delete(key);
      return true;
    } catch (e) {
      unsaved.set(key, file);
      reportStorageFailure(e);
      return false;
    }
  },
  async get(key: string): Promise<StoredFile | null> {
    try {
      return ((await tx('readonly', (s) => s.get(key))) as StoredFile | undefined) ?? unsaved.get(key) ?? null;
    } catch {
      return unsaved.get(key) ?? null;
    }
  },
  /** Copy every file of `from` to `to` (a local document published to the server). */
  async rekey(from: string, to: string) {
    try {
      for (const k of await this.keys(`${from}|`)) {
        const f = await this.get(k);
        if (f) await this.put(`${to}|${k.slice(from.length + 1)}`, f);
      }
    } catch {
      /* ignore */
    }
  },
  /** Keys starting with `prefix` (a document's files: `${docId}|`). */
  async keys(prefix: string): Promise<string[]> {
    let stored: string[] = [];
    try {
      stored = (await tx('readonly', (s) => s.getAllKeys())) as string[];
    } catch {
      /* none readable: the unsaved ones still count */
    }
    return [...new Set([...stored, ...unsaved.keys()])].filter((k) => typeof k === 'string' && k.startsWith(prefix));
  },
  async remove(key: string) {
    unsaved.delete(key);
    try {
      await tx('readwrite', (s) => s.delete(key));
    } catch {
      /* ignore */
    }
  },
};

export const packageKey = (docId: string) => `${docId}|package`;
export const mediaKey = (docId: string, path: string) => `${docId}|media|${path}`;
