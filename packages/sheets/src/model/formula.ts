/**
 * English Excel formulas: a scanner for references and function names (the
 * same rules as oelxlsx-rs `refs.rs`), A1 shifting for fill and paste, and the
 * id-reference form formulas are stored in inside the Y.Doc.
 *
 * Id-reference form: `{ f, x }` where `f` is the formula text with each
 * reference replaced by `<i>`, and `x[i]` names the reference by
 * sheet id and row/column ids. Inserting or deleting rows only changes the
 * row order, so formulas need no rewriting and concurrent edits merge.
 */
import { MAX_COLS, MAX_ROWS, colIndex, colName, quoteSheet } from './a1';

export type RefPart =
  | { kind: 'cell'; col: number; colAbs: boolean; row: number; rowAbs: boolean }
  | { kind: 'col'; col: number; abs: boolean }
  | { kind: 'row'; row: number; abs: boolean };

export type Token =
  | { type: 'text'; text: string }
  | { type: 'func'; name: string }
  /** `sheet` is the prefix as written (quotes included), without the `!`. */
  | { type: 'ref'; sheet?: string; start: RefPart; end?: RefPart; text: string };

const isIdent = (ch: string | undefined) => !!ch && (/[A-Za-z0-9_.]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const isDigit = (ch: string | undefined) => !!ch && ch >= '0' && ch <= '9';
const isAlpha = (ch: string | undefined) => !!ch && /[A-Za-z]/.test(ch);

function scanCell(s: string, i: number): [RefPart, number] | null {
  let j = i;
  const colAbs = s[j] === '$';
  if (colAbs) j++;
  const cs = j;
  while (isAlpha(s[j])) j++;
  const col = colIndex(s.slice(cs, j));
  if (col == null) return null;
  const rowAbs = s[j] === '$';
  if (rowAbs) j++;
  const rs = j;
  while (isDigit(s[j])) j++;
  if (rs === j) return null;
  const row = Number(s.slice(rs, j));
  if (row < 1 || row > MAX_ROWS) return null;
  return [{ kind: 'cell', col, colAbs, row: row - 1, rowAbs }, j];
}

function scanCol(s: string, i: number): [RefPart, number] | null {
  let j = i;
  const abs = s[j] === '$';
  if (abs) j++;
  const cs = j;
  while (isAlpha(s[j])) j++;
  const col = colIndex(s.slice(cs, j));
  return col == null ? null : [{ kind: 'col', col, abs }, j];
}

function scanRow(s: string, i: number): [RefPart, number] | null {
  let j = i;
  const abs = s[j] === '$';
  if (abs) j++;
  const rs = j;
  while (isDigit(s[j])) j++;
  if (rs === j) return null;
  const row = Number(s.slice(rs, j));
  return row >= 1 && row <= MAX_ROWS ? [{ kind: 'row', row: row - 1, abs }, j] : null;
}

function scanRef(s: string, i: number): [RefPart, RefPart | undefined, number] | null {
  const followsOk = (j: number) => j >= s.length || !(isIdent(s[j]) || s[j] === '(' || s[j] === '!' || s[j] === '[');
  const a = scanCell(s, i);
  if (a) {
    if (s[a[1]] === ':') {
      const b = scanCell(s, a[1] + 1);
      if (b && followsOk(b[1])) return [a[0], b[0], b[1]];
    }
    return followsOk(a[1]) ? [a[0], undefined, a[1]] : null;
  }
  for (const scan of [scanCol, scanRow]) {
    const p = scan(s, i);
    if (p && s[p[1]] === ':') {
      const q = scan(s, p[1] + 1);
      if (q && followsOk(q[1])) return [p[0], q[0], q[1]];
    }
  }
  return null;
}

/** Split a formula (without `=`) into text, references and function names. */
export function tokenize(f: string): Token[] {
  const out: Token[] = [];
  let textStart = 0;
  let i = 0;
  const flush = (to: number) => {
    if (to > textStart) out.push({ type: 'text', text: f.slice(textStart, to) });
  };
  while (i < f.length) {
    const ch = f[i]!;
    if (ch === '"') {
      i++;
      while (i < f.length) {
        if (f[i] === '"') {
          if (f[i + 1] === '"') {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '[') {
      let depth = 0;
      while (i < f.length) {
        if (f[i] === '[') depth++;
        else if (f[i] === ']' && --depth === 0) break;
        i++;
      }
      i++;
      continue;
    }
    if (i > 0 && (isIdent(f[i - 1]) || f[i - 1] === '$')) {
      i++;
      continue;
    }
    if (ch === "'") {
      const start = i;
      i++;
      while (i < f.length) {
        if (f[i] === "'") {
          if (f[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      if (f[i] === '!') {
        const r = scanRef(f, i + 1);
        if (r) {
          flush(start);
          out.push({ type: 'ref', sheet: f.slice(start, i), start: r[0], end: r[1], text: f.slice(start, r[2]) });
          i = r[2];
          textStart = i;
        }
      }
      continue;
    }
    if (isIdent(ch) || ch === '$') {
      const r = scanRef(f, i);
      if (r) {
        flush(i);
        out.push({ type: 'ref', start: r[0], end: r[1], text: f.slice(i, r[2]) });
        i = r[2];
        textStart = i;
        continue;
      }
      const start = i;
      while (i < f.length && isIdent(f[i])) i++;
      if (i === start) {
        i++;
        continue;
      }
      if (f[i] === '!') {
        const rr = scanRef(f, i + 1);
        if (rr) {
          flush(start);
          out.push({ type: 'ref', sheet: f.slice(start, i), start: rr[0], end: rr[1], text: f.slice(start, rr[2]) });
          i = rr[2];
          textStart = i;
        }
        continue;
      }
      if (f[i] === '(' && (isAlpha(f[start]) || f[start] === '_')) {
        flush(start);
        out.push({ type: 'func', name: f.slice(start, i) });
        textStart = i;
      }
      continue;
    }
    i++;
  }
  flush(f.length);
  return out;
}

export function partText(p: RefPart): string {
  switch (p.kind) {
    case 'cell':
      return `${p.colAbs ? '$' : ''}${colName(p.col)}${p.rowAbs ? '$' : ''}${p.row + 1}`;
    case 'col':
      return `${p.abs ? '$' : ''}${colName(p.col)}`;
    case 'row':
      return `${p.abs ? '$' : ''}${p.row + 1}`;
  }
}

function shiftPart(p: RefPart, dr: number, dc: number): RefPart | null {
  const sh = (v: number, d: number, abs: boolean, max: number) => {
    if (abs) return v;
    const n = v + d;
    return n >= 0 && n < max ? n : null;
  };
  switch (p.kind) {
    case 'cell': {
      const col = sh(p.col, dc, p.colAbs, MAX_COLS);
      const row = sh(p.row, dr, p.rowAbs, MAX_ROWS);
      return col == null || row == null ? null : { ...p, col, row };
    }
    case 'col': {
      const col = sh(p.col, dc, p.abs, MAX_COLS);
      return col == null ? null : { ...p, col };
    }
    case 'row': {
      const row = sh(p.row, dr, p.abs, MAX_ROWS);
      return row == null ? null : { ...p, row };
    }
  }
}

/** Move a formula by (dr, dc) as copy/fill does; refs pushed off the grid become `#REF!`. */
export function shiftFormula(f: string, dr: number, dc: number): string {
  if (!dr && !dc) return f;
  return tokenize(f)
    .map((t) => {
      if (t.type === 'text') return t.text;
      if (t.type === 'func') return t.name;
      const a = shiftPart(t.start, dr, dc);
      const b = t.end ? shiftPart(t.end, dr, dc) : undefined;
      const prefix = t.sheet ? `${t.sheet}!` : '';
      if (!a || b === null) return `${prefix}#REF!`;
      return prefix + partText(a) + (b ? `:${partText(b)}` : '');
    })
    .join('');
}

/** Cycle `$` on the reference at `cursor` (F4): A1 → $A$1 → A$1 → $A1 → A1. */
export function cycleAbsolute(f: string, cursor: number): { text: string; cursor: number } {
  let pos = 0;
  const parts = tokenize(f).map((t) => {
    const text = t.type === 'text' ? t.text : t.type === 'func' ? t.name : t.text;
    const start = pos;
    pos += text.length;
    return { t, text, start, end: pos };
  });
  const hit = parts.find((p) => p.t.type === 'ref' && cursor >= p.start && cursor <= p.end);
  if (!hit || hit.t.type !== 'ref') return { text: f, cursor };
  const cycle = (p: RefPart): RefPart => {
    if (p.kind !== 'cell') return { ...p, abs: !p.abs };
    const state = (p.colAbs ? 2 : 0) + (p.rowAbs ? 1 : 0);
    const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state]!;
    return { ...p, colAbs: next >= 2, rowAbs: next % 2 === 1 };
  };
  const t = hit.t;
  const replaced = (t.sheet ? `${t.sheet}!` : '') + partText(cycle(t.start)) + (t.end ? `:${partText(cycle(t.end))}` : '');
  const text = f.slice(0, hit.start) + replaced + f.slice(hit.end);
  return { text, cursor: hit.start + replaced.length };
}

// ---------------------------------------------------------------------------
// Id-reference form
// ---------------------------------------------------------------------------

/** A row or column key: a stable id, or `#<index>` past the sheet's tracked extent. */
export type Key = string;

export type IdPart =
  | { k: 'cell'; r: Key; c: Key; ar?: boolean; ac?: boolean }
  | { k: 'col'; c: Key; a?: boolean }
  | { k: 'row'; r: Key; a?: boolean };

export interface IdRef {
  /** Sheet id, when the formula names a sheet. */
  s?: string;
  /** The sheet name as written, kept when the sheet does not exist (external or unknown). */
  raw?: string;
  a: IdPart;
  b?: IdPart;
}

export interface StoredFormula {
  f: string;
  x: IdRef[];
}

/** Positions ↔ ids for every sheet; implemented over the Y.Doc. */
export interface RefResolver {
  sheetIdByName(name: string): string | null;
  sheetName(id: string): string | null;
  rowKey(sheetId: string, index: number): Key;
  colKey(sheetId: string, index: number): Key;
  /** Current index of a key; `null` when the row/column was deleted. */
  rowIndex(sheetId: string, key: Key): number | null;
  colIndex(sheetId: string, key: Key): number | null;
}

const OPEN = '';
const CLOSE = '';
const PLACEHOLDER = /(\d+)/g;

const unquote = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);

/** A1 formula (as typed, relative to `sheetId`) → stored form. */
export function encodeFormula(f: string, sheetId: string, res: RefResolver): StoredFormula {
  const x: IdRef[] = [];
  const parts = tokenize(f).map((t) => {
    if (t.type !== 'ref') return t.type === 'text' ? t.text : t.name;
    let target = sheetId;
    const ref: Partial<IdRef> = {};
    if (t.sheet) {
      const id = res.sheetIdByName(unquote(t.sheet));
      if (!id) return t.text; // unknown or external sheet: keep the text as is
      target = id;
      ref.s = id;
    }
    const enc = (p: RefPart): IdPart => {
      switch (p.kind) {
        case 'cell':
          return { k: 'cell', r: res.rowKey(target, p.row), c: res.colKey(target, p.col), ...(p.rowAbs ? { ar: true } : {}), ...(p.colAbs ? { ac: true } : {}) };
        case 'col':
          return { k: 'col', c: res.colKey(target, p.col), ...(p.abs ? { a: true } : {}) };
        case 'row':
          return { k: 'row', r: res.rowKey(target, p.row), ...(p.abs ? { a: true } : {}) };
      }
    };
    ref.a = enc(t.start);
    if (t.end) ref.b = enc(t.end);
    x.push(ref as IdRef);
    return `${OPEN}${x.length - 1}${CLOSE}`;
  });
  return { f: parts.join(''), x };
}

/** Stored form → A1 text for the current row/column order. Deleted references read `#REF!`. */
export function decodeFormula(sf: StoredFormula, sheetId: string, res: RefResolver): string {
  return sf.f.replace(PLACEHOLDER, (_, n: string) => {
    const ref = sf.x[Number(n)];
    if (!ref) return '#REF!';
    const target = ref.s ?? sheetId;
    const name = ref.s ? res.sheetName(ref.s) : null;
    if (ref.s && name == null) return '#REF!';
    const prefix = ref.s ? `${quoteSheet(name!)}!` : '';
    const dec = (p: IdPart): string | null => {
      switch (p.k) {
        case 'cell': {
          const r = res.rowIndex(target, p.r);
          const c = res.colIndex(target, p.c);
          return r == null || c == null ? null : `${p.ac ? '$' : ''}${colName(c)}${p.ar ? '$' : ''}${r + 1}`;
        }
        case 'col': {
          const c = res.colIndex(target, p.c);
          return c == null ? null : `${p.a ? '$' : ''}${colName(c)}`;
        }
        case 'row': {
          const r = res.rowIndex(target, p.r);
          return r == null ? null : `${p.a ? '$' : ''}${r + 1}`;
        }
      }
    };
    const a = dec(ref.a);
    const b = ref.b ? dec(ref.b) : undefined;
    if (a == null || b === null) return `${prefix}#REF!`;
    // A range whose ends crossed (rows deleted between) is normalized by the engine.
    return prefix + a + (b ? `:${b}` : '');
  });
}

/** Ids a stored formula points at, per sheet (for delete-time range adjustment). */
export function forEachIdPart(sf: StoredFormula, fn: (part: IdPart, ref: IdRef, end: 'a' | 'b') => IdPart | void): StoredFormula {
  let changed = false;
  const x = sf.x.map((ref) => {
    const a = fn(ref.a, ref, 'a') ?? ref.a;
    const b = ref.b ? (fn(ref.b, ref, 'b') ?? ref.b) : undefined;
    if (a !== ref.a || b !== ref.b) {
      changed = true;
      return { ...ref, a, ...(b ? { b } : {}) };
    }
    return ref;
  });
  return changed ? { f: sf.f, x } : sf;
}

/** Function names Excel stores with `_xlfn.`; the engine and the editor use the bare name. */
export const stripFuturePrefixes = (f: string) => f.replace(/_xlfn\.(_xlws\.)?/g, '');
