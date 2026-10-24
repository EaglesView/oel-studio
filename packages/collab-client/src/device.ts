/**
 * Y.Docs kept on this device (IndexedDB, y-indexeddb) outside an editing session: the desk
 * itself, and the raw copies a bureau backup reads and writes. One small seam, so a native
 * app can swap the storage without touching the callers.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { reportStorageFailure, watchDatabase } from './local';

export interface DeviceDoc {
  doc: Y.Doc;
  /** Stop saving (the data stays). */
  close(): Promise<void>;
  /** Delete the saved copy and stop saving. */
  clear(): Promise<void>;
}

/** Save `doc` under `name` with y-indexeddb, reporting the writes the device refuses (`onStorageFailure`). */
export function persistDoc(name: string, doc: Y.Doc): IndexeddbPersistence {
  const idb = new IndexeddbPersistence(name, doc);
  idb._db.then(watchDatabase, (e: unknown) => {
    // No database (a full disk can't create one): y-indexeddb would never say it is synced, and
    // the session would wait forever. Nothing is saved, so the document carries on in memory.
    reportStorageFailure(e);
    idb.emit('synced', [idb]);
  });
  return idb;
}

/** Open (or create) a Y.Doc saved under `name`; resolves once the saved state is loaded. */
export async function openDeviceDoc(name: string, doc: Y.Doc = new Y.Doc()): Promise<DeviceDoc> {
  const idb = persistDoc(name, doc);
  await idb.whenSynced;
  return {
    doc,
    close: () => idb.destroy(),
    clear: () => idb.clearData(),
  };
}

/** The saved state of `name` as one update, or null when nothing is saved there. */
export async function readDeviceDoc(name: string): Promise<Uint8Array | null> {
  const d = await openDeviceDoc(name);
  try {
    // An empty state vector (one byte: zero clients) means nothing was ever saved.
    return Y.encodeStateVector(d.doc).length <= 1 ? null : Y.encodeStateAsUpdate(d.doc);
  } finally {
    await d.close();
    d.doc.destroy();
  }
}

/** Merge `update` into the copy saved under `name` (created if missing). */
export async function writeDeviceDoc(name: string, update: Uint8Array): Promise<void> {
  const d = await openDeviceDoc(name);
  Y.applyUpdate(d.doc, update);
  // y-indexeddb stores the update in the same tick; closing waits for its transaction.
  await d.close();
  d.doc.destroy();
}

/** Delete the copy saved under `name`. */
export async function deleteDeviceDoc(name: string): Promise<void> {
  const d = await openDeviceDoc(name);
  await d.clear();
  d.doc.destroy();
}

/** Names of the saved copies starting with `prefix`, or null when the browser can't list them. */
export async function deviceDocNames(prefix: string): Promise<string[] | null> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
  try {
    return (await indexedDB.databases()).map((d) => d.name ?? '').filter((n) => n.startsWith(prefix));
  } catch {
    return null;
  }
}
