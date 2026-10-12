/**
 * The bureau backup file (plan solo MVP, S-2): one .zip, lossless — the desk Y.Doc, every
 * file's Y.Doc and the device's binary files, exactly as kept in this browser.
 *
 *   bureau.json         manifest (format, version, title, where each part is)
 *   bureau.yjs          the desk
 *   documents/<n>.yjs   one per document, workbook or deck
 *   fichiers/<n>.bin    originals, pictures, thumbnails (by their device key)
 *
 * Pure: `deskStorage.ts` reads and writes the device.
 */
import type { DocKind } from '@oel/collab-client';
import { readZipBytes, readZipDirectory, writeZip } from '@oel/engine';
import { messages } from '@oel/i18n';

const t = messages(
  {
    notZip: 'Ce fichier n’est pas une archive .zip.',
    missing: (name: string) => `Sauvegarde incomplète : « ${name} » manque.`,
    noManifest: 'Ce .zip n’est pas une sauvegarde de bureau (bureau.json manque).',
    badManifest: 'bureau.json est illisible.',
    notBackup: 'Ce .zip n’est pas une sauvegarde de bureau.',
    newer: 'Cette sauvegarde vient d’une version plus récente du Bureau.',
  },
  {
    notZip: 'This file is not a .zip archive.',
    missing: (name) => `Incomplete backup: “${name}” is missing.`,
    noManifest: 'This .zip is not a desk backup (bureau.json is missing).',
    badManifest: 'bureau.json can’t be read.',
    notBackup: 'This .zip is not a desk backup.',
    newer: 'This backup comes from a newer version of the Bureau.',
  },
);

export const BACKUP_FORMAT = 'oel-bureau';
export const BACKUP_VERSION = 1;

export interface BackupParts {
  title: string;
  desk: Uint8Array;
  docs: Array<{ docId: string; kind: DocKind; update: Uint8Array }>;
  files: Array<{ key: string; mime: string; bytes: Uint8Array }>;
}

interface Manifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  title: string;
  desk: string;
  docs: Array<{ docId: string; kind: DocKind; file: string }>;
  files: Array<{ key: string; mime: string; file: string }>;
}

export function packBackup(parts: BackupParts, now = new Date()): Uint8Array {
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    title: parts.title,
    desk: 'bureau.yjs',
    docs: parts.docs.map((d, i) => ({ docId: d.docId, kind: d.kind, file: `documents/${i + 1}.yjs` })),
    files: parts.files.map((f, i) => ({ key: f.key, mime: f.mime, file: `fichiers/${i + 1}.bin` })),
  };
  return writeZip([
    { name: 'bureau.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { name: manifest.desk, data: parts.desk },
    ...parts.docs.map((d, i) => ({ name: manifest.docs[i]!.file, data: d.update })),
    ...parts.files.map((f, i) => ({ name: manifest.files[i]!.file, data: f.bytes })),
  ]);
}

/** Read and check a backup; throws a message for the person when it isn't one. */
export async function readBackup(bytes: Uint8Array): Promise<BackupParts> {
  let dir: ReturnType<typeof readZipDirectory>;
  try {
    dir = readZipDirectory(bytes);
  } catch {
    throw new Error(t.notZip);
  }
  const read = async (name: string) => {
    const e = dir.get(name);
    if (!e) throw new Error(t.missing(name));
    return readZipBytes(bytes, e);
  };
  if (!dir.has('bureau.json')) throw new Error(t.noManifest);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(await read('bureau.json'))) as Manifest;
  } catch {
    throw new Error(t.badManifest);
  }
  if (manifest.format !== BACKUP_FORMAT) throw new Error(t.notBackup);
  if (manifest.version > BACKUP_VERSION) throw new Error(t.newer);
  return {
    title: manifest.title,
    desk: await read(manifest.desk),
    docs: await Promise.all(manifest.docs.map(async (d) => ({ docId: d.docId, kind: d.kind, update: await read(d.file) }))),
    files: await Promise.all(manifest.files.map(async (f) => ({ key: f.key, mime: f.mime, bytes: await read(f.file) }))),
  };
}
