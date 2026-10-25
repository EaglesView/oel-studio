/** A device that refuses writes (backlog T0-4): the failure is reported, never swallowed. */
import { afterAll, describe, expect, it } from 'vitest';
import { localFiles, onStorageFailure, reportStorageFailure, settleLocalFiles, storageFailure, watchDatabase, type StorageFailure } from '../src/local';

/**
 * Just enough IndexedDB for `localFiles`: reads succeed, and every write succeeds as a request
 * but aborts its transaction with `QuotaExceededError`, as browsers do on a full disk.
 */
function fullDiskIndexedDB() {
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = new EventTarget() as IDBDatabase & EventTarget;
  Object.assign(db, {
    transaction(_store: string, mode: IDBTransactionMode) {
      const tx = new EventTarget() as IDBTransaction & EventTarget;
      const request = <T>(result: T) => {
        const req = { result, error: null } as unknown as IDBRequest<T>;
        later(() => {
          req.onsuccess?.(new Event('success'));
          if (mode === 'readonly') return tx.oncomplete?.(new Event('complete'));
          Object.assign(tx, { error: new DOMException('Quota exceeded', 'QuotaExceededError') });
          const abort = new Event('abort');
          tx.onabort?.(abort);
          db.dispatchEvent(Object.defineProperty(new Event('abort'), 'target', { value: tx }));
        });
        return req;
      };
      return Object.assign(tx, { objectStore: () => ({ put: () => request(undefined), get: () => request(undefined), getAllKeys: () => request([]), delete: () => request(undefined) }) });
    },
  });
  return {
    db,
    factory: {
      open() {
        const req = { result: db } as unknown as IDBOpenDBRequest;
        later(() => req.onsuccess?.(new Event('success')));
        return req;
      },
    },
  };
}

const fake = fullDiskIndexedDB();
const saved = globalThis.indexedDB;
globalThis.indexedDB = fake.factory as unknown as IDBFactory;
afterAll(() => void (globalThis.indexedDB = saved));

describe('writes this device refuses', () => {
  it('reports a full disk instead of swallowing it', async () => {
    const seen: StorageFailure[] = [];
    const stop = onStorageFailure((f) => seen.push(f));
    expect(storageFailure()).toBeNull();
    // The request succeeds; only the aborted transaction says the bytes were not kept.
    expect(await localFiles.put('doc|package', { mime: 'application/zip', bytes: new Uint8Array([1, 2, 3]) })).toBe(false);
    expect(seen.map((f) => f.reason)).toEqual(['full']);
    expect(storageFailure()?.reason).toBe('full');
    stop();
  });

  it('keeps a refused file for this tab, so export and editing still find it', async () => {
    const file = { mime: 'application/zip', bytes: new Uint8Array([4, 5, 6]) };
    expect(await localFiles.put('doc|media|a.png', file)).toBe(false);
    expect(await localFiles.get('doc|media|a.png')).toBe(file);
    expect(await localFiles.keys('doc|')).toEqual(['doc|package', 'doc|media|a.png']);
    await localFiles.remove('doc|media|a.png');
    expect(await localFiles.get('doc|media|a.png')).toBeNull();
  });

  it('tells a late subscriber at once', () => {
    const seen: string[] = [];
    onStorageFailure((f) => seen.push(f.reason))();
    expect(seen).toEqual(['full']);
  });

  it('keeps a full disk as the reason for the refusals that follow', () => {
    reportStorageFailure(new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError'));
    expect(storageFailure()?.reason).toBe('full');
  });

  it('hears y-indexeddb writes nobody awaits, through the database', async () => {
    const seen: string[] = [];
    const stop = onStorageFailure((f) => seen.push(f.reason));
    seen.length = 0;
    watchDatabase(fake.db);
    fake.db.transaction('updates', 'readwrite').objectStore('updates').put(new Uint8Array([0]));
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(['full']);
    stop();
  });
});

describe('before the desktop app closes', () => {
  it('waits for the file writes already started, refused ones included', async () => {
    let done = false;
    void localFiles.put('doc|media|b.png', { mime: 'image/png', bytes: new Uint8Array([7]) }).then(() => (done = true));
    await settleLocalFiles();
    expect(done).toBe(true);
  });
});
