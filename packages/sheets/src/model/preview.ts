import type { SheetDoc } from './ydoc';

/** Desk thumbnail rows: what the grid shows in the first rows and columns. */
export function toPreview(doc: SheetDoc, text: (sheetIndex: number, r: number, c: number) => string | undefined, maxRows = 40, maxCols = 12): { kind: 'spreadsheet'; sheets: string[]; rows: string[][] } {
  const ids = doc.sheetIds();
  const visible = ids.filter((id) => doc.props(id).state === 'visible');
  const first = visible[0] ?? ids[0];
  const sheets = visible.map((id) => doc.props(id).name);
  if (!first) return { kind: 'spreadsheet', sheets, rows: [] };
  const si = ids.indexOf(first);
  const used = doc.usedRange(first);
  if (!used) return { kind: 'spreadsheet', sheets, rows: [] };
  const rows: string[][] = [];
  for (let r = 0; r <= Math.min(used.r1, maxRows - 1); r++) {
    const row: string[] = [];
    for (let c = 0; c <= Math.min(used.c1, maxCols - 1); c++) row.push(text(si, r, c) ?? '');
    rows.push(row);
  }
  return { kind: 'spreadsheet', sheets, rows };
}
