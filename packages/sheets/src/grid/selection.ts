import { MAX_COLS, MAX_ROWS, normalize, type Range } from '../model/a1';

export interface Pos {
  r: number;
  c: number;
}

/** Excel-style selection: several ranges, the last one current; the active cell sits inside it. */
export interface Selection {
  ranges: Range[];
  active: Pos;
  /** The corner the current range was started from (Shift+arrows move the other one). */
  anchor: Pos;
}

export const single = (p: Pos): Selection => ({ ranges: [{ r0: p.r, c0: p.c, r1: p.r, c1: p.c }], active: p, anchor: p });

export const current = (s: Selection): Range => s.ranges[s.ranges.length - 1]!;

export const clampPos = (p: Pos): Pos => ({ r: Math.max(0, Math.min(MAX_ROWS - 1, p.r)), c: Math.max(0, Math.min(MAX_COLS - 1, p.c)) });

/** Extend the current range from the anchor to `to` (Shift+arrows, Shift+click, drag). */
export function extendTo(s: Selection, to: Pos): Selection {
  const t = clampPos(to);
  const range = normalize({ r0: s.anchor.r, c0: s.anchor.c, r1: t.r, c1: t.c });
  return { ...s, ranges: [...s.ranges.slice(0, -1), range] };
}

/** The moving corner of the current range (opposite the anchor). */
export function movingCorner(s: Selection): Pos {
  const r = current(s);
  return { r: s.anchor.r === r.r0 ? r.r1 : r.r0, c: s.anchor.c === r.c0 ? r.c1 : r.c0 };
}

export const isWholeRows = (r: Range) => r.c0 === 0 && r.c1 >= MAX_COLS - 1;
export const isWholeCols = (r: Range) => r.r0 === 0 && r.r1 >= MAX_ROWS - 1;

/**
 * Enter / Tab inside a multi-cell selection walk through it without losing it
 * (Excel): Enter goes down then to the next column, Tab right then next row.
 */
export function cycleInside(s: Selection, dir: 'down' | 'up' | 'right' | 'left'): Selection | null {
  const r = current(s);
  if (r.r0 === r.r1 && r.c0 === r.c1 && s.ranges.length === 1) return null;
  let { r: row, c: col } = s.active;
  const vertical = dir === 'down' || dir === 'up';
  const fwd = dir === 'down' || dir === 'right';
  if (vertical) {
    row += fwd ? 1 : -1;
    if (row > r.r1) {
      row = r.r0;
      col = col + 1 > r.c1 ? r.c0 : col + 1;
    } else if (row < r.r0) {
      row = r.r1;
      col = col - 1 < r.c0 ? r.c1 : col - 1;
    }
  } else {
    col += fwd ? 1 : -1;
    if (col > r.c1) {
      col = r.c0;
      row = row + 1 > r.r1 ? r.r0 : row + 1;
    } else if (col < r.c0) {
      col = r.c1;
      row = row - 1 < r.r0 ? r.r1 : row - 1;
    }
  }
  return { ...s, active: { r: row, c: col } };
}

/**
 * Ctrl+arrow: jump to the edge of the data block, or to the next non-empty
 * cell across a gap, or to the sheet edge (Excel's End mode).
 */
export function jump(from: Pos, dr: number, dc: number, filled: (r: number, c: number) => boolean, limit: Pos): Pos {
  const inside = (p: Pos) => p.r >= 0 && p.c >= 0 && p.r <= limit.r && p.c <= limit.c;
  const next = (p: Pos) => ({ r: p.r + dr, c: p.c + dc });
  let p = from;
  const n = next(p);
  if (!inside(n)) return p;
  if (filled(p.r, p.c) && filled(n.r, n.c)) {
    // Run to the last filled cell of this block.
    while (inside(next(p)) && filled(next(p).r, next(p).c)) p = next(p);
    return p;
  }
  // Skip blanks to the next filled cell, or stop at the edge.
  p = n;
  while (!filled(p.r, p.c) && inside(next(p))) p = next(p);
  return p;
}
