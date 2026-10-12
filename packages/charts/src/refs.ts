/**
 * Chart references (`'Budget'!$B$2:$B$8`, `Feuil1!A1`, unions `(A1:A3,C1:C3)`)
 * and a resolver built on any cell reader, so hosts only say how to read one cell.
 */
import { formatValue } from './format';
import type { RefValues, Resolver } from './types';

export interface RefArea {
  sheet: string | null;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

function col(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One area: `Sheet!$A$1:$B$4` (sheet optional, `$` optional). */
function area(text: string): RefArea | null {
  const m = /^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const sheet = m[1] != null ? m[1].replace(/''/g, "'") : (m[2] ?? null);
  const c0 = col(m[3]!);
  const r0 = Number(m[4]) - 1;
  const c1 = m[5] ? col(m[5]) : c0;
  const r1 = m[6] ? Number(m[6]) - 1 : r0;
  return { sheet, r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

/** Parse a chart reference into its areas (`null` when it is a name or something else). */
export function parseRef(ref: string): RefArea[] | null {
  let s = ref.trim().replace(/^=/, '');
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  const parts: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of s) {
    if (ch === "'") q = !q;
    if (ch === ',' && !q) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const out: RefArea[] = [];
  let lastSheet: string | null = null;
  for (const p of parts) {
    const a = area(p);
    if (!a) return null;
    if (a.sheet == null) a.sheet = lastSheet;
    lastSheet = a.sheet;
    out.push(a);
  }
  return out;
}

export interface CellReader {
  /** Number in a cell, or null (empty, text, error). */
  num(sheet: string | null, r: number, c: number): number | null;
  /** Text shown in a cell. */
  text(sheet: string | null, r: number, c: number): string | null;
  /** Number format of a cell. */
  format?(sheet: string | null, r: number, c: number): string | undefined;
  /** Hidden rows/columns are skipped when the chart plots visible cells only. */
  hidden?(sheet: string | null, r: number, c: number): boolean;
}

/** A resolver reading cells row by row (a row or a column of cells per area, like Excel). */
export function cellResolver(reader: CellReader, opts: { visibleOnly?: boolean } = {}): Resolver {
  return (ref) => {
    const areas = parseRef(ref);
    if (!areas) return null;
    const out: RefValues = { num: [], text: [] };
    for (const a of areas) {
      for (let r = a.r0; r <= a.r1; r++) {
        for (let c = a.c0; c <= a.c1; c++) {
          if (opts.visibleOnly && reader.hidden?.(a.sheet, r, c)) continue;
          const n = reader.num(a.sheet, r, c);
          const t = reader.text(a.sheet, r, c);
          out.num.push(n);
          out.text.push(t ?? (n != null ? formatValue(n, reader.format?.(a.sheet, r, c)) : null));
          if (out.format == null) out.format = reader.format?.(a.sheet, r, c);
        }
      }
    }
    return out;
  };
}
