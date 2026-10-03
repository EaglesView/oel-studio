/** Bureau ↔ @oel/sheets: one collaborative workbook session per spreadsheet paper. */
import CalcWorker from '@oel/sheets/calc-worker?worker';
import { DEFAULT_STYLE, SheetSession, parseInput, type Cell, type ExportRequest, type Workbook } from '@oel/sheets';
import type { WorkbookPayload } from '@oel/engine';
import { collabApi, identity } from './docs';
import { engineHost } from './importFiles';
import type { Bureau, Paper } from './model';

export const createCalcWorker = () => new CalcWorker();

const sessions = new Map<string, Promise<SheetSession>>();

/** A workbook from the desk preview rows (papers seeded on the desk, sheets made by forms). */
export function workbookFromRows(rows: string[][], tab = 'Feuille 1'): Workbook {
  const cells: Cell[] = [];
  rows.forEach((row, r) =>
    row.forEach((text, c) => {
      if (!text) return;
      const p = parseInput(text);
      if (p.f != null) cells.push({ r, c, f: p.f });
      else if (p.t) cells.push({ r, c, t: p.t, v: p.v });
    }),
  );
  return { sheets: [{ id: 'xl/worksheets/sheet1.xml', name: tab.slice(0, 31) || 'Feuille 1', cells }], styles: [DEFAULT_STYLE], baseStyles: 1, source: 'new' };
}

/** Create the shared workbook for an imported .xlsx/.csv; returns its id. */
export async function createSheetFromPayload(payload: unknown, title: string): Promise<string> {
  const p = payload as WorkbookPayload;
  const s = await SheetSession.create({ api: collabApi, identity: identity(), seed: { workbook: JSON.parse(p.json) as Workbook, original: p.original, title } });
  sessions.set(s.status.docId, Promise.resolve(s));
  return s.status.docId;
}

/** Session for a paper; papers without a workbook get one seeded from their preview. */
export function sheetSessionFor(paper: Paper, onCreated: (docId: string) => void): Promise<SheetSession> {
  const known = paper.data.docId && sessions.get(paper.data.docId);
  if (known) return known;
  const p = (async () => {
    if (paper.data.docId) return SheetSession.open({ docId: paper.data.docId, api: collabApi, identity: identity() });
    const pv = paper.data.preview.kind === 'spreadsheet' ? paper.data.preview : { sheets: ['Feuille 1'], rows: [] as string[][] };
    const s = await SheetSession.create({ api: collabApi, identity: identity(), seed: { workbook: workbookFromRows(pv.rows, pv.sheets[0]), title: paper.title } });
    onCreated(s.status.docId);
    return s;
  })();
  p.then((s) => sessions.set(s.status.docId, p));
  return p;
}

export async function exportSheet(req: ExportRequest): Promise<Uint8Array> {
  return engineHost().export({ kind: 'spreadsheet', format: req.format, data: { json: req.json, original: req.original, sheet: req.sheet } });
}

// ---------------------------------------------------------------------------
// Forms (E5): the linked spreadsheet is the form's database
// ---------------------------------------------------------------------------

/** What is typed in the first sheet, as rows of text (used range). */
export function sheetRows(s: SheetSession): string[][] {
  const d = s.sheet;
  const first = d.sheetIds()[0];
  if (!first) return [];
  const used = d.usedRange(first);
  if (!used) return [];
  return Array.from({ length: used.r1 + 1 }, (_, r) => Array.from({ length: used.c1 + 1 }, (_, c) => d.inputText(first, r, c)));
}

/**
 * Write rows into the first sheet, touching only the cells that change
 * (numbers and dates are read as typed, so amounts stay numbers). Rows past
 * the new end are cleared in the columns the rows cover.
 */
export function writeSheetRows(s: SheetSession, rows: string[][]) {
  const d = s.sheet;
  const first = d.sheetIds()[0];
  if (!first) return;
  const before = sheetRows(s);
  const width = Math.max(0, ...rows.map((r) => r.length), ...before.map((r) => r.length));
  const height = Math.max(rows.length, before.length);
  d.doc.transact(() => {
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const next = rows[r]?.[c] ?? '';
        if ((before[r]?.[c] ?? '') !== next) d.setInput(first, r, c, next);
      }
  });
}

/** Rows of a spreadsheet paper: from its workbook when it has one, else its preview. */
export async function paperRows(paper: Paper): Promise<string[][]> {
  if (paper.data.docId) return sheetRows(await sheetSessionFor(paper, () => {}));
  return paper.data.preview.kind === 'spreadsheet' ? paper.data.preview.rows : [];
}

/** Replace a spreadsheet paper's rows (workbook and desk thumbnail). */
export async function setPaperRows(store: Bureau, paper: Paper, rows: string[][], flash?: { label: string; at: number }) {
  const pv = paper.data.preview.kind === 'spreadsheet' ? paper.data.preview : { kind: 'spreadsheet' as const, sheets: ['Feuille 1'], rows: [] };
  if (paper.data.docId) writeSheetRows(await sheetSessionFor(paper, () => {}), rows);
  const current = store.node(paper.id) as Paper | undefined;
  if (!current) return;
  store.update(paper.id, { data: { ...current.data, preview: { ...pv, rows: rows.slice(0, 40).map((r) => r.slice(0, 12)) }, ...(flash ? { flash } : {}) } }, { history: false });
}
