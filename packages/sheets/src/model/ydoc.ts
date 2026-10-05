/**
 * A workbook inside one Y.Doc (what the collab server stores):
 *
 *   meta            Y.Map    seeded, title, source, csv dialect, preserved[], date1904, baseStyles
 *   sheets          Y.Array  sheet ids, in tab order
 *   sheet:<id>      Y.Map    name, state, tabColor, frozenRows/Cols, zoom, showGrid, default sizes
 *   rows:<id>       Y.Array  stable row ids, in order (cols:<id> for columns)
 *   rowMeta:<id>    Y.Map    row id → { height?, hidden?, style?, outline? }   (colMeta:<id> for columns)
 *   cells:<id>      Y.Map    "<rowId>:<colId>" → YCell
 *   x:<id>          Y.Map    merges, filter, validations, condFormats, hyperlinks, notes, tables,
 *                            drawings (id ranges and anchors)
 *   styles          Y.Array  CellStyle, append-only (index = style id, as in the file)
 *   dxfs            Y.Array  differential formats (conditional formatting)
 *   names           Y.Map    "<scope>|<name>" → { name, scope?, formula: StoredFormula, hidden? }
 *
 * Rows and columns are named by id, never by position: inserting a row is one
 * array insert, cells and formulas follow, and concurrent edits merge. Pure
 * (no DOM): used by the editor, the server export and the tests.
 */
import * as Y from 'yjs';
import type { ChartSpec } from '@oel/engine/generated/oelchart';
import { MAX_COLS, MAX_ROWS, normalize, parseRange, parseSqref, rangeA1, type Range } from './a1';
import { decodeFormula, encodeFormula, shiftFormula, stripFuturePrefixes, type IdPart, type Key, type RefResolver, type StoredFormula } from './formula';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_STYLE,
  type AutoFilter,
  type Cell,
  type CellStyle,
  type CellType,
  type CellValue,
  type Color,
  type CondFormat,
  type Drawing,
  type DrawingMarker,
  type CondRule,
  type CsvDialect,
  type Hyperlink,
  type Note,
  type Preserved,
  type Sheet,
  type SheetState,
  type Source,
  type Table,
  type Validation,
  type Workbook,
} from './types';

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

export interface YCell {
  f?: StoredFormula;
  t?: CellType;
  v?: CellValue;
  s?: number;
  /** Array formula size (anchor cell only). */
  aw?: number;
  ah?: number;
  rich?: string;
}

export interface LineMeta {
  /** Points for rows, character widths for columns. */
  size?: number;
  hidden?: boolean;
  style?: number;
  outline?: number;
}

export interface IdRange {
  r0: Key;
  c0: Key;
  r1: Key;
  c1: Key;
}

export interface SheetProps {
  name: string;
  state: SheetState;
  tabColor: Color | null;
  frozenRows: number;
  frozenCols: number;
  zoom: number;
  showGrid: boolean;
  defaultColWidth: number;
  defaultRowHeight: number;
}

/** A formula that is relative to a range's top-left (CF, validation): kept in A1 with its original anchor. */
interface Anchored {
  /** Top-left of the range when the formula was written. */
  at: { r: Key; c: Key; r0: number; c0: number };
}

export type YValidation = Omit<Validation, 'sqref'> & Anchored & { ranges: IdRange[] };
export type YCondFormat = { ranges: IdRange[]; rules: CondRule[] } & Anchored;
export type YHyperlink = Omit<Hyperlink, 'ref'> & { range: IdRange };
export type YNote = Omit<Note, 'r' | 'c'> & { r: Key; c: Key };
export type YTable = Omit<Table, 'ref'> & { range: IdRange };
export type YMarker = Omit<DrawingMarker, 'r' | 'c'> & { r: Key; c: Key };
export type YDrawing = Omit<Drawing, 'from' | 'to'> & { from: YMarker; to?: YMarker };
export interface YFilter {
  range: IdRange;
  raw?: string;
  columns: Array<{ col: Key; values: string[]; blank?: boolean }>;
}

export interface YName {
  name: string;
  scope?: string;
  formula: StoredFormula;
  hidden?: boolean;
}

export const meta = (d: Y.Doc) => d.getMap<unknown>('meta');
export const sheetOrder = (d: Y.Doc) => d.getArray<string>('sheets');
export const sheetMap = (d: Y.Doc, id: string) => d.getMap<unknown>(`sheet:${id}`);
export const rowIds = (d: Y.Doc, id: string) => d.getArray<string>(`rows:${id}`);
export const colIds = (d: Y.Doc, id: string) => d.getArray<string>(`cols:${id}`);
export const rowMeta = (d: Y.Doc, id: string) => d.getMap<LineMeta>(`rowMeta:${id}`);
export const colMeta = (d: Y.Doc, id: string) => d.getMap<LineMeta>(`colMeta:${id}`);
export const cellMap = (d: Y.Doc, id: string) => d.getMap<YCell>(`cells:${id}`);
export const extras = (d: Y.Doc, id: string) => d.getMap<unknown>(`x:${id}`);

/** Marks a chart reference stored id-based (JSON of a `StoredFormula` follows). */
const STORED_REF = '\u0001';

/** Apply `fn` to every cell reference of a chart (series names, values, categories, titles, error amounts). */
export function mapChartRefs(spec: ChartSpec, fn: (ref: string) => string): ChartSpec {
  const ref = <T extends { f?: string | null } | null | undefined>(d: T): T => (d && d.f ? { ...d, f: fn(d.f) } : d);
  return {
    ...spec,
    title: ref(spec.title),
    axes: spec.axes?.map((a) => ({ ...a, title: ref(a.title) })),
    groups: spec.groups.map((g) => ({
      ...g,
      series: g.series.map((s) => ({
        ...s,
        nameRef: s.nameRef ? fn(s.nameRef) : s.nameRef,
        cat: ref(s.cat),
        val: ref(s.val),
        size: ref(s.size),
        errBars: s.errBars?.map((e) => ({ ...e, plus: ref(e.plus), minus: ref(e.minus) })),
      })),
    })),
  };
}
export const stylesArr = (d: Y.Doc) => d.getArray<CellStyle>('styles');
export const dxfsArr = (d: Y.Doc) => d.getArray<CellStyle>('dxfs');
export const namesMap = (d: Y.Doc) => d.getMap<YName>('names');

export const cellKey = (r: Key, c: Key) => `${r}:${c}`;

const rid = () => Math.random().toString(36).slice(2, 10);

/** Rows/columns referenced past this get a positional key instead of ids. */
const ID_CAP_ROWS = 200_000;
const ID_CAP_COLS = MAX_COLS;

// ---------------------------------------------------------------------------
// Index of ids → positions (cached per array, rebuilt when it changes)
// ---------------------------------------------------------------------------

class LineIndex {
  ids: string[] = [];
  pos = new Map<string, number>();
  private dirty = true;

  constructor(private arr: Y.Array<string>) {
    arr.observe(() => (this.dirty = true));
  }

  private refresh() {
    if (!this.dirty) return;
    this.dirty = false;
    // Concurrent extensions can repeat an id: the first occurrence wins.
    const seen = new Set<string>();
    this.ids = [];
    for (const id of this.arr.toArray()) {
      if (seen.has(id)) continue;
      seen.add(id);
      this.ids.push(id);
    }
    this.pos = new Map(this.ids.map((id, i) => [id, i]));
  }

  get length() {
    this.refresh();
    return this.ids.length;
  }
  id(i: number): string | undefined {
    this.refresh();
    return this.ids[i];
  }
  index(id: string): number | undefined {
    this.refresh();
    return this.pos.get(id);
  }
  markDirty() {
    this.dirty = true;
  }
}

// ---------------------------------------------------------------------------
// User input, as Excel reads what is typed into a cell
// ---------------------------------------------------------------------------

export interface ParsedInput {
  f?: string;
  t?: CellType;
  v?: CellValue;
  /** Number format implied by the input (`12 %`, `2026-01-05`), applied to General cells. */
  fmt?: string;
}

const ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!'];

/** Days since 1899-12-30 (Excel serial, 1900 system). */
export function dateSerial(y: number, m: number, d: number): number | null {
  const dt = Date.UTC(y, m - 1, d);
  const back = new Date(dt);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round((dt - Date.UTC(1899, 11, 30)) / 86_400_000);
}

export function parseInput(text: string): ParsedInput {
  if (text === '') return {};
  if (text.startsWith('=') && text.length > 1) return { f: stripFuturePrefixes(text.slice(1)) };
  if (text.startsWith("'")) return { t: 's', v: text.slice(1) };
  const s = text.trim();
  const up = s.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') return { t: 'b', v: up === 'TRUE' };
  if (ERRORS.includes(up)) return { t: 'e', v: up };
  // 1,234.5 · -3 · 1e5 · (12) — leading zeros stay text (codes), as in the CSV reader.
  let m = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (m && !(/^[+-]?0\d/.test(s))) return { t: 'n', v: Number(s.replace(/,/g, '')) };
  m = /^([+-]?)(\d+(?:\.\d+)?)\s?%$/.exec(s);
  if (m) return { t: 'n', v: Number(`${m[1]}${m[2]}`) / 100, fmt: m[2]!.includes('.') ? '0.00%' : '0%' };
  m = /^([+-]?)\$\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?$/.exec(s) ?? /^([+-]?)(\d{1,3}(?:[ ,  ]\d{3})*|\d+)([.,]\d+)?\s?\$$/.exec(s);
  if (m) {
    const n = Number(`${m[1]}${m[2]!.replace(/[ ,  ]/g, '')}${(m[3] ?? '').replace(',', '.')}`);
    return { t: 'n', v: n, fmt: s.endsWith('$') ? '#,##0.00 "$"' : '"$"#,##0.00' };
  }
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) {
    const serial = dateSerial(Number(m[1]), Number(m[2]), Number(m[3]));
    if (serial != null) return { t: 'n', v: serial, fmt: 'yyyy-mm-dd' };
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3] ?? 0) < 60) {
    return { t: 'n', v: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400, fmt: m[3] ? 'h:mm:ss' : 'h:mm' };
  }
  return { t: 's', v: text };
}

/** Format code without literal text, escapes and colour/condition brackets. */
const bare = (code: string) => code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');

export function isDateFormat(code: string): boolean {
  const b = bare(code).toLowerCase();
  return b !== 'general' && /[ymd]/.test(b) && !/^[#0.,%e+\-\s?/]*$/.test(b);
}

export function isTimeFormat(code: string): boolean {
  const b = bare(code).toLowerCase();
  return /[hs]/.test(b) || /am\/pm/.test(b);
}

/** A number as the formula bar shows it for editing (dates as ISO, percentages with %). */
export function editText(v: number, numFmt: string): string {
  const date = isDateFormat(numFmt);
  const time = isTimeFormat(numFmt);
  if (date || time) {
    const ms = Math.round(v * 86_400_000) + Date.UTC(1899, 11, 30);
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const clock = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${d.getUTCSeconds() ? `:${p(d.getUTCSeconds())}` : ''}`;
    if (date && time) return `${day} ${clock}`;
    return date ? day : clock;
  }
  if (bare(numFmt).includes('%')) return `${+(v * 100).toPrecision(15)}%`;
  return String(+v.toPrecision(15));
}

// ---------------------------------------------------------------------------
// The workbook over a Y.Doc
// ---------------------------------------------------------------------------

export interface CellEdit {
  r: number;
  c: number;
  /** New content; `null` clears the value (the format stays); absent keeps the content (format-only edit). */
  cell?: { f?: string; t?: CellType; v?: CellValue; aw?: number; ah?: number; rich?: string } | null;
  /** New style id; `undefined` keeps the current one. */
  s?: number;
}

export class SheetDoc implements RefResolver {
  private rowIdx = new Map<string, LineIndex>();
  private colIdx = new Map<string, LineIndex>();
  private styleKeys: Map<string, number> | null = null;

  constructor(readonly doc: Y.Doc) {
    stylesArr(doc).observe(() => (this.styleKeys = null));
  }

  /** Where the workbook came from: `xlsx`, `csv` or `new` (CSV mode limits features). */
  source(): Source {
    return (meta(this.doc).get('source') as Source) ?? 'new';
  }

  // ----- sheets ---------------------------------------------------------

  sheetIds(): string[] {
    return sheetOrder(this.doc).toArray();
  }

  props(id: string): SheetProps {
    const m = sheetMap(this.doc, id);
    return {
      name: (m.get('name') as string) ?? 'Feuille',
      state: (m.get('state') as SheetState) ?? 'visible',
      tabColor: (m.get('tabColor') as Color | null) ?? null,
      frozenRows: (m.get('frozenRows') as number) ?? 0,
      frozenCols: (m.get('frozenCols') as number) ?? 0,
      zoom: (m.get('zoom') as number) ?? 100,
      showGrid: (m.get('showGrid') as boolean) ?? true,
      defaultColWidth: (m.get('defaultColWidth') as number) ?? DEFAULT_COL_WIDTH,
      defaultRowHeight: (m.get('defaultRowHeight') as number) ?? DEFAULT_ROW_HEIGHT,
    };
  }

  setProps(id: string, patch: Partial<SheetProps>) {
    const m = sheetMap(this.doc, id);
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) m.set(k, v);
    });
  }

  sheetIdByName(name: string): string | null {
    const low = name.toLowerCase();
    return this.sheetIds().find((id) => this.props(id).name.toLowerCase() === low) ?? null;
  }

  sheetName(id: string): string | null {
    return this.sheetIds().includes(id) ? this.props(id).name : null;
  }

  /** A sheet name Excel accepts and no other sheet uses. */
  validSheetName(name: string, except?: string): string | null {
    const n = name.trim();
    if (!n || n.length > 31 || /[[\]*?:/\\]/.test(n) || n.startsWith("'") || n.endsWith("'")) return null;
    const other = this.sheetIdByName(n);
    return other && other !== except ? null : n;
  }

  addSheet(name?: string, index?: number): string {
    const id = `new-${rid()}`;
    const names = new Set(this.sheetIds().map((s) => this.props(s).name.toLowerCase()));
    let n = name ?? '';
    if (!n || names.has(n.toLowerCase())) {
      let i = this.sheetIds().length + 1;
      while (names.has(`feuille ${i}`)) i++;
      n = `Feuille ${i}`;
    }
    this.doc.transact(() => {
      const m = sheetMap(this.doc, id);
      m.set('name', n);
      m.set('state', 'visible');
      const order = sheetOrder(this.doc);
      order.insert(Math.min(index ?? order.length, order.length), [id]);
    });
    return id;
  }

  renameSheet(id: string, name: string): boolean {
    const n = this.validSheetName(name, id);
    if (!n) return false;
    sheetMap(this.doc, id).set('name', n);
    return true;
  }

  deleteSheet(id: string): boolean {
    const order = sheetOrder(this.doc);
    const visible = this.sheetIds().filter((s) => this.props(s).state === 'visible');
    if (visible.length <= 1 && visible[0] === id) return false;
    this.doc.transact(() => {
      const i = order.toArray().indexOf(id);
      if (i >= 0) order.delete(i, 1);
      cellMap(this.doc, id).clear();
      // Names local to the sheet go with it.
      for (const [k, n] of namesMap(this.doc).entries()) if (n.scope === id) namesMap(this.doc).delete(k);
    });
    return true;
  }

  moveSheet(id: string, to: number) {
    const order = sheetOrder(this.doc);
    const from = order.toArray().indexOf(id);
    if (from < 0 || from === to) return;
    this.doc.transact(() => {
      order.delete(from, 1);
      order.insert(Math.max(0, Math.min(to, order.length)), [id]);
    });
  }

  /** Copy a sheet (cells, sizes, extras) right after it. */
  duplicateSheet(id: string): string {
    const name = this.props(id).name;
    let n = 2;
    while (this.sheetIdByName(`${name} (${n})`)) n++;
    const copy = this.addSheet(`${name} (${n})`, this.sheetIds().indexOf(id) + 1);
    this.doc.transact(() => {
      const src = sheetMap(this.doc, id);
      const dst = sheetMap(this.doc, copy);
      for (const [k, v] of src.entries()) if (k !== 'name') dst.set(k, v);
      // Same ids: the copy's structure starts identical and diverges from there.
      rowIds(this.doc, copy).push(rowIds(this.doc, id).toArray());
      colIds(this.doc, copy).push(colIds(this.doc, id).toArray());
      for (const [k, v] of rowMeta(this.doc, id).entries()) rowMeta(this.doc, copy).set(k, v);
      for (const [k, v] of colMeta(this.doc, id).entries()) colMeta(this.doc, copy).set(k, v);
      const cells = cellMap(this.doc, copy);
      for (const [k, v] of cellMap(this.doc, id).entries()) {
        // References to the copied sheet itself (no sheet prefix) stay local to the copy.
        cells.set(k, v);
      }
      // Tables and drawings belong to their file part: a table name is unique in a workbook.
      for (const [k, v] of extras(this.doc, id).entries()) if (k !== 'tables' && k !== 'drawings') extras(this.doc, copy).set(k, v);
    });
    return copy;
  }

  // ----- rows / columns ---------------------------------------------------

  private rows(sheet: string): LineIndex {
    let li = this.rowIdx.get(sheet);
    if (!li) this.rowIdx.set(sheet, (li = new LineIndex(rowIds(this.doc, sheet))));
    return li;
  }

  private cols(sheet: string): LineIndex {
    let li = this.colIdx.get(sheet);
    if (!li) this.colIdx.set(sheet, (li = new LineIndex(colIds(this.doc, sheet))));
    return li;
  }

  rowCount(sheet: string) {
    return this.rows(sheet).length;
  }
  colCount(sheet: string) {
    return this.cols(sheet).length;
  }

  /** Make sure ids exist up to `index` (deterministic ids, so concurrent extensions agree). */
  private extend(arr: Y.Array<string>, li: LineIndex, index: number, prefix: string) {
    const n = li.length;
    if (index < n) return;
    const target = index + 64;
    const ids: string[] = [];
    for (let i = n; i <= target; i++) ids.push(`${prefix}${n}.${i - n}`);
    arr.push(ids);
    li.markDirty();
  }

  rowKey(sheet: string, index: number): Key {
    const li = this.rows(sheet);
    if (index >= li.length) {
      if (index >= ID_CAP_ROWS) return `#${index}`;
      this.extend(rowIds(this.doc, sheet), li, index, 'r');
    }
    return li.id(index)!;
  }

  colKey(sheet: string, index: number): Key {
    const li = this.cols(sheet);
    if (index >= li.length) {
      if (index >= ID_CAP_COLS) return `#${index}`;
      this.extend(colIds(this.doc, sheet), li, index, 'c');
    }
    return li.id(index)!;
  }

  rowIndex(sheet: string, key: Key): number | null {
    if (key.startsWith('#')) return Number(key.slice(1));
    return this.rows(sheet).index(key) ?? null;
  }

  colIndex(sheet: string, key: Key): number | null {
    if (key.startsWith('#')) return Number(key.slice(1));
    return this.cols(sheet).index(key) ?? null;
  }

  /** Row id at an index without creating one. */
  rowIdAt(sheet: string, index: number): string | undefined {
    return this.rows(sheet).id(index);
  }
  colIdAt(sheet: string, index: number): string | undefined {
    return this.cols(sheet).id(index);
  }

  rowSize(sheet: string, r: number): LineMeta | undefined {
    const id = this.rows(sheet).id(r);
    return id ? rowMeta(this.doc, sheet).get(id) : undefined;
  }
  colSize(sheet: string, c: number): LineMeta | undefined {
    const id = this.cols(sheet).id(c);
    return id ? colMeta(this.doc, sheet).get(id) : undefined;
  }

  setRowMeta(sheet: string, from: number, to: number, patch: Partial<LineMeta>) {
    this.doc.transact(() => {
      const m = rowMeta(this.doc, sheet);
      for (let r = from; r <= to; r++) {
        const id = this.rowKey(sheet, r);
        if (id.startsWith('#')) continue;
        m.set(id, clean({ ...m.get(id), ...patch }));
      }
    });
  }

  setColMeta(sheet: string, from: number, to: number, patch: Partial<LineMeta>) {
    this.doc.transact(() => {
      const m = colMeta(this.doc, sheet);
      for (let c = from; c <= to; c++) {
        const id = this.colKey(sheet, c);
        if (id.startsWith('#')) continue;
        m.set(id, clean({ ...m.get(id), ...patch }));
      }
    });
  }

  // ----- cells ------------------------------------------------------------

  getCell(sheet: string, r: number, c: number): YCell | undefined {
    const ri = this.rows(sheet).id(r);
    const ci = this.cols(sheet).id(c);
    return ri && ci ? cellMap(this.doc, sheet).get(cellKey(ri, ci)) : undefined;
  }

  /** What the formula bar shows for a cell. */
  inputText(sheet: string, r: number, c: number): string {
    const cell = this.getCell(sheet, r, c);
    if (!cell) return '';
    if (cell.f) return `=${decodeFormula(cell.f, sheet, this)}`;
    if (cell.v == null) return '';
    if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
    if (cell.t === 'n' && typeof cell.v === 'number') return editText(cell.v, this.style(cell.s ?? 0).numFmt);
    if (cell.t === 's') {
      const s = String(cell.v);
      // Text that would read as something else is shown with its apostrophe, as in Excel.
      const p = parseInput(s);
      return p.t === 's' && !p.f ? s : `'${s}`;
    }
    return String(cell.v);
  }

  /** Formula text (A1, no `=`) of a stored cell. */
  formulaText(sheet: string, cell: YCell): string | undefined {
    return cell.f ? decodeFormula(cell.f, sheet, this) : undefined;
  }

  /** Apply several cell edits in one transaction (one undo step). */
  setCells(sheet: string, edits: CellEdit[]) {
    if (!edits.length) return;
    this.doc.transact(() => {
      const map = cellMap(this.doc, sheet);
      for (const e of edits) {
        if (e.r < 0 || e.c < 0 || e.r >= MAX_ROWS || e.c >= MAX_COLS) continue;
        const key = cellKey(this.rowKey(sheet, e.r), this.colKey(sheet, e.c));
        const old = map.get(key);
        const s = e.s ?? old?.s ?? this.lineStyle(sheet, e.r, e.c);
        let next: YCell = {};
        if (e.cell === undefined) {
          next = { ...old };
          delete next.s;
        } else if (e.cell) {
          if (e.cell.f != null) {
            next.f = encodeFormula(e.cell.f, sheet, this);
            if (e.cell.aw && e.cell.ah) {
              next.aw = e.cell.aw;
              next.ah = e.cell.ah;
            }
          } else if (e.cell.t && e.cell.v != null) {
            next.t = e.cell.t;
            next.v = e.cell.v;
            if (e.cell.rich) next.rich = e.cell.rich;
          }
        }
        if (s) next.s = s;
        if (Object.keys(next).length) map.set(key, next);
        else if (old) map.delete(key);
      }
    });
  }

  /** Style of an empty cell: its row's, else its column's. */
  private lineStyle(sheet: string, r: number, c: number): number | undefined {
    return this.rowSize(sheet, r)?.style ?? this.colSize(sheet, c)?.style;
  }

  /** Type into a cell, with Excel's reading of numbers, dates, percentages. */
  setInput(sheet: string, r: number, c: number, text: string) {
    const p = parseInput(text);
    const cell = this.getCell(sheet, r, c);
    let s: number | undefined;
    if (p.fmt) {
      const cur = this.style(cell?.s ?? 0);
      if (cur.numFmt === 'General') s = this.styleId({ ...cur, numFmt: p.fmt });
    }
    this.setCells(sheet, [{ r, c, cell: p.f != null ? { f: p.f } : p.t ? { t: p.t, v: p.v } : null, s }]);
  }

  /** Every stored cell of a sheet with its position (skips cells of deleted rows/columns). */
  *cells(sheet: string): Generator<{ r: number; c: number; cell: YCell; key: string }> {
    for (const [key, cell] of cellMap(this.doc, sheet).entries()) {
      const i = key.indexOf(':');
      const r = this.rows(sheet).index(key.slice(0, i));
      const c = this.cols(sheet).index(key.slice(i + 1));
      if (r != null && c != null) yield { r, c, cell, key };
    }
  }

  /** Last used row and column (for Ctrl+End, CSV export, previews). */
  usedRange(sheet: string): Range | null {
    let r1 = -1;
    let c1 = -1;
    for (const { r, c, cell } of this.cells(sheet)) {
      if (cell.f || cell.v != null) {
        if (r > r1) r1 = r;
        if (c > c1) c1 = c;
      }
    }
    return r1 < 0 ? null : { r0: 0, c0: 0, r1, c1 };
  }

  // ----- styles -----------------------------------------------------------

  style(id: number): CellStyle {
    return stylesArr(this.doc).get(id) ?? DEFAULT_STYLE;
  }

  /** Id of a style, appending it when it is new (styles are never edited in place). */
  styleId(st: CellStyle): number {
    const arr = stylesArr(this.doc);
    if (!this.styleKeys) {
      this.styleKeys = new Map();
      arr.toArray().forEach((s, i) => {
        const k = styleKey(s);
        if (!this.styleKeys!.has(k)) this.styleKeys!.set(k, i);
      });
    }
    const k = styleKey(st);
    const found = this.styleKeys.get(k);
    if (found != null) return found;
    arr.push([st]);
    const id = arr.length - 1;
    this.styleKeys.set(k, id);
    return id;
  }

  /** Change the format of every cell in a range (empty cells get a format-only entry). */
  formatRange(sheet: string, range: Range, change: (s: CellStyle) => CellStyle) {
    this.doc.transact(() => {
      const map = cellMap(this.doc, sheet);
      const r1 = Math.min(range.r1, Math.max(range.r0, this.rowCount(sheet) + 200));
      const c1 = Math.min(range.c1, Math.max(range.c0, this.colCount(sheet) + 50));
      const cache = new Map<number, number>();
      const restyle = (s: number) => {
        let n = cache.get(s);
        if (n == null) cache.set(s, (n = this.styleId(change(this.style(s)))));
        return n;
      };
      // Whole columns or rows: the line carries the format too (for cells typed later).
      if (range.r0 === 0 && range.r1 >= MAX_ROWS - 1) {
        for (let c = range.c0; c <= Math.min(range.c1, this.colCount(sheet) + 50); c++) {
          const cur = this.colSize(sheet, c)?.style ?? 0;
          this.setColMeta(sheet, c, c, { style: restyle(cur) || undefined });
        }
      }
      if (range.c0 === 0 && range.c1 >= MAX_COLS - 1) {
        for (let r = range.r0; r <= Math.min(range.r1, this.rowCount(sheet) + 200); r++) {
          const cur = this.rowSize(sheet, r)?.style ?? 0;
          this.setRowMeta(sheet, r, r, { style: restyle(cur) || undefined });
        }
      }
      for (let r = range.r0; r <= r1; r++) {
        for (let c = range.c0; c <= c1; c++) {
          const key = cellKey(this.rowKey(sheet, r), this.colKey(sheet, c));
          const old = map.get(key);
          const s = restyle(old?.s ?? this.lineStyle(sheet, r, c) ?? 0);
          const next: YCell = { ...old };
          if (s) next.s = s;
          else delete next.s;
          if (Object.keys(next).length) map.set(key, next);
          else if (old) map.delete(key);
        }
      }
    });
  }

  // ----- extras (merges, filters, validation, conditional formats, links) ---

  idRange(sheet: string, r: Range): IdRange {
    return { r0: this.rowKey(sheet, r.r0), c0: this.colKey(sheet, r.c0), r1: this.rowKey(sheet, r.r1), c1: this.colKey(sheet, r.c1) };
  }

  range(sheet: string, ir: IdRange): Range | null {
    const r0 = this.rowIndex(sheet, ir.r0);
    const c0 = this.colIndex(sheet, ir.c0);
    const r1 = this.rowIndex(sheet, ir.r1);
    const c1 = this.colIndex(sheet, ir.c1);
    return r0 == null || c0 == null || r1 == null || c1 == null ? null : normalize({ r0, c0, r1, c1 });
  }

  merges(sheet: string): Range[] {
    return ((extras(this.doc, sheet).get('merges') as IdRange[] | undefined) ?? []).map((m) => this.range(sheet, m)).filter((r): r is Range => !!r);
  }

  setMerges(sheet: string, ranges: Range[]) {
    this.doc.transact(() => extras(this.doc, sheet).set('merges', ranges.map((r) => this.idRange(sheet, r))));
  }

  filter(sheet: string): AutoFilter | null {
    const f = extras(this.doc, sheet).get('filter') as YFilter | undefined;
    if (!f) return null;
    const range = this.range(sheet, f.range);
    if (!range) return null;
    const columns = f.columns
      .map((col) => ({ col: (this.colIndex(sheet, col.col) ?? -1) - range.c0, values: col.values, ...(col.blank ? { blank: true } : {}) }))
      .filter((c) => c.col >= 0);
    return { ref: rangeA1(range), ...(f.raw && !f.columns.length ? { raw: f.raw } : {}), columns };
  }

  setFilter(sheet: string, f: { range: Range; columns: Array<{ col: number; values: string[]; blank?: boolean }>; raw?: string } | null) {
    this.doc.transact(() => {
      if (!f) return extras(this.doc, sheet).delete('filter');
      const y: YFilter = {
        range: this.idRange(sheet, f.range),
        columns: f.columns.map((c) => ({ col: this.colKey(sheet, f.range.c0 + c.col), values: c.values, ...(c.blank ? { blank: true } : {}) })),
        ...(f.raw ? { raw: f.raw } : {}),
      };
      extras(this.doc, sheet).set('filter', y);
    });
  }

  private anchoredFormula(sheet: string, f: string, at: Anchored['at']): string {
    const r = this.rowIndex(sheet, at.r);
    const c = this.colIndex(sheet, at.c);
    return r == null || c == null ? f : shiftFormula(f, r - at.r0, c - at.c0);
  }

  validations(sheet: string): Validation[] {
    const list = (extras(this.doc, sheet).get('validations') as YValidation[] | undefined) ?? [];
    return list.flatMap((v) => {
      const ranges = v.ranges.map((r) => this.range(sheet, r)).filter((r): r is Range => !!r);
      if (!ranges.length) return [];
      const { ranges: _r, at, ...rest } = v;
      return [
        {
          ...rest,
          sqref: ranges.map(rangeA1).join(' '),
          ...(v.formula1 != null ? { formula1: this.anchoredFormula(sheet, v.formula1, at) } : {}),
          ...(v.formula2 != null ? { formula2: this.anchoredFormula(sheet, v.formula2, at) } : {}),
        },
      ];
    });
  }

  setValidations(sheet: string, list: Validation[]) {
    this.doc.transact(() => extras(this.doc, sheet).set('validations', list.map((v) => this.toYValidation(sheet, v)).filter((v): v is YValidation => !!v)));
  }

  private toYValidation(sheet: string, v: Validation): YValidation | null {
    const ranges = parseSqref(v.sqref);
    if (!ranges.length) return null;
    const { sqref: _s, ...rest } = v;
    const top = ranges[0]!;
    return { ...rest, ranges: ranges.map((r) => this.idRange(sheet, r)), at: { r: this.rowKey(sheet, top.r0), c: this.colKey(sheet, top.c0), r0: top.r0, c0: top.c0 } };
  }

  condFormats(sheet: string): CondFormat[] {
    const list = (extras(this.doc, sheet).get('condFormats') as YCondFormat[] | undefined) ?? [];
    return list.flatMap((cf) => {
      const ranges = cf.ranges.map((r) => this.range(sheet, r)).filter((r): r is Range => !!r);
      if (!ranges.length) return [];
      return [{ sqref: ranges.map(rangeA1).join(' '), rules: cf.rules.map((rule) => ({ ...rule, formulas: rule.formulas.map((f) => this.anchoredFormula(sheet, f, cf.at)) })) }];
    });
  }

  setCondFormats(sheet: string, list: CondFormat[]) {
    this.doc.transact(() =>
      extras(this.doc, sheet).set(
        'condFormats',
        list.flatMap((cf): YCondFormat[] => {
          const ranges = parseSqref(cf.sqref);
          if (!ranges.length) return [];
          const top = ranges[0]!;
          return [{ ranges: ranges.map((r) => this.idRange(sheet, r)), rules: cf.rules, at: { r: this.rowKey(sheet, top.r0), c: this.colKey(sheet, top.c0), r0: top.r0, c0: top.c0 } }];
        }),
      ),
    );
  }

  hyperlinks(sheet: string): Hyperlink[] {
    const list = (extras(this.doc, sheet).get('hyperlinks') as YHyperlink[] | undefined) ?? [];
    return list.flatMap(({ range, ...h }) => {
      const r = this.range(sheet, range);
      return r ? [{ ...h, ref: rangeA1(r) }] : [];
    });
  }

  setHyperlinks(sheet: string, list: Hyperlink[]) {
    this.doc.transact(() =>
      extras(this.doc, sheet).set(
        'hyperlinks',
        list.flatMap(({ ref, ...h }) => {
          const r = parseRange(ref);
          return r ? [{ ...h, range: this.idRange(sheet, r) }] : [];
        }),
      ),
    );
  }

  notes(sheet: string): Note[] {
    const list = (extras(this.doc, sheet).get('notes') as YNote[] | undefined) ?? [];
    return list.flatMap((n) => {
      const r = this.rowIndex(sheet, n.r);
      const c = this.colIndex(sheet, n.c);
      return r == null || c == null ? [] : [{ ...n, r, c }];
    });
  }

  /** Structured tables (read from the file; their range follows row and column edits). */
  tables(sheet: string): Table[] {
    const list = (extras(this.doc, sheet).get('tables') as YTable[] | undefined) ?? [];
    return list.flatMap(({ range, ...t }) => {
      const r = this.range(sheet, range);
      return r ? [{ ...t, ref: rangeA1(r) }] : [];
    });
  }

  /**
   * Pictures, shapes and charts over the grid, anchored to row and column ids.
   * Chart references are stored like formulas (id based), so inserting or
   * deleting rows moves the ranges a chart reads, as in Excel.
   */
  drawings(sheet: string): Drawing[] {
    const list = (extras(this.doc, sheet).get('drawings') as YDrawing[] | undefined) ?? [];
    const marker = (m: YMarker): DrawingMarker | null => {
      const r = this.rowIndex(sheet, m.r);
      const c = this.colIndex(sheet, m.c);
      return r == null || c == null ? null : { ...m, r, c };
    };
    return list.flatMap(({ from: f, to: t, ...rest }) => {
      const from = marker(f);
      const to = t ? marker(t) : undefined;
      const chart = rest.chart ? mapChartRefs(rest.chart, (ref) => this.decodeChartRef(sheet, ref)) : undefined;
      return from && to !== null ? [{ ...rest, ...(chart ? { chart } : {}), from, ...(to ? { to } : {}) }] : [];
    });
  }

  private toYDrawing(sheet: string, d: Drawing): YDrawing {
    const marker = (m: DrawingMarker): YMarker => ({ ...m, r: this.rowKey(sheet, m.r), c: this.colKey(sheet, m.c) });
    const chart = d.chart ? mapChartRefs(d.chart, (ref) => this.encodeChartRef(sheet, ref)) : undefined;
    return clean({ ...d, chart, from: marker(d.from), ...(d.to ? { to: marker(d.to) } : {}) }) as YDrawing;
  }

  /** A chart reference → stored form; the text as written is kept for as long as the reference does not move. */
  private encodeChartRef(sheet: string, ref: string): string {
    const sf = encodeFormula(ref.replace(/^=/, ''), sheet, this);
    return STORED_REF + JSON.stringify({ sf, t: ref, sig: decodeFormula(sf, sheet, this) });
  }

  private decodeChartRef(sheet: string, ref: string): string {
    if (!ref.startsWith(STORED_REF)) return ref;
    const o = JSON.parse(ref.slice(1)) as { sf: StoredFormula; t: string; sig: string };
    const now = decodeFormula(o.sf, sheet, this);
    return now === o.sig ? o.t : now;
  }

  /** Replace the drawings of a sheet (one undo step). */
  setDrawings(sheet: string, list: Drawing[]) {
    this.doc.transact(() => {
      const x = extras(this.doc, sheet);
      if (list.length) x.set('drawings', list.map((d) => this.toYDrawing(sheet, d)));
      else x.delete('drawings');
    });
  }

  /** Change one drawing (by its position in `drawings()`). */
  updateDrawing(sheet: string, index: number, patch: (d: Drawing) => Drawing) {
    const list = this.drawings(sheet);
    const d = list[index];
    if (!d) return;
    list[index] = patch(d);
    this.setDrawings(sheet, list);
  }

  // ----- names ------------------------------------------------------------

  names(): Array<{ name: string; scope?: string; formula: string; hidden?: boolean }> {
    const first = this.sheetIds()[0] ?? '';
    return [...namesMap(this.doc).values()].map((n) => ({ name: n.name, ...(n.scope ? { scope: n.scope } : {}), formula: decodeFormula(n.formula, n.scope ?? first, this), ...(n.hidden ? { hidden: true } : {}) }));
  }

  setName(name: string, formula: string, scope?: string) {
    const first = this.sheetIds()[0] ?? '';
    this.doc.transact(() => namesMap(this.doc).set(`${scope ?? ''}|${name}`, { name, ...(scope ? { scope } : {}), formula: encodeFormula(formula.replace(/^=/, ''), scope ?? first, this) }));
  }

  deleteName(name: string, scope?: string) {
    namesMap(this.doc).delete(`${scope ?? ''}|${name}`);
  }

  // ----- structure --------------------------------------------------------

  insertRows(sheet: string, at: number, count: number) {
    this.insertLines(sheet, 'row', at, count);
  }
  insertCols(sheet: string, at: number, count: number) {
    this.insertLines(sheet, 'col', at, count);
  }
  deleteRows(sheet: string, at: number, count: number) {
    this.deleteLines(sheet, 'row', at, count);
  }
  deleteCols(sheet: string, at: number, count: number) {
    this.deleteLines(sheet, 'col', at, count);
  }

  private insertLines(sheet: string, kind: 'row' | 'col', at: number, count: number) {
    const li = kind === 'row' ? this.rows(sheet) : this.cols(sheet);
    if (at >= li.length) return; // past the tracked extent nothing moves
    const arr = kind === 'row' ? rowIds(this.doc, sheet) : colIds(this.doc, sheet);
    const ids = Array.from({ length: count }, () => `${kind[0]}${rid()}`);
    this.doc.transact(() => {
      // Position in the raw array (it may hold duplicate ids from concurrent extensions).
      const raw = arr.toArray().indexOf(li.id(at)!);
      arr.insert(raw, ids);
      li.markDirty();
      // New lines take the format of the line before them, as in Excel.
      if (at > 0) {
        const m = kind === 'row' ? rowMeta(this.doc, sheet) : colMeta(this.doc, sheet);
        const prev = m.get(li.id(at - 1)!);
        if (prev?.style || prev?.size) for (const id of ids) m.set(id, clean({ size: prev.size, style: prev.style }));
      }
    });
  }

  /**
   * Delete rows/columns. Done like Excel: single references to them become
   * `#REF!`, ranges that lose an end shrink to the surviving lines, and
   * merges, validations, conditional formats and links shrink or go.
   */
  private deleteLines(sheet: string, kind: 'row' | 'col', at: number, count: number) {
    const li = kind === 'row' ? this.rows(sheet) : this.cols(sheet);
    if (at >= li.length) return;
    const end = Math.min(at + count, li.length);
    const gone = new Set<string>();
    for (let i = at; i < end; i++) gone.add(li.id(i)!);
    const after = li.id(end);
    const before = at > 0 ? li.id(at - 1) : undefined;
    const arr = kind === 'row' ? rowIds(this.doc, sheet) : colIds(this.doc, sheet);
    const isRow = kind === 'row';

    /** Move a range end out of the deleted block; null when the whole range goes. */
    const adjust = (a: Key, b: Key): [Key, Key] | null => {
      const ia = isRow ? this.rowIndex(sheet, a) : this.colIndex(sheet, a);
      const ib = isRow ? this.rowIndex(sheet, b) : this.colIndex(sheet, b);
      if (ia == null || ib == null) return [a, b];
      const lo = Math.min(ia, ib);
      const hi = Math.max(ia, ib);
      if (lo >= at && hi < end) return null;
      let na = a;
      let nb = b;
      if (gone.has(a)) na = (ia === lo ? after : before) ?? a;
      if (gone.has(b)) nb = (ib === lo ? after : before) ?? b;
      return [na, nb];
    };

    this.doc.transact(() => {
      // 1. Formulas everywhere that point into this sheet.
      for (const sid of this.sheetIds()) {
        const map = cellMap(this.doc, sid);
        for (const [key, cell] of map.entries()) {
          if (!cell.f) continue;
          const f = this.adjustFormula(cell.f, sid, sheet, isRow, gone, adjust);
          if (f !== cell.f) map.set(key, { ...cell, f });
        }
      }
      for (const [k, n] of namesMap(this.doc).entries()) {
        const f = this.adjustFormula(n.formula, n.scope ?? this.sheetIds()[0] ?? '', sheet, isRow, gone, adjust);
        if (f !== n.formula) namesMap(this.doc).set(k, { ...n, formula: f });
      }
      // 2. Ranges in extras.
      const fixRange = (r: IdRange): IdRange | null => {
        const p = isRow ? adjust(r.r0, r.r1) : adjust(r.c0, r.c1);
        if (!p) return null;
        return isRow ? { ...r, r0: p[0], r1: p[1] } : { ...r, c0: p[0], c1: p[1] };
      };
      const x = extras(this.doc, sheet);
      const merges = x.get('merges') as IdRange[] | undefined;
      if (merges) x.set('merges', merges.map(fixRange).filter((r): r is IdRange => !!r));
      for (const key of ['validations', 'condFormats'] as const) {
        const list = x.get(key) as Array<{ ranges: IdRange[] } & Anchored> | undefined;
        if (!list) continue;
        x.set(
          key,
          list.flatMap((item) => {
            const ranges = item.ranges.map(fixRange).filter((r): r is IdRange => !!r);
            if (!ranges.length) return [];
            // A deleted anchor moves to the first line after the block. Its original
            // offset stays right: the lines its relative references point at moved
            // up by the same count.
            const anchorKey = isRow ? item.at.r : item.at.c;
            const at2 = gone.has(anchorKey) && after ? (isRow ? { ...item.at, r: after } : { ...item.at, c: after }) : item.at;
            return [{ ...item, ranges, at: at2 }];
          }),
        );
      }
      const links = x.get('hyperlinks') as YHyperlink[] | undefined;
      if (links) x.set('hyperlinks', links.flatMap((l) => (fixRange(l.range) ? [{ ...l, range: fixRange(l.range)! }] : [])));
      const tables = x.get('tables') as YTable[] | undefined;
      if (tables) x.set('tables', tables.flatMap((t) => (fixRange(t.range) ? [{ ...t, range: fixRange(t.range)! }] : [])));
      // A drawing corner on a deleted line moves to the start of the next one, as in Excel.
      const drawings = x.get('drawings') as YDrawing[] | undefined;
      const fixMarker = (m: YMarker): YMarker => {
        const k = isRow ? m.r : m.c;
        if (!gone.has(k)) return m;
        const to = after ?? before ?? k;
        return isRow ? { ...m, r: to, dy: 0 } : { ...m, c: to, dx: 0 };
      };
      if (drawings?.some((d) => gone.has(isRow ? d.from.r : d.from.c) || (d.to && gone.has(isRow ? d.to.r : d.to.c)))) {
        x.set('drawings', drawings.map((d) => ({ ...d, from: fixMarker(d.from), ...(d.to ? { to: fixMarker(d.to) } : {}) })));
      }
      const filter = x.get('filter') as YFilter | undefined;
      if (filter) {
        const range = fixRange(filter.range);
        if (!range) x.delete('filter');
        else x.set('filter', { ...filter, range, columns: isRow ? filter.columns : filter.columns.filter((c) => !gone.has(c.col)) });
      }
      // 3. The cells of the deleted lines, and their sizes.
      const map = cellMap(this.doc, sheet);
      for (const key of [...map.keys()]) {
        const i = key.indexOf(':');
        if (gone.has(isRow ? key.slice(0, i) : key.slice(i + 1))) map.delete(key);
      }
      const m = isRow ? rowMeta(this.doc, sheet) : colMeta(this.doc, sheet);
      for (const id of gone) m.delete(id);
      // 4. The lines themselves (every occurrence, duplicates included).
      const all = arr.toArray();
      for (let i = all.length - 1; i >= 0; i--) if (gone.has(all[i]!)) arr.delete(i, 1);
      li.markDirty();
    });
  }

  private adjustFormula(
    sf: StoredFormula,
    cellSheet: string,
    target: string,
    isRow: boolean,
    gone: Set<string>,
    adjust: (a: Key, b: Key) => [Key, Key] | null,
  ): StoredFormula {
    let changed = false;
    const x = sf.x.map((ref) => {
      if ((ref.s ?? cellSheet) !== target || !ref.b) return ref;
      const keyOf = (p: IdPart) => (isRow ? (p.k === 'col' ? null : p.r) : p.k === 'row' ? null : p.c);
      const ka = keyOf(ref.a);
      const kb = keyOf(ref.b);
      if (ka == null || kb == null || (!gone.has(ka) && !gone.has(kb))) return ref;
      const p = adjust(ka, kb);
      if (!p) return ref; // whole range deleted → #REF!
      const set = (part: IdPart, k: Key): IdPart => (isRow ? ('r' in part ? { ...part, r: k } : part) : 'c' in part ? { ...part, c: k } : part);
      changed = true;
      return { ...ref, a: set(ref.a, p[0]), b: set(ref.b, p[1]) };
    });
    return changed ? { f: sf.f, x } : sf;
  }

  // ----- seed and materialize ----------------------------------------------

  /** Put an imported workbook into an empty Y.Doc. Returns false if it already has content. */
  seed(wb: Workbook, title?: string): boolean {
    const m = meta(this.doc);
    if (m.get('seeded')) return false;
    this.doc.transact(() => {
      stylesArr(this.doc).push(wb.styles.length ? wb.styles : [DEFAULT_STYLE]);
      if (wb.dxfs?.length) dxfsArr(this.doc).push(wb.dxfs);
      const order = sheetOrder(this.doc);
      for (const s of wb.sheets) {
        const id = s.id;
        order.push([id]);
        const sm = sheetMap(this.doc, id);
        sm.set('name', s.name);
        sm.set('state', s.state ?? 'visible');
        if (s.tabColor) sm.set('tabColor', s.tabColor);
        if (s.frozenRows) sm.set('frozenRows', s.frozenRows);
        if (s.frozenCols) sm.set('frozenCols', s.frozenCols);
        if (s.zoom && s.zoom !== 100) sm.set('zoom', s.zoom);
        if (s.showGrid === false) sm.set('showGrid', false);
        if (s.defaultColWidth) sm.set('defaultColWidth', s.defaultColWidth);
        if (s.defaultRowHeight) sm.set('defaultRowHeight', s.defaultRowHeight);
        // Ids for the used extent (deterministic: seeding happens once).
        let maxR = 0;
        let maxC = 0;
        for (const c of s.cells) {
          maxR = Math.max(maxR, c.r);
          maxC = Math.max(maxC, c.c);
        }
        for (const r of s.rows ?? []) maxR = Math.max(maxR, r.r);
        for (const c of s.cols ?? []) maxC = Math.max(maxC, Math.min(c.max, 1000));
        rowIds(this.doc, id).push(Array.from({ length: Math.min(maxR + 101, MAX_ROWS) }, (_, i) => `r${i}`));
        colIds(this.doc, id).push(Array.from({ length: Math.min(maxC + 27, MAX_COLS) }, (_, i) => `c${i}`));
      }
      // Names first: formulas are encoded against existing sheets.
      const first = wb.sheets[0]?.id ?? '';
      for (const n of wb.names ?? []) {
        namesMap(this.doc).set(`${n.scope ?? ''}|${n.name}`, { name: n.name, ...(n.scope ? { scope: n.scope } : {}), formula: encodeFormula(n.formula, n.scope ?? first, this), ...(n.hidden ? { hidden: true } : {}) });
      }
      for (const s of wb.sheets) {
        const id = s.id;
        const rm = rowMeta(this.doc, id);
        for (const r of s.rows ?? []) {
          const key = this.rowKey(id, r.r);
          rm.set(key, clean({ size: r.height, hidden: r.hidden || undefined, style: r.style, outline: r.outline || undefined }));
        }
        const cm = colMeta(this.doc, id);
        for (const c of s.cols ?? []) {
          for (let i = c.min; i <= Math.min(c.max, this.colCount(id) - 1); i++) {
            cm.set(this.colKey(id, i), clean({ size: c.width, hidden: c.hidden || undefined, style: c.style, outline: c.outline || undefined }));
          }
          if (c.max >= this.colCount(id) && c.style) sheetMap(this.doc, id).set('tailColStyle', c.style);
        }
        const map = cellMap(this.doc, id);
        for (const c of s.cells) {
          const key = cellKey(this.rowKey(id, c.r), this.colKey(id, c.c));
          const y: YCell = {};
          if (c.f != null) {
            y.f = encodeFormula(c.f, id, this);
            const a = c.a ? parseRange(c.a) : null;
            if (a) {
              y.aw = a.c1 - a.c0 + 1;
              y.ah = a.r1 - a.r0 + 1;
            }
          } else if (c.t && c.v != null) {
            y.t = c.t;
            y.v = c.v;
            if (c.rich) y.rich = c.rich;
          }
          if (c.s) y.s = c.s;
          if (Object.keys(y).length) map.set(key, y);
        }
        const x = extras(this.doc, id);
        if (s.merges?.length) x.set('merges', s.merges.map(parseRange).filter((r): r is Range => !!r).map((r) => this.idRange(id, r)));
        if (s.autoFilter) {
          const range = parseRange(s.autoFilter.ref);
          if (range) this.setFilter(id, { range, columns: s.autoFilter.columns ?? [], raw: s.autoFilter.raw });
        }
        if (s.validations?.length) this.setValidations(id, s.validations);
        if (s.condFormats?.length) this.setCondFormats(id, s.condFormats);
        if (s.hyperlinks?.length) this.setHyperlinks(id, s.hyperlinks);
        if (s.notes?.length) x.set('notes', s.notes.map((n) => ({ ...n, r: this.rowKey(id, n.r), c: this.colKey(id, n.c) })));
        const tables = (s.tables ?? []).flatMap(({ ref, ...t }) => {
          const r = parseRange(ref);
          return r ? [{ ...t, range: this.idRange(id, r) }] : [];
        });
        if (tables.length) x.set('tables', tables);
        if (s.drawings?.length) x.set('drawings', s.drawings.map((d) => this.toYDrawing(id, d)));
      }
      m.set('source', wb.source ?? 'new');
      if (wb.csv) m.set('csv', wb.csv);
      if (wb.preserved?.length) m.set('preserved', wb.preserved);
      if (wb.date1904) m.set('date1904', true);
      m.set('baseStyles', wb.baseStyles ?? wb.styles.length);
      if (title) m.set('title', title);
      m.set('seeded', true);
    });
    return true;
  }

  /** Replace the whole content by another workbook in one transaction (version restore). */
  replaceWith(wb: Workbook) {
    this.doc.transact(() => {
      for (const [name, type] of this.doc.share) {
        if (name === 'meta') continue;
        if (type instanceof Y.Map) type.clear();
        else if (type instanceof Y.Array) type.delete(0, type.length);
      }
      const m = meta(this.doc);
      const title = m.get('title') as string | undefined;
      m.clear();
      this.rowIdx.clear();
      this.colIdx.clear();
      this.styleKeys = null;
      this.seed(wb, title);
    });
  }

  /** The workbook JSON for the engine and the codec (A1, current order). */
  toWorkbook(): Workbook {
    const m = meta(this.doc);
    const sheets: Sheet[] = this.sheetIds().map((id) => this.sheetJson(id));
    const styles = stylesArr(this.doc).toArray();
    return {
      sheets,
      names: this.names(),
      styles: styles.length ? styles : [DEFAULT_STYLE],
      baseStyles: (m.get('baseStyles') as number) ?? styles.length,
      dxfs: dxfsArr(this.doc).toArray(),
      preserved: (m.get('preserved') as Preserved[]) ?? [],
      date1904: !!m.get('date1904'),
      activeSheet: 0,
      source: (m.get('source') as Source) ?? 'new',
      ...(m.get('csv') ? { csv: m.get('csv') as CsvDialect } : {}),
    };
  }

  sheetJson(id: string): Sheet {
    const p = this.props(id);
    const cells: Cell[] = [];
    for (const { r, c, cell } of this.cells(id)) {
      const out: Cell = { r, c };
      if (cell.f) {
        out.f = decodeFormula(cell.f, id, this);
        if (cell.aw && cell.ah) out.a = rangeA1({ r0: r, c0: c, r1: r + cell.ah - 1, c1: c + cell.aw - 1 });
      } else if (cell.t && cell.v != null) {
        out.t = cell.t;
        out.v = cell.v;
        if (cell.rich) out.rich = cell.rich;
      }
      if (cell.s) out.s = cell.s;
      cells.push(out);
    }
    const lines = (kind: 'row' | 'col') => {
      const metaMap = kind === 'row' ? rowMeta(this.doc, id) : colMeta(this.doc, id);
      const out: Array<{ i: number; m: LineMeta }> = [];
      for (const [key, lm] of metaMap.entries()) {
        const i = kind === 'row' ? this.rowIndex(id, key) : this.colIndex(id, key);
        if (i != null) out.push({ i, m: lm });
      }
      return out.sort((a, b) => a.i - b.i);
    };
    const rows = lines('row').map(({ i, m }) => clean({ r: i, height: m.size, hidden: m.hidden || undefined, style: m.style, outline: m.outline || undefined }) as { r: number });
    // Columns: merge neighbours with the same settings into <col min max>.
    const cols: Array<{ min: number; max: number; width?: number; hidden?: boolean; style?: number; outline?: number }> = [];
    for (const { i, m } of lines('col')) {
      const last = cols[cols.length - 1];
      const same = last && last.max === i - 1 && last.width === m.size && !!last.hidden === !!m.hidden && last.style === m.style && (last.outline ?? 0) === (m.outline ?? 0);
      if (same) last.max = i;
      else cols.push(clean({ min: i, max: i, width: m.size, hidden: m.hidden || undefined, style: m.style, outline: m.outline || undefined }) as { min: number; max: number });
    }
    const tail = sheetMap(this.doc, id).get('tailColStyle') as number | undefined;
    if (tail) cols.push({ min: this.colCount(id), max: MAX_COLS - 1, style: tail });
    const filter = this.filter(id);
    return {
      id,
      name: p.name,
      state: p.state,
      ...(p.tabColor ? { tabColor: p.tabColor } : {}),
      cells,
      cols,
      rows,
      defaultColWidth: p.defaultColWidth,
      defaultRowHeight: p.defaultRowHeight,
      merges: this.merges(id).map(rangeA1),
      frozenRows: p.frozenRows,
      frozenCols: p.frozenCols,
      zoom: p.zoom,
      showGrid: p.showGrid,
      ...(filter ? { autoFilter: filter } : {}),
      validations: this.validations(id),
      condFormats: this.condFormats(id),
      hyperlinks: this.hyperlinks(id),
      notes: this.notes(id),
      tables: this.tables(id),
      drawings: this.drawings(id),
    };
  }
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k];
  return o;
}

/** Stable key for style de-duplication (property order independent). */
function styleKey(s: CellStyle): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined && x !== false && !(typeof x === 'object' && x && !Array.isArray(x) && !Object.keys(x).length))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, sort(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(s));
}

