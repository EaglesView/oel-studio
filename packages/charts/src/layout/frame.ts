/**
 * Chart area, title and legend; what remains is the plot rectangle the
 * family layouts (cartesian, pie, radar, 3-D, chartEx) draw into.
 */
import { readText } from '../data';
import { Ctx, PT } from '../style';
import type { Paint, ResolvedChart, SeriesData, Stroke } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LegendEntry {
  label: string;
  fill: Paint | null;
  line: Stroke | null;
  /** Draw a line with a marker (line, scatter, radar series) instead of a box. */
  lineKey?: boolean;
  marker?: { fill: Paint | null; line: Stroke | null; symbol: string } | null;
  id: string;
}

const PAD = 7;

export function chartArea(ctx: Ctx) {
  const bg = ctx.opts.background === undefined ? '#FFFFFF' : ctx.opts.background;
  const look = ctx.box(ctx.spec.space, bg, bg ? { color: '#D9D9D9', width: 0.75 * PT } : null);
  ctx.push({ t: 'rect', id: 'chart', x: 0.5, y: 0.5, w: ctx.w - 1, h: ctx.h - 1, fill: look.fill ?? undefined, stroke: look.line ?? undefined, r: ctx.spec.rounded ? 8 : 0 });
  ctx.hit('chart', 0, 0, ctx.w, ctx.h);
}

/** Title text: explicit, linked to a cell, or the automatic one (single series name). */
export function titleText(data: ResolvedChart, resolve = undefined as Parameters<typeof readText>[2]): string | null {
  const t = data.spec.title;
  const visible = data.series.filter((s) => !s.series.hidden);
  if (t) {
    const txt = readText(t.f, t.text, resolve);
    if (txt) return txt;
    if (visible.length === 1) return visible[0]!.name;
    return 'Titre du graphique';
  }
  // No title element: Excel shows the series name of a single-series chart unless the title was deleted.
  if (!data.spec.autoTitleDeleted && visible.length === 1 && !data.spec.ex && data.spec.groups.length === 1) return visible[0]!.name;
  return null;
}

export function title(ctx: Ctx, data: ResolvedChart, r: Rect): Rect {
  const text = titleText(data, ctx.opts.resolve);
  if (!text) return r;
  const t = ctx.spec.title;
  const ts = ctx.text(t?.style, { size: 14 });
  const lines = text.split('\n');
  const lh = ts.size * 1.2;
  const h = lines.length * lh;
  const lay = t?.layout;
  const w = Math.max(...lines.map((l) => ctx.measure(l, ts)));
  const x = lay ? lay.x * ctx.w + w / 2 : r.x + r.w / 2;
  const y0 = lay ? lay.y * ctx.h : r.y + 4;
  const look = ctx.box(t?.shape, null, null);
  if (look.fill || look.line) ctx.push({ t: 'rect', id: 'title', x: x - w / 2 - 4, y: y0 - 2, w: w + 8, h: h + 4, fill: look.fill ?? undefined, stroke: look.line ?? undefined });
  lines.forEach((l, i) => ctx.label(l, x, y0 + i * lh, ts, 'middle', 'top', 'title'));
  ctx.hit('title', x - w / 2, y0, w, h);
  if (lay || t?.overlay) return r;
  return { x: r.x, y: r.y + h + 8, w: r.w, h: r.h - h - 8 };
}

export function legendEntries(ctx: Ctx, data: ResolvedChart): LegendEntry[] {
  const vis = data.series.filter((s) => !s.series.hidden);
  const first = vis[0];
  const byPoint = first && (['pie', 'doughnut', 'ofPie'].includes(first.group.kind) || (vis.length === 1 && first.group.varyColors)) && first.group.kind !== 'surface';
  let out: LegendEntry[] = [];
  if (byPoint && first) {
    const n = Math.max(first.cats.length, first.values.length);
    for (let i = 0; i < n; i++) {
      const look = ctx.seriesLook(first, i, 'fill');
      out.push({ label: first.cats[i] ?? String(i + 1), fill: look.fill, line: look.line, id: `point:${first.index}:${i}` });
    }
  } else {
    for (const s of vis) {
      const k = s.group.kind;
      const lineKey = k === 'line' || (k === 'scatter' && s.group.scatterStyle !== 'marker') || (k === 'radar' && s.group.radarStyle !== 'filled') || k === 'stock';
      const look = ctx.seriesLook(s, null, lineKey ? 'line' : 'fill');
      const markerOn = lineKey && hasMarker(s);
      const ml = markerOn ? ctx.seriesLook(s, null, 'marker') : null;
      out.push({ label: s.name, fill: look.fill, line: look.line, lineKey, marker: ml ? { ...ml, symbol: markerSymbol(s) } : null, id: `series:${s.index}` });
      for (const [ti, t] of (s.series.trendlines ?? []).entries()) {
        const kinds: Record<string, string> = { linear: 'Linéaire', exp: 'Expon.', log: 'Logarithmique', poly: 'Polynomial', power: 'Puissance', movingAvg: 'Moy. mobile' };
        const tl = ctx.stroke(t.line, { color: look.line?.color ?? (typeof look.fill === 'string' ? look.fill : '#595959'), width: 1.5 * PT });
        out.push({ label: t.name ?? `${kinds[t.kind] ?? t.kind} (${s.name})`, fill: null, line: tl ? { ...tl, dash: tl.dash ?? [2, 2] } : null, lineKey: true, id: `trendline:${s.index}:${ti}` });
      }
    }
  }
  const deleted = new Set(ctx.spec.legend?.deleted ?? []);
  out = out.filter((_, i) => !deleted.has(i));
  return out;
}

export function hasMarker(s: SeriesData): boolean {
  const sym = s.series.marker?.symbol;
  if (sym === 'none') return false;
  if (sym && sym !== 'auto') return true;
  const k = s.group.kind;
  if (k === 'line') return !!s.group.markers;
  if (k === 'scatter') return s.group.scatterStyle !== 'line' && s.group.scatterStyle !== 'smooth' && s.group.scatterStyle !== 'none';
  if (k === 'radar') return s.group.radarStyle === 'marker';
  if (k === 'stock') return false;
  return false;
}

const SYMBOLS = ['diamond', 'square', 'triangle', 'x', 'star', 'circle', 'plus', 'dash', 'dot'];
export function markerSymbol(s: SeriesData): string {
  const sym = s.series.marker?.symbol;
  if (sym && sym !== 'auto') return sym;
  // Office 2013+ default marker: circle; older styles cycle shapes by series.
  return ctx2013(s) ? 'circle' : SYMBOLS[s.series.idx % SYMBOLS.length]!;
}
const ctx2013 = (_s: SeriesData) => true;

export function legend(ctx: Ctx, entries: LegendEntry[], r: Rect): Rect {
  const lg = ctx.spec.legend;
  if (!lg || !entries.length) return r;
  const ts = ctx.text(lg.text);
  const key = 7 * PT;
  const lineKeyW = 18 * PT;
  const gap = 4;
  const itemW = (e: LegendEntry) => (e.lineKey ? lineKeyW : key) + gap + ctx.measure(e.label, ts) + 10;
  const rowH = Math.max(ts.size * 1.25, key + 4);
  const pos = lg.pos ?? 'r';
  const look = ctx.box(lg.shape, null, null);
  const items: { e: LegendEntry; x: number; y: number }[] = [];
  let box: Rect;
  if (pos === 'r' || pos === 'l' || pos === 'tr') {
    const w = Math.min(r.w * 0.4, Math.max(...entries.map(itemW)));
    const maxRows = Math.max(1, Math.floor((r.h - 8) / rowH));
    const shown = entries.slice(0, maxRows);
    const h = shown.length * rowH;
    const x = pos === 'l' ? r.x + 4 : r.x + r.w - w - 4;
    const y = pos === 'tr' ? r.y + 4 : r.y + (r.h - h) / 2;
    shown.forEach((e, i) => items.push({ e, x, y: y + i * rowH }));
    box = { x, y, w, h };
  } else {
    // Rows that wrap, centred.
    const rows: LegendEntry[][] = [[]];
    let cur = 0;
    for (const e of entries) {
      const iw = itemW(e);
      if (cur + iw > r.w - 16 && rows[rows.length - 1]!.length) {
        rows.push([]);
        cur = 0;
      }
      rows[rows.length - 1]!.push(e);
      cur += iw;
    }
    const shownRows = rows.slice(0, Math.max(1, Math.floor((r.h * 0.4) / rowH)));
    const h = shownRows.length * rowH;
    const y = pos === 't' ? r.y + 2 : r.y + r.h - h - 2;
    let minX = Infinity;
    let maxX = -Infinity;
    shownRows.forEach((row, ri) => {
      const total = row.reduce((s, e) => s + itemW(e), 0);
      let x = r.x + (r.w - total) / 2;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + total);
      for (const e of row) {
        items.push({ e, x, y: y + ri * rowH });
        x += itemW(e);
      }
    });
    box = { x: minX, y, w: maxX - minX, h };
  }
  if (lg.layout) {
    const dx = lg.layout.x * ctx.w - box.x;
    const dy = lg.layout.y * ctx.h - box.y;
    for (const it of items) {
      it.x += dx;
      it.y += dy;
    }
    box = { ...box, x: box.x + dx, y: box.y + dy };
  }
  if (look.fill || look.line) ctx.push({ t: 'rect', id: 'legend', x: box.x - 4, y: box.y - 2, w: box.w + 4, h: box.h + 4, fill: look.fill ?? undefined, stroke: look.line ?? undefined });
  for (const { e, x, y } of items) {
    const cy = y + rowH / 2;
    if (e.lineKey) {
      if (e.line) ctx.push({ t: 'path', id: 'legend', d: `M${x} ${cy}H${x + lineKeyW}`, stroke: { ...e.line, width: Math.min(e.line.width, 3 * PT) } });
      if (e.marker) drawMarker(ctx, e.marker.symbol, x + lineKeyW / 2, cy, 5 * PT, e.marker.fill, e.marker.line, 'legend');
    } else {
      ctx.push({ t: 'rect', id: 'legend', x, y: cy - key / 2, w: key, h: key, fill: e.fill ?? undefined, stroke: e.line ?? undefined });
    }
    ctx.label(e.label, x + (e.lineKey ? lineKeyW : key) + gap, cy, ts, 'start', 'middle', 'legend');
  }
  ctx.hit('legend', box.x - 4, box.y - 2, box.w + 4, box.h + 4);
  if (lg.overlay || lg.layout) return r;
  if (pos === 'r' || pos === 'tr') return pos === 'tr' ? r : { ...r, w: r.w - box.w - 12 };
  if (pos === 'l') return { ...r, x: r.x + box.w + 12, w: r.w - box.w - 12 };
  if (pos === 't') return { ...r, y: r.y + box.h + 6, h: r.h - box.h - 6 };
  return { ...r, h: r.h - box.h - 6 };
}

/** A data marker centred on (x, y); `size` is the marker's width in px. */
export function drawMarker(ctx: Ctx, symbol: string, x: number, y: number, size: number, fill: Paint | null, line: Stroke | null, id?: string) {
  const h = size / 2;
  const f = fill ?? undefined;
  const s = line ?? undefined;
  switch (symbol) {
    case 'none':
      return;
    case 'square':
      ctx.push({ t: 'rect', id, x: x - h, y: y - h, w: size, h: size, fill: f, stroke: s });
      return;
    case 'diamond':
      ctx.push({ t: 'path', id, d: `M${x} ${y - h}L${x + h} ${y}L${x} ${y + h}L${x - h} ${y}Z`, fill: f, stroke: s });
      return;
    case 'triangle':
      ctx.push({ t: 'path', id, d: `M${x} ${y - h}L${x + h} ${y + h}L${x - h} ${y + h}Z`, fill: f, stroke: s });
      return;
    case 'x':
      ctx.push({ t: 'path', id, d: `M${x - h} ${y - h}L${x + h} ${y + h}M${x + h} ${y - h}L${x - h} ${y + h}`, stroke: s ?? (typeof f === 'string' ? { color: f, width: 1.5 } : undefined) });
      return;
    case 'plus':
      ctx.push({ t: 'path', id, d: `M${x - h} ${y}H${x + h}M${x} ${y - h}V${y + h}`, stroke: s ?? (typeof f === 'string' ? { color: f, width: 1.5 } : undefined) });
      return;
    case 'star':
      ctx.push({ t: 'path', id, d: `M${x - h} ${y - h}L${x + h} ${y + h}M${x + h} ${y - h}L${x - h} ${y + h}M${x} ${y - h}V${y + h}`, stroke: s ?? (typeof f === 'string' ? { color: f, width: 1.5 } : undefined) });
      return;
    case 'dash':
      ctx.push({ t: 'rect', id, x: x - h, y: y - size / 8, w: size, h: size / 4, fill: f, stroke: s });
      return;
    case 'dot':
      ctx.push({ t: 'circle', id, cx: x, cy: y, r: size / 5, fill: f, stroke: s });
      return;
    default:
      ctx.push({ t: 'circle', id, cx: x, cy: y, r: h, fill: f, stroke: s });
  }
}

export function inset(r: Rect, d = PAD): Rect {
  return { x: r.x + d, y: r.y + d, w: Math.max(1, r.w - 2 * d), h: Math.max(1, r.h - 2 * d) };
}
