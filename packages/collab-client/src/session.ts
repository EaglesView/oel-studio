/**
 * The part of an editing session every document kind shares: one Y.Doc,
 * persisted in IndexedDB (offline) and synced with the collab server when
 * there is one, plus share links and version history. Documents created
 * while the server is unreachable are "local-…" until published (Partager).
 *
 * Editors subclass it (`DocSession` in @oel/docs, `SheetSession` in
 * @oel/sheets, `SlideSession` in @oel/slides) for seeding, media and export.
 */
import * as Y from 'yjs';
import type { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CollabApi, CollabError, decodeToken, type DocKind, type Role, type ShareLink, type VersionInfo } from './api';
import type { Identity } from './identity';
import { localFiles, packageKey } from './local';
import { persistDoc } from './device';
import { tr } from '@oel/i18n';

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

export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);

/** IndexedDB name per kind (docs keep the name they always had). */
const IDB_PREFIX: Record<DocKind, string> = { doc: 'oel-doc', sheet: 'oel-sheet', slides: 'oel-slides' };

/** The IndexedDB database holding a document's offline copy (backups and clean-up read it directly). */
export const docDbName = (kind: DocKind, docId: string) => `${IDB_PREFIX[kind]}:${docId}`;

const PACKAGE_MIME: Record<DocKind, string> = {
  doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * Create a server document when the server is reachable; `null` otherwise
 * (the session then starts local and can be published later).
 */
export async function createRemoteDoc(api: CollabApi | null, original: Uint8Array | null, title: string, kind: DocKind): Promise<{ docId: string; token: string } | null> {
  if (!api || !(await api.health())) return null;
  try {
    const { docId, ownerToken } = await api.createDoc(original, title, kind);
    tokenStore.set(docId, ownerToken);
    return { docId, token: ownerToken };
  } catch {
    return null;
  }
}

/** Y.Docs of the sessions open in this tab, by document id: newer than the device's copy when a write was refused. */
const openDocs = new Map<string, Y.Doc>();

/** The live Y.Doc of an open session, or null (then the device's copy is the latest). */
export const openSessionDoc = (docId: string): Y.Doc | null => openDocs.get(docId) ?? null;

export class YSession {
  readonly ydoc = new Y.Doc();
  provider: HocuspocusProvider | null = null;
  protected idb: IndexeddbPersistence;
  private listeners = new Set<() => void>();
  private disposed = false;
  status: SessionStatus;

  protected constructor(
    readonly kind: DocKind,
    docId: string,
    token: string | null,
    readonly api: CollabApi | null,
    protected identity: Identity,
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
    this.idb = persistDoc(docDbName(kind, docId), this.ydoc);
    openDocs.set(docId, this.ydoc);
  }

  /** Resolve the id and token a session opens with (a new local id when none). */
  protected static ids(docId?: string | null, token?: string | null): { docId: string; token: string | null } {
    const id = docId || `local-${randomId()}`;
    return { docId: id, token: token ?? (docId ? tokenStore.get(docId) : null) };
  }

  /** Wait for the offline copy, then connect when the document is on a server. */
  protected async start() {
    await this.idb.whenSynced;
    if (this.status.connection !== 'local') this.connect();
  }

  /** Called after each successful authentication (e.g. to upload pending media). */
  protected onAuthenticated() {}

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
        this.onAuthenticated();
      },
      onAuthenticationFailed: ({ reason }) => this.set({ error: reason || tr('Lien invalide ou révoqué', 'Invalid or revoked link'), connection: 'offline' }),
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

  protected waitSynced(ms: number): Promise<void> {
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

  /** Name of the person editing here (« par … » in link history). */
  get author(): string {
    return this.identity.name;
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

  protected set(patch: Partial<SessionStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  get isSeeded() {
    return !!this.ydoc.getMap('meta').get('seeded');
  }

  // ---------------------------------------------------------------------
  // Original file (round-trip base)
  // ---------------------------------------------------------------------

  /** The original file kept by the server, if any. */
  async originalPackage(): Promise<Uint8Array | null> {
    const { docId, token } = this.status;
    if (!this.api || !token || this.status.connection === 'local') return null;
    return this.api.package(docId, token).catch(() => null);
  }

  /** Keep the original file on this device (export works offline). */
  protected storeOriginal(bytes: Uint8Array) {
    return localFiles.put(packageKey(this.status.docId), { mime: PACKAGE_MIME[this.kind], bytes });
  }

  /** The original file: this device's copy, else the server's (then cached). */
  async original(): Promise<Uint8Array | null> {
    const { docId, token } = this.status;
    let bytes = (await localFiles.get(packageKey(docId)))?.bytes ?? null;
    if (!bytes && this.api && token && this.status.connection !== 'local') {
      bytes = await this.api.package(docId, token).catch(() => null);
      if (bytes) await localFiles.put(packageKey(docId), { mime: 'application/zip', bytes });
    }
    return bytes;
  }

  // ---------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------

  /** Put a local document on the server (keeps the same Y.Doc and editor). */
  async publish(title = ''): Promise<void> {
    if (this.status.connection !== 'local' || this.status.token) return;
    if (!this.api || !(await this.api.health())) throw new CollabError(tr('Serveur de collaboration injoignable', 'Collaboration server unreachable'), 0);
    const oldId = this.status.docId;
    const original = (await localFiles.get(packageKey(oldId)))?.bytes ?? null;
    const { docId, ownerToken } = await this.api.createDoc(original, title, this.kind);
    tokenStore.set(docId, ownerToken);
    await localFiles.rekey(oldId, docId);
    // Keep the offline copy under the new id, then sync to the server.
    const old = this.idb;
    this.idb = persistDoc(docDbName(this.kind, docId), this.ydoc);
    openDocs.delete(oldId);
    openDocs.set(docId, this.ydoc);
    await this.idb.whenSynced;
    void old.clearData();
    this.set({ docId, token: ownerToken, role: 'owner', connection: 'connecting' });
    this.connect();
  }

  protected need(): { docId: string; token: string; api: CollabApi } {
    const { docId, token } = this.status;
    if (!this.api || !token || this.status.connection === 'local') throw new CollabError(tr('Partagez d’abord le document pour activer cette fonction', 'Share the document first to turn this on'), 0);
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

  /** Called once by `destroy` (revoke object URLs, stop workers…). */
  protected onDestroy() {}

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    if (openDocs.get(this.status.docId) === this.ydoc) openDocs.delete(this.status.docId);
    this.onDestroy();
    this.provider?.destroy();
    void this.idb.destroy();
    this.listeners.clear();
  }
}
