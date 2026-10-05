/**
 * The spreadsheet editor's state and commands, shared by the grid, the
 * formula bar, the toolbar, the menus and the sheet tabs. Everything that
 * changes the workbook goes through the Y.Doc (one transaction per command,
 * so one undo step); everything else (selection, editing) lives here.
 */
import * as Y from 'yjs';
import { MAX_COLS, MAX_ROWS, a1, inRange, normalize, quoteSheet, rangeA1, type Range } from '../model/a1';
import { cssHex, parseHTML, parseTSV, toHTML, toTSV, type ClipCell } from '../model/clipboard';
import { fillLine, type FillSource } from '../model/fill';
import { cycleAbsolute, shiftFormula } from '../model/formula';
import { DEFAULT_STYLE, type CellOut, type CellStyle, type Color } from '../model/types';
import { SheetDoc, colMeta, parseInput, rowMeta, type CellEdit, type YCell } from '../model/ydoc';
import type { ChartSpec } from '@oel/charts';
import type { CalcClient } from '../calc/client';
import { Axis, colWidthPx, rowHeightPx } from '../grid/geometry';
import { clampPos, current, cycleInside, extendTo, jump, movingCorner, single, type Pos, type Selection } from '../grid/selection';

export interface EditState {
  text: string;
  /** Caret position in `text`. */
  cursor: number;
  /** Where typing happens: in the cell, or in the formula bar. */
  where: 'cell' | 'bar';
  /** F2 « modifier » (arrows move the caret) vs « entrer » (arrows commit and move, Excel). */
  mode: 'enter' | 'edit';
  /** The reference being pointed at with arrows/mouse while typing a formula. */
  point: { start: number; end: number; anchor: Pos; at: Pos; sheet: string } | null;
}

interface InternalClip {
  sheet: string;
  range: Range;
  cells: Array<Array<{ y?: YCell; f?: string }>>;
  text: string;
  cut: boolean;
}

export interface CellView {
  text: string;
  kind: '' | 'n' | 's' | 'b' | 'e';
  style: CellStyle;
  styleId: number;
  formula: boolean;
}

const COLOR = (css: string): Color => ({ css, rgb: `FF${css.replace('#', '').toUpperCase()}` });

/** Number formats offered in the toolbar and the Format menu (Excel codes; display follows them). */
export const NUMBER_FORMATS: Array<{ id: string; label: string; code: string; example: string }> = [
  { id: 'general', label: 'Automatique', code: 'General', example: '1234.5' },
  { id: 'number', label: 'Nombre', code: '#,##0.00', example: '1,234.50' },
  { id: 'integer', label: 'Nombre entier', code: '#,##0', example: '1,235' },
  { id: 'percent', label: 'Pourcentage', code: '0.00%', example: '12.34%' },
  { id: 'currency', label: 'Monétaire ($ CA)', code: '#,##0.00 "$"', example: '1,234.50 $' },
  { id: 'currency-us', label: 'Monétaire ($ devant)', code: '"$"#,##0.00', example: '$1,234.50' },
  { id: 'accounting', label: 'Comptabilité', code: '_-* #,##0.00 "$"_-;-* #,##0.00 "$"_-;_-* "-"?? "$"_-;_-@_-', example: '1,234.50 $' },
  { id: 'date', label: 'Date', code: 'yyyy-mm-dd', example: '2026-10-03' },
  { id: 'date-long', label: 'Date longue', code: 'd mmmm yyyy', example: '3 October 2026' },
  { id: 'time', label: 'Heure', code: 'h:mm', example: '14:30' },
  { id: 'datetime', label: 'Date et heure', code: 'yyyy-mm-dd h:mm', example: '2026-10-03 14:30' },
  { id: 'scientific', label: 'Scientifique', code: '0.00E+00', example: '1.23E+03' },
  { id: 'text', label: 'Texte', code: '@', example: 'texte' },
];

/** Excel's 1900 date system: serial for a JS date (local day). */
const serialOf = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;

export class SheetController {
  readonly undo: Y.UndoManager;
  sheetId: string;
  sel: Selection = single({ r: 0, c: 0 });
  edit: EditState | null = null;
  copyMark: { sheet: string; range: Range; cut: boolean } | null = null;
  showFormulas = false;
  /** Bumped on every change the views care about. */
  version = 0;
  private listeners = new Set<() => void>();
  private clip: InternalClip | null = null;
  private axes = new Map<string, { rows: Axis; cols: Axis; v: number }>();
  private geoVersion = 0;
  private selections = new Map<string, Selection>();
  private onTx = (tr: Y.Transaction) => this.afterTransaction(tr);

  constructor(
    readonly doc: SheetDoc,
    readonly calc: CalcClient,
  ) {
    const first = doc.sheetIds().find((id) => doc.props(id).state === 'visible') ?? doc.sheetIds()[0] ?? '';
    this.sheetId = first;
    this.undo = new Y.UndoManager([...doc.doc.share.values()], { captureTimeout: 400 });
    doc.doc.on('afterTransaction', this.onTx);
    calc.subscribe(() => this.bump());
  }

  // ----- store -------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  bump() {
    this.version++;
    for (const l of this.listeners) l();
  }

  private afterTransaction(tr: Y.Transaction) {
    // New shared types (a new sheet) join the undo scope.
    for (const t of this.doc.doc.share.values()) this.undo.addToScope(t);
    const names = new Map<unknown, string>();
    for (const [n, t] of this.doc.doc.share) names.set(t, n);
    for (const type of tr.changed.keys()) {
      const n = names.get(type) ?? '';
      if (/^(rowMeta|colMeta|rows|cols|sheet):/.test(n)) this.geoVersion++;
    }
    if (!this.doc.sheetIds().includes(this.sheetId)) this.sheetId = this.doc.sheetIds()[0] ?? '';
    this.bump();
  }

  dispose() {
    this.doc.doc.off('afterTransaction', this.onTx);
    this.undo.destroy();
    this.listeners.clear();
  }

  // ----- sheets --------------------------------------------------------------

  get sheetIndex() {
    return this.doc.sheetIds().indexOf(this.sheetId);
  }

  get props() {
    return this.doc.props(this.sheetId);
  }

  setSheet(id: string) {
    if (id === this.sheetId) return;
    this.commitEdit(null);
    this.selections.set(this.sheetId, this.sel);
    this.sheetId = id;
    this.selectedDrawing = null;
    this.sel = this.selections.get(id) ?? single({ r: 0, c: 0 });
    this.bump();
  }

  /** Ctrl+PgUp / Ctrl+PgDn: previous / next visible sheet. */
  stepSheet(d: 1 | -1) {
    const vis = this.doc.sheetIds().filter((id) => this.doc.props(id).state === 'visible');
    const i = vis.indexOf(this.sheetId);
    const next = vis[i + d];
    if (next) this.setSheet(next);
  }

  // ----- geometry ------------------------------------------------------------

  /** Row and column axes in CSS pixels at 100 % (zoom applied by the grid). */
  geometry(sheet = this.sheetId): { rows: Axis; cols: Axis } {
    const cached = this.axes.get(sheet);
    if (cached && cached.v === this.geoVersion) return cached;
    const p = this.doc.props(sheet);
    const rowsO = new Map<number, number>();
    const colsO = new Map<number, number>();
    for (const [id, m] of rowMeta(this.doc.doc, sheet).entries()) {
      const r = this.doc.rowIndex(sheet, id);
      if (r != null && (m.hidden || m.size != null)) rowsO.set(r, m.hidden ? 0 : rowHeightPx(m.size!));
    }
    for (const [id, m] of colMeta(this.doc.doc, sheet).entries()) {
      const c = this.doc.colIndex(sheet, id);
      if (c != null && (m.hidden || m.size != null)) colsO.set(c, m.hidden ? 0 : colWidthPx(m.size!));
    }
    const g = { rows: new Axis(rowHeightPx(p.defaultRowHeight), MAX_ROWS, rowsO), cols: new Axis(colWidthPx(p.defaultColWidth), MAX_COLS, colsO), v: this.geoVersion };
    this.axes.set(sheet, g);
    return g;
  }

  // ----- reading cells -------------------------------------------------------

  styleAt(r: number, c: number, sheet = this.sheetId): { style: CellStyle; id: number } {
    const y = this.doc.getCell(sheet, r, c);
    const id = y?.s ?? this.doc.rowSize(sheet, r)?.style ?? this.doc.colSize(sheet, c)?.style ?? 0;
    return { style: this.doc.style(id), id };
  }

  view(r: number, c: number, sheet = this.sheetId): CellView {
    const y = this.doc.getCell(sheet, r, c);
    const { style, id } = this.styleAt(r, c, sheet);
    const si = this.doc.sheetIds().indexOf(sheet);
    if (this.showFormulas && y?.f) return { text: `=${this.doc.formulaText(sheet, y)}`, kind: 's', style, styleId: id, formula: true };
    const out: CellOut | undefined = this.calc.get(si, r, c);
    if (out) return { text: out.text, kind: out.t, style, styleId: id, formula: !!y?.f };
    if (y && !y.f && y.v != null) return { text: y.t === 'b' ? (y.v ? 'TRUE' : 'FALSE') : String(y.v), kind: (y.t ?? 's') as CellView['kind'], style, styleId: id, formula: false };
    return { text: '', kind: '', style, styleId: id, formula: !!y?.f };
  }

  /** Something is in the cell (value or formula). */
  filled = (r: number, c: number, sheet = this.sheetId): boolean => {
    const y = this.doc.getCell(sheet, r, c);
    return !!y && (!!y.f || y.v != null);
  };

  numberAt(r: number, c: number): number | null {
    const out = this.calc.get(this.sheetIndex, r, c);
    return out && out.t === 'n' && typeof out.v === 'number' ? out.v : null;
  }

  // ----- selection -------------------------------------------------------------

  select(sel: Selection) {
    this.sel = sel;
    this.selectedDrawing = null;
    this.bump();
  }

  /** A picture, shape or chart selected over the grid (index in `doc.drawings`), or null. */
  selectedDrawing: number | null = null;

  selectDrawing(index: number | null) {
    this.selectedDrawing = index;
    this.bump();
  }

  /** The merged area a cell belongs to, if any. */
  mergeAt(r: number, c: number): Range | null {
    return this.doc.merges(this.sheetId).find((m) => inRange(m, r, c)) ?? null;
  }

  /** Arrow keys (Shift extends, Ctrl jumps to the data edge). */
  move(dr: number, dc: number, opts: { extend?: boolean; jump?: boolean } = {}) {
    const { rows, cols } = this.geometry();
    const from = opts.extend ? movingCorner(this.sel) : this.sel.active;
    let to: Pos;
    if (opts.jump) {
      to = jump(from, dr, dc, (r, c) => this.filled(r, c), { r: MAX_ROWS - 1, c: MAX_COLS - 1 });
    } else {
      // Step out of a merged area as a whole.
      const m = this.mergeAt(from.r, from.c);
      const base = m && !opts.extend ? { r: dr > 0 ? m.r1 : dr < 0 ? m.r0 : from.r, c: dc > 0 ? m.c1 : dc < 0 ? m.c0 : from.c } : from;
      to = { r: dr ? rows.step(base.r, dr > 0 ? 1 : -1) : base.r, c: dc ? cols.step(base.c, dc > 0 ? 1 : -1) : base.c };
    }
    to = clampPos(to);
    if (opts.extend) this.select(extendTo(this.sel, to));
    else {
      const m = this.mergeAt(to.r, to.c);
      this.select(m ? { ranges: [m], active: { r: m.r0, c: m.c0 }, anchor: { r: m.r0, c: m.c0 } } : single(to));
    }
  }

  /** Enter/Tab: inside a selection they cycle through it, otherwise they move. */
  advance(dir: 'down' | 'up' | 'right' | 'left') {
    const inside = cycleInside(this.sel, dir);
    if (inside) return this.select(inside);
    const d = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[dir];
    this.move(d[0]!, d[1]!);
  }

  selectAll() {
    this.select({ ranges: [{ r0: 0, c0: 0, r1: MAX_ROWS - 1, c1: MAX_COLS - 1 }], active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 } });
  }

  selectRows() {
    const r = current(this.sel);
    this.select({ ...this.sel, ranges: [...this.sel.ranges.slice(0, -1), { r0: r.r0, c0: 0, r1: r.r1, c1: MAX_COLS - 1 }] });
  }

  selectCols() {
    const r = current(this.sel);
    this.select({ ...this.sel, ranges: [...this.sel.ranges.slice(0, -1), { r0: 0, c0: r.c0, r1: MAX_ROWS - 1, c1: r.c1 }] });
  }

  /** Go to a reference typed in the name box (`B12`, `A1:C4`, `Feuil2!A1`, a defined name). */
  goTo(text: string): boolean {
    let t = text.trim();
    let sheet = this.sheetId;
    const named = this.doc.names().find((n) => n.name.toLowerCase() === t.toLowerCase());
    if (named) t = named.formula;
    const bang = t.lastIndexOf('!');
    if (bang > 0) {
      const name = t.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'");
      const id = this.doc.sheetIdByName(name);
      if (!id) return false;
      sheet = id;
      t = t.slice(bang + 1);
    }
    const r = parseRangeLoose(t);
    if (!r) return false;
    this.setSheet(sheet);
    this.select({ ranges: [r], active: { r: r.r0, c: r.c0 }, anchor: { r: r.r0, c: r.c0 } });
    return true;
  }

  /** Data region around the active cell (Ctrl+A in data, filters, sort). */
  currentRegion(): Range {
    const { r, c } = this.sel.active;
    let reg: Range = { r0: r, c0: c, r1: r, c1: c };
    for (let changed = true; changed; ) {
      changed = false;
      const grow = (test: () => boolean, apply: () => void) => {
        if (test()) {
          apply();
          changed = true;
        }
      };
      const rowFilled = (row: number) => row >= 0 && Array.from({ length: reg.c1 - reg.c0 + 3 }, (_, k) => reg.c0 - 1 + k).some((cc) => cc >= 0 && this.filled(row, cc));
      const colFilled = (col: number) => col >= 0 && Array.from({ length: reg.r1 - reg.r0 + 3 }, (_, k) => reg.r0 - 1 + k).some((rr) => rr >= 0 && this.filled(rr, col));
      grow(() => reg.r0 > 0 && rowFilled(reg.r0 - 1), () => (reg = { ...reg, r0: reg.r0 - 1 }));
      grow(() => rowFilled(reg.r1 + 1), () => (reg = { ...reg, r1: reg.r1 + 1 }));
      grow(() => reg.c0 > 0 && colFilled(reg.c0 - 1), () => (reg = { ...reg, c0: reg.c0 - 1 }));
      grow(() => colFilled(reg.c1 + 1), () => (reg = { ...reg, c1: reg.c1 + 1 }));
      if (reg.r1 - reg.r0 > 100_000) break;
    }
    return reg;
  }

  // ----- editing -------------------------------------------------------------

  get readOnly() {
    return this.readOnlyFlag;
  }
  readOnlyFlag = false;

  /** F2 / double-click (keep content) or typing (replace content). */
  startEdit(initial?: string, where: EditState['where'] = 'cell') {
    if (this.readOnlyFlag) return;
    const { r, c } = this.sel.active;
    const text = initial ?? this.doc.inputText(this.sheetId, r, c);
    this.edit = { text, cursor: text.length, where, mode: initial == null ? 'edit' : 'enter', point: null };
    this.bump();
  }

  setEditText(text: string, cursor: number) {
    if (!this.edit) return;
    this.edit = { ...this.edit, text, cursor, point: null };
    this.bump();
  }

  /** In a formula, is the caret where a reference can be pointed at? */
  canPoint(): boolean {
    const e = this.edit;
    if (!e || !e.text.startsWith('=') || e.mode === 'edit') return false;
    if (e.point && e.cursor === e.point.end) return true;
    return /[=(,;+\-*/^&<>:\s]$/.test(e.text.slice(0, e.cursor));
  }

  /** Point at a cell/range with arrows or the mouse (inserts or updates the reference). */
  pointTo(to: Pos, extend = false) {
    const e = this.edit;
    if (!e) return;
    const p = e.point;
    const anchor = extend && p ? p.anchor : to;
    const range = normalize({ r0: anchor.r, c0: anchor.c, r1: to.r, c1: to.c });
    const prefix = this.pointSheet && this.pointSheet !== this.editSheet ? `${quoteSheet(this.doc.props(this.pointSheet).name)}!` : '';
    const ref = prefix + rangeA1(range);
    const start = p && e.cursor === p.end ? p.start : e.cursor;
    const end = p && e.cursor === p.end ? p.end : e.cursor;
    const text = e.text.slice(0, start) + ref + e.text.slice(end);
    this.edit = { ...e, text, cursor: start + ref.length, point: { start, end: start + ref.length, anchor, at: to, sheet: this.pointSheet ?? this.sheetId } };
    this.bump();
  }

  /** Sheet being pointed at (pointing can cross sheets while the edit stays on its cell). */
  pointSheet: string | null = null;
  editSheet: string | null = null;

  /** F4 while editing: cycle `$` on the reference at the caret. */
  cycleRef() {
    const e = this.edit;
    if (!e || !e.text.startsWith('=')) return;
    const out = cycleAbsolute(e.text.slice(1), Math.max(0, e.cursor - 1));
    this.edit = { ...e, text: `=${out.text}`, cursor: out.cursor + 1, point: null };
    this.bump();
  }

  cancelEdit() {
    this.edit = null;
    this.pointSheet = null;
    this.bump();
  }

  /**
   * Validate the edit. `move`: where the active cell goes next (Enter/Tab), or
   * null to stay. `all` (Ctrl+Entrée) writes into every selected cell;
   * `array` (Ctrl+Maj+Entrée) makes an array formula over the selection.
   */
  /** Data validation: returns why a typed value is refused, or null (set by the editor). */
  validator: ((r: number, c: number, text: string) => string | null) | null = null;
  /** Messages for the person (refused values…), shown by the editor as toasts. */
  onNotice: ((title: string, description?: string) => void) | null = null;
  /** « Lier dans… » on a chart (Figma G2): the host lists the files that can take a linked copy. Null hides nothing, it disables the button. */
  onLinkChart: ((chart: { sheetId: string; chartId: string; name: string; spec: ChartSpec }) => void) | null = null;

  commitEdit(move: 'down' | 'up' | 'right' | 'left' | null, opts: { all?: boolean; array?: boolean } = {}) {
    const e = this.edit;
    if (!e) return;
    const { r, c } = this.sel.active;
    const refused = !e.text.startsWith('=') ? this.validator?.(r, c, e.text) : null;
    if (refused) {
      // Excel's « Arrêt »: the value is refused and the edit stays open.
      this.onNotice?.('Valeur refusée', refused);
      this.bump();
      return;
    }
    this.edit = null;
    this.pointSheet = null;
    const range = current(this.sel);
    // Autocomplete the missing closing parentheses, as Excel does.
    let text = e.text;
    if (text.startsWith('=')) {
      let depth = 0;
      let inStr = false;
      for (const ch of text) {
        if (ch === '"') inStr = !inStr;
        else if (!inStr && ch === '(') depth++;
        else if (!inStr && ch === ')') depth--;
      }
      if (depth > 0) text += ')'.repeat(depth);
    }
    this.doc.doc.transact(() => {
      if (opts.array && text.startsWith('=')) {
        this.doc.setCells(this.sheetId, [{ r: range.r0, c: range.c0, cell: { f: text.slice(1), aw: range.c1 - range.c0 + 1, ah: range.r1 - range.r0 + 1 } }]);
      } else if (opts.all && (range.r0 !== range.r1 || range.c0 !== range.c1)) {
        const edits: CellEdit[] = [];
        for (let rr = range.r0; rr <= Math.min(range.r1, range.r0 + 10_000); rr++)
          for (let cc = range.c0; cc <= Math.min(range.c1, range.c0 + 500); cc++) {
            const t = text.startsWith('=') ? `=${shiftFormula(text.slice(1), rr - r, cc - c)}` : text;
            const p = parseInput(t);
            edits.push({ r: rr, c: cc, cell: p.f != null ? { f: p.f } : p.t ? { t: p.t, v: p.v } : null });
          }
        this.doc.setCells(this.sheetId, edits);
      } else {
        this.doc.setInput(this.sheetId, r, c, text);
      }
    });
    if (move) this.advance(move);
    else this.bump();
  }

  // ----- clearing and formatting -----------------------------------------------

  /** Delete / Backspace: clear values (formats stay), as in Excel. */
  clearValues() {
    if (this.readOnlyFlag) return;
    this.doc.doc.transact(() => {
      for (const rg of this.sel.ranges) {
        const edits: CellEdit[] = [];
        for (const { r, c } of this.doc.cells(this.sheetId)) if (inRange(rg, r, c)) edits.push({ r, c, cell: null });
        this.doc.setCells(this.sheetId, edits);
      }
    });
  }

  /** Reproduire la mise en forme: a style held until the next selection is made. */
  painter: CellStyle | null = null;

  togglePainter() {
    this.painter = this.painter ? null : this.activeStyle;
    this.bump();
  }

  /** Apply the held format to the selection; true when there was one. */
  applyPainter(): boolean {
    if (!this.painter) return false;
    const st = this.painter;
    this.painter = null;
    this.format(() => st);
    return true;
  }

  clearFormats() {
    this.format(() => ({ ...DEFAULT_STYLE }));
  }

  /** Change the style of every selected cell. */
  format(change: (s: CellStyle) => CellStyle) {
    if (this.readOnlyFlag) return;
    this.doc.doc.transact(() => {
      for (const rg of this.sel.ranges) this.doc.formatRange(this.sheetId, rg, change);
    });
  }

  /** Style of the active cell (what the toolbar shows). */
  get activeStyle(): CellStyle {
    return this.styleAt(this.sel.active.r, this.sel.active.c).style;
  }

  toggleFont(key: 'bold' | 'italic' | 'strike') {
    const on = !this.activeStyle.font[key];
    this.format((s) => ({ ...s, font: { ...s.font, [key]: on || undefined } }));
  }

  toggleUnderline() {
    const on = !this.activeStyle.font.underline;
    this.format((s) => ({ ...s, font: { ...s.font, underline: on ? 'single' : undefined } }));
  }

  setFont(patch: Partial<CellStyle['font']>) {
    this.format((s) => ({ ...s, font: { ...s.font, ...patch } }));
  }

  setTextColor(css: string | null) {
    this.format((s) => ({ ...s, font: { ...s.font, color: css ? COLOR(css) : undefined } }));
  }

  setFill(css: string | null) {
    this.format((s) => ({ ...s, fill: css ? COLOR(css) : undefined }));
  }

  setAlign(patch: Partial<CellStyle['align']>) {
    this.format((s) => ({ ...s, align: { ...s.align, ...patch } }));
  }

  setNumFmt(code: string) {
    this.format((s) => ({ ...s, numFmt: code }));
  }

  /** Add or remove one decimal on the selection's number format. */
  stepDecimals(d: 1 | -1) {
    const code = this.activeStyle.numFmt;
    const base = code === 'General' ? (() => {
      const v = this.numberAt(this.sel.active.r, this.sel.active.c);
      const dec = v == null ? 0 : (String(v).split('.')[1]?.length ?? 0);
      return dec ? `0.${'0'.repeat(dec)}` : '0';
    })() : code;
    const next = base.replace(/0(\.0*)?(?=[^0.]*$|%|E|\s|")/, (m) => {
      const dec = m.includes('.') ? m.length - 2 : 0;
      const n = Math.max(0, dec + d);
      return n ? `0.${'0'.repeat(n)}` : '0';
    });
    this.setNumFmt(next === base && d > 0 ? `${base}.0` : next);
  }

  /** Borders: `all`, `outer`, `bottom`, `top`, `left`, `right`, `none`. */
  setBorders(kind: 'all' | 'outer' | 'bottom' | 'top' | 'left' | 'right' | 'none', style = 'thin') {
    if (this.readOnlyFlag) return;
    const side = { style, color: COLOR('#000000') };
    this.doc.doc.transact(() => {
      for (const rg of this.sel.ranges) {
        const each = (r0: number, c0: number, r1: number, c1: number, fn: (s: CellStyle) => CellStyle) => this.doc.formatRange(this.sheetId, { r0, c0, r1, c1 }, fn);
        const set = (keys: Array<'left' | 'right' | 'top' | 'bottom'>, on: boolean) => (s: CellStyle) => {
          const b = { ...s.border };
          for (const k of keys) b[k] = on ? side : undefined;
          return { ...s, border: b };
        };
        const { r0, c0, r1, c1 } = rg;
        if (kind === 'none') each(r0, c0, r1, c1, set(['left', 'right', 'top', 'bottom'], false));
        else if (kind === 'all') each(r0, c0, r1, c1, set(['left', 'right', 'top', 'bottom'], true));
        else if (kind === 'outer') {
          each(r0, c0, r0, c1, set(['top'], true));
          each(r1, c0, r1, c1, set(['bottom'], true));
          each(r0, c0, r1, c0, set(['left'], true));
          each(r0, c1, r1, c1, set(['right'], true));
        } else if (kind === 'bottom') each(r1, c0, r1, c1, set(['bottom'], true));
        else if (kind === 'top') each(r0, c0, r0, c1, set(['top'], true));
        else if (kind === 'left') each(r0, c0, r1, c0, set(['left'], true));
        else if (kind === 'right') each(r0, c1, r1, c1, set(['right'], true));
      }
    });
  }

  // ----- merges, sizes, freeze, structure ------------------------------------

  merge(center = false) {
    if (this.readOnlyFlag) return;
    const rg = current(this.sel);
    if (rg.r0 === rg.r1 && rg.c0 === rg.c1) return;
    this.doc.doc.transact(() => {
      const others = this.doc.merges(this.sheetId).filter((m) => !(m.r0 <= rg.r1 && rg.r0 <= m.r1 && m.c0 <= rg.c1 && rg.c0 <= m.c1));
      this.doc.setMerges(this.sheetId, [...others, rg]);
      // Excel keeps the top-left value only.
      const edits: CellEdit[] = [];
      for (const { r, c } of this.doc.cells(this.sheetId)) if (inRange(rg, r, c) && !(r === rg.r0 && c === rg.c0)) edits.push({ r, c, cell: null });
      this.doc.setCells(this.sheetId, edits);
      if (center) this.doc.formatRange(this.sheetId, rg, (s) => ({ ...s, align: { ...s.align, h: 'center' } }));
    });
    this.select({ ranges: [rg], active: { r: rg.r0, c: rg.c0 }, anchor: { r: rg.r0, c: rg.c0 } });
  }

  unmerge() {
    const rg = current(this.sel);
    this.doc.setMerges(this.sheetId, this.doc.merges(this.sheetId).filter((m) => !(m.r0 <= rg.r1 && rg.r0 <= m.r1 && m.c0 <= rg.c1 && rg.c0 <= m.c1)));
  }

  /** Width in characters for selected (or given) columns. */
  setColWidth(chars: number, cols?: [number, number]) {
    const rg = current(this.sel);
    const [a, b] = cols ?? [rg.c0, Math.min(rg.c1, this.doc.colCount(this.sheetId) + 100)];
    this.doc.setColMeta(this.sheetId, a, b, { size: chars, hidden: undefined });
  }

  /** Height in points for selected (or given) rows. */
  setRowHeight(pt: number, rows?: [number, number]) {
    const rg = current(this.sel);
    const [a, b] = rows ?? [rg.r0, Math.min(rg.r1, this.doc.rowCount(this.sheetId) + 500)];
    this.doc.setRowMeta(this.sheetId, a, b, { size: pt, hidden: undefined });
  }

  hideRows(hidden: boolean) {
    const rg = current(this.sel);
    this.doc.setRowMeta(this.sheetId, rg.r0, Math.min(rg.r1, this.doc.rowCount(this.sheetId) + 500), { hidden: hidden || undefined });
  }

  hideCols(hidden: boolean) {
    const rg = current(this.sel);
    this.doc.setColMeta(this.sheetId, rg.c0, Math.min(rg.c1, this.doc.colCount(this.sheetId) + 100), { hidden: hidden || undefined });
  }

  /** Freeze above and left of the active cell; `rows`/`cols` to set them directly. */
  freeze(rows?: number, cols?: number) {
    const { r, c } = this.sel.active;
    this.doc.setProps(this.sheetId, { frozenRows: rows ?? r, frozenCols: cols ?? c });
  }

  insertRows(where: 'above' | 'below') {
    const rg = current(this.sel);
    const n = Math.min(rg.r1 - rg.r0 + 1, 1000);
    this.doc.insertRows(this.sheetId, where === 'above' ? rg.r0 : rg.r1 + 1, n);
  }

  insertCols(where: 'left' | 'right') {
    const rg = current(this.sel);
    const n = Math.min(rg.c1 - rg.c0 + 1, 200);
    this.doc.insertCols(this.sheetId, where === 'left' ? rg.c0 : rg.c1 + 1, n);
  }

  deleteRows() {
    const rg = current(this.sel);
    this.doc.deleteRows(this.sheetId, rg.r0, Math.min(rg.r1, this.doc.rowCount(this.sheetId)) - rg.r0 + 1);
  }

  deleteCols() {
    const rg = current(this.sel);
    this.doc.deleteCols(this.sheetId, rg.c0, Math.min(rg.c1, this.doc.colCount(this.sheetId)) - rg.c0 + 1);
  }

  // ----- fill ------------------------------------------------------------------

  /** Fill from the current range to `target` (the fill handle's drop), along one axis. */
  fillTo(target: Range) {
    if (this.readOnlyFlag) return;
    const src = current(this.sel);
    const vertical = target.c0 === src.c0 && target.c1 === src.c1;
    const edits: CellEdit[] = [];
    const sourceOf = (r: number, c: number): FillSource => {
      const y = this.doc.getCell(this.sheetId, r, c);
      const { style, id } = this.styleAt(r, c);
      return { ...(y?.f ? { f: this.doc.formulaText(this.sheetId, y) } : y?.t ? { t: y.t, v: y.v } : {}), s: id, numFmt: style.numFmt };
    };
    if (vertical) {
      const down = target.r1 > src.r1;
      const count = down ? target.r1 - src.r1 : src.r0 - target.r0;
      for (let c = src.c0; c <= src.c1; c++) {
        const line = Array.from({ length: src.r1 - src.r0 + 1 }, (_, k) => sourceOf(src.r0 + k, c));
        fillLine(line, count, !down, { dr: 1, dc: 0 }).forEach((res, k) => {
          const r = down ? src.r1 + 1 + k : src.r0 - 1 - k;
          edits.push({ r, c, cell: res ? (res.f != null ? { f: res.f } : res.t ? { t: res.t, v: res.v } : null) : null, s: res?.s ?? 0 });
        });
      }
    } else {
      const right = target.c1 > src.c1;
      const count = right ? target.c1 - src.c1 : src.c0 - target.c0;
      for (let r = src.r0; r <= src.r1; r++) {
        const line = Array.from({ length: src.c1 - src.c0 + 1 }, (_, k) => sourceOf(r, src.c0 + k));
        fillLine(line, count, !right, { dr: 0, dc: 1 }).forEach((res, k) => {
          const c = right ? src.c1 + 1 + k : src.c0 - 1 - k;
          edits.push({ r, c, cell: res ? (res.f != null ? { f: res.f } : res.t ? { t: res.t, v: res.v } : null) : null, s: res?.s ?? 0 });
        });
      }
    }
    this.doc.setCells(this.sheetId, edits);
    const all = normalize({ r0: Math.min(src.r0, target.r0), c0: Math.min(src.c0, target.c0), r1: Math.max(src.r1, target.r1), c1: Math.max(src.c1, target.c1) });
    this.select({ ...this.sel, ranges: [all] });
  }

  /** Ctrl+D / Ctrl+R: copy the first row (column) of the selection down (right). */
  fillDown(right = false) {
    const rg = current(this.sel);
    const first: Range = right ? { ...rg, c1: rg.c0 } : { ...rg, r1: rg.r0 };
    if ((right ? rg.c1 === rg.c0 : rg.r1 === rg.r0) && (right ? rg.c0 > 0 : rg.r0 > 0)) {
      // One line selected: copy from the line before it.
      const prev: Range = right ? { ...rg, c0: rg.c0 - 1, c1: rg.c0 - 1 } : { ...rg, r0: rg.r0 - 1, r1: rg.r0 - 1 };
      this.copyBlock(prev, { r: rg.r0, c: rg.c0 }, right ? { r: rg.r1 - rg.r0 + 1, c: 1 } : { r: 1, c: rg.c1 - rg.c0 + 1 });
      return;
    }
    const size = right ? { r: rg.r1 - rg.r0 + 1, c: rg.c1 - rg.c0 } : { r: rg.r1 - rg.r0, c: rg.c1 - rg.c0 + 1 };
    this.copyBlock(first, right ? { r: rg.r0, c: rg.c0 + 1 } : { r: rg.r0 + 1, c: rg.c0 }, size);
  }

  /** Copy a block (formulas moved, styles kept) into a target area, tiling it. */
  private copyBlock(src: Range, at: Pos, size: { r: number; c: number }) {
    const h = src.r1 - src.r0 + 1;
    const w = src.c1 - src.c0 + 1;
    const edits: CellEdit[] = [];
    for (let i = 0; i < size.r; i++)
      for (let j = 0; j < size.c; j++) {
        const sr = src.r0 + (i % h);
        const sc = src.c0 + (j % w);
        const y = this.doc.getCell(this.sheetId, sr, sc);
        const r = at.r + i;
        const c = at.c + j;
        const f = y?.f ? shiftFormula(this.doc.formulaText(this.sheetId, y)!, r - sr, c - sc) : undefined;
        edits.push({ r, c, cell: f != null ? { f } : y?.t ? { t: y.t, v: y.v } : null, s: y?.s ?? 0 });
      }
    this.doc.setCells(this.sheetId, edits);
  }

  // ----- clipboard ---------------------------------------------------------------

  /** Copy (or cut) the current range: text + HTML for other apps, formulas for us. */
  copy(cut = false): { text: string; html: string } {
    const rg = current(this.sel);
    const r1 = Math.min(rg.r1, rg.r0 + 20_000);
    const c1 = Math.min(rg.c1, rg.c0 + 1_000);
    const texts: string[][] = [];
    const html: ClipCell[][] = [];
    const cells: InternalClip['cells'] = [];
    for (let r = rg.r0; r <= r1; r++) {
      const tr: string[] = [];
      const hr: ClipCell[] = [];
      const cr: InternalClip['cells'][number] = [];
      for (let c = rg.c0; c <= c1; c++) {
        const v = this.view(r, c);
        const y = this.doc.getCell(this.sheetId, r, c);
        tr.push(v.text);
        hr.push({ text: v.text, bold: v.style.font.bold, italic: v.style.font.italic, underline: !!v.style.font.underline, color: v.style.font.color?.css, fill: v.style.fill?.css });
        cr.push({ y, f: y?.f ? this.doc.formulaText(this.sheetId, y) : undefined });
      }
      texts.push(tr);
      html.push(hr);
      cells.push(cr);
    }
    const text = toTSV(texts);
    this.clip = { sheet: this.sheetId, range: { r0: rg.r0, c0: rg.c0, r1, c1 }, cells, text, cut };
    this.copyMark = { sheet: this.sheetId, range: { r0: rg.r0, c0: rg.c0, r1, c1 }, cut };
    this.bump();
    return { text, html: toHTML(html) };
  }

  /**
   * Paste at the selection. Our own copy (same text on the clipboard) keeps
   * formulas, moved relative to the new place, and formats; other sources
   * come in as typed values (numbers, dates…) with their basic formatting.
   * `mode`: everything, values only, formats only, or transposed.
   */
  paste(data: { text?: string; html?: string }, mode: 'all' | 'values' | 'formats' | 'transpose' = 'all') {
    if (this.readOnlyFlag) return;
    const at = { r: current(this.sel).r0, c: current(this.sel).c0 };
    const internal = this.clip && data.text != null && data.text.replace(/\r\n/g, '\n') === this.clip.text.replace(/\r\n/g, '\n') ? this.clip : null;
    const edits: CellEdit[] = [];
    if (internal) {
      const rows = internal.cells;
      for (let i = 0; i < rows.length; i++)
        for (let j = 0; j < rows[i]!.length; j++) {
          const { y, f } = rows[i]![j]!;
          const [di, dj] = mode === 'transpose' ? [j, i] : [i, j];
          const r = at.r + di;
          const c = at.c + dj;
          const sr = internal.range.r0 + i;
          const sc = internal.range.c0 + j;
          let cell: CellEdit['cell'] = undefined;
          if (mode !== 'formats') {
            if (mode === 'values') {
              const v = this.calc.get(this.doc.sheetIds().indexOf(internal.sheet), sr, sc);
              cell = v ? { t: v.t, v: v.v ?? '' } : y?.t ? { t: y.t, v: y.v } : null;
            } else if (f != null) {
              // Cut moves formulas unchanged; copy moves their relative references.
              cell = { f: internal.cut ? f : shiftFormula(f, r - sr, c - sc) };
            } else cell = y?.t ? { t: y.t, v: y.v, ...(y.rich ? { rich: y.rich } : {}) } : null;
          }
          edits.push({ r, c, cell, ...(mode !== 'values' ? { s: y?.s ?? 0 } : {}) });
        }
      this.doc.doc.transact(() => {
        if (internal.cut) {
          const clear: CellEdit[] = [];
          for (let r = internal.range.r0; r <= internal.range.r1; r++) for (let c = internal.range.c0; c <= internal.range.c1; c++) clear.push({ r, c, cell: null, s: 0 });
          this.doc.setCells(internal.sheet, clear);
          this.clip = null;
          this.copyMark = null;
        }
        this.doc.setCells(this.sheetId, edits);
      });
      const h = mode === 'transpose' ? rows[0]!.length : rows.length;
      const w = mode === 'transpose' ? rows.length : rows[0]!.length;
      this.select({ ranges: [{ r0: at.r, c0: at.c, r1: at.r + h - 1, c1: at.c + w - 1 }], active: at, anchor: at });
      return;
    }
    const html = data.html ? parseHTML(data.html) : null;
    const rows: ClipCell[][] = html ?? parseTSV(data.text ?? '').map((r) => r.map((text) => ({ text })));
    if (!rows.length) return;
    this.doc.doc.transact(() => {
      for (let i = 0; i < rows.length; i++)
        for (let j = 0; j < rows[i]!.length; j++) {
          const cc = rows[i]![j]!;
          const [di, dj] = mode === 'transpose' ? [j, i] : [i, j];
          const p = parseInput(cc.text);
          let s: number | undefined;
          if (html && mode !== 'values') {
            const base = this.styleAt(at.r + di, at.c + dj).style;
            const color = cssHex(cc.color);
            const fill = cssHex(cc.fill);
            const st: CellStyle = {
              ...base,
              ...(p.fmt && base.numFmt === 'General' ? { numFmt: p.fmt } : {}),
              font: { ...base.font, bold: cc.bold || undefined, italic: cc.italic || undefined, underline: cc.underline ? 'single' : undefined, ...(color && color !== '#000000' ? { color: COLOR(color) } : {}) },
              ...(fill && fill !== '#FFFFFF' ? { fill: COLOR(fill) } : {}),
            };
            s = this.doc.styleId(st);
          } else if (p.fmt && this.styleAt(at.r + di, at.c + dj).style.numFmt === 'General') {
            s = this.doc.styleId({ ...this.styleAt(at.r + di, at.c + dj).style, numFmt: p.fmt });
          }
          const cell = mode === 'formats' ? undefined : p.f != null ? { f: p.f } : p.t ? { t: p.t, v: p.v } : null;
          edits.push({ r: at.r + di, c: at.c + dj, cell, s });
        }
      this.doc.setCells(this.sheetId, edits);
    });
    const h = mode === 'transpose' ? Math.max(...rows.map((r) => r.length)) : rows.length;
    const w = mode === 'transpose' ? rows.length : Math.max(...rows.map((r) => r.length));
    this.select({ ranges: [{ r0: at.r, c0: at.c, r1: at.r + h - 1, c1: at.c + w - 1 }], active: at, anchor: at });
  }

  clearCopyMark() {
    if (!this.copyMark) return;
    this.copyMark = null;
    this.bump();
  }

  // ----- formulas helpers -------------------------------------------------------

  /** Alt+= : SUM of the numbers above (or to the left of) the active cell. */
  autoSum(fn = 'SUM') {
    const rg = current(this.sel);
    if (rg.r0 !== rg.r1 || rg.c0 !== rg.c1) {
      // A range: totals under each column.
      const edits: CellEdit[] = [];
      for (let c = rg.c0; c <= rg.c1; c++) edits.push({ r: rg.r1 + 1, c, cell: { f: `${fn}(${a1(rg.r0, c)}:${a1(rg.r1, c)})` } });
      this.doc.setCells(this.sheetId, edits);
      return;
    }
    const { r, c } = this.sel.active;
    const num = (rr: number, cc: number) => this.numberAt(rr, cc) != null;
    let range = '';
    if (r > 0 && num(r - 1, c)) {
      let top = r - 1;
      while (top > 0 && num(top - 1, c)) top--;
      range = `${a1(top, c)}:${a1(r - 1, c)}`;
    } else if (c > 0 && num(r, c - 1)) {
      let left = c - 1;
      while (left > 0 && num(r, left - 1)) left--;
      range = `${a1(r, left)}:${a1(r, c - 1)}`;
    }
    const text = `=${fn}(${range})`;
    this.edit = { text, cursor: range ? text.length : text.length - 1, where: 'cell', mode: 'enter', point: null };
    this.bump();
  }

  /** Ctrl+; and Ctrl+Maj+; : today's date / the current time, as values. */
  insertNow(kind: 'date' | 'time') {
    const now = new Date();
    if (kind === 'date') return this.applyInput(serialOf(now), 'yyyy-mm-dd');
    const t = (now.getHours() * 3600 + now.getMinutes() * 60) / 86400;
    this.applyInput(t, 'h:mm');
  }

  private applyInput(v: number, fmt: string) {
    const { r, c } = this.sel.active;
    const cur = this.styleAt(r, c).style;
    const s = cur.numFmt === 'General' ? this.doc.styleId({ ...cur, numFmt: fmt }) : undefined;
    this.doc.setCells(this.sheetId, [{ r, c, cell: { t: 'n', v }, s }]);
  }

  // ----- sort and filter -----------------------------------------------------------

  /**
   * Sort the selection (or its data region) by one or more columns. Rows move
   * whole: values, formats and formulas (relative references move with their
   * row, as in Excel).
   */
  sort(keys: Array<{ col: number; desc: boolean }>, opts: { header?: boolean; range?: Range } = {}) {
    if (this.readOnlyFlag) return;
    let rg = opts.range ?? current(this.sel);
    if (rg.r0 === rg.r1 && rg.c0 === rg.c1) rg = this.currentRegion();
    rg = { ...rg, r1: Math.min(rg.r1, this.doc.rowCount(this.sheetId) - 1), c1: Math.min(rg.c1, this.doc.colCount(this.sheetId) - 1) };
    const r0 = rg.r0 + (opts.header ? 1 : 0);
    if (r0 >= rg.r1) return;
    const si = this.sheetIndex;
    const rows = Array.from({ length: rg.r1 - r0 + 1 }, (_, i) => r0 + i);
    const keyOf = (r: number, c: number): [number, number | string] => {
      const v = this.calc.get(si, r, c);
      if (!v || v.v == null || v.v === '') return [3, ''];
      if (v.t === 'n') return [0, v.v as number];
      if (v.t === 's') return [1, String(v.v).toLocaleLowerCase('fr-CA')];
      if (v.t === 'b') return [2, v.v ? 1 : 0];
      return [2, String(v.v)];
    };
    const coll = new Intl.Collator('fr-CA', { numeric: true, sensitivity: 'base' });
    const order = [...rows].sort((a, b) => {
      for (const k of keys) {
        const [ta, va] = keyOf(a, k.col);
        const [tb, vb] = keyOf(b, k.col);
        // Blanks always last, whatever the direction (Excel).
        if (ta === 3 || tb === 3) {
          if (ta !== tb) return ta === 3 ? 1 : -1;
          continue;
        }
        let d = ta - tb || (typeof va === 'number' && typeof vb === 'number' ? va - vb : coll.compare(String(va), String(vb)));
        if (k.desc) d = -d;
        if (d) return d;
      }
      return a - b;
    });
    const edits: CellEdit[] = [];
    order.forEach((src, i) => {
      const dst = r0 + i;
      if (src === dst) return;
      for (let c = rg.c0; c <= rg.c1; c++) {
        const y = this.doc.getCell(this.sheetId, src, c);
        const f = y?.f ? shiftFormula(this.doc.formulaText(this.sheetId, y)!, dst - src, 0) : undefined;
        edits.push({ r: dst, c, cell: f != null ? { f } : y?.t ? { t: y.t, v: y.v } : null, s: y?.s ?? 0 });
      }
    });
    this.doc.setCells(this.sheetId, edits);
  }

  /** Turn the filter on for the data region (or off when there is one). */
  toggleFilter() {
    if (this.doc.filter(this.sheetId)) {
      this.doc.doc.transact(() => {
        this.doc.setFilter(this.sheetId, null);
        this.doc.setRowMeta(this.sheetId, 0, this.doc.rowCount(this.sheetId) - 1, { hidden: undefined });
      });
      return;
    }
    const rg = current(this.sel);
    const range = rg.r0 === rg.r1 && rg.c0 === rg.c1 ? this.currentRegion() : rg;
    this.doc.setFilter(this.sheetId, { range, columns: [] });
  }

  /** Distinct displayed values of a filter column (for the checklist). */
  filterValues(col: number): Array<{ text: string; count: number }> {
    const f = this.doc.filter(this.sheetId);
    if (!f) return [];
    const range = parseRangeLoose(f.ref)!;
    const map = new Map<string, number>();
    for (let r = range.r0 + 1; r <= Math.min(range.r1, range.r0 + 50_000); r++) {
      const t = this.view(r, range.c0 + col).text;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return [...map].map(([text, count]) => ({ text, count })).sort((a, b) => new Intl.Collator('fr-CA', { numeric: true }).compare(a.text, b.text));
  }

  /** Show only rows whose column `col` displays one of `values` (null = no criterion). */
  setFilterColumn(col: number, values: string[] | null) {
    const f = this.doc.filter(this.sheetId);
    if (!f) return;
    const range = parseRangeLoose(f.ref)!;
    const columns = f.columns.filter((c) => c.col !== col);
    if (values) columns.push({ col, values: values.filter((v) => v !== ''), ...(values.includes('') ? { blank: true } : {}) });
    this.doc.doc.transact(() => {
      this.doc.setFilter(this.sheetId, { range, columns });
      for (let r = range.r0 + 1; r <= range.r1; r++) {
        const show = columns.every((fc) => {
          const t = this.view(r, range.c0 + fc.col).text;
          return t === '' ? !!fc.blank : fc.values.includes(t);
        });
        const cur = !!this.doc.rowSize(this.sheetId, r)?.hidden;
        if (cur === show) this.doc.setRowMeta(this.sheetId, r, r, { hidden: show ? undefined : true });
      }
    });
  }

  /** Remove rows that repeat an earlier row of the selection (all columns compared). Returns how many. */
  removeDuplicates(header = true): number {
    let rg = current(this.sel);
    if (rg.r0 === rg.r1 && rg.c0 === rg.c1) rg = this.currentRegion();
    rg = { ...rg, r1: Math.min(rg.r1, this.doc.rowCount(this.sheetId) - 1), c1: Math.min(rg.c1, this.doc.colCount(this.sheetId) - 1) };
    const r0 = rg.r0 + (header ? 1 : 0);
    const seen = new Set<string>();
    const keep: number[] = [];
    for (let r = r0; r <= rg.r1; r++) {
      const key = Array.from({ length: rg.c1 - rg.c0 + 1 }, (_, k) => this.view(r, rg.c0 + k).text.toLocaleLowerCase('fr-CA')).join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      keep.push(r);
    }
    const removed = rg.r1 - r0 + 1 - keep.length;
    if (!removed) return 0;
    const edits: CellEdit[] = [];
    keep.forEach((src, i) => {
      const dst = r0 + i;
      for (let c = rg.c0; c <= rg.c1; c++) {
        const y = this.doc.getCell(this.sheetId, src, c);
        const f = y?.f ? shiftFormula(this.doc.formulaText(this.sheetId, y)!, dst - src, 0) : undefined;
        edits.push({ r: dst, c, cell: f != null ? { f } : y?.t ? { t: y.t, v: y.v } : null, s: y?.s ?? 0 });
      }
    });
    for (let r = r0 + keep.length; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) edits.push({ r, c, cell: null, s: 0 });
    this.doc.setCells(this.sheetId, edits);
    return removed;
  }

  /** « Fractionner le texte en colonnes »: split the selected column's text into the columns to its right. */
  splitText(delimiter: string) {
    const rg = current(this.sel);
    const c = rg.c0;
    const edits: CellEdit[] = [];
    for (let r = rg.r0; r <= Math.min(rg.r1, this.doc.rowCount(this.sheetId) - 1); r++) {
      const y = this.doc.getCell(this.sheetId, r, c);
      if (!y || y.f || y.t !== 's') continue;
      String(y.v)
        .split(delimiter === 'auto' ? /[,;\t]/ : delimiter)
        .forEach((part, k) => {
          const p = parseInput(part.trim());
          edits.push({ r, c: c + k, cell: p.t ? { t: p.t, v: p.v } : null });
        });
    }
    this.doc.setCells(this.sheetId, edits);
  }

  // ----- find & replace ----------------------------------------------------------

  /** Cells matching a search, in reading order from the active cell. */
  find(query: string, opts: { matchCase?: boolean; whole?: boolean; formulas?: boolean; allSheets?: boolean }): Array<{ sheet: string; r: number; c: number }> {
    if (!query) return [];
    const q = opts.matchCase ? query : query.toLocaleLowerCase('fr-CA');
    const test = (s: string) => {
      const t = opts.matchCase ? s : s.toLocaleLowerCase('fr-CA');
      return opts.whole ? t === q : t.includes(q);
    };
    const out: Array<{ sheet: string; r: number; c: number }> = [];
    for (const sheet of opts.allSheets ? this.doc.sheetIds() : [this.sheetId]) {
      const found: Array<{ r: number; c: number }> = [];
      for (const { r, c, cell } of this.doc.cells(sheet)) {
        const text = opts.formulas && cell.f ? `=${this.doc.formulaText(sheet, cell)}` : this.view(r, c, sheet).text;
        if (text && test(text)) found.push({ r, c });
      }
      found.sort((a, b) => a.r - b.r || a.c - b.c);
      out.push(...found.map((f) => ({ sheet, ...f })));
    }
    return out;
  }

  /** Replace in literal text and in formulas; returns how many cells changed. */
  replace(query: string, by: string, opts: { matchCase?: boolean; whole?: boolean; allSheets?: boolean }, only?: { sheet: string; r: number; c: number }): number {
    if (!query || this.readOnlyFlag) return 0;
    const re = new RegExp(opts.whole ? `^${escapeRe(query)}$` : escapeRe(query), opts.matchCase ? 'g' : 'gi');
    let n = 0;
    this.doc.doc.transact(() => {
      for (const sheet of opts.allSheets ? this.doc.sheetIds() : [this.sheetId]) {
        const edits: CellEdit[] = [];
        for (const { r, c, cell } of this.doc.cells(sheet)) {
          if (only && (only.sheet !== sheet || only.r !== r || only.c !== c)) continue;
          const src = cell.f ? `=${this.doc.formulaText(sheet, cell)}` : cell.t === 's' ? String(cell.v) : null;
          if (src == null || !re.test(src)) continue;
          re.lastIndex = 0;
          const next = src.replace(re, by);
          const p = cell.f ? parseInput(next) : { t: 's' as const, v: next };
          edits.push({ r, c, cell: p.f != null ? { f: p.f } : p.t ? { t: p.t, v: p.v } : null });
          n++;
        }
        this.doc.setCells(sheet, edits);
      }
    });
    return n;
  }

  // ----- selection statistics ------------------------------------------------------

  /** Sum, average and count of the numbers in the selection (status bar). */
  stats(): { sum: number; count: number; numbers: number; avg: number | null; min: number | null; max: number | null } {
    let sum = 0;
    let count = 0;
    let numbers = 0;
    let min = Infinity;
    let max = -Infinity;
    const take = (r: number, c: number) => {
      count++;
      const v = this.numberAt(r, c);
      if (v != null) {
        numbers++;
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    };
    for (const rg of this.sel.ranges) {
      const area = (Math.min(rg.r1, MAX_ROWS) - rg.r0 + 1) * (Math.min(rg.c1, MAX_COLS) - rg.c0 + 1);
      if (area <= 20_000) {
        // Small selections: read just their cells.
        for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) if (this.filled(r, c)) take(r, c);
      } else {
        for (const { r, c, cell } of this.doc.cells(this.sheetId)) if (inRange(rg, r, c) && (cell.f || cell.v != null)) take(r, c);
      }
    }
    return { sum, count, numbers, avg: numbers ? sum / numbers : null, min: numbers ? min : null, max: numbers ? max : null };
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `B3`, `A1:C4`, `A:C`, `2:5` → range. */
function parseRangeLoose(t: string): Range | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(t.trim());
  if (m) {
    const col = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const r0 = Number(m[2]) - 1;
    const c0 = col(m[1]!);
    const r1 = m[4] ? Number(m[4]) - 1 : r0;
    const c1 = m[3] ? col(m[3]) : c0;
    if (r0 < 0 || r1 < 0 || r0 >= MAX_ROWS || r1 >= MAX_ROWS || c0 >= MAX_COLS || c1 >= MAX_COLS) return null;
    return normalize({ r0, c0, r1, c1 });
  }
  const cols = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(t.trim());
  if (cols) {
    const col = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return normalize({ r0: 0, c0: col(cols[1]!), r1: MAX_ROWS - 1, c1: col(cols[2]!) });
  }
  const rows = /^\$?(\d+):\$?(\d+)$/.exec(t.trim());
  if (rows) return normalize({ r0: Number(rows[1]) - 1, c0: 0, r1: Number(rows[2]) - 1, c1: MAX_COLS - 1 });
  return null;
}

export { parseRangeLoose };
