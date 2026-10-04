import { HocuspocusProvider } from '@hocuspocus/provider';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SlidesDoc, plainText, type Deck } from '@oel/slides/model';
import { createCollabServer } from '../src/server';

const require = createRequire(import.meta.url);
const codec = require('oelpptx-node') as { pptx_to_deck(b: Uint8Array): { json: string } };
const pptx = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../fixtures/pptx/Presentation 1.pptx', import.meta.url))));

const secret = 'test-secret';
const port = 22_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let collab: ReturnType<typeof createCollabServer>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oel-collab-slides-'));
  collab = createCollabServer({ dbFile: join(dir, 'db.sqlite'), secret, publicUrl: base, quiet: true, maxUploadBytes: 50 * 1024 * 1024 });
  await collab.listen(port);
});
afterAll(async () => {
  await collab?.close();
});

const until = async (fn: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

function connect(docId: string, token: string) {
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${port}`, name: docId, token, document });
  const synced = new Promise<void>((res) => provider.on('synced', () => res()));
  return { document, provider, synced, slides: new SlidesDoc(document) };
}

describe('presentations on the collaboration server', () => {
  it('keeps the .pptx, syncs two editors and exports their edits', async () => {
    const r = await fetch(`${base}/docs?title=Iris&kind=slides`, { method: 'POST', body: pptx });
    expect(r.status).toBe(201);
    const { docId, ownerToken } = (await r.json()) as { docId: string; ownerToken: string };
    const info = (await (await fetch(`${base}/docs/${docId}`, { headers: { Authorization: `Bearer ${ownerToken}` } })).json()) as { kind: string; hasPackage: boolean };
    expect(info).toMatchObject({ kind: 'slides', hasPackage: true });
    const pkg = await fetch(`${base}/docs/${docId}/package`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    expect(pkg.headers.get('content-type')).toContain('presentationml');

    const a = connect(docId, ownerToken);
    await a.synced;
    a.slides.seed(JSON.parse(codec.pptx_to_deck(pptx).json) as Deck);
    const b = connect(docId, ownerToken);
    await b.synced;
    await until(() => b.slides.slideIds().length === 8);

    const sid = a.slides.slideIds()[0]!;
    const title = a.slides.slide(sid)!.elements[0]!;
    b.slides.edit(() => b.slides.updateElement(sid, title.id, { text: { ...title.text!, paras: [{ runs: [{ kind: 'text', text: 'Hommage', props: {} }], props: {}, end: {} }] } }));
    a.slides.edit(() => a.slides.moveSlide(a.slides.slideIds()[7]!, 0));
    await until(() => plainText(a.slides.slide(sid)!.elements[0]!.text) === 'Hommage' && b.slides.slideIds()[0] === a.slides.slideIds()[0]);

    await new Promise((res) => setTimeout(res, 300));
    const x = await fetch(`${base}/docs/${docId}/export.pptx`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    expect(x.status).toBe(200);
    const back = JSON.parse(codec.pptx_to_deck(new Uint8Array(await x.arrayBuffer())).json) as Deck;
    expect(back.slides).toHaveLength(8);
    expect(plainText(back.slides[1]!.elements[0]!.text)).toBe('Hommage');
    // Pictures and unwrapped fonts of a presentation upload; anything else does not.
    const up = (path: string, type: string, body: Uint8Array) => fetch(`${base}/docs/${docId}/media?path=${encodeURIComponent(path)}`, { method: 'POST', body: body as Uint8Array<ArrayBuffer>, headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': type } });
    expect((await up('ppt/media/oel-a.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).status).toBe(201);
    expect((await up('ppt/fonts/font1-regular.ttf', 'font/ttf', new Uint8Array([0, 1, 0, 0, 9, 9]))).status).toBe(201);
    expect((await up('ppt/fonts/font1-regular.ttf', 'font/ttf', new Uint8Array([1, 2, 3, 4]))).status).toBe(415);
    expect((await up('ppt/slides/slide1.xml', 'image/png', new Uint8Array([1]))).status).toBe(400);
    expect((await up('ppt/media/oel-b.png', 'font/ttf', new Uint8Array([0, 1, 0, 0]))).status).toBe(415);
    a.provider.destroy();
    b.provider.destroy();
  });
});
