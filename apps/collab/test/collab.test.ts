import { HocuspocusProvider } from '@hocuspocus/provider';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docsSchema } from '@oel/docs/schema';
import { BODY, exportJsonFromYDoc, plainText, sectionsMap, seedYDoc, type DocxJson } from '@oel/docs/model';
import { signToken, verifyToken } from '../src/auth';
import { createCollabServer } from '../src/server';

const require = createRequire(import.meta.url);
const codec = require('oeldocx-node') as { docx_to_pm(b: Uint8Array): { json: string } };
const docx = readFileSync(fileURLToPath(new URL('../../../fixtures/docx/tesxte.docx', import.meta.url)));

const secret = 'test-secret';
const port = 18_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let collab: ReturnType<typeof createCollabServer>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oel-collab-'));
  collab = createCollabServer({ dbFile: join(dir, 'db.sqlite'), secret, publicUrl: base, quiet: true });
  await collab.listen(port);
});
afterAll(async () => {
  await collab?.close();
});

const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

function connect(docId: string, token: string) {
  const document = new Y.Doc();
  const failures: string[] = [];
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: docId,
    token,
    document,
    onAuthenticationFailed: ({ reason }) => void failures.push(reason),
  });
  const synced = new Promise<void>((res) => provider.on('synced', () => res()));
  return { document, provider, synced, failures };
}

const until = async (fn: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('tokens', () => {
  it('sign and verify, reject tampering', () => {
    const t = signToken({ d: 'doc', r: 'editor', l: 'l1' }, secret);
    expect(verifyToken(t, secret)?.r).toBe('editor');
    expect(verifyToken(t, 'other')).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ d: 'doc', r: 'owner', l: 'l1' })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyToken(`${body}.${sig}x`, secret)).toBeNull();
    expect(verifyToken(signToken({ d: 'd', r: 'viewer', l: 'l', x: Date.now() - 1 }, secret), secret)).toBeNull();
  });
});

describe('collaboration server', () => {
  let docId = '';
  let owner = '';
  let editor = '';
  let viewer = '';
  let viewerLink = '';

  it('creates a document from a .docx and hands out links', async () => {
    const r = await fetch(`${base}/docs?title=Essai`, { method: 'POST', body: docx });
    expect(r.status).toBe(201);
    ({ docId, ownerToken: owner } = (await r.json()) as { docId: string; ownerToken: string });
    const pkg = await api(`/docs/${docId}/package`, owner);
    expect(new Uint8Array(await pkg.arrayBuffer()).length).toBe(docx.length);

    const e = (await (await api(`/docs/${docId}/links`, owner, { method: 'POST', body: JSON.stringify({ role: 'editor' }), headers: { 'Content-Type': 'application/json' } })).json()) as { token: string };
    const v = (await (await api(`/docs/${docId}/links`, owner, { method: 'POST', body: JSON.stringify({ role: 'viewer' }), headers: { 'Content-Type': 'application/json' } })).json()) as { token: string; id: string };
    editor = e.token;
    viewer = v.token;
    viewerLink = v.id;
    // Editors cannot create links.
    expect((await api(`/docs/${docId}/links`, editor, { method: 'POST', body: '{"role":"editor"}' })).status).toBe(403);
    expect((await api(`/docs/${docId}`, 'garbage')).status).toBe(401);
  });

  it('syncs edits between peers and keeps viewers read-only', async () => {
    const a = connect(docId, owner);
    await a.synced;
    const json = JSON.parse(codec.docx_to_pm(docx).json) as DocxJson;
    expect(seedYDoc(a.document, json, docsSchema())).toBe(true);

    const b = connect(docId, editor);
    await b.synced;
    await until(() => plainText(exportJsonFromYDoc(b.document).doc).includes('Bixi'));

    // Editor types: owner sees it.
    b.document.getXmlFragment(BODY).insert(0, [new Y.XmlElement('paragraph')]);
    const p = b.document.getXmlFragment(BODY).get(0) as Y.XmlElement;
    p.insert(0, [new Y.XmlText('Ajout de l’éditeur')]);
    await until(() => plainText(exportJsonFromYDoc(a.document).doc).startsWith('Ajout de l’éditeur'));

    // Viewer changes never reach the others.
    const v = connect(docId, viewer);
    await v.synced;
    const vp = new Y.XmlElement('paragraph');
    vp.insert(0, [new Y.XmlText('Intrusion')]);
    v.document.getXmlFragment(BODY).insert(0, [vp]);
    await new Promise((r) => setTimeout(r, 400));
    expect(plainText(exportJsonFromYDoc(a.document).doc)).not.toContain('Intrusion');

    for (const c of [a, b, v]) c.provider.destroy();
  });

  it('revoked links are refused', async () => {
    expect((await api(`/docs/${docId}/links/${viewerLink}`, owner, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/docs/${docId}`, viewer)).status).toBe(401);
    const v = connect(docId, viewer);
    await until(() => v.failures.length > 0);
    v.provider.destroy();
  });

  it('keeps versions and exports .docx', async () => {
    const created = await api(`/docs/${docId}/versions`, editor, { method: 'POST', body: JSON.stringify({ name: 'Première version' }), headers: { 'Content-Type': 'application/json' } });
    expect(created.status).toBe(201);
    const list = (await (await api(`/docs/${docId}/versions`, owner)).json()) as Array<{ id: string; name: string }>;
    expect(list[0]?.name).toBe('Première version');
    const snap = new Uint8Array(await (await api(`/docs/${docId}/versions/${list[0]!.id}`, owner)).arrayBuffer());
    const restored = new Y.Doc();
    Y.applyUpdate(restored, snap);
    expect(plainText(exportJsonFromYDoc(restored).doc)).toContain('Ajout de l’éditeur');

    const out = await api(`/docs/${docId}/export.docx`, owner);
    expect(out.status).toBe(200);
    const bytes = new Uint8Array(await out.arrayBuffer());
    const back = JSON.parse(codec.docx_to_pm(bytes).json) as DocxJson;
    expect(plainText(back.doc)).toContain('Ajout de l’éditeur');
    expect(plainText(back.doc)).toContain('La première chose');
  });

  it('exports sections and shared headers/footers (format 2)', async () => {
    const file = readFileSync(fileURLToPath(new URL('../../../fixtures/docx/sections-headers.docx', import.meta.url)));
    const r = await fetch(`${base}/docs?title=Sections`, { method: 'POST', body: file });
    const { docId: id, ownerToken } = (await r.json()) as { docId: string; ownerToken: string };
    const a = connect(id, ownerToken);
    await a.synced;
    const json = JSON.parse(codec.docx_to_pm(file).json) as DocxJson;
    expect(seedYDoc(a.document, json, docsSchema())).toBe(true);
    // A collaborator widens the second section's left margin and drops the third's own footer.
    const map = sectionsMap(a.document);
    map.set('s2', { ...map.get('s2')!, page: { ...map.get('s2')!.page, left: 2880 } });
    map.set('body', { ...map.get('body')!, footers: {} });
    await new Promise((res) => setTimeout(res, 300));

    const out = await api(`/docs/${id}/export.docx`, ownerToken);
    expect(out.status).toBe(200);
    const back = JSON.parse(codec.docx_to_pm(new Uint8Array(await out.arrayBuffer())).json) as DocxJson;
    expect(back.sections.map((s) => s.id)).toEqual(['s1', 's2', 'body']);
    expect(back.sections[1]!.page.left).toBe(2880);
    expect(back.sections[0]!.headers).toEqual(json.sections[0]!.headers);
    expect(back.sections[2]!.footers).toEqual({});
    expect(back.settings.evenAndOddHeaders).toBe(true);
    a.provider.destroy();
  });

  it('stores media behind unguessable ids', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await api(`/docs/${docId}/media?path=word/media/oel-a.png`, editor, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(201);
    const { url } = (await r.json()) as { url: string };
    const img = await fetch(url);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect((await api(`/docs/${docId}/media?path=../../etc/passwd`, editor, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } })).status).toBe(400);
  });
});
