// @vitest-environment happy-dom
/**
 * The real editor (all extensions) driven headlessly with the same commands
 * the toolbar and menus use, then exported through the codec and re-imported.
 */
import { readFileSync, mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { docsExtensions } from '../src/extensions';
import { styleRegistry } from '../src/ui/useDocEditor';
import { insertOrUpdateToc, toMarkdown, toHTML } from '../src/ui/actions';
import { plainText } from '../src/model/ydoc';
import type { DocxJson, ExportJson, PMNode } from '../src/model/types';

const require = createRequire(import.meta.url);
const codec = require('oeldocx-node') as {
  docx_to_pm(b: Uint8Array): { json: string };
  pm_to_docx(json: string, original: Uint8Array | null | undefined, media: unknown[]): Uint8Array;
};
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '../../../fixtures/docx', name));
const load = (b: Uint8Array) => JSON.parse(codec.docx_to_pm(b).json) as DocxJson;

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function open(json: DocxJson) {
  const e = new Editor({ element: document.createElement('div'), extensions: docsExtensions({ pagination: false }), content: json.doc });
  e.storage.paragraph.styles = styleRegistry(json.styles);
  e.storage.docList.numbering = json.numbering;
  e.commands.refreshLists();
  editor = e;
  return e;
}

function exportJson(e: Editor, base: DocxJson, extra: Partial<ExportJson> = {}): ExportJson {
  return {
    doc: e.getJSON() as ExportJson['doc'],
    notes: base.notes,
    headers: base.headers,
    footers: base.footers,
    page: base.page,
    numbering: { synthetic: [...e.storage.docList.synthetic].map(([numId, kind]) => ({ numId, kind })) },
    ...extra,
  };
}

/** Position range of the n-th paragraph's text. */
function para(e: Editor, n: number) {
  let i = 0;
  let out = { from: 0, to: 0 };
  e.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    if (i++ === n) out = { from: pos + 1, to: pos + node.nodeSize - 1 };
    return false;
  });
  return out;
}

const all = (n: PMNode, t: string, out: PMNode[] = []) => {
  if (n.type === t) out.push(n);
  (n.content ?? []).forEach((c) => all(c, t, out));
  return out;
};

function opensInLibreOffice(bytes: Uint8Array): boolean | null {
  try {
    execFileSync('soffice', ['--version'], { stdio: 'ignore' });
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), 'oel-editor-'));
  writeFileSync(join(dir, 'out.docx'), bytes);
  execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, join(dir, 'out.docx')], { stdio: 'ignore', timeout: 120_000 });
  return existsSync(join(dir, 'out.pdf')) && statSync(join(dir, 'out.pdf')).size > 500;
}

describe('editor commands → .docx', () => {
  it('formats, lists, tables, breaks, links, TOC and find/replace survive export', () => {
    const original = fixture('long.docx');
    const base = load(original);
    const e = open(base);
    const h = para(e, 0);
    const p1 = para(e, 1);

    e.chain().setTextSelection(h).toggleItalic().run();
    e.chain().setTextSelection({ from: p1.from, to: p1.from + 9 }).toggleBold().setColor('#CC0000').setFontSize('14pt').setFontFamily('Georgia').setHighlight({ color: '#FFFF00' }).run();
    e.chain().setTextSelection(p1.from + 12).setAlign('center').setLineSpacing(360).changeIndent(720).run();

    // Lists: bullet, numbered (two levels), checklist with one item checked.
    e.chain().setTextSelection(para(e, 2).from).toggleList('bullet').run();
    e.chain().setTextSelection(para(e, 3).from).toggleList('numbered').run();
    e.chain().setTextSelection(para(e, 3).from).changeIndent(720).run();
    e.chain().setTextSelection(para(e, 4).from).toggleList('check').run();
    const checkPos = para(e, 4).from - 1;
    e.commands.toggleChecked(checkPos);

    // Heading via role, page break, tab, link, horizontal line, table.
    e.chain().setTextSelection(para(e, 5).from).setParagraphRole('heading2').run();
    e.chain().setTextSelection(para(e, 5).to).insertTab().insertContent({ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://outilsenligne.ca' } }] }).run();
    e.chain().setTextSelection(para(e, 6).to).insertPageBreak().run();
    e.chain().setTextSelection(para(e, 6).to).insertHorizontalLine().run();
    e.chain().setTextSelection(para(e, 1).to).insertTable({ rows: 2, cols: 3, withHeaderRow: false }).insertContent('cellule').run();
    expect(e.isActive('table')).toBe(true);
    e.chain().focus().addRowAfter().run();
    e.chain().focus().addColumnAfter().run();

    // Table of contents from headings (static page numbers here).
    e.commands.setTextSelection(1);
    insertOrUpdateToc(e, () => 1);

    // Find & replace.
    e.commands.setSearch({ query: 'Sherbrooke', caseSensitive: true });
    const hits = e.storage.find.results.length;
    expect(hits).toBeGreaterThan(5);
    e.commands.replaceAll('Magog');
    e.commands.setSearch({ query: 'Sherbrooke' });
    expect(e.storage.find.results.length).toBe(0);

    // Undo/redo of the last change.
    e.commands.undo();
    expect(e.getText()).toContain('Sherbrooke');
    e.commands.redo();
    expect(e.getText()).not.toContain('Sherbrooke');

    // Static renders used by headers, previews, downloads.
    expect(toHTML(e.getJSON() as never)).toContain('<table');
    expect(toMarkdown(e)).toMatch(/^## /m);

    const out = exportJson(e, base);
    const bytes = codec.pm_to_docx(JSON.stringify(out), original, []);
    const back = load(bytes);
    const text = plainText(back.doc);
    expect(text).toContain('Magog');
    expect(text).not.toContain('Sherbrooke');
    expect(text).toContain('Table des matières');

    const paras = all(back.doc, 'paragraph');
    const marks = (n: PMNode) => all(n, 'text').flatMap((t) => t.marks ?? []);
    expect(marks(paras.find((p) => p.attrs?.outline === 0 && plainText(p).startsWith('Chapitre 1'))!).some((m) => m.type === 'italic')).toBe(true);
    const red = all(back.doc, 'text').find((t) => t.marks?.some((m) => m.type === 'textStyle' && m.attrs?.color === '#CC0000'));
    expect(red?.marks?.find((m) => m.type === 'textStyle')?.attrs).toMatchObject({ fontSize: '14pt', fontFamily: 'Georgia' });
    expect(red?.marks?.some((m) => m.type === 'bold')).toBe(true);
    expect(red?.marks?.some((m) => m.type === 'highlight')).toBe(true);
    expect(paras.some((p) => p.attrs?.align === 'center' && (p.attrs?.spacing as { line?: number })?.line === 360)).toBe(true);
    const listed = paras.filter((p) => p.attrs?.numId != null);
    expect(listed.length).toBeGreaterThanOrEqual(3);
    expect(listed.some((p) => p.attrs?.ilvl === 1)).toBe(true);
    const kinds = new Set(listed.map((p) => back.numbering.nums[String(p.attrs!.numId)]?.levels[0]?.text));
    expect(kinds.has('●') && kinds.has('☑')).toBe(true);
    expect(paras.some((p) => p.attrs?.outline === 1)).toBe(true);
    expect(all(back.doc, 'pageBreak').length).toBeGreaterThanOrEqual(1);
    expect(all(back.doc, 'tab').length).toBeGreaterThanOrEqual(1);
    expect(all(back.doc, 'text').some((t) => t.marks?.some((m) => m.type === 'link' && m.attrs?.href === 'https://outilsenligne.ca'))).toBe(true);
    const tables = all(back.doc, 'table');
    expect(tables.length).toBe(2);
    expect(plainText(tables[0]!)).toContain('cellule');
    expect(all(tables[0]!, 'tableRow').length).toBe(3);
    expect(all(back.doc, 'sdtBlock')[0]?.attrs?.gallery).toBe('Table of Contents');

    expect(opensInLibreOffice(bytes)).not.toBe(false);
  }, 180_000);

  it('a new document built from scratch exports', () => {
    const blankJson = JSON.parse(require('oeldocx-node').new_document_pm().json) as DocxJson;
    const e = open(blankJson);
    e.chain().setTextSelection(1).insertContent('Titre du rapport').setParagraphRole('title').run();
    e.chain().splitBlock().setParagraphRole('normal').insertContent('Premier paragraphe.').run();
    e.chain().splitBlock().toggleList('numbered').insertContent('Point un').run();
    const bytes = codec.pm_to_docx(JSON.stringify(exportJson(e, blankJson)), null, []);
    const back = load(bytes);
    expect(plainText(back.doc)).toContain('Titre du rapport');
    const title = all(back.doc, 'paragraph')[0]!;
    expect(back.styles.find((s) => s.id === title.attrs?.styleId)?.role).toBe('title');
    expect(all(back.doc, 'paragraph').some((p) => p.attrs?.numId != null)).toBe(true);
    expect(opensInLibreOffice(bytes)).not.toBe(false);
  }, 180_000);
});
