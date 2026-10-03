/** A1 addresses and rectangular ranges (0-based, inclusive). */

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export interface Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 0 → `A`, 26 → `AA`. */
export function colName(c: number): string {
  let s = '';
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** `AA` → 26; `null` when not a column (or past `XFD`). */
export function colIndex(s: string): number | null {
  if (!s || s.length > 3) return null;
  let n = 0;
  for (const ch of s.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    n = n * 26 + (code - 64);
  }
  return n >= 1 && n <= MAX_COLS ? n - 1 : null;
}

export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;

/** `$B$3` → `{ r: 2, c: 1 }`. */
export function parseA1(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
  if (!m) return null;
  const c = colIndex(m[1]!);
  const r = Number(m[2]) - 1;
  return c == null || r < 0 || r >= MAX_ROWS ? null : { r, c };
}

/** `A1:C3`, `B2` (1×1), `A:C` (whole columns), `2:4` (whole rows). */
export function parseRange(s: string): Range | null {
  const [a, b = a] = s.trim().split(':') as [string, string?];
  const p = parseA1(a);
  const q = parseA1(b!);
  if (p && q) return normalize({ r0: p.r, c0: p.c, r1: q.r, c1: q.c });
  const ca = colIndex(a.replace(/\$/g, ''));
  const cb = colIndex(b!.replace(/\$/g, ''));
  if (ca != null && cb != null) return normalize({ r0: 0, c0: ca, r1: MAX_ROWS - 1, c1: cb });
  if (/^\$?\d+$/.test(a) && /^\$?\d+$/.test(b!)) {
    const ra = Number(a.replace('$', '')) - 1;
    const rb = Number(b!.replace('$', '')) - 1;
    if (ra >= 0 && rb >= 0) return normalize({ r0: ra, c0: 0, r1: rb, c1: MAX_COLS - 1 });
  }
  return null;
}

export const parseSqref = (s: string): Range[] => s.split(/\s+/).filter(Boolean).map(parseRange).filter((r): r is Range => !!r);

export function normalize(r: Range): Range {
  return { r0: Math.min(r.r0, r.r1), c0: Math.min(r.c0, r.c1), r1: Math.max(r.r0, r.r1), c1: Math.max(r.c0, r.c1) };
}

export function rangeA1(r: Range): string {
  if (r.c0 === 0 && r.c1 === MAX_COLS - 1) return `${r.r0 + 1}:${r.r1 + 1}`;
  if (r.r0 === 0 && r.r1 === MAX_ROWS - 1) return `${colName(r.c0)}:${colName(r.c1)}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? a1(r.r0, r.c0) : `${a1(r.r0, r.c0)}:${a1(r.r1, r.c1)}`;
}

export const inRange = (r: Range, row: number, col: number) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;

export const intersects = (a: Range, b: Range) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

export const cellCount = (r: Range) => (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);

/** Sheet names that need quotes in formulas (`'Mon budget'!A1`). */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) && !parseA1(name) && !/^R\d*C\d*$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}
