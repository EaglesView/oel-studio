/**
 * Canvas painter for the grid. Coordinates are CSS pixels at 100 % zoom; the
 * context is scaled by device pixel ratio × zoom. Cells are paper: white with
 * black "automatic" ink in both themes (as documents are); the chrome around
 * them (headers, selection) uses the emboss tokens.
 */
import { MAX_COLS, MAX_ROWS, inRange, parseRange, parseSqref, type Range } from '../model/a1';
import { tokenize } from '../model/formula';
import type { CellStyle, CondFormat, Drawing } from '../model/types';
import type { CellView, SheetController } from '../ui/controller';
import { current, isWholeCols, isWholeRows } from './selection';
import type { Axis } from './geometry';
import { paintDrawings } from './drawings';

export const HEADER_H = 22;
export const rowHeaderWidth = (lastRow: number) => Math.max(36, 14 + 7.5 * String(lastRow + 1).length);

/** Colours for references in a formula being typed (Excel's order). */
export const REF_COLORS = ['#1a73e8', '#d93025', '#7b1fa2', '#188038', '#e37400', '#c2185b', '#00897b'];

export interface Theme {
  header: string;
  headerText: string;
  headerSel: string;
  headerSelText: string;
  headerLine: string;
  grid: string;
  accent: string;
  accentSoft: string;
  frozen: string;
  font: string;
}

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    header: v('--emboss-well', '#f1efe9'),
    headerText: v('--emboss-ink-muted', '#5f5b53'),
    headerSel: v('--emboss-accent-soft', '#e3defa'),
    headerSelText: v('--emboss-text', '#1d1b18'),
    headerLine: v('--emboss-edge', '#d8d3c8'),
    grid: '#e1e1e1',
    accent: v('--emboss-fill-primary', '#5b3fd6'),
    accentSoft: 'rgba(91, 63, 214, 0.12)',
    frozen: '#bdbdbd',
    font: v('--font-sans', 'system-ui, sans-serif'),
  };
}

/** Where everything is on screen for one frame. */
export class Layout {
  readonly frozenW: number;
  readonly frozenH: number;
  readonly fr: number;
  readonly fc: number;

  constructor(
    readonly rows: Axis,
    readonly cols: Axis,
    frozenRows: number,
    frozenCols: number,
    /** Scroll offsets of the unfrozen area, in logical px. */
    readonly sx: number,
    readonly sy: number,
    /** Viewport size in logical px (canvas size / zoom). */
    readonly w: number,
    readonly h: number,
    readonly headerW: number,
    readonly headerH = HEADER_H,
  ) {
    this.fr = frozenRows;
    this.fc = frozenCols;
    this.frozenW = cols.offset(frozenCols);
    this.frozenH = rows.offset(frozenRows);
  }

  x(c: number) {
    return this.headerW + this.cols.offset(c) - (c >= this.fc ? this.sx : 0);
  }
  y(r: number) {
    return this.headerH + this.rows.offset(r) - (r >= this.fr ? this.sy : 0);
  }

  /** Screen rectangle of a range (clipped to its pane by the caller). */
  rect(rg: Range) {
    const x = this.x(rg.c0);
    const y = this.y(rg.r0);
    return { x, y, w: this.x(Math.min(rg.c1 + 1, MAX_COLS)) - x, h: this.y(Math.min(rg.r1 + 1, MAX_ROWS)) - y };
  }

  /** First and last scrollable rows/columns on screen. */
  get rowsShown(): [number, number] {
    const top = this.rows.indexAt(this.frozenH + this.sy);
    const bottom = this.rows.indexAt(this.frozenH + this.sy + Math.max(0, this.h - this.headerH - this.frozenH));
    return [Math.max(top, this.fr), bottom];
  }
  get colsShown(): [number, number] {
    const left = this.cols.indexAt(this.frozenW + this.sx);
    const right = this.cols.indexAt(this.frozenW + this.sx + Math.max(0, this.w - this.headerW - this.frozenW));
    return [Math.max(left, this.fc), right];
  }

  /** Cell under a point (logical px); -1 for a header. */
  hit(px: number, py: number): { r: number; c: number } {
    const r = py < this.headerH ? -1 : py < this.headerH + this.frozenH ? this.rows.indexAt(py - this.headerH) : this.rows.indexAt(py - this.headerH + this.sy);
    const c = px < this.headerW ? -1 : px < this.headerW + this.frozenW ? this.cols.indexAt(px - this.headerW) : this.cols.indexAt(px - this.headerW + this.sx);
    return { r, c };
  }
}

// ---------------------------------------------------------------------------
// Conditional formatting (display only; rules stay in the file as they were)
// ---------------------------------------------------------------------------

interface CfLook {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  bar?: { frac: number; color: string };
}

function lerpColor(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Builds a per-cell evaluator for the sheet's conditional formats. */
export function conditionalFormats(list: CondFormat[], dxfs: CellStyle[], num: (r: number, c: number) => number | null, text: (r: number, c: number) => string): (r: number, c: number) => CfLook | null {
  if (!list.length) return () => null;
  const prepared = list.flatMap((cf) => {
    const ranges = parseSqref(cf.sqref);
    return cf.rules.map((rule) => {
      let min = Infinity;
      let max = -Infinity;
      if (rule.kind === 'colorScale' || rule.kind === 'dataBar') {
        for (const rg of ranges)
          for (let r = rg.r0; r <= Math.min(rg.r1, rg.r0 + 5000); r++)
            for (let c = rg.c0; c <= Math.min(rg.c1, rg.c0 + 200); c++) {
              const v = num(r, c);
              if (v != null) {
                min = Math.min(min, v);
                max = Math.max(max, v);
              }
            }
      }
      return { ranges, rule, min, max };
    });
  });
  prepared.sort((a, b) => a.rule.priority - b.rule.priority);
  const constant = (f: string | undefined): number | string | null => {
    if (f == null) return null;
    const t = f.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    const m = /^"(.*)"$/.exec(t);
    return m ? m[1]!.replace(/""/g, '"') : null;
  };
  return (r, c) => {
    let look: CfLook | null = null;
    for (const p of prepared) {
      if (!p.ranges.some((rg) => inRange(rg, r, c))) continue;
      const rule = p.rule;
      const v = num(r, c);
      let hit = false;
      if (rule.kind === 'cellIs') {
        const a = constant(rule.formulas[0]);
        const b = constant(rule.formulas[1]);
        const val: number | string = v ?? text(r, c);
        const cmp = (x: number | string | null) => (x == null ? NaN : typeof x === 'number' && typeof val === 'number' ? val - x : String(val).localeCompare(String(x)));
        const d = cmp(a);
        switch (rule.operator) {
          case 'greaterThan': hit = d > 0; break;
          case 'lessThan': hit = d < 0; break;
          case 'greaterThanOrEqual': hit = d >= 0; break;
          case 'lessThanOrEqual': hit = d <= 0; break;
          case 'equal': hit = d === 0; break;
          case 'notEqual': hit = d !== 0 && !Number.isNaN(d); break;
          case 'between': hit = d >= 0 && cmp(b) <= 0; break;
          case 'notBetween': hit = d < 0 || cmp(b) > 0; break;
        }
      } else if (rule.kind === 'containsText' || rule.kind === 'notContainsText' || rule.kind === 'beginsWith' || rule.kind === 'endsWith') {
        const needle = /"((?:[^"]|"")*)"/.exec(rule.formulas[0] ?? '')?.[1]?.replace(/""/g, '"')?.toLowerCase();
        const t = text(r, c).toLowerCase();
        if (needle != null) hit = rule.kind === 'containsText' ? t.includes(needle) : rule.kind === 'notContainsText' ? !t.includes(needle) : rule.kind === 'beginsWith' ? t.startsWith(needle) : t.endsWith(needle);
      } else if (rule.kind === 'colorScale' && v != null && rule.colors.length >= 2 && p.max > p.min) {
        const t = (v - p.min) / (p.max - p.min);
        const cs = rule.colors.map((x) => x.css);
        const fill = cs.length === 3 ? (t < 0.5 ? lerpColor(cs[0]!, cs[1]!, t * 2) : lerpColor(cs[1]!, cs[2]!, (t - 0.5) * 2)) : lerpColor(cs[0]!, cs[1]!, t);
        look = { ...(look ?? {}), fill };
        continue;
      } else if (rule.kind === 'dataBar' && v != null && p.max > p.min) {
        look = { ...(look ?? {}), bar: { frac: 0.1 + 0.8 * ((v - Math.min(0, p.min)) / (p.max - Math.min(0, p.min))), color: rule.colors[0]?.css ?? '#638EC6' } };
        continue;
      }
      if (hit && rule.dxf != null) {
        const d = dxfs[rule.dxf];
        if (d) look = { ...(look ?? {}), ...(d.fill ? { fill: d.fill.css } : {}), ...(d.font.color ? { color: d.font.color.css } : {}), ...(d.font.bold ? { bold: true } : {}), ...(d.font.italic ? { italic: true } : {}) };
        if (rule.stop) break;
      }
    }
    return look;
  };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

const PT = 96 / 72;
const PAD = 3;

function fontOf(s: CellStyle, cf: CfLook | null, theme: Theme): string {
  const size = (s.font.size ?? 11) * PT;
  const family = s.font.name ? `"${s.font.name}", ` : '';
  return `${s.font.italic || cf?.italic ? 'italic ' : ''}${s.font.bold || cf?.bold ? '700 ' : ''}${size.toFixed(1)}px ${family}Carlito, Calibri, ${theme.font}`;
}

function dash(ctx: CanvasRenderingContext2D, style: string): number {
  switch (style) {
    case 'medium':
    case 'mediumDashed':
    case 'mediumDashDot':
      ctx.setLineDash(style === 'medium' ? [] : [6, 3]);
      return 2;
    case 'thick':
      ctx.setLineDash([]);
      return 3;
    case 'dashed':
      ctx.setLineDash([4, 2]);
      return 1;
    case 'dotted':
    case 'hair':
      ctx.setLineDash([1, 2]);
      return 1;
    case 'double':
      ctx.setLineDash([]);
      return 3;
    default:
      ctx.setLineDash([]);
      return 1;
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next).width > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export interface PaintArgs {
  ctx: CanvasRenderingContext2D;
  ctl: SheetController;
  layout: Layout;
  theme: Theme;
  dpr: number;
  zoom: number;
  /** Skip the text of this cell (the in-cell editor covers it). */
  editing: { r: number; c: number } | null;
  cf: (r: number, c: number) => CfLook | null;
  /** Ranges referenced by the formula being typed, with their colours. */
  refHighlights: Array<{ range: Range; color: string }>;
  focused: boolean;
  /** Pictures and shapes over the cells, and the decoded images by package path. */
  drawings?: Drawing[];
  images?: ReadonlyMap<string, CanvasImageSource>;
}

export function paint(a: PaintArgs) {
  const { ctx, ctl, layout: L, theme, dpr, zoom } = a;
  const props = ctl.props;
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  ctx.clearRect(0, 0, L.w, L.h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L.w, L.h);
  const merges = ctl.doc.merges(ctl.sheetId);
  const notes = ctl.doc.notes(ctl.sheetId);
  const filter = ctl.doc.filter(ctl.sheetId);
  const filterRange = filter ? parseRange(filter.ref) : null;

  const [rs0, rs1] = L.rowsShown;
  const [cs0, cs1] = L.colsShown;
  const rowsF: [number, number] | null = L.fr > 0 ? [0, L.fr - 1] : null;
  const colsF: [number, number] | null = L.fc > 0 ? [0, L.fc - 1] : null;
  const panes: Array<{ rows: [number, number]; cols: [number, number]; clip: [number, number, number, number]; frozenRows?: boolean; frozenCols?: boolean }> = [];
  const mainX = L.headerW + L.frozenW;
  const mainY = L.headerH + L.frozenH;
  panes.push({ rows: [rs0, rs1], cols: [cs0, cs1], clip: [mainX, mainY, L.w - mainX, L.h - mainY] });
  if (rowsF) panes.push({ rows: rowsF, cols: [cs0, cs1], clip: [mainX, L.headerH, L.w - mainX, L.frozenH], frozenRows: true });
  if (colsF) panes.push({ rows: [rs0, rs1], cols: colsF, clip: [L.headerW, mainY, L.frozenW, L.h - mainY], frozenCols: true });
  if (rowsF && colsF) panes.push({ rows: rowsF, cols: colsF, clip: [L.headerW, L.headerH, L.frozenW, L.frozenH], frozenRows: true, frozenCols: true });

  for (const pane of panes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(...pane.clip);
    ctx.clip();
    paintCells(a, pane.rows, pane.cols, merges, notes, filterRange, filter?.columns.map((c) => c.col) ?? [], props.showGrid);
    if (a.drawings?.length) paintDrawings(ctx, L, a.drawings, a.images ?? new Map(), { frozenRows: !!pane.frozenRows, frozenCols: !!pane.frozenCols }, theme.font);
    paintSelection(a, merges);
    ctx.restore();
  }

  // Frozen separators.
  ctx.strokeStyle = theme.frozen;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  if (L.fr > 0) {
    ctx.beginPath();
    ctx.moveTo(L.headerW, mainY);
    ctx.lineTo(L.w, mainY);
    ctx.stroke();
  }
  if (L.fc > 0) {
    ctx.beginPath();
    ctx.moveTo(mainX, L.headerH);
    ctx.lineTo(mainX, L.h);
    ctx.stroke();
  }
  paintHeaders(a, [rowsF, [rs0, rs1]], [colsF, [cs0, cs1]]);
}

function paintCells(a: PaintArgs, rows: [number, number], cols: [number, number], merges: Range[], notes: Array<{ r: number; c: number }>, filterRange: Range | null, filterActive: number[], showGrid: boolean) {
  const { ctx, ctl, layout: L, theme } = a;
  const views = new Map<number, CellView>();
  const key = (r: number, c: number) => r * MAX_COLS + c;
  const viewAt = (r: number, c: number) => {
    let v = views.get(key(r, c));
    if (!v) views.set(key(r, c), (v = ctl.view(r, c)));
    return v;
  };
  const mergeOf = (r: number, c: number) => merges.find((m) => inRange(m, r, c));

  // Fills (style, conditional) and data bars.
  for (let r = rows[0]; r <= rows[1]; r++) {
    if (L.rows.hidden(r)) continue;
    const y = L.y(r);
    const h = L.rows.size(r);
    for (let c = cols[0]; c <= cols[1]; c++) {
      if (L.cols.hidden(c)) continue;
      const v = viewAt(r, c);
      const look = a.cf(r, c);
      const fill = look?.fill ?? v.style.fill?.css;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(L.x(c), y, L.cols.size(c), h);
      }
      if (look?.bar) {
        ctx.fillStyle = look.bar.color;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(L.x(c) + 1, y + 2, (L.cols.size(c) - 2) * Math.min(1, look.bar.frac), h - 4);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Gridlines (not inside merges, not over filled cells — as Excel shows them).
  if (showGrid) {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1 / (a.dpr * a.zoom);
    ctx.setLineDash([]);
    ctx.beginPath();
    const yTop = L.y(rows[0]);
    const yBot = L.y(rows[1] + 1);
    const xLeft = L.x(cols[0]);
    const xRight = L.x(cols[1] + 1);
    for (let c = cols[0]; c <= cols[1] + 1; c++) {
      const x = Math.round(L.x(c)) - 0.5 / (a.dpr * a.zoom);
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
    }
    for (let r = rows[0]; r <= rows[1] + 1; r++) {
      const y = Math.round(L.y(r)) - 0.5 / (a.dpr * a.zoom);
      ctx.moveTo(xLeft, y);
      ctx.lineTo(xRight, y);
    }
    ctx.stroke();
  }
  // Merged areas: one cell (covers the inner gridlines).
  for (const m of merges) {
    if (m.r1 < rows[0] || m.r0 > rows[1] || m.c1 < cols[0] || m.c0 > cols[1]) continue;
    const rr = L.rect(m);
    ctx.fillStyle = viewAt(m.r0, m.c0).style.fill?.css ?? '#ffffff';
    ctx.fillRect(rr.x + 0.5, rr.y + 0.5, rr.w - 1, rr.h - 1);
  }

  // Text.
  for (let r = rows[0]; r <= rows[1]; r++) {
    if (L.rows.hidden(r)) continue;
    for (let c = cols[0]; c <= cols[1]; c++) {
      if (L.cols.hidden(c)) continue;
      const m = mergeOf(r, c);
      if (m && (m.r0 !== r || m.c0 !== c)) {
        // Draw a merge's text once, even when its top-left is scrolled away.
        const firstShown = r === Math.max(m.r0, rows[0]) && c === Math.max(m.c0, cols[0]);
        if (!firstShown) continue;
        drawText(a, m.r0, m.c0, viewAt(m.r0, m.c0), m, () => false);
        continue;
      }
      const v = viewAt(r, c);
      if (!v.text || (a.editing && a.editing.r === r && a.editing.c === c)) continue;
      drawText(a, r, c, v, m ?? null, (cc) => cc >= 0 && cc < MAX_COLS && !viewAt(r, cc).text && !mergeOf(r, cc));
    }
  }

  // Borders.
  for (let r = rows[0]; r <= rows[1]; r++) {
    if (L.rows.hidden(r)) continue;
    for (let c = cols[0]; c <= cols[1]; c++) {
      if (L.cols.hidden(c)) continue;
      const b = viewAt(r, c).style.border;
      if (!b.left && !b.right && !b.top && !b.bottom) continue;
      const x0 = L.x(c);
      const y0 = L.y(r);
      const x1 = x0 + L.cols.size(c);
      const y1 = y0 + L.rows.size(r);
      const line = (side: { style: string; color?: { css: string } } | undefined, ax: number, ay: number, bx: number, by: number) => {
        if (!side) return;
        ctx.strokeStyle = side.color?.css ?? '#000';
        ctx.lineWidth = dash(ctx, side.style);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      };
      line(b.top, x0, y0, x1, y0);
      line(b.bottom, x0, y1, x1, y1);
      line(b.left, x0, y0, x0, y1);
      line(b.right, x1, y0, x1, y1);
    }
  }
  ctx.setLineDash([]);

  // Notes: a small red corner, as in Excel.
  ctx.fillStyle = '#d93025';
  for (const n of notes) {
    if (n.r < rows[0] || n.r > rows[1] || n.c < cols[0] || n.c > cols[1]) continue;
    const x = L.x(n.c + 1);
    const y = L.y(n.r);
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + 6);
    ctx.fill();
  }

  // Filter buttons on the header row of the filtered range.
  if (filterRange && filterRange.r0 >= rows[0] && filterRange.r0 <= rows[1]) {
    for (let c = Math.max(filterRange.c0, cols[0]); c <= Math.min(filterRange.c1, cols[1]); c++) {
      const x = L.x(c + 1) - 17;
      const y = L.y(filterRange.r0) + (L.rows.size(filterRange.r0) - 15) / 2;
      const on = filterActive.includes(c - filterRange.c0);
      ctx.fillStyle = on ? theme.accent : '#f3f3f3';
      ctx.strokeStyle = '#9e9e9e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, 15, 15, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = on ? '#fff' : '#424242';
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 6);
      ctx.lineTo(x + 11, y + 6);
      ctx.lineTo(x + 7.5, y + 10);
      ctx.fill();
    }
  }
}

function drawText(a: PaintArgs, r: number, c: number, v: CellView, merge: Range | null, emptyAt: (c: number) => boolean) {
  const { ctx, layout: L, theme } = a;
  const s = v.style;
  const look = a.cf(r, c);
  const rect = merge ? L.rect(merge) : { x: L.x(c), y: L.y(r), w: L.cols.size(c), h: L.rows.size(r) };
  ctx.font = fontOf(s, look, theme);
  ctx.fillStyle = look?.color ?? s.font.color?.css ?? (v.kind === 'e' ? '#000' : '#000');
  const indent = (s.align.indent ?? 0) * 9;
  let h = s.align.h;
  if (!h || h === 'general') h = v.kind === 'n' ? 'right' : v.kind === 'b' || v.kind === 'e' ? 'center' : 'left';
  if (h === 'fill' || h === 'justify' || h === 'distributed') h = 'left';
  if (h === 'centerContinuous') h = 'center';
  const vAlign = s.align.v ?? 'bottom';
  const fontPx = (s.font.size ?? 11) * PT;
  const lineH = fontPx * 1.22;
  let text = v.text;
  const avail = rect.w - PAD * 2 - indent;
  const width = ctx.measureText(text).width;

  // Numbers that do not fit show ####, as in Excel.
  if (v.kind === 'n' && width > avail && !s.align.wrap) {
    const hashW = ctx.measureText('#').width || 6;
    text = '#'.repeat(Math.max(1, Math.floor(avail / hashW)));
  }

  ctx.save();
  if (s.align.wrap) {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    const lines = wrapLines(ctx, text, avail);
    const total = lines.length * lineH;
    let y = vAlign === 'top' ? rect.y + PAD + fontPx : vAlign === 'center' ? rect.y + (rect.h - total) / 2 + fontPx : rect.y + rect.h - total - PAD + fontPx;
    for (const line of lines) {
      const lw = ctx.measureText(line).width;
      const x = h === 'right' ? rect.x + rect.w - PAD - lw : h === 'center' ? rect.x + (rect.w - lw) / 2 : rect.x + PAD + indent;
      ctx.fillText(line, x, y - fontPx * 0.2);
      decorate(ctx, s, x, y - fontPx * 0.2, lw, fontPx);
      y += lineH;
    }
    ctx.restore();
    return;
  }
  // Overflow into empty neighbours (text only), else clip to the cell.
  let clipX0 = rect.x;
  let clipX1 = rect.x + rect.w;
  const tw = ctx.measureText(text).width;
  if (!merge && v.kind !== 'n' && tw > avail) {
    if (h === 'left' || h === 'center') {
      let cc = c + 1;
      while (clipX1 - rect.x < tw + PAD * 2 + (h === 'center' ? tw : 0) && emptyAt(cc) && cc < c + 60) clipX1 = L.x(++cc);
    }
    if (h === 'right' || h === 'center') {
      let cc = c - 1;
      while (rect.x + rect.w - clipX0 < tw + PAD * 2 + (h === 'center' ? tw : 0) && cc >= 0 && emptyAt(cc) && cc > c - 60) clipX0 = L.x(cc--);
    }
  }
  ctx.beginPath();
  ctx.rect(clipX0, rect.y, clipX1 - clipX0, rect.h);
  ctx.clip();
  const x = h === 'right' ? rect.x + rect.w - PAD - tw : h === 'center' ? rect.x + (rect.w - tw) / 2 : rect.x + PAD + indent;
  const y = vAlign === 'top' ? rect.y + PAD + fontPx * 0.8 : vAlign === 'center' ? rect.y + rect.h / 2 + fontPx * 0.35 : rect.y + rect.h - PAD - 1;
  const first = text.split('\n')[0]!;
  ctx.fillText(first, x, y);
  decorate(ctx, s, x, y, ctx.measureText(first).width, fontPx);
  ctx.restore();
}

function decorate(ctx: CanvasRenderingContext2D, s: CellStyle, x: number, y: number, w: number, fontPx: number) {
  if (!s.font.underline && !s.font.strike) return;
  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineWidth = Math.max(1, fontPx / 14);
  ctx.setLineDash([]);
  ctx.beginPath();
  if (s.font.underline) {
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + w, y + 2);
    if (s.font.underline.startsWith('double')) {
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x + w, y + 4);
    }
  }
  if (s.font.strike) {
    ctx.moveTo(x, y - fontPx * 0.3);
    ctx.lineTo(x + w, y - fontPx * 0.3);
  }
  ctx.stroke();
}

function paintSelection(a: PaintArgs, merges: Range[]) {
  const { ctx, ctl, layout: L, theme } = a;
  const sel = ctl.sel;
  const clampR = (rg: Range): Range => ({ r0: rg.r0, c0: rg.c0, r1: Math.min(rg.r1, L.rows.count - 1), c1: Math.min(rg.c1, L.cols.count - 1) });
  // Ranges: soft fill, the active cell left clear (even-odd), as in Excel.
  const act = merges.find((m) => inRange(m, sel.active.r, sel.active.c)) ?? { r0: sel.active.r, c0: sel.active.c, r1: sel.active.r, c1: sel.active.c };
  const ar = L.rect(act);
  ctx.fillStyle = theme.accentSoft;
  ctx.beginPath();
  for (const rg of sel.ranges) {
    const rr = L.rect(clampR(rg));
    ctx.rect(rr.x, rr.y, rr.w, rr.h);
  }
  ctx.rect(ar.x, ar.y, ar.w, ar.h);
  ctx.fill('evenodd');
  // Current range outline.
  const cur = L.rect(clampR(current(sel)));
  ctx.strokeStyle = theme.accent;
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeRect(cur.x, cur.y, cur.w, cur.h);
  ctx.lineWidth = 2;
  ctx.strokeRect(ar.x + 1, ar.y + 1, ar.w - 2, ar.h - 2);
  // Fill handle.
  const c = current(sel);
  if (!a.editing && !isWholeRows(c) && !isWholeCols(c) && !ctl.readOnlyFlag) {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(cur.x + cur.w - 3.5, cur.y + cur.h - 3.5, 7, 7);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(cur.x + cur.w - 3.5, cur.y + cur.h - 3.5, 7, 7);
  }
  // Copy marquee.
  if (ctl.copyMark && ctl.copyMark.sheet === ctl.sheetId) {
    const m = L.rect(ctl.copyMark.range);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.lineDashOffset = -((performance.now() / 60) % 8);
    ctx.strokeRect(m.x + 1, m.y + 1, m.w - 2, m.h - 2);
    ctx.setLineDash([]);
  }
  // References of the formula being typed.
  for (const h of a.refHighlights) {
    const rr = L.rect(clampR(h.range));
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 2);
    ctx.fillStyle = `${h.color}14`;
    ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
  }
}

function paintHeaders(a: PaintArgs, rowParts: Array<[number, number] | null>, colParts: Array<[number, number] | null>) {
  const { ctx, ctl, layout: L, theme } = a;
  const sel = ctl.sel;
  const rowSel = (r: number) => sel.ranges.some((rg) => r >= rg.r0 && r <= rg.r1);
  const colSel = (c: number) => sel.ranges.some((rg) => c >= rg.c0 && c <= rg.c1);
  const rowFull = (r: number) => sel.ranges.some((rg) => isWholeRows(rg) && r >= rg.r0 && r <= rg.r1);
  const colFull = (c: number) => sel.ranges.some((rg) => isWholeCols(rg) && c >= rg.c0 && c <= rg.c1);
  ctx.font = `500 11.5px ${theme.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // Column headers.
  ctx.fillStyle = theme.header;
  ctx.fillRect(0, 0, L.w, L.headerH);
  for (const part of colParts) {
    if (!part) continue;
    ctx.save();
    ctx.beginPath();
    const clipX = part[0] < L.fc ? L.headerW : L.headerW + L.frozenW;
    ctx.rect(clipX, 0, L.w - clipX, L.headerH);
    ctx.clip();
    for (let c = part[0]; c <= part[1]; c++) {
      const w = L.cols.size(c);
      if (!w) continue;
      const x = L.x(c);
      if (colSel(c)) {
        ctx.fillStyle = colFull(c) ? theme.accent : theme.headerSel;
        ctx.fillRect(x, 0, w, L.headerH);
      }
      ctx.fillStyle = colFull(c) ? '#fff' : colSel(c) ? theme.headerSelText : theme.headerText;
      ctx.fillText(colLetters(c), x + w / 2, L.headerH / 2 + 0.5);
      ctx.strokeStyle = theme.headerLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w - 0.5, 0);
      ctx.lineTo(x + w - 0.5, L.headerH);
      ctx.stroke();
      if (colSel(c) && !colFull(c)) {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(x, L.headerH - 2, w, 2);
      }
    }
    ctx.restore();
  }
  // Row headers.
  ctx.fillStyle = theme.header;
  ctx.fillRect(0, L.headerH, L.headerW, L.h - L.headerH);
  for (const part of rowParts) {
    if (!part) continue;
    ctx.save();
    ctx.beginPath();
    const clipY = part[0] < L.fr ? L.headerH : L.headerH + L.frozenH;
    ctx.rect(0, clipY, L.headerW, L.h - clipY);
    ctx.clip();
    for (let r = part[0]; r <= part[1]; r++) {
      const h = L.rows.size(r);
      if (!h) continue;
      const y = L.y(r);
      if (rowSel(r)) {
        ctx.fillStyle = rowFull(r) ? theme.accent : theme.headerSel;
        ctx.fillRect(0, y, L.headerW, h);
      }
      ctx.fillStyle = rowFull(r) ? '#fff' : rowSel(r) ? theme.headerSelText : theme.headerText;
      ctx.fillText(String(r + 1), L.headerW / 2, y + h / 2 + 0.5);
      ctx.strokeStyle = theme.headerLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + h - 0.5);
      ctx.lineTo(L.headerW, y + h - 0.5);
      ctx.stroke();
      if (rowSel(r) && !rowFull(r)) {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(L.headerW - 2, y, 2, h);
      }
    }
    ctx.restore();
  }
  // Corner (select all) and header edges.
  ctx.fillStyle = theme.header;
  ctx.fillRect(0, 0, L.headerW, L.headerH);
  ctx.fillStyle = theme.headerText;
  ctx.beginPath();
  ctx.moveTo(L.headerW - 4, L.headerH - 12);
  ctx.lineTo(L.headerW - 4, L.headerH - 4);
  ctx.lineTo(L.headerW - 12, L.headerH - 4);
  ctx.fill();
  ctx.strokeStyle = theme.headerLine;
  ctx.beginPath();
  ctx.moveTo(0, L.headerH - 0.5);
  ctx.lineTo(L.w, L.headerH - 0.5);
  ctx.moveTo(L.headerW - 0.5, 0);
  ctx.lineTo(L.headerW - 0.5, L.h);
  ctx.stroke();
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function colLetters(c: number): string {
  let s = '';
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Ranges a formula refers to on the given sheet, coloured in order (for the editor). */
export function formulaRefs(text: string, sheetName: string, sheetIdByName: (n: string) => string | null, sheetId: string): Array<{ range: Range; color: string; text: string }> {
  if (!text.startsWith('=')) return [];
  const out: Array<{ range: Range; color: string; text: string }> = [];
  let i = 0;
  for (const t of tokenize(text.slice(1))) {
    if (t.type !== 'ref') continue;
    const color = REF_COLORS[i++ % REF_COLORS.length]!;
    if (t.sheet) {
      const name = t.sheet.replace(/^'|'$/g, '').replace(/''/g, "'");
      if (sheetIdByName(name) !== sheetId && name.toLowerCase() !== sheetName.toLowerCase()) continue;
    }
    const rg = parseRange(t.text.slice(t.sheet ? t.sheet.length + 1 : 0));
    if (rg) out.push({ range: rg, color, text: t.text });
  }
  return out;
}
