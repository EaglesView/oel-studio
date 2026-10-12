/**
 * Pictures of a shared document: an index in the Y.Doc (`path → { mime, url? }`),
 * the bytes on this device (IndexedDB, so they show offline and before the
 * server knows them) and on the server once the document is shared.
 *
 * Imported pictures arrive with the file; pictures added in the editor get an
 * `oel-` path. Used by `SlideSession` (@oel/slides); `DocSession` keeps its own
 * copy of the same logic for now.
 */
import type * as Y from 'yjs';
import type { CollabApi } from './api';
import { localFiles, mediaKey } from './local';
import { randomId } from './session';

export interface MediaEntry {
  mime: string;
  url?: string;
}

export class MediaStore {
  private urls = new Map<string, string>();
  private listeners = new Set<() => void>();

  constructor(
    readonly index: Y.Map<MediaEntry>,
    private ctx: () => { docId: string; token: string | null; api: CollabApi | null; canUpload: boolean },
  ) {}

  /** Display URL of a path: this device's copy, else the server's. */
  url = (path: string): string | null => this.urls.get(path) ?? this.index.get(path)?.url ?? null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private changed() {
    for (const l of this.listeners) l();
  }

  /** Keep files on this device and list them in the index (an import). */
  async seed(files: Array<{ path: string; mime: string; bytes: Uint8Array }>) {
    const { docId } = this.ctx();
    for (const f of files) {
      await localFiles.put(mediaKey(docId, f.path), { mime: f.mime, bytes: f.bytes });
      this.urls.set(f.path, URL.createObjectURL(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime })));
    }
    this.index.doc?.transact(() => {
      for (const f of files) if (!this.index.has(f.path)) this.index.set(f.path, { mime: f.mime });
    });
    this.changed();
  }

  /** Object URLs for the files this device holds. */
  async preload() {
    const { docId } = this.ctx();
    await Promise.all(
      [...this.index.entries()].map(async ([path, e]) => {
        if (this.urls.has(path)) return;
        const f = await localFiles.get(mediaKey(docId, path));
        if (f) this.urls.set(path, URL.createObjectURL(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime || e.mime })));
      }),
    );
    this.changed();
  }

  /** A picture added in the editor; returns its package path (`<folder>/oel-….png`). */
  async add(file: Blob, folder: string): Promise<string> {
    const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const path = `${folder}/oel-${randomId()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await localFiles.put(mediaKey(this.ctx().docId, path), { mime: file.type, bytes });
    this.urls.set(path, URL.createObjectURL(file));
    this.index.set(path, { mime: file.type });
    this.changed();
    void this.sync();
    return path;
  }

  /** Upload what the server does not have yet (imported files, or added offline). */
  async sync() {
    const { docId, token, api, canUpload } = this.ctx();
    if (!api || !token || !canUpload) return;
    for (const [path, entry] of [...this.index.entries()]) {
      if (entry.url) continue;
      const bytes = (await localFiles.get(mediaKey(docId, path)))?.bytes;
      if (!bytes) continue;
      try {
        const { url } = await api.uploadMedia(docId, token, path, bytes, entry.mime);
        this.index.set(path, { ...entry, url });
      } catch {
        return; // offline: retried on the next authentication
      }
    }
  }

  /** Bytes of the pictures added in the editor (imported ones are in the original file). */
  async added(): Promise<Array<{ path: string; bytes: Uint8Array }>> {
    const { docId } = this.ctx();
    const out: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const [path, entry] of this.index.entries()) {
      if (!path.split('/').pop()?.startsWith('oel-')) continue;
      let bytes = (await localFiles.get(mediaKey(docId, path)))?.bytes ?? null;
      if (!bytes && entry.url) bytes = new Uint8Array(await (await fetch(entry.url)).arrayBuffer());
      if (bytes) out.push({ path, bytes });
    }
    return out;
  }

  destroy() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.listeners.clear();
  }
}
