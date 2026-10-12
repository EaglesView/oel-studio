import { detectKind, extensionOf, stripExtension } from '../detect';
import type { DocumentEngine, ImportRequest, ImportResult, Preview } from '../types';
import { readZipDirectory, readZipText } from '../zip';
import { messages } from '@oel/i18n';

const t = messages(
  {
    sheet1: 'Feuille 1',
    reading: 'Lecture du fichier',
    readingText: 'Lecture du texte',
    readingCells: 'Lecture des cellules',
    readingSlides: 'Lecture des diapositives',
    ready: 'Prêt',
    scanned: 'Numérisé : le texte n’est pas encore modifiable.',
    pdf: 'PDF : ouvert en lecture.',
    unsupported: 'Aperçu seulement : format non pris en charge.',
    legacy: 'Ancien format : conversion requise pour modifier.',
  },
  {
    sheet1: 'Sheet1',
    reading: 'Reading the file',
    readingText: 'Reading the text',
    readingCells: 'Reading the cells',
    readingSlides: 'Reading the slides',
    ready: 'Ready',
    scanned: 'Scanned: the text can’t be edited yet.',
    pdf: 'PDF: opened read-only.',
    unsupported: 'Preview only: format not supported.',
    legacy: 'Old format: needs converting to edit.',
  },
);

/**
 * JS preview engine: reads just enough of each format to put a faithful paper
 * on the desk. It is the fallback behind the WASM engines and runs in a Worker
 * (no DOM: XML is scanned with regular expressions, not DOMParser).
 */

const MAX_BLOCKS = 40;
const MAX_ROWS = 14;
const MAX_COLS = 6;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}
function textRuns(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g');
  let out = '';
  for (const m of xml.matchAll(re)) out += m[1];
  return decodeXml(out);
}

async function docx(bytes: Uint8Array): Promise<Preview> {
  const zip = readZipDirectory(bytes);
  const entry = zip.get('word/document.xml');
  if (!entry) throw new Error('word/document.xml introuvable');
  const xml = await readZipText(bytes, entry);
  const blocks: Extract<Preview, { kind: 'document' }>['blocks'] = [];
  let words = 0;
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const text = textRuns(p, 'w:t').trim();
    if (!text) continue;
    words += text.split(/\s+/).length;
    if (blocks.length < MAX_BLOCKS) {
      const heading = /<w:pStyle w:val="(Heading|Titre|Title|Titl)[^"]*"/i.test(p);
      blocks.push({ type: heading ? 'heading' : 'paragraph', text });
    }
  }
  const breaks = (xml.match(/w:type="page"/g)?.length ?? 0) + 1;
  return { kind: 'document', blocks, wordCount: words, pageCount: Math.max(breaks, Math.ceil(words / 450)) };
}

async function odf(bytes: Uint8Array, kind: 'document' | 'slides' | 'spreadsheet'): Promise<Preview> {
  const zip = readZipDirectory(bytes);
  const entry = zip.get('content.xml');
  if (!entry) throw new Error('content.xml introuvable');
  const xml = await readZipText(bytes, entry);
  const paras = [...xml.matchAll(/<text:(h|p)[^>]*>([\s\S]*?)<\/text:\1>/g)]
    .map((m) => ({ type: m[1] === 'h' ? ('heading' as const) : ('paragraph' as const), text: decodeXml(m[2]!.replace(/<[^>]+>/g, '')).trim() }))
    .filter((b) => b.text);
  if (kind === 'slides') return { kind, slides: paras.slice(0, 12).map((b) => ({ title: b.text })) };
  if (kind === 'spreadsheet') return { kind, sheets: [t.sheet1], rows: paras.slice(0, MAX_ROWS).map((b) => [b.text]) };
  return { kind, blocks: paras.slice(0, MAX_BLOCKS), wordCount: paras.reduce((n, b) => n + b.text.split(/\s+/).length, 0) };
}

async function xlsx(bytes: Uint8Array): Promise<Preview> {
  const zip = readZipDirectory(bytes);
  const shared: string[] = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = await readZipText(bytes, ss);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]!, 't'));
  }
  const wb = zip.get('xl/workbook.xml');
  const sheets = wb ? [...(await readZipText(bytes, wb)).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decodeXml(m[1]!)) : [];
  const first = zip.get('xl/worksheets/sheet1.xml');
  const rows: string[][] = [];
  if (first) {
    const xml = await readZipText(bytes, first);
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) break;
      const cells: string[] = [];
      for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const body = c[2] ?? '';
        const col = /r="([A-Z]+)/.exec(attrs)?.[1] ?? '';
        const idx = col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        if (idx >= MAX_COLS) continue;
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        let text = '';
        if (/t="s"/.test(attrs) && v != null) text = shared[Number(v)] ?? '';
        else if (/t="inlineStr"/.test(attrs)) text = textRuns(body, 't');
        else if (v != null) text = decodeXml(v);
        while (cells.length < idx) cells.push('');
        cells[idx] = text;
      }
      rows.push(cells);
    }
  }
  return { kind: 'spreadsheet', sheets: sheets.length ? sheets : [t.sheet1], rows };
}

async function pptx(bytes: Uint8Array): Promise<Preview> {
  const zip = readZipDirectory(bytes);
  const names = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  const slides = [];
  for (const n of names.slice(0, 30)) {
    const xml = await readZipText(bytes, zip.get(n)!);
    const texts = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => textRuns(m[1]!, 'a:t').trim()).filter(Boolean);
    slides.push({ title: texts[0] ?? `Diapositive ${slides.length + 1}`, body: texts.slice(1, 4).join(' · ') || undefined });
  }
  return { kind: 'slides', slides };
}

function plainText(bytes: Uint8Array, markdown: boolean): Preview {
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const blocks = lines.slice(0, MAX_BLOCKS).map((l) =>
    markdown && /^#{1,6}\s/.test(l) ? { type: 'heading' as const, text: l.replace(/^#+\s*/, '') } : { type: 'paragraph' as const, text: l },
  );
  return { kind: 'document', blocks, wordCount: text.split(/\s+/).filter(Boolean).length };
}

function delimited(bytes: Uint8Array, sep: string): Preview {
  const text = new TextDecoder().decode(bytes);
  const rows = text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, MAX_ROWS)
    .map((l) => l.split(sep).slice(0, MAX_COLS).map((c) => c.replace(/^"|"$/g, '')));
  return { kind: 'spreadsheet', sheets: [t.sheet1], rows };
}

function pdf(bytes: Uint8Array): Preview {
  // latin1 keeps byte offsets; enough for dictionary keys.
  const text = new TextDecoder('latin1').decode(bytes);
  const pageCount = Math.max(1, text.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 1);
  const hasFonts = /\/Font\b/.test(text);
  const hasImages = /\/Subtype\s*\/Image/.test(text);
  const title = /\/Title\s*\(([^)]{1,120})\)/.exec(text)?.[1];
  return { kind: 'pdf', pageCount, scanned: !hasFonts && hasImages, title };
}

async function image(bytes: Uint8Array, type: string): Promise<Preview> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const out = { kind: 'image' as const, width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return { kind: 'image', width: 0, height: 0 };
  }
}

export const previewEngine: DocumentEngine = {
  id: 'preview-js',
  kinds: ['document', 'slides', 'spreadsheet', 'pdf', 'image'],
  async import(req: ImportRequest, onProgress): Promise<ImportResult> {
    const kind = detectKind(req, req.bytes.subarray(0, 16));
    const ext = extensionOf(req.name);
    const title = stripExtension(req.name);
    onProgress({ value: 0.1, stage: t.reading });

    let preview: Preview;
    switch (true) {
      case ext === 'docx':
        onProgress({ value: 0.4, stage: t.readingText });
        preview = await docx(req.bytes);
        break;
      case ext === 'xlsx':
        onProgress({ value: 0.4, stage: t.readingCells });
        preview = await xlsx(req.bytes);
        break;
      case ext === 'pptx':
        onProgress({ value: 0.4, stage: t.readingSlides });
        preview = await pptx(req.bytes);
        break;
      case ext === 'odt' || ext === 'ods' || ext === 'odp':
        preview = await odf(req.bytes, kind === 'slides' ? 'slides' : kind === 'spreadsheet' ? 'spreadsheet' : 'document');
        break;
      case ext === 'csv' || ext === 'tsv':
        preview = delimited(req.bytes, ext === 'tsv' ? '\t' : req.bytes.includes(59) && !req.bytes.includes(44) ? ';' : ',');
        break;
      case ext === 'txt' || ext === 'md':
        preview = plainText(req.bytes, ext === 'md');
        break;
      case kind === 'pdf':
        preview = pdf(req.bytes);
        break;
      case kind === 'image':
        preview = await image(req.bytes, req.type);
        break;
      default:
        preview = { kind: 'unsupported' };
    }
    onProgress({ value: 1, stage: t.ready });

    if (preview.kind === 'pdf') {
      return {
        kind: 'pdf',
        title: preview.title || title,
        readOnly: true,
        reason: preview.scanned ? t.scanned : t.pdf,
        preview,
        engine: this.id,
      };
    }
    if (preview.kind === 'unsupported' || kind === 'unsupported') {
      return { kind: 'unsupported', title, readOnly: true, reason: t.unsupported, preview, engine: this.id };
    }
    // Legacy binary formats are recognised but need the WASM engines to edit.
    const legacy = ext === 'doc' || ext === 'xls' || ext === 'ppt' || ext === 'key' || ext === 'rtf';
    return {
      kind,
      title,
      readOnly: legacy,
      reason: legacy ? t.legacy : undefined,
      preview: legacy ? emptyPreview(kind) : preview,
      engine: this.id,
    };
  },
};

function emptyPreview(kind: string): Preview {
  if (kind === 'slides') return { kind: 'slides', slides: [] };
  if (kind === 'spreadsheet') return { kind: 'spreadsheet', sheets: [], rows: [] };
  return { kind: 'document', blocks: [] };
}
