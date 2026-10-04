import { describe, expect, it } from 'vitest';
import { EngineRegistry, detectKind, previewEngine } from '../src';

const enc = new TextEncoder();

/** Builds an uncompressed (stored) ZIP — enough to exercise the reader. */
function storedZip(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name);
    const d = enc.encode(text);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint32(18, d.length, true);
    local.setUint32(22, d.length, true);
    local.setUint16(26, n.length, true);
    chunks.push(new Uint8Array(local.buffer), n, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(20, d.length, true);
    c.setUint32(24, d.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

const run = (name: string, bytes: Uint8Array, type = '') => new EngineRegistry().register(previewEngine).import({ name, type, bytes });

describe('detectKind', () => {
  it('prefers magic bytes over the extension', () => {
    expect(detectKind({ name: 'scan.docx' }, enc.encode('%PDF-1.7'))).toBe('pdf');
    expect(detectKind({ name: 'budget.xlsx' })).toBe('spreadsheet');
    expect(detectKind({ name: 'archive.zip' })).toBe('unsupported');
  });
});

describe('previewEngine', () => {
  it('reads paragraphs and headings from a .docx', async () => {
    const xml = '<w:document><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Rapport &amp; bilan</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Bonjour </w:t></w:r><w:r><w:t>le monde</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const r = await run('rapport.docx', storedZip({ 'word/document.xml': xml }));
    expect(r.kind).toBe('document');
    expect(r.readOnly).toBe(false);
    expect(r.preview).toMatchObject({ blocks: [{ type: 'heading', text: 'Rapport & bilan' }, { type: 'paragraph', text: 'Bonjour le monde' }] });
  });

  it('reads shared strings and numbers from a .xlsx', async () => {
    const r = await run('budget.xlsx', storedZip({
      'xl/sharedStrings.xml': '<sst><si><t>Affiches</t></si></sst>',
      'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" sheetId="1"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200</v></c></row></sheetData>',
    }));
    expect(r.preview).toEqual({ kind: 'spreadsheet', sheets: ['Budget'], rows: [['Affiches', '1200']] });
  });

  it('opens a scanned PDF read-only with a reason', async () => {
    const pdf = '%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj\n<< /Subtype /Image >>';
    const r = await run('facture.pdf', enc.encode(pdf));
    expect(r).toMatchObject({ kind: 'pdf', readOnly: true, preview: { pageCount: 2, scanned: true } });
    expect(r.reason).toMatch(/Numérisé/);
  });

  it('parses csv with semicolons', async () => {
    const r = await run('ventes.csv', enc.encode('Poste;Montant\nAffiches;1200'));
    expect(r.preview).toMatchObject({ rows: [['Poste', 'Montant'], ['Affiches', '1200']] });
  });
});

describe('oeldocx engine', () => {
  it('imports with a payload, exports, and creates blank documents', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const { createOeldocxEngine, EngineRegistry, previewEngine } = await import('../src');
    const mod = createRequire(import.meta.url)('oeldocx-node');
    const registry = new EngineRegistry().register(previewEngine).register(createOeldocxEngine(async () => mod));
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../fixtures/docx/tesxte.docx', import.meta.url))));
    const res = await registry.import({ name: 'tesxte.docx', type: '', bytes });
    expect(res.engine).toBe('oeldocx-rs');
    expect(res.preview.kind === 'document' && res.preview.blocks[0]?.text.startsWith('La première chose')).toBe(true);
    const payload = res.payload as { json: string; original: Uint8Array };
    const out = await registry.export({ kind: 'document', format: 'docx', data: { json: JSON.parse(payload.json), original: payload.original, media: [] } });
    expect(out[0]).toBe(0x50);
    const blank = await registry.create('document', 'Nouveau');
    expect(blank.title).toBe('Nouveau');
    // Other formats still go to the preview engine.
    const csv = await registry.import({ name: 'a.csv', type: 'text/csv', bytes: new TextEncoder().encode('a;b\n1;2') });
    expect(csv.engine).not.toBe('oeldocx-rs');
  });
});

describe('oelpptx engine', () => {
  it('imports .pptx with a payload, exports, creates decks, and leaves .ppt to the preview engine', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const { createOelpptxEngine, EngineRegistry, previewEngine, asDeckPayload } = await import('../src');
    const mod = createRequire(import.meta.url)('oelpptx-node');
    const registry = new EngineRegistry().register(previewEngine).register(createOelpptxEngine(async () => mod));
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../fixtures/pptx/Presentation 3.pptx', import.meta.url))));
    const res = await registry.import({ name: 'Presentation 3.pptx', type: '', bytes });
    expect(res.engine).toBe('oelpptx-rs');
    expect(res.kind).toBe('slides');
    // Portrait 4:3 deck: the desk paper takes its shape.
    expect(res.preview).toMatchObject({ kind: 'slides', size: { width: 6858000, height: 9144000 } });
    const payload = asDeckPayload(res.payload);
    const out = await registry.export({ kind: 'slides', format: 'pptx', data: { json: JSON.parse(payload.json), original: payload.original, media: [] } });
    expect([out[0], out[1]]).toEqual([0x50, 0x4b]);
    const blank = await registry.create('slides', 'Nouvelle');
    expect(blank.title).toBe('Nouvelle');
    expect(asDeckPayload(blank.payload).original).toBeNull();
    expect(detectKind({ name: 'vieux.ppt' })).toBe('slides');
    const old = await registry.import({ name: 'vieux.ppt', type: '', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }).catch((e: Error) => e);
    expect(old instanceof Error ? old.message : (old as { engine: string }).engine).not.toBe('oelpptx-rs');
  });
});
