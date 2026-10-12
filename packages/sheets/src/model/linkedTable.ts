/**
 * A sheet range as a linked table (`@oel/links`, plan I-4, Figma I2): the
 * values as the sheet displays them, their formats, merges, column widths.
 * Hidden rows and columns (hidden by hand or by a filter) are left out, like
 * an Excel copy-paste, unless `includeHidden`.
 */
import type { LinkedCell, LinkedTable } from '@oel/links';
import type { Range } from './a1';
import type { SheetDoc } from './ydoc';

/** What the calc engine shows in a cell. */
export type CellShown = { text: string; num?: number } | undefined;

/** Excel's default column width (8.43 characters) in points, and points per character. */
const PT_PER_CHAR = 5.25;
const DEFAULT_CHARS = 8.43;

export function rangeAsTable(doc: SheetDoc, sheet: string, range: Range, shown: (r: number, c: number) => CellShown, includeHidden = false): LinkedTable {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = range.r0; r <= range.r1; r++) if (includeHidden || !doc.rowSize(sheet, r)?.hidden) rows.push(r);
  for (let c = range.c0; c <= range.c1; c++) if (includeHidden || !doc.colSize(sheet, c)?.hidden) cols.push(c);
  const rowAt = new Map(rows.map((r, i) => [r, i]));
  const colAt = new Map(cols.map((c, i) => [c, i]));

  const out: LinkedCell[][] = rows.map((r) =>
    cols.map((c) => {
      const v = shown(r, c);
      const cell = doc.getCell(sheet, r, c);
      const st = doc.style(cell?.s ?? doc.rowSize(sheet, r)?.style ?? doc.colSize(sheet, c)?.style ?? 0);
      const h = st.align?.h;
      const lc: LinkedCell = { text: v?.text ?? '' };
      if (v?.num != null) lc.num = v.num;
      if (st.font?.bold) lc.bold = true;
      if (st.font?.italic) lc.italic = true;
      if (st.font?.color?.css && st.font.color.css.toUpperCase() !== '#000000') lc.color = st.font.color.css;
      if (st.fill?.css) lc.fill = st.fill.css;
      // Like the grid: numbers to the right unless the cell says otherwise.
      const align = h === 'center' || h === 'centerContinuous' ? 'center' : h === 'right' ? 'right' : h === 'left' ? 'left' : v?.num != null ? 'right' : undefined;
      if (align) lc.align = align;
      return lc;
    }),
  );

  // Merges that start inside the range: the anchor spans what is visible, the rest is covered.
  for (const m of doc.merges(sheet)) {
    if (m.r0 < range.r0 || m.c0 < range.c0 || m.r0 > range.r1 || m.c0 > range.c1) continue;
    const ri = rowAt.get(m.r0);
    const ci = colAt.get(m.c0);
    if (ri == null || ci == null) continue;
    const spanR = rows.filter((r) => r >= m.r0 && r <= Math.min(m.r1, range.r1)).length;
    const spanC = cols.filter((c) => c >= m.c0 && c <= Math.min(m.c1, range.c1)).length;
    if (spanR > 1) out[ri]![ci]!.rowSpan = spanR;
    if (spanC > 1) out[ri]![ci]!.colSpan = spanC;
    for (let i = 0; i < spanR; i++) for (let j = 0; j < spanC; j++) if (i || j) out[ri + i]![ci + j]!.merged = true;
  }

  const base = doc.style(0).font;
  return {
    rows: out,
    widths: cols.map((c) => Math.round((doc.colSize(sheet, c)?.size ?? DEFAULT_CHARS) * PT_PER_CHAR * 10) / 10),
    // A first row in bold reads as a header (repeated on each page in documents).
    header: out[0]?.length && out[0].every((c) => c.bold || !c.text) && out[0].some((c) => c.text) ? 1 : 0,
    ...(base?.name ? { font: { family: base.name, size: base.size ?? 11 } } : {}),
    rowIds: rows.map((r) => String(doc.rowKey(sheet, r))),
    colIds: cols.map((c) => String(doc.colKey(sheet, c))),
  };
}

/**
 * Text typed the fr-CA way, as the sheet's input and number format (plan I-5,
 * Figma I3: « 1 240 000 $ » becomes 1240000 in a currency format). Text that
 * isn't a number comes back as it was.
 */
export function frInput(text: string): { input: string; fmt?: string } {
  const s = text.replace(/[  ]/g, ' ').trim();
  const num = (body: string) => {
    if (!/^[+-]?\d{1,3}( \d{3})*(,\d+)?$|^[+-]?\d+(,\d+)?$/.test(body)) return null;
    // A leading zero stays text (codes, postal boxes), as in parseInput.
    if (/^[+-]?0\d/.test(body)) return null;
    const v = Number(body.replace(/ /g, '').replace(',', '.'));
    return Number.isFinite(v) ? { v, decimals: body.split(',')[1]?.length ?? 0 } : null;
  };
  let m = /^(.+?)\s?\$$/.exec(s);
  if (m) {
    const n = num(m[1]!.trim());
    if (n) return { input: String(n.v), fmt: n.decimals ? '#,##0.00 $' : '#,##0 $' };
  }
  m = /^(.+?)\s?%$/.exec(s);
  if (m) {
    const n = num(m[1]!.trim());
    if (n) return { input: String(n.v / 100), fmt: n.decimals ? `0.${'0'.repeat(n.decimals)}%` : '0%' };
  }
  const n = num(s);
  if (n && (s.includes(' ') || s.includes(','))) return { input: String(n.v), fmt: n.decimals ? `#,##0.${'0'.repeat(n.decimals)}` : '#,##0' };
  return { input: text };
}

/**
 * Write a table's cells into a sheet from `at` (Figma I3): values (fr-CA
 * numbers recognised), bold, italic, colours, fills and merges. Returns the
 * range written.
 */
export function writeTable(doc: SheetDoc, sheet: string, at: { r: number; c: number }, table: LinkedTable): Range {
  const width = Math.max(1, ...table.rows.map((row) => row.length));
  const range = { r0: at.r, c0: at.c, r1: at.r + table.rows.length - 1, c1: at.c + width - 1 };
  const merges: Range[] = [];
  table.rows.forEach((row, i) =>
    row.forEach((cell, j) => {
      if (cell.merged) return;
      const r = at.r + i;
      const c = at.c + j;
      const { input, fmt } = frInput(cell.text);
      doc.setInput(sheet, r, c, input);
      if (fmt || cell.bold || cell.italic || cell.color || cell.fill)
        doc.formatRange(sheet, { r0: r, c0: c, r1: r, c1: c }, (st) => ({
          ...st,
          ...(fmt ? { numFmt: fmt } : {}),
          ...(cell.fill ? { fill: { css: cell.fill } } : {}),
          font: { ...st.font, ...(cell.bold ? { bold: true } : {}), ...(cell.italic ? { italic: true } : {}), ...(cell.color ? { color: { css: cell.color } } : {}) },
        }));
      if ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1) merges.push({ r0: r, c0: c, r1: r + (cell.rowSpan ?? 1) - 1, c1: c + (cell.colSpan ?? 1) - 1 });
    }),
  );
  if (merges.length) doc.setMerges(sheet, [...doc.merges(sheet), ...merges]);
  return range;
}
