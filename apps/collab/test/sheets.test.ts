import { HocuspocusProvider } from '@hocuspocus/provider';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SheetDoc } from '@oel/sheets/model';
import { createCollabServer } from '../src/server';

const require = createRequire(import.meta.url);
const codec = require('oelxlsx-node') as { xlsx_to_model(b: Uint8Array): string };
const xlsx = readFileSync(fileURLToPath(new URL('../../../fixtures/xlsx/rich-lo.xlsx', import.meta.url)));

const secret = 'test-secret';
const port = 20_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let collab: ReturnType<typeof createCollabServer>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oel-collab-sheets-'));
  collab = createCollabServer({ dbFile: join(dir, 'db.sqlite'), secret, publicUrl: base, quiet: true });
  await collab.listen(port);
});
afterAll(async () => {
  await collab?.close();
});

function connect(docId: string, token: string) {
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${port}`, name: docId, token, document });
  const synced = new Promise<void>((res) => provider.on('synced', () => res()));
  return { document, provider, synced, sheet: new SheetDoc(document) };
}

const until = async (fn: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('spreadsheets on the collaboration server', () => {
  it('syncs concurrent structural and formula edits, enforces viewers, exports .xlsx', async () => {
    const r = await fetch(`${base}/docs?title=Budget&kind=sheet`, { method: 'POST', body: xlsx });
    expect(r.status).toBe(201);
    const { docId, ownerToken } = (await r.json()) as { docId: string; ownerToken: string };
    const info = (await (await fetch(`${base}/docs/${docId}`, { headers: { Authorization: `Bearer ${ownerToken}` } })).json()) as { kind: string; hasPackage: boolean };
    expect(info).toMatchObject({ kind: 'sheet', hasPackage: true });

    const a = connect(docId, ownerToken);
    await a.synced;
    a.sheet.seed(JSON.parse(codec.xlsx_to_model(new Uint8Array(xlsx))));
    const editorLink = (await (await fetch(`${base}/docs/${docId}/links`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'editor' }) })).json()) as { token: string };
    const b = connect(docId, editorLink.token);
    await b.synced;
    await until(() => b.sheet.sheetIds().length === 3);
    const sheet = a.sheet.sheetIds()[0]!;

    // At the same time: A inserts two rows above the amounts, B types a formula under the table.
    a.sheet.insertRows(sheet, 1, 2);
    b.sheet.setInput(sheet, 15, 1, '=SUM(B2:B5)*2');
    await until(() => a.sheet.inputText(sheet, 17, 1) === '=SUM(B4:B7)*2' && b.sheet.inputText(sheet, 17, 1) === '=SUM(B4:B7)*2');
    expect(b.sheet.inputText(sheet, 8, 1)).toBe('=SUM(B4:B7)');

    // A viewer's edits are not accepted by the server.
    const viewerLink = (await (await fetch(`${base}/docs/${docId}/links`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) })).json()) as { token: string };
    const v = connect(docId, viewerLink.token);
    await v.synced;
    v.sheet.setInput(sheet, 30, 0, 'pirate');
    await new Promise((res) => setTimeout(res, 400));
    expect(a.sheet.inputText(sheet, 30, 0)).toBe('');

    // Server-side export: a real .xlsx with the edits and recomputed values.
    await new Promise((res) => setTimeout(res, 300));
    const x = await fetch(`${base}/docs/${docId}/export.xlsx`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    expect(x.status).toBe(200);
    const back = JSON.parse(codec.xlsx_to_model(new Uint8Array(await x.arrayBuffer()))) as { sheets: Array<{ cells: Array<{ r: number; c: number; f?: string; v?: unknown }> }> };
    const total = back.sheets[0]!.cells.find((c) => c.r === 8 && c.c === 1)!;
    expect(total.f).toBe('SUM(B4:B7)');
    expect(total.v).toBe(2285.5);
    const csv = await fetch(`${base}/docs/${docId}/export.csv?sheet=1`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    expect((await csv.text()).split(/\r?\n/)[0]).toMatch(/^1,2,/);
    for (const c of [a, b, v]) c.provider.destroy();
  });
});
