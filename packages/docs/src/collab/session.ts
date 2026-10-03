/**
 * A document session: the shared Y.Doc session of @oel/collab-client
 * (offline copy, sync, links, versions) plus what is particular to .docx:
 * seeding from the codec JSON, images, and the export input.
 */
import * as Y from 'yjs';
import type { Schema } from '@tiptap/pm/model';
import { CollabApi, YSession, createRemoteDoc, localFiles, mediaKey, randomId, type Identity } from '@oel/collab-client';
import { exportJsonFromYDoc, mediaIndex, replaceYDocContent, seedYDoc, BODY } from '../model/ydoc';
import type { DocxJson, ExportJson, MediaFile } from '../model/types';

export { tokenStore, type Peer, type SessionStatus } from '@oel/collab-client';

export interface SeedInput {
  json: DocxJson;
  original?: Uint8Array | null;
  media?: MediaFile[];
}

export class DocSession extends YSession {
  private objectUrls = new Map<string, string>();

  private constructor(docId: string, token: string | null, api: CollabApi | null, identity: Identity) {
    super('doc', docId, token, api, identity);
  }

  /** Open an existing document (or a new local one when `docId` is empty). */
  static async open(o: { docId?: string | null; token?: string | null; api?: CollabApi | null; identity: Identity; seed?: SeedInput | null; schema?: Schema }): Promise<DocSession> {
    const { docId, token } = YSession.ids(o.docId, o.token);
    const s = new DocSession(docId, token, o.api ?? null, o.identity);
    await s.start();
    if (o.seed && o.schema) await s.seed(o.seed, o.schema);
    await s.preloadMedia();
    return s;
  }

  /**
   * Create a document from an import: on the server when reachable (it keeps
   * the original .docx for round trips), otherwise locally.
   */
  static async create(o: { api: CollabApi | null; identity: Identity; seed: SeedInput; schema: Schema; title?: string }): Promise<DocSession> {
    const remote = await createRemoteDoc(o.api, o.seed.original ?? null, o.title ?? '', 'doc');
    return DocSession.open({ docId: remote?.docId ?? null, token: remote?.token ?? null, api: o.api, identity: o.identity, seed: o.seed, schema: o.schema });
  }

  /**
   * Fill a document that is still empty after syncing (e.g. created on the
   * server from a .docx by a client that left before seeding it).
   */
  async seedIfEmpty(make: () => Promise<SeedInput | null>, schema: Schema): Promise<boolean> {
    if (this.status.readOnly) return false;
    if (this.provider) await this.waitSynced(5000);
    if (this.isSeeded) return false;
    const seed = await make();
    if (!seed || this.isSeeded) return false;
    await this.seed(seed, schema);
    return true;
  }

  private async seed(seed: SeedInput, schema: Schema) {
    const { docId } = this.status;
    if (seed.original) await this.storeOriginal(seed.original);
    for (const m of seed.media ?? []) await localFiles.put(mediaKey(docId, m.path), { mime: m.mime, bytes: m.bytes });
    if (this.provider) await this.waitSynced(4000);
    if (seedYDoc(this.ydoc, seed.json, schema)) void this.syncMedia(seed.media ?? []);
  }

  protected override onAuthenticated() {
    void this.syncMedia([]);
  }

  get fragment() {
    return this.ydoc.getXmlFragment(BODY);
  }

  // ---------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------

  /** URL for an image path (server URL, or a local object URL while offline). */
  mediaUrl = (path: string): string | null => {
    return this.objectUrls.get(path) ?? mediaIndex(this.ydoc).get(path)?.url ?? null;
  };

  private async preloadMedia() {
    const tasks: Array<Promise<void>> = [];
    mediaIndex(this.ydoc).forEach((_, path) => {
      tasks.push(
        localFiles.get(mediaKey(this.status.docId, path)).then((f) => {
          if (f && !this.objectUrls.has(path)) this.objectUrls.set(path, URL.createObjectURL(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime })));
        }),
      );
    });
    await Promise.all(tasks);
  }

  /** Store an image added in the editor; returns its package path. */
  async addImage(file: Blob): Promise<string> {
    const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const path = `word/media/oel-${randomId()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await localFiles.put(mediaKey(this.status.docId, path), { mime: file.type, bytes });
    this.objectUrls.set(path, URL.createObjectURL(file));
    mediaIndex(this.ydoc).set(path, { mime: file.type });
    void this.syncMedia([]);
    return path;
  }

  /** Upload images the server does not have yet (imported ones, or added offline). */
  private async syncMedia(known: MediaFile[]) {
    const { docId, token } = this.status;
    if (!this.api || !token || this.status.readOnly || this.status.connection === 'local') return;
    const index = mediaIndex(this.ydoc);
    for (const [path, entry] of [...index.entries()]) {
      if (entry.url) continue;
      const bytes = known.find((m) => m.path === path)?.bytes ?? (await localFiles.get(mediaKey(docId, path)))?.bytes;
      if (!bytes) continue;
      try {
        const { url } = await this.api.uploadMedia(docId, token, path, bytes, entry.mime);
        index.set(path, { ...entry, url });
      } catch {
        return; // offline: retried on the next authentication
      }
    }
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------

  /** What the codec needs to write a .docx of the current state. */
  async exportInput(): Promise<{ json: ExportJson; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> }> {
    const { docId } = this.status;
    const original = await this.original();
    const media: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const [path, entry] of mediaIndex(this.ydoc).entries()) {
      if (!path.includes('/oel-')) continue; // imported images are in the original package
      let bytes = (await localFiles.get(mediaKey(docId, path)))?.bytes ?? null;
      if (!bytes && entry.url) bytes = new Uint8Array(await (await fetch(entry.url)).arrayBuffer());
      if (bytes) media.push({ path, bytes });
    }
    return { json: exportJsonFromYDoc(this.ydoc), original, media };
  }

  // ---------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------

  /** Restore a version as a new change (a "before restore" version is kept first). */
  async restoreVersion(id: string, schema: Schema) {
    const source: Y.Doc = await this.loadVersion(id);
    await this.createVersion('Avant la restauration', true).catch(() => null);
    replaceYDocContent(this.ydoc, source, schema);
  }

  protected override onDestroy() {
    for (const u of this.objectUrls.values()) URL.revokeObjectURL(u);
  }
}
