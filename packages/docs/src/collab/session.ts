/**
 * A document session: one Y.Doc, persisted in IndexedDB (offline) and synced
 * with the collab server when there is one. Documents created while the
 * server is unreachable are "local-…" until published (Partager).
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Schema } from '@tiptap/pm/model';
import { CollabApi, CollabError, decodeToken, type Role, type ShareLink, type VersionInfo } from './api';
import type { Identity } from './identity';
import { localFiles, mediaKey, packageKey } from './local';
import { exportJsonFromYDoc, mediaIndex, meta, replaceYDocContent, seedYDoc, BODY } from '../model/ydoc';
import type { DocxJson, ExportJson, MediaFile } from '../model/types';

export interface Peer {
  clientId: number;
  name: string;
  color: string;
}

export interface SessionStatus {
  docId: string;
  token: string | null;
  role: Role;
  readOnly: boolean;
  /** local = never published; offline = has a server but cannot reach it. */
  connection: 'local' | 'connecting' | 'connected' | 'offline';
  /** True when the server has every local change. */
  saved: boolean;
  error: string | null;
  peers: Peer[];
}

export interface SeedInput {
  json: DocxJson;
  original?: Uint8Array | null;
  media?: MediaFile[];
}

const TOKENS = 'oel-doc-tokens';

/** Tokens this browser holds, so reopening a document keeps its role. */
export const tokenStore = {
  get(docId: string): string | null {
    try {
      return (JSON.parse(localStorage.getItem(TOKENS) ?? '{}') as Record<string, string>)[docId] ?? null;
    } catch {
      return null;
    }
  },
  set(docId: string, token: string) {
    try {
      const all = JSON.parse(localStorage.getItem(TOKENS) ?? '{}') as Record<string, string>;
      // Never downgrade: an owner token beats an editor link opened later.
      const rank = (t?: string) => ({ owner: 3, editor: 2, viewer: 1 })[decodeToken(t)?.role ?? 'viewer'] ?? 0;
      if (!all[docId] || rank(token) >= rank(all[docId])) all[docId] = token;
      localStorage.setItem(TOKENS, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  },
};

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);

export class DocSession {
  readonly ydoc = new Y.Doc();
  provider: HocuspocusProvider | null = null;
  private idb: IndexeddbPersistence;
  private listeners = new Set<() => void>();
  private objectUrls = new Map<string, string>();
  private disposed = false;
  status: SessionStatus;

  private constructor(
    docId: string,
    token: string | null,
    readonly api: CollabApi | null,
    private identity: Identity,
  ) {
    const role: Role = token ? decodeToken(token)?.role ?? 'viewer' : 'owner';
    this.status = {
      docId,
      token,
      role,
      readOnly: role === 'viewer',
      connection: docId.startsWith('local-') || !api || !token ? 'local' : 'connecting',
      saved: true,
      error: null,
      peers: [],
    };
    this.idb = new IndexeddbPersistence(`oel-doc:${docId}`, this.ydoc);
  }

  /** Open an existing document (or a new local one when `docId` is empty). */
  static async open(o: { docId?: string | null; token?: string | null; api?: CollabApi | null; identity: Identity; seed?: SeedInput | null; schema?: Schema }): Promise<DocSession> {
    const docId = o.docId || `local-${randomId()}`;
    const token = o.token ?? (o.docId ? tokenStore.get(o.docId) : null);
    const s = new DocSession(docId, token, o.api ?? null, o.identity);
    await s.idb.whenSynced;
    if (s.status.connection !== 'local') s.connect();
    if (o.seed && o.schema) await s.seed(o.seed, o.schema);
    await s.preloadMedia();
    return s;
  }

  /**
   * Create a document from an import: on the server when reachable (it keeps
   * the original .docx for round trips), otherwise locally.
   */
  static async create(o: { api: CollabApi | null; identity: Identity; seed: SeedInput; schema: Schema; title?: string }): Promise<DocSession> {
    let docId: string | null = null;
    let token: string | null = null;
    if (o.api && (await o.api.health())) {
      try {
        ({ docId, ownerToken: token } = await o.api.createDoc(o.seed.original ?? null, o.title ?? ''));
        tokenStore.set(docId, token);
      } catch {
        docId = null;
      }
    }
    return DocSession.open({ docId, token, api: o.api, identity: o.identity, seed: o.seed, schema: o.schema });
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

  /** The original .docx kept by the server, if any. */
  async originalPackage(): Promise<Uint8Array | null> {
    const { docId, token } = this.status;
    if (!this.api || !token || this.status.connection === 'local') return null;
    return this.api.package(docId, token).catch(() => null);
  }

  private async seed(seed: SeedInput, schema: Schema) {
    const { docId } = this.status;
    if (seed.original) await localFiles.put(packageKey(docId), { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: seed.original });
    for (const m of seed.media ?? []) await localFiles.put(mediaKey(docId, m.path), { mime: m.mime, bytes: m.bytes });
    if (this.provider) await this.waitSynced(4000);
    if (seedYDoc(this.ydoc, seed.json, schema)) void this.syncMedia(seed.media ?? []);
  }

  private connect() {
    const { docId, token } = this.status;
    if (!this.api || !token) return;
    const p = new HocuspocusProvider({
      url: this.api.wsUrl,
      name: docId,
      token,
      document: this.ydoc,
      onStatus: ({ status }) => this.set({ connection: status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline' }),
      onAuthenticated: ({ scope }) => {
        this.set({ readOnly: scope === 'readonly' || this.status.role === 'viewer', error: null });
        void this.syncMedia([]);
      },
      onAuthenticationFailed: ({ reason }) => this.set({ error: reason || 'Lien invalide ou révoqué', connection: 'offline' }),
      onUnsyncedChanges: ({ number }) => this.set({ saved: number === 0 }),
      onAwarenessChange: ({ states }) => {
        const peers: Peer[] = [];
        for (const s of states as Array<{ clientId: number; user?: { name: string; color: string } }>) {
          if (s.clientId !== this.ydoc.clientID && s.user) peers.push({ clientId: s.clientId, ...s.user });
        }
        this.set({ peers });
      },
    });
    p.setAwarenessField('user', this.identity);
    this.provider = p;
  }

  private waitSynced(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.provider || this.provider.synced) return resolve();
      const done = () => {
        clearTimeout(t);
        this.provider?.off('synced', done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.provider.on('synced', done);
    });
  }

  setIdentity(id: Identity) {
    this.identity = id;
    this.provider?.setAwarenessField('user', id);
  }

  // ---------------------------------------------------------------------
  // Status store (useSyncExternalStore)
  // ---------------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getStatus = () => this.status;

  private set(patch: Partial<SessionStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  get isSeeded() {
    return !!meta(this.ydoc).get('seeded');
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
    const { docId, token } = this.status;
    let original = (await localFiles.get(packageKey(docId)))?.bytes ?? null;
    if (!original && this.api && token && this.status.connection !== 'local') {
      original = await this.api.package(docId, token).catch(() => null);
      if (original) await localFiles.put(packageKey(docId), { mime: 'application/zip', bytes: original });
    }
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
  // Sharing
  // ---------------------------------------------------------------------

  /** Put a local document on the server (keeps the same Y.Doc and editor). */
  async publish(title = ''): Promise<void> {
    if (this.status.connection !== 'local' || this.status.token) return;
    if (!this.api || !(await this.api.health())) throw new CollabError('Serveur de collaboration injoignable', 0);
    const oldId = this.status.docId;
    const original = (await localFiles.get(packageKey(oldId)))?.bytes ?? null;
    const { docId, ownerToken } = await this.api.createDoc(original, title);
    tokenStore.set(docId, ownerToken);
    await localFiles.rekey(oldId, docId);
    // Keep the offline copy under the new id, then sync to the server.
    const old = this.idb;
    this.idb = new IndexeddbPersistence(`oel-doc:${docId}`, this.ydoc);
    await this.idb.whenSynced;
    void old.clearData();
    this.set({ docId, token: ownerToken, role: 'owner', connection: 'connecting' });
    this.connect();
  }

  private need(): { docId: string; token: string; api: CollabApi } {
    const { docId, token } = this.status;
    if (!this.api || !token || this.status.connection === 'local') throw new CollabError('Partagez d’abord le document pour activer cette fonction', 0);
    return { docId, token, api: this.api };
  }

  links(): Promise<ShareLink[]> {
    const { api, docId, token } = this.need();
    return api.links(docId, token);
  }
  createLink(role: ShareLink['role']): Promise<ShareLink> {
    const { api, docId, token } = this.need();
    return api.createLink(docId, token, role);
  }
  revokeLink(id: string): Promise<void> {
    const { api, docId, token } = this.need();
    return api.revokeLink(docId, token, id);
  }

  // ---------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------

  versions(): Promise<VersionInfo[]> {
    const { api, docId, token } = this.need();
    return api.versions(docId, token);
  }

  async createVersion(name: string | null, auto = false): Promise<VersionInfo> {
    const { api, docId, token } = this.need();
    await this.waitSynced(3000);
    return api.createVersion(docId, token, { name: name ?? undefined, auto, author: this.identity.name });
  }

  async loadVersion(id: string): Promise<Y.Doc> {
    const { api, docId, token } = this.need();
    const d = new Y.Doc();
    Y.applyUpdate(d, await api.versionState(docId, token, id));
    return d;
  }

  /** Restore a version as a new change (a "before restore" version is kept first). */
  async restoreVersion(id: string, schema: Schema) {
    const source = await this.loadVersion(id);
    await this.createVersion('Avant la restauration', true).catch(() => null);
    replaceYDocContent(this.ydoc, source, schema);
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.provider?.destroy();
    void this.idb.destroy();
    for (const u of this.objectUrls.values()) URL.revokeObjectURL(u);
    this.listeners.clear();
  }
}
