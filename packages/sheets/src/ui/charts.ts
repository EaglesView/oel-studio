/**
 * Chart commands of the spreadsheet editor (Figma H0–H2): insert the
 * recommended chart from the selection (Alt+F1), change its type, its
 * elements and data, move, resize, delete. Each command is one Y.Doc
 * transaction, so one undo step.
 */
import { applyType, newChart, recommend, type CellBlock, type ChartSpec } from '@oel/charts';
import { current } from '../grid/selection';
import type { Drawing, DrawingMarker } from '../model/types';
import type { SheetController } from './controller';

const EMU = 9525;

/** Pixel frame of a drawing in sheet coordinates (no scroll, no headers). */
export function frameOf(ctl: SheetController, d: Drawing) {
  const { rows, cols } = ctl.geometry();
  const at = (m: DrawingMarker) => ({ x: cols.offset(m.c) + (m.dx ?? 0) / EMU, y: rows.offset(m.r) + (m.dy ?? 0) / EMU });
  const a = at(d.from);
  const fixed = (d.editAs === 'oneCell' || d.editAs === 'absolute') && !!d.cx && !!d.cy;
  const b = d.to && !fixed ? at(d.to) : { x: a.x + (d.cx ?? 0) / EMU, y: a.y + (d.cy ?? 0) / EMU };
  return { x: a.x, y: a.y, w: Math.max(1, b.x - a.x), h: Math.max(1, b.y - a.y) };
}

/** Sheet pixel position → anchor marker (cell + offset). */
export function markerAt(ctl: SheetController, x: number, y: number): DrawingMarker {
  const { rows, cols } = ctl.geometry();
  const c = cols.indexAt(Math.max(0, x));
  const r = rows.indexAt(Math.max(0, y));
  return { r, c, dx: Math.round((Math.max(0, x) - cols.offset(c)) * EMU), dy: Math.round((Math.max(0, y) - rows.offset(r)) * EMU) };
}

/** Put a drawing at a pixel frame (both corners re-anchored, size kept for fixed drawings). */
export function placed(ctl: SheetController, d: Drawing, f: { x: number; y: number; w: number; h: number }): Drawing {
  const from = markerAt(ctl, f.x, f.y);
  const to = markerAt(ctl, f.x + f.w, f.y + f.h);
  return { ...d, from, to, cx: Math.round(f.w * EMU), cy: Math.round(f.h * EMU) };
}

/** The block a chart is made from: the selection, or the current region around a single cell (Excel). */
export function chartBlock(ctl: SheetController): CellBlock | null {
  let rg = current(ctl.sel);
  const filled = (r: number, c: number) => ctl.filled(r, c);
  if (rg.r0 === rg.r1 && rg.c0 === rg.c1) {
    if (!filled(rg.r0, rg.c0)) return null;
    // Grow while a neighbouring row or column holds something.
    let grown = true;
    while (grown) {
      grown = false;
      const rowHas = (r: number) => r >= 0 && Array.from({ length: rg.c1 - rg.c0 + 1 }, (_, k) => rg.c0 + k).some((c) => filled(r, c));
      const colHas = (c: number) => c >= 0 && Array.from({ length: rg.r1 - rg.r0 + 1 }, (_, k) => rg.r0 + k).some((r) => filled(r, c));
      if (rowHas(rg.r0 - 1)) (rg = { ...rg, r0: rg.r0 - 1 }), (grown = true);
      if (rowHas(rg.r1 + 1) && rg.r1 - rg.r0 < 5000) (rg = { ...rg, r1: rg.r1 + 1 }), (grown = true);
      if (colHas(rg.c0 - 1)) (rg = { ...rg, c0: rg.c0 - 1 }), (grown = true);
      if (colHas(rg.c1 + 1) && rg.c1 - rg.c0 < 200) (rg = { ...rg, c1: rg.c1 + 1 }), (grown = true);
    }
  }
  // Whole columns or rows: stop at the used area.
  const used = ctl.doc.usedRange(ctl.sheetId);
  if (used) rg = { r0: Math.max(rg.r0, used.r0), c0: Math.max(rg.c0, used.c0), r1: Math.min(rg.r1, used.r1), c1: Math.min(rg.c1, used.c1) };
  if (rg.r1 < rg.r0 || rg.c1 < rg.c0) return null;
  const si = ctl.sheetIndex;
  return {
    sheet: ctl.props.name,
    ...rg,
    text: (r, c) => ctl.view(r, c).text,
    num: (r, c) => {
      const out = ctl.calc.get(si, r, c);
      if (out) return out.t === 'n' && typeof out.v === 'number' ? out.v : null;
      const t = ctl.view(r, c);
      return t.kind === 'n' && t.text.trim() !== '' && Number.isFinite(Number(t.text)) ? Number(t.text) : null;
    },
  };
}

/** Alt+F1: the recommended chart of the selection, next to it, selected. Returns false (with nothing done) when there is no data. */
export function insertChart(ctl: SheetController, typeId?: string): boolean {
  if (ctl.readOnlyFlag) return false;
  const block = chartBlock(ctl);
  if (!block) return false;
  let spec = newChart(block, 'col-clustered');
  const id = typeId ?? recommend(spec)[0]?.id ?? 'col-clustered';
  if (id !== 'col-clustered') spec = applyType(spec, id);
  const { rows, cols } = ctl.geometry();
  const x = cols.offset(block.c1 + 1) + 16;
  const y = rows.offset(block.r0);
  const list = ctl.doc.drawings(ctl.sheetId);
  const n = list.filter((d) => d.kind === 'chart').length + 1;
  const d = placed(ctl, { kind: 'chart', name: `Graphique ${n}`, from: { r: 0, c: 0 }, chart: spec }, { x, y, w: 480, h: 288 });
  ctl.doc.setDrawings(ctl.sheetId, [...list, d]);
  ctl.selectDrawing(list.length);
  return true;
}

export function selectedChart(ctl: SheetController): { index: number; drawing: Drawing; spec: ChartSpec } | null {
  const i = ctl.selectedDrawing;
  if (i == null) return null;
  const d = ctl.doc.drawings(ctl.sheetId)[i];
  return d?.chart ? { index: i, drawing: d, spec: d.chart } : null;
}

export function updateChart(ctl: SheetController, index: number, fn: (s: ChartSpec) => ChartSpec) {
  if (ctl.readOnlyFlag) return;
  ctl.doc.updateDrawing(ctl.sheetId, index, (d) => (d.chart ? { ...d, chart: fn(d.chart) } : d));
}

export function moveDrawing(ctl: SheetController, index: number, frame: { x: number; y: number; w: number; h: number }) {
  if (ctl.readOnlyFlag) return;
  ctl.doc.updateDrawing(ctl.sheetId, index, (d) => placed(ctl, d, frame));
}

export function deleteDrawing(ctl: SheetController, index: number) {
  if (ctl.readOnlyFlag) return;
  const list = ctl.doc.drawings(ctl.sheetId);
  list.splice(index, 1);
  ctl.doc.setDrawings(ctl.sheetId, list);
  ctl.selectDrawing(null);
}

export function duplicateDrawing(ctl: SheetController, index: number) {
  const list = ctl.doc.drawings(ctl.sheetId);
  const d = list[index];
  if (!d || ctl.readOnlyFlag) return;
  const f = frameOf(ctl, d);
  const copy = placed(ctl, { ...d, src: undefined, oid: undefined, name: `${d.name} (copie)`, chart: d.chart ? { ...d.chart, part: '' } : undefined }, { ...f, x: f.x + 20, y: f.y + 20 });
  ctl.doc.setDrawings(ctl.sheetId, [...list, copy]);
  ctl.selectDrawing(list.length);
}
