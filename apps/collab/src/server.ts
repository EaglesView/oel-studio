/**
 * Collaboration server: Hocuspocus (Yjs sync over WebSocket) and a small HTTP
 * API (Hono) on the same port.
 *
 *   WS   /                      Yjs sync; document name = doc id; token = share token
 *   POST /docs?kind=doc|sheet   body: original .docx/.xlsx (optional) → { docId, ownerToken }
 *   GET  /docs/:id              → { id, title, role }
 *   GET  /docs/:id/package      original .docx (round-trip base)
 *   POST /docs/:id/media?path=  body: image bytes → { id, url }
 *   GET  /media/:id             image (unguessable id, cacheable)
 *   GET|POST /docs/:id/links    share links (owner)            DELETE /docs/:id/links/:lid
 *   GET|POST /docs/:id/versions version history (editors)      GET /docs/:id/versions/:vid
 *   GET  /docs/:id/export.docx  server-side .docx export
 *   GET  /docs/:id/export.xlsx  server-side .xlsx export (spreadsheets)
 *   GET  /docs/:id/export.csv?sheet=n   one sheet as CSV, in the file's dialect
 */
import { Server, type onAuthenticatePayload } from '@hocuspocus/server';
import { getRequestListener } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import { exportJsonFromYDoc } from '@oel/docs/model';
import { SheetDoc } from '@oel/sheets/model';
import { canEdit, signToken, verifyToken, type TokenPayload } from './auth';
import { Store, type DocKind, type Role } from './db';

const require = createRequire(import.meta.url);
const codec = require('oeldocx-node') as { pm_to_docx(json: string, original: Uint8Array | null | undefined, media: Array<{ path: string; bytes: Uint8Array }>): Uint8Array };
const sheets = require('oelxlsx-node') as { model_to_xlsx(json: string, original?: Uint8Array | null): Uint8Array; model_to_csv(json: string, sheet: number, dialect: string): Uint8Array };

export interface CollabOptions {
  dbFile: string;
  secret: string;
  /** Public base URL of this server (media links), e.g. http://localhost:8787 */
  publicUrl: string;
  /** Minimum time between automatic versions. */
  autoVersionEveryMs?: number;
  autoVersionsKept?: number;
  maxUploadBytes?: number;
  maxConnectionsPerIp?: number;
  quiet?: boolean;
}

/** Behind a proxy, trust its X-Forwarded-For; otherwise everything counts as one client. */
const clientIp = (h: Headers) => h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';

interface ConnContext {
  token: TokenPayload;
  name: string;
}

export function createCollabServer(o: CollabOptions) {
  const store = new Store(o.dbFile);
  const every = o.autoVersionEveryMs ?? 10 * 60_000;
  const maxUpload = o.maxUploadBytes ?? 100 * 1024 * 1024;
  const perIp = new Map<string, number>();

  /** A valid, non-revoked token for this document, or null. */
  const auth = (token: string | null | undefined, docId: string): TokenPayload | null => {
    const p = verifyToken(token, o.secret);
    if (!p || p.d !== docId) return null;
    const link = store.link(p.l);
    if (!link || link.revoked || link.doc_id !== docId || link.role !== p.r) return null;
    return p;
  };

  const server = new Server<ConnContext>({
    quiet: o.quiet ?? false,
    stopOnSignals: false,
    debounce: 2000,
    maxDebounce: 10_000,
    websocketOptions: { maxPayload: 32 * 1024 * 1024 },

    async onConnect({ requestHeaders }) {
      const ip = clientIp(requestHeaders);
      const n = (perIp.get(ip) ?? 0) + 1;
      if (n > (o.maxConnectionsPerIp ?? 200)) throw new Error('Trop de connexions');
      perIp.set(ip, n);
    },

    async onDisconnect({ requestHeaders }) {
      const ip = clientIp(requestHeaders);
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
    },

    async onAuthenticate(data: onAuthenticatePayload<ConnContext>) {
      const p = auth(data.token, data.documentName);
      if (!p || !store.doc(data.documentName)) throw new Error('Lien invalide ou révoqué');
      data.connectionConfig.readOnly = !canEdit(p.r);
      return { token: p, name: data.requestParameters.get('name') ?? '' };
    },

    async onLoadDocument({ document, documentName }) {
      const state = store.loadState(documentName);
      if (state) Y.applyUpdate(document, state);
      return document;
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const state = Y.encodeStateAsUpdate(document);
      store.saveState(documentName, state);
      // Automatic history: at most one snapshot per interval of activity.
      if (Date.now() - store.lastVersionAt(documentName) >= every) {
        store.addVersion(documentName, state, null, true, lastContext?.name || null);
        store.pruneAutoVersions(documentName, o.autoVersionsKept ?? 50);
      }
    },
  });

  /** Current state: the live document if loaded, else storage. */
  const currentState = (docId: string): Uint8Array | null => {
    const live = server.hocuspocus.documents.get(docId);
    return live ? Y.encodeStateAsUpdate(live) : store.loadState(docId);
  };

  const app = new Hono();
  app.use('*', cors({ origin: (origin) => origin ?? '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], maxAge: 600 }));
  app.use('*', bodyLimit({ maxSize: maxUpload, onError: (c) => c.json({ error: 'Fichier trop volumineux (100 Mo max.)' }, 413) }));

  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? c.req.query('t');
  const need = (c: Context, roles: Role[]): TokenPayload | Response => {
    const p = auth(bearer(c), c.req.param('id') ?? '');
    if (!p) return c.json({ error: 'Lien invalide ou révoqué' }, 401);
    if (!roles.includes(p.r)) return c.json({ error: 'Action réservée' }, 403);
    return p;
  };

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/docs', async (c) => {
    const body = new Uint8Array(await c.req.arrayBuffer());
    const kind: DocKind = c.req.query('kind') === 'sheet' ? 'sheet' : 'doc';
    // The round-trip base is an OOXML zip (.docx/.xlsx); CSV workbooks have none.
    if (body.length && (body[0] !== 0x50 || body[1] !== 0x4b)) return c.json({ error: kind === 'sheet' ? 'Le fichier n’est pas un .xlsx' : 'Le fichier n’est pas un .docx' }, 400);
    const doc = store.createDoc(c.req.query('title') ?? '', body.length ? body : null, kind);
    const link = store.createLink(doc.id, 'owner');
    return c.json({ docId: doc.id, ownerToken: signToken({ d: doc.id, r: 'owner', l: link.id }, o.secret) }, 201);
  });

  app.get('/docs/:id', (c) => {
    const p = need(c, ['owner', 'editor', 'viewer']);
    if (p instanceof Response) return p;
    const doc = store.doc(p.d);
    return c.json({ id: p.d, title: doc?.title ?? '', role: p.r, kind: doc?.kind ?? 'doc', hasPackage: !!store.package(p.d) });
  });

  app.get('/docs/:id/package', (c) => {
    const p = need(c, ['owner', 'editor', 'viewer']);
    if (p instanceof Response) return p;
    const pkg = store.package(p.d);
    if (!pkg) return c.body(null, 204);
    const mime = store.doc(p.d)?.kind === 'sheet' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return c.body(pkg as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': mime });
  });

  app.post('/docs/:id/media', async (c) => {
    const p = need(c, ['owner', 'editor']);
    if (p instanceof Response) return p;
    const path = c.req.query('path') ?? '';
    if (!/^word\/media\/[\w.-]+\.(png|jpe?g|gif|bmp|svg|webp|tiff?|emf|wmf)$/i.test(path)) return c.json({ error: 'Chemin d’image invalide' }, 400);
    const mime = c.req.header('content-type') ?? 'application/octet-stream';
    if (!mime.startsWith('image/')) return c.json({ error: 'Seules les images sont acceptées' }, 415);
    const id = store.addMedia(p.d, path, mime, new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ id, url: `${o.publicUrl}/media/${id}` }, 201);
  });

  app.get('/media/:mid', (c) => {
    const m = store.media(c.req.param('mid'));
    if (!m) return c.notFound();
    // SVG could carry script: never render it inline from our origin.
    const headers: Record<string, string> = { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
    if (m.mime.includes('svg')) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
    return c.body(m.bytes as Uint8Array<ArrayBuffer>, 200, headers);
  });

  app.get('/docs/:id/links', (c) => {
    const p = need(c, ['owner']);
    if (p instanceof Response) return p;
    return c.json(
      store.links(p.d).map((l) => ({ id: l.id, role: l.role, revoked: !!l.revoked, createdAt: l.created_at, token: l.revoked ? null : signToken({ d: p.d, r: l.role, l: l.id }, o.secret) })),
    );
  });

  app.post('/docs/:id/links', async (c) => {
    const p = need(c, ['owner']);
    if (p instanceof Response) return p;
    const { role } = (await c.req.json().catch(() => ({}))) as { role?: Role };
    if (role !== 'editor' && role !== 'viewer') return c.json({ error: 'Rôle invalide' }, 400);
    const l = store.createLink(p.d, role);
    return c.json({ id: l.id, role, revoked: false, createdAt: l.created_at, token: signToken({ d: p.d, r: role, l: l.id }, o.secret) }, 201);
  });

  app.delete('/docs/:id/links/:lid', (c) => {
    const p = need(c, ['owner']);
    if (p instanceof Response) return p;
    if (!store.revokeLink(p.d, c.req.param('lid'))) return c.notFound();
    // Drop live sessions; valid tokens reconnect on their own, revoked ones are refused.
    server.hocuspocus.closeConnections(p.d);
    return c.json({ ok: true });
  });

  app.get('/docs/:id/versions', (c) => {
    const p = need(c, ['owner', 'editor']);
    if (p instanceof Response) return p;
    return c.json(store.versions(p.d).map((v) => ({ id: v.id, name: v.name, auto: !!v.auto, author: v.author, createdAt: v.created_at })));
  });

  app.post('/docs/:id/versions', async (c) => {
    const p = need(c, ['owner', 'editor']);
    if (p instanceof Response) return p;
    const { name, auto, author } = (await c.req.json().catch(() => ({}))) as { name?: string; auto?: boolean; author?: string };
    const state = currentState(p.d);
    if (!state) return c.json({ error: 'Document vide' }, 409);
    const v = store.addVersion(p.d, state, name?.slice(0, 120) || null, !!auto, author?.slice(0, 80) || null);
    return c.json({ id: v.id, name: v.name, auto: !!v.auto, author: v.author, createdAt: v.created_at }, 201);
  });

  app.get('/docs/:id/versions/:vid', (c) => {
    const p = need(c, ['owner', 'editor']);
    if (p instanceof Response) return p;
    const s = store.versionState(p.d, c.req.param('vid'));
    if (!s) return c.notFound();
    return c.body(s as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/octet-stream' });
  });

  app.get('/docs/:id/export.docx', (c) => {
    const p = need(c, ['owner', 'editor', 'viewer']);
    if (p instanceof Response) return p;
    const state = currentState(p.d);
    if (!state) return c.json({ error: 'Document vide' }, 409);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    const json = exportJsonFromYDoc(ydoc);
    const media = [...store.mediaByPath(p.d)].map(([path, bytes]) => ({ path, bytes }));
    const bytes = codec.pm_to_docx(JSON.stringify(json), store.package(p.d), media);
    const title = (store.doc(p.d)?.title || 'document').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 80) || 'document';
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(title)}.docx`,
    });
  });

  /** The workbook JSON of a spreadsheet's current state. */
  const workbook = (docId: string) => {
    const state = currentState(docId);
    if (!state) return null;
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    return new SheetDoc(ydoc).toWorkbook();
  };
  const fileName = (docId: string, fallback: string) => (store.doc(docId)?.title || fallback).replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 80) || fallback;

  app.get('/docs/:id/export.xlsx', (c) => {
    const p = need(c, ['owner', 'editor', 'viewer']);
    if (p instanceof Response) return p;
    const wb = workbook(p.d);
    if (!wb) return c.json({ error: 'Classeur vide' }, 409);
    // Cached values are recomputed by the codec (IronCalc) before writing.
    const bytes = sheets.model_to_xlsx(JSON.stringify(wb), wb.source === 'xlsx' ? store.package(p.d) : null);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName(p.d, 'classeur'))}.xlsx`,
    });
  });

  app.get('/docs/:id/export.csv', (c) => {
    const p = need(c, ['owner', 'editor', 'viewer']);
    if (p instanceof Response) return p;
    const wb = workbook(p.d);
    if (!wb) return c.json({ error: 'Classeur vide' }, 409);
    const sheet = Math.max(0, Math.min(wb.sheets.length - 1, Number(c.req.query('sheet') ?? 0) || 0));
    const bytes = sheets.model_to_csv(JSON.stringify(wb), sheet, '');
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName(p.d, 'classeur'))}.csv`,
    });
  });

  const listener = getRequestListener(app.fetch);
  server.hocuspocus.configuration.extensions.push({
    async onRequest({ request, response }) {
      await listener(request, response);
      // Rejecting with null tells Hocuspocus the request was handled.
      throw null;
    },
  });

  return {
    server,
    store,
    app,
    listen: (port: number) => server.listen(port),
    async close() {
      await server.destroy();
      store.db.close();
    },
  };
}
