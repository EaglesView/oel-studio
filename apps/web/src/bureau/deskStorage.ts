/**
 * Opening the saved desk, and the actions that replace it (plan solo MVP, S-2): « Vider le
 * bureau », « Réinitialiser la démo », « Importer un bureau », plus « Exporter le bureau ».
 *
 * Replacing deletes IndexedDB databases, which the browser refuses while a tab holds them
 * open (every editing session does). So these actions are recorded, the page reloads, and
 * `openDesk` carries them out first, before any document is opened.
 */
import * as Y from 'yjs';
import { deleteDeviceDoc, docDbName, localFiles, openDeviceDoc, readDeviceDoc, writeDeviceDoc, type DeviceDoc, type DocKind } from '@oel/collab-client';
import { originalKey } from '@oel/img';
import type { Paper } from './model';
import { deskDbName, initDesk, readDesk, takeTrash, trashOf, type DeskContent } from './persist';
import { DOC_KIND, deleteFiles } from './restore';
import { packBackup, readBackup, type BackupParts } from './backup';
import { DEMO_VERSION } from './demo';
import { tr } from '@oel/i18n';

/** What the desk starts with when it is new: the demo (first visit, reset) or nothing (« Vider »). */
export type Seed = 'demo' | 'none';

export interface OpenedDesk {
  device: DeviceDoc;
  /** The saved desk, or null when it is new (then `seed` says what to put on it). */
  content: DeskContent | null;
  seed: Seed;
}

type Pending = { action: 'clear' } | { action: 'demo' } | { action: 'import' };
const pendingKey = (projectId: string) => `oel-desk-pending:${projectId}`;
const IMPORT_KEY = 'desk|pending-import';
const thumbKey = (paperId: string) => `desk|thumb|${paperId}`;

function readPending(projectId: string): Pending | null {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(projectId)) ?? 'null') as Pending | null;
  } catch {
    return null;
  }
}

/** Give a deletion a few seconds: another tab holding the database open would block it forever. */
const settle = (p: Promise<unknown>, ms = 4000) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);

/** Delete a desk and the files of its papers (their documents, binary files and thumbnails). */
async function wipeDesk(projectId: string): Promise<void> {
  const update = await readDeviceDoc(deskDbName(projectId));
  if (update) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const papers = readDesk(doc)?.papers ?? [];
    await settle(deleteFiles([...papers.filter((p) => p.data.docId).map((p) => ({ docId: p.data.docId!, kind: p.kind })), ...trashOf(doc)]));
    for (const p of papers) await localFiles.remove(thumbKey(p.id));
    doc.destroy();
  }
  await settle(deleteDeviceDoc(deskDbName(projectId)));
}

/** Open the project's desk, carrying out a pending reset or import first, and emptying the trash. */
export async function openDesk(projectId: string): Promise<OpenedDesk> {
  const pending = readPending(projectId);
  let seed: Seed = 'demo';
  if (pending) {
    // Read the backup before anything is deleted: an unreadable one leaves the desk as it was.
    const stored = pending.action === 'import' ? await localFiles.get(IMPORT_KEY) : null;
    const backup = stored ? await readBackup(stored.bytes).catch((e: Error) => (console.warn('Sauvegarde illisible, bureau conservé', e), null)) : null;
    if (pending.action !== 'import' || backup) {
      await wipeDesk(projectId);
      if (backup) await restoreBackup(projectId, backup);
      if (pending.action === 'clear') seed = 'none';
    }
    await localFiles.remove(IMPORT_KEY);
    try {
      localStorage.removeItem(pendingKey(projectId));
    } catch {
      /* ignore */
    }
  }
  const device = await openDeviceDoc(deskDbName(projectId));
  const content = readDesk(device.doc);
  if (!content) initDesk(device.doc, { demoVersion: seed === 'demo' ? DEMO_VERSION : null });
  else void deleteFiles(takeTrash(device.doc));
  return { device, content, seed };
}

/** Record a reset (« Vider le bureau » or « Réinitialiser la démo ») and reload to carry it out. */
export function scheduleReset(projectId: string, action: 'clear' | 'demo') {
  localStorage.setItem(pendingKey(projectId), JSON.stringify({ action } satisfies Pending));
  location.reload();
}

/* ── backups (format: backup.ts) ─────────────────────────────────────────────────────────── */

/** The whole desk as one lossless .zip, as this device keeps it. `deskDoc` must be flushed. */
export async function exportBureau(papers: Paper[], deskDoc: Y.Doc, title: string): Promise<Blob> {
  const docIds = new Map<string, DocKind>();
  for (const p of papers) {
    const kind = DOC_KIND[p.kind];
    if (kind && p.data.docId) docIds.set(p.data.docId, kind);
  }
  const docs: BackupParts['docs'] = [];
  for (const [docId, kind] of docIds) {
    const update = await readDeviceDoc(docDbName(kind, docId));
    if (update) docs.push({ docId, kind, update });
  }
  const keys = new Set<string>();
  for (const docId of docIds.keys()) for (const k of await localFiles.keys(`${docId}|`)) keys.add(k);
  for (const p of papers) {
    if (p.data.image?.original) keys.add(originalKey(p.data.image.original));
    if (p.data.docId) keys.add(thumbKey(p.id));
  }
  const files: BackupParts['files'] = [];
  for (const key of keys) {
    const f = await localFiles.get(key);
    if (f) files.push({ key, mime: f.mime, bytes: f.bytes });
  }
  const zip = packBackup({ title, desk: Y.encodeStateAsUpdate(deskDoc), docs, files });
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Check a backup, keep it on the device and reload: `openDesk` replaces the desk with it. */
export async function scheduleImport(projectId: string, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await readBackup(bytes);
  await localFiles.put(IMPORT_KEY, { mime: 'application/zip', bytes });
  if (!(await localFiles.get(IMPORT_KEY))) throw new Error(tr('Pas assez d’espace sur cet appareil pour importer cette sauvegarde.', 'Not enough space on this device to import this backup.'));
  localStorage.setItem(pendingKey(projectId), JSON.stringify({ action: 'import' } satisfies Pending));
  location.reload();
}

/** Write a backup's documents, files and desk on the device (the old desk is already wiped). */
async function restoreBackup(projectId: string, backup: BackupParts): Promise<void> {
  for (const d of backup.docs) {
    const name = docDbName(d.kind, d.docId);
    // Exactly the saved state: a copy still on this device would otherwise merge with it.
    await settle(deleteDeviceDoc(name));
    await writeDeviceDoc(name, d.update);
  }
  for (const f of backup.files) await localFiles.put(f.key, { mime: f.mime, bytes: f.bytes });
  await writeDeviceDoc(deskDbName(projectId), backup.desk);
}
