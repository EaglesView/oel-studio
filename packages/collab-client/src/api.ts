/** HTTP client for apps/collab. Tokens travel as Bearer headers, never in URLs. */

export type Role = 'owner' | 'editor' | 'viewer';

/** What a server document holds: a word-processing doc, a spreadsheet or a presentation. */
export type DocKind = 'doc' | 'sheet' | 'slides';

const KIND_MIME: Record<DocKind, string> = {
  doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Page that opens a shared document of each kind. */
export const SHARE_PATH: Record<DocKind, string> = { doc: '/document', sheet: '/tableur', slides: '/presentation' };

export interface ShareLink {
  id: string;
  role: Exclude<Role, 'owner'>;
  revoked: boolean;
  createdAt: number;
  token: string | null;
}

export interface VersionInfo {
  id: string;
  name: string | null;
  auto: boolean;
  author: string | null;
  createdAt: number;
}

export class CollabError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Role and document id carried by a token (signature is checked by the server). */
export function decodeToken(token: string | null | undefined): { docId: string; role: Role } | null {
  if (!token) return null;
  try {
    const body = token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(decodeURIComponent(escape(atob(body)))) as { d: string; r: Role };
    return { docId: p.d, role: p.r };
  } catch {
    return null;
  }
}

export class CollabApi {
  readonly wsUrl: string;

  constructor(readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws');
  }

  private async call(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
    let r: Response;
    try {
      r = await fetch(this.baseUrl + path, {
        ...init,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
      });
    } catch {
      throw new CollabError('Serveur de collaboration injoignable', 0);
    }
    if (!r.ok) {
      const msg = await r
        .json()
        .then((j: { error?: string }) => j.error)
        .catch(() => null);
      throw new CollabError(msg ?? `Erreur ${r.status}`, r.status);
    }
    return r;
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** A new server document, optionally from its original file (kept for round trips). */
  async createDoc(original: Uint8Array | null, title = '', kind: DocKind = 'doc'): Promise<{ docId: string; ownerToken: string }> {
    const r = await this.call(`/docs?title=${encodeURIComponent(title)}&kind=${kind}`, null, {
      method: 'POST',
      body: original ? (original as Uint8Array<ArrayBuffer>) : undefined,
      headers: { 'Content-Type': KIND_MIME[kind] },
    });
    return r.json();
  }

  async info(docId: string, token: string): Promise<{ id: string; title: string; role: Role; hasPackage: boolean; kind?: DocKind }> {
    return (await this.call(`/docs/${docId}`, token)).json();
  }

  async package(docId: string, token: string): Promise<Uint8Array | null> {
    const r = await this.call(`/docs/${docId}/package`, token);
    if (r.status === 204) return null;
    return new Uint8Array(await r.arrayBuffer());
  }

  async uploadMedia(docId: string, token: string, path: string, bytes: Uint8Array, mime: string): Promise<{ id: string; url: string }> {
    const r = await this.call(`/docs/${docId}/media?path=${encodeURIComponent(path)}`, token, {
      method: 'POST',
      body: bytes as Uint8Array<ArrayBuffer>,
      headers: { 'Content-Type': mime },
    });
    return r.json();
  }

  async links(docId: string, token: string): Promise<ShareLink[]> {
    return (await this.call(`/docs/${docId}/links`, token)).json();
  }

  async createLink(docId: string, token: string, role: ShareLink['role']): Promise<ShareLink> {
    const r = await this.call(`/docs/${docId}/links`, token, { method: 'POST', body: JSON.stringify({ role }), headers: { 'Content-Type': 'application/json' } });
    return r.json();
  }

  async revokeLink(docId: string, token: string, linkId: string): Promise<void> {
    await this.call(`/docs/${docId}/links/${linkId}`, token, { method: 'DELETE' });
  }

  async versions(docId: string, token: string): Promise<VersionInfo[]> {
    return (await this.call(`/docs/${docId}/versions`, token)).json();
  }

  async createVersion(docId: string, token: string, opts: { name?: string; auto?: boolean; author?: string }): Promise<VersionInfo> {
    const r = await this.call(`/docs/${docId}/versions`, token, { method: 'POST', body: JSON.stringify(opts), headers: { 'Content-Type': 'application/json' } });
    return r.json();
  }

  async versionState(docId: string, token: string, versionId: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.call(`/docs/${docId}/versions/${versionId}`, token)).arrayBuffer());
  }
}

/** The URL a share link opens (token in the fragment, so it never reaches server logs). */
export function shareUrl(origin: string, docId: string, token: string, kind: DocKind = 'doc'): string {
  return `${origin.replace(/\/$/, '')}${SHARE_PATH[kind]}?d=${encodeURIComponent(docId)}#t=${token}`;
}
