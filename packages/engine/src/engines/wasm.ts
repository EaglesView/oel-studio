import type { DeckPayload, DocumentEngine, DocxPayload, ExportRequest, FileKind, ImportResult, Preview, WorkbookPayload } from '../types';
import type { Workbook } from '../generated/oelxlsx';
import type { Deck } from '../generated/oelpptx';
import { PAYLOAD_FORMATS } from '../payload';

/**
 * Adapter for WASM engines built with wasm-bindgen (oeldocx-rs, oelimg-rs).
 *
 * The module is loaded lazily inside the worker the first time a matching
 * file arrives, so the editor shell never pays for engines it does not use.
 */
export interface WasmEngineSpec<M> {
  id: string;
  kinds: FileKind[];
  /** Dynamic import of the wasm-bindgen package (its default export is `init`). */
  load: () => Promise<M & { default?: (input?: unknown) => Promise<unknown> }>;
  run: (mod: M, bytes: Uint8Array, name: string) => Promise<Omit<ImportResult, 'engine'>> | Omit<ImportResult, 'engine'>;
  export?: (mod: M, req: ExportRequest) => Promise<Uint8Array> | Uint8Array;
  create?: (mod: M, kind: FileKind, title: string) => Promise<Omit<ImportResult, 'engine'>> | Omit<ImportResult, 'engine'>;
  accepts?: (name: string) => boolean;
}

export function createWasmEngine<M>(spec: WasmEngineSpec<M>): DocumentEngine {
  let ready: Promise<M> | null = null;
  const module = () =>
    (ready ??= spec.load().then(async (mod) => {
      if (typeof mod.default === 'function') await mod.default();
      return mod;
    }));
  return {
    id: spec.id,
    kinds: spec.kinds,
    accepts: spec.accepts,
    async import(req, onProgress) {
      onProgress({ value: null, stage: 'Chargement du moteur' });
      const mod = await module();
      onProgress({ value: 0.5, stage: 'Conversion en document modifiable' });
      const result = await spec.run(mod, req.bytes, req.name);
      onProgress({ value: 1, stage: 'Prêt' });
      return { ...result, engine: spec.id };
    },
    export: spec.export ? async (req) => spec.export!(await module(), req) : undefined,
    create: spec.create ? async (kind, title) => ({ ...(await spec.create!(await module(), kind, title)), engine: spec.id }) : undefined,
  };
}

/** The parts of the oeldocx-rs wasm package this adapter uses. */
export interface OeldocxModule {
  docx_to_pm(bytes: Uint8Array): { json: string; media: Array<{ path: string; mime: string; bytes: Uint8Array }> };
  new_document_pm(): { json: string; media: Array<{ path: string; mime: string; bytes: Uint8Array }> };
  pm_to_docx(json: string, original: Uint8Array | null | undefined, media: Array<{ path: string; bytes: Uint8Array }>): Uint8Array;
}

interface PMish {
  type?: string;
  text?: string;
  attrs?: { outline?: number | null; section?: string | null; behindDoc?: boolean; cx?: number; cy?: number; shape?: { fill?: string | null } };
  content?: PMish[];
}

const text = (n: PMish): string => (n.text ?? '') + (n.content ?? []).map(text).join(n.type === 'tableRow' ? ' ' : '');

/** Desk preview from the codec's ProseMirror JSON (first blocks as text). */
function previewOf(doc: PMish, page?: { width: number; height: number }, pageColour?: string | null): Preview {
  const blocks: Array<{ type: 'heading' | 'paragraph'; text: string }> = [];
  let words = 0;
  const visit = (n: PMish) => {
    if (n.type === 'paragraph') {
      const t = text(n).replace(/\s+/g, ' ').trim();
      words += t.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (blocks.length < 40) blocks.push({ type: n.attrs?.outline != null ? 'heading' : 'paragraph', text: t });
      return;
    }
    (n.content ?? []).forEach(visit);
  };
  visit(doc);
  const background = coverColour(doc, page) ?? pageColour ?? undefined;
  return { kind: 'document', blocks, wordCount: words, pageCount: Math.max(1, Math.ceil(words / 450)), ...(page ? { page: { width: page.width, height: page.height } } : {}), ...(background ? { background } : {}) };
}

/** A solid behind-text shape of the first section covering half page 1 or more (same rule as @oel/docs `firstPageBackground`). */
function coverColour(doc: PMish, page?: { width: number; height: number }): string | undefined {
  if (!page) return undefined;
  const area = page.width * page.height * 635 * 635;
  let found: string | undefined;
  const visit = (n: PMish): boolean => {
    if (found) return false;
    const a = n.attrs;
    if (n.type === 'anchor' && a?.behindDoc && a.shape?.fill && !a.shape.fill.includes('gradient') && (a.cx ?? 0) * (a.cy ?? 0) >= area / 2) found = a.shape.fill;
    (n.content ?? []).forEach(visit);
    return !(n.type === 'paragraph' && a?.section);
  };
  for (const n of doc.content ?? []) if (!visit(n)) break;
  return found;
}

/**
 * oeldocx-rs: lossless DOCX ↔ editor JSON. Imports carry a `DocxPayload`
 * (editor JSON + images + the original file) for `@oel/docs`; exports write
 * the edited JSON back into a copy of the original package.
 */
export function createOeldocxEngine(load: () => Promise<unknown>): DocumentEngine {
  return createWasmEngine<OeldocxModule>({
    id: 'oeldocx-rs',
    kinds: ['document'],
    load: load as WasmEngineSpec<OeldocxModule>['load'],
    run(mod, bytes, name) {
      if (!/\.(docx|docm|dotx)$/i.test(name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        throw new Error('Format non pris en charge par le moteur DOCX');
      }
      const out = mod.docx_to_pm(bytes);
      const json = JSON.parse(out.json) as { doc: PMish; title?: string | null; background?: string | null; sections?: Array<{ page: { width: number; height: number } }> };
      const payload: DocxPayload = { format: PAYLOAD_FORMATS.docx, json: out.json, media: out.media, original: bytes };
      return { kind: 'document', title: json.title?.trim() || name.replace(/\.[^.]+$/, ''), readOnly: false, preview: previewOf(json.doc, json.sections?.[0]?.page, json.background), payload };
    },
    export(mod, req) {
      if (req.format !== 'docx') throw new Error(`Format d’export inconnu : ${req.format}`);
      const d = req.data as { json: unknown; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> };
      return mod.pm_to_docx(JSON.stringify(d.json), d.original ?? undefined, d.media ?? []);
    },
    create(mod, _kind, title) {
      const out = mod.new_document_pm();
      const payload: DocxPayload = { format: PAYLOAD_FORMATS.docx, json: out.json, media: out.media, original: null };
      return { kind: 'document', title: title || 'Document sans titre', readOnly: false, preview: { kind: 'document', blocks: [], wordCount: 0, pageCount: 1 }, payload };
    },
  });
}

/** The parts of the oelxlsx-rs wasm package this adapter uses (signatures from its wasm-bindgen `.d.ts`). */
export type OelxlsxModule = Pick<typeof import('oelxlsx-rs'), 'xlsx_to_model' | 'csv_to_model' | 'new_workbook_model' | 'model_to_xlsx' | 'model_to_csv'>;

/** Desk preview: the first rows of the first visible sheet (cached values, formulas shown as their result). */
function sheetPreview(wb: Workbook): Preview {
  const visible = wb.sheets.filter((s) => !s.state || s.state === 'visible');
  const first = visible[0] ?? wb.sheets[0];
  const rows: string[][] = [];
  for (const c of first?.cells ?? []) {
    if (c.r >= 40 || c.c >= 12 || c.v == null) continue;
    while (rows.length <= c.r) rows.push([]);
    const row = rows[c.r]!;
    while (row.length <= c.c) row.push('');
    row[c.c] = c.t === 'b' ? (c.v ? 'TRUE' : 'FALSE') : String(c.v);
  }
  return { kind: 'spreadsheet', sheets: visible.map((s) => s.name), rows };
}

/**
 * oelxlsx-rs: lossless .xlsx ↔ workbook JSON (IronCalc computes formulas in
 * the editor's calc worker; here we only read and write files). CSV/TSV keep
 * their dialect (delimiter, encoding, BOM, line endings, decimal comma).
 */
export function createOelxlsxEngine(load: () => Promise<unknown>): DocumentEngine {
  return createWasmEngine<OelxlsxModule>({
    id: 'oelxlsx-rs',
    kinds: ['spreadsheet'],
    // .ods and .xls stay previews (read-only) for now.
    accepts: (name) => /\.(xlsx|xlsm|csv|tsv)$/i.test(name),
    load: load as WasmEngineSpec<OelxlsxModule>['load'],
    run(mod, bytes, name) {
      const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
      const title = name.replace(/\.[^.]+$/, '');
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const json = mod.csv_to_model(bytes, JSON.stringify({ ...(ext === 'tsv' ? { delimiter: '\t' } : {}), sheetName: title.slice(0, 31) }));
        const payload: WorkbookPayload = { format: PAYLOAD_FORMATS.workbook, json, original: null };
        return { kind: 'spreadsheet', title, readOnly: false, preview: sheetPreview(JSON.parse(json)), payload };
      }
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('Format non pris en charge par le moteur de tableurs (.xlsx, .xlsm, .csv)');
      const json = mod.xlsx_to_model(bytes);
      const payload: WorkbookPayload = { format: PAYLOAD_FORMATS.workbook, json, original: bytes };
      return { kind: 'spreadsheet', title, readOnly: false, preview: sheetPreview(JSON.parse(json)), payload };
    },
    export(mod, req) {
      const d = req.data as { json: unknown; original?: Uint8Array | null; media?: Array<{ path: string; bytes: Uint8Array }>; sheet?: number };
      const json = typeof d.json === 'string' ? d.json : JSON.stringify(d.json);
      if (req.format === 'xlsx') return mod.model_to_xlsx(json, d.original ?? undefined, d.media ?? []);
      if (req.format === 'csv') return mod.model_to_csv(json, d.sheet ?? 0, '');
      if (req.format === 'tsv') return mod.model_to_csv(json, d.sheet ?? 0, JSON.stringify({ delimiter: '\t', encoding: 'utf-8', bom: false, lineEnding: '\r\n' }));
      throw new Error(`Format d’export inconnu : ${req.format}`);
    },
    create(mod, _kind, title) {
      const json = mod.new_workbook_model();
      const payload: WorkbookPayload = { format: PAYLOAD_FORMATS.workbook, json, original: null };
      return { kind: 'spreadsheet', title: title || 'Tableur sans titre', readOnly: false, preview: { kind: 'spreadsheet', sheets: ['Feuille 1'], rows: [] }, payload };
    },
  });
}

/** The parts of the oelpptx-rs wasm package this adapter uses (signatures from its wasm-bindgen `.d.ts`). */
export type OelpptxModule = Pick<typeof import('oelpptx-rs'), 'pptx_to_deck' | 'new_deck' | 'deck_to_pptx'>;

type DeckOut = { json: string; media: Array<{ path: string; mime: string; bytes: Uint8Array }> };

const runsText = (paras: Deck['slides'][number]['elements'][number]['text'] | undefined) =>
  (paras?.paras ?? []).map((p) => p.runs.map((r) => (r.kind === 'br' ? ' ' : r.text)).join('').trim()).filter(Boolean);

/** Desk preview of a deck: titles and first lines, the slide shape, the first slide's colours. */
export function deckPreview(deck: Deck): Preview {
  const slides = deck.slides.slice(0, 40).map((s, i) => {
    const title = s.elements.find((e) => e.ph && /title/i.test(e.ph.type));
    const others = s.elements.filter((e) => e !== title && e.text).flatMap((e) => runsText(e.text));
    return { title: runsText(title?.text)[0] ?? others[0] ?? `Diapositive ${i + 1}`, body: others.slice(title ? 0 : 1, 3).join(' · ') || undefined };
  });
  const first = deck.slides[0];
  const layout = first && deck.layouts.find((l) => l.id === first.layout);
  const bg = first?.background ?? layout?.background;
  const background = bg?.type === 'solid' ? bg.color : bg?.type === 'gradient' ? bg.stops[0]?.color : undefined;
  const titleEl = first?.elements.find((e) => e.ph && /title/i.test(e.ph.type));
  const ink = titleEl?.text?.levels[0]?.color;
  return { kind: 'slides', slides, size: { width: deck.width, height: deck.height }, ...(background ? { background } : {}), ...(ink ? { ink } : {}) };
}

/**
 * oelpptx-rs: lossless .pptx ↔ deck JSON. Imports carry a `DeckPayload` (deck
 * JSON + media + the original file) for `@oel/slides`; exports patch the
 * edited JSON back into a copy of the original package.
 */
export function createOelpptxEngine(load: () => Promise<unknown>): DocumentEngine {
  return createWasmEngine<OelpptxModule>({
    id: 'oelpptx-rs',
    kinds: ['slides'],
    // .ppt, .odp and .key stay previews (read-only).
    accepts: (name) => /\.(pptx|pptm|ppsx|potx)$/i.test(name),
    load: load as WasmEngineSpec<OelpptxModule>['load'],
    run(mod, bytes, name) {
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('Format non pris en charge par le moteur de présentations (.pptx)');
      const out = mod.pptx_to_deck(bytes) as DeckOut;
      const deck = JSON.parse(out.json) as Deck;
      const payload: DeckPayload = { format: PAYLOAD_FORMATS.deck, json: out.json, media: out.media, original: bytes };
      return { kind: 'slides', title: deck.title?.trim() || name.replace(/\.[^.]+$/, ''), readOnly: false, preview: deckPreview(deck), payload };
    },
    export(mod, req) {
      if (req.format !== 'pptx') throw new Error(`Format d’export inconnu : ${req.format}`);
      const d = req.data as { json: unknown; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> };
      return mod.deck_to_pptx(typeof d.json === 'string' ? d.json : JSON.stringify(d.json), d.original ?? undefined, d.media ?? []);
    },
    create(mod, _kind, title) {
      const out = mod.new_deck() as DeckOut;
      const deck = JSON.parse(out.json) as Deck;
      const payload: DeckPayload = { format: PAYLOAD_FORMATS.deck, json: out.json, media: out.media, original: null };
      return { kind: 'slides', title: title || 'Présentation sans titre', readOnly: false, preview: deckPreview(deck), payload };
    },
  });
}
