/**
 * Pies, doughnuts, pie of pie / bar of pie, and 3-D pies (an ellipse with a
 * rim, tilted by `view3D.rotX`). Angles start at 12 o'clock and run
 * clockwise, offset by `firstSliceAng`, like Excel.
 */
import { formatValue } from '../format';
import { Ctx, PT, shade } from '../style';
import type { Paint, ResolvedChart, SeriesData, Stroke } from '../types';
import { labelsOf, labelText } from './cartesian';
import type { Rect } from './frame';

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
const TAU = Math.PI * 2;

function arcPath(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, inner = 0): string {
  const pt = (a: number, k: number): [number, number] => [cx + Math.sin(a) * rx * k, cy - Math.cos(a) * ry * k];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (a1 - a0 >= TAU - 1e-6) {
    // Full circle: two halves.
    const mid = a0 + Math.PI;
    const o = arcPath(cx, cy, rx, ry, a0, mid, inner) + arcPath(cx, cy, rx, ry, mid, a0 + TAU - 1e-6, inner);
    return o;
  }
  const [x0, y0] = pt(a0, 1);
  const [x1, y1] = pt(a1, 1);
  if (inner > 0) {
    const [x2, y2] = pt(a1, inner);
    const [x3, y3] = pt(a0, inner);
    return `M${f2(x0)} ${f2(y0)}A${f2(rx)} ${f2(ry)} 0 ${large} 1 ${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}A${f2(rx * inner)} ${f2(ry * inner)} 0 ${large} 0 ${f2(x3)} ${f2(y3)}Z`;
  }
  return `M${f2(cx)} ${f2(cy)}L${f2(x0)} ${f2(y0)}A${f2(rx)} ${f2(ry)} 0 ${large} 1 ${f2(x1)} ${f2(y1)}Z`;
}

interface Slice {
  i: number;
  v: number;
  a0: number;
  a1: number;
  explode: number;
  fill: Paint | null;
  line: Stroke | null;
}

function slices(ctx: Ctx, s: SeriesData, start: number, idx: number[]): Slice[] {
  const total = idx.reduce((t, i) => t + Math.abs(s.values[i] ?? 0), 0) || 1;
  let a = start;
  return idx.map((i) => {
    const v = Math.abs(s.values[i] ?? 0);
    const a0 = a;
    a += (v / total) * TAU;
    const look = ctx.seriesLook(s, i, 'fill');
    const dpt = s.series.points?.find((p) => p.idx === i);
    return { i, v, a0, a1: a, explode: (dpt?.explosion ?? s.series.explosion ?? 0) / 100, fill: look.fill, line: look.line };
  });
}

export function pie(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const all = data.series.filter((s) => !s.series.hidden && ['pie', 'doughnut', 'ofPie'].includes(s.group.kind));
  const first = all[0];
  if (!first) return;
  const g = first.group;
  const three = g.threeD && g.kind === 'pie';
  const start = ((g.firstSliceAng ?? 0) * Math.PI) / 180;
  const plotLook = ctx.box(ctx.spec.plot, null, null);
  if (plotLook.fill || plotLook.line) ctx.push({ t: 'rect', id: 'plot', ...area, fill: plotLook.fill ?? undefined, stroke: plotLook.line ?? undefined });
  const lab = labelsOf(first);
  const ts = ctx.text(lab?.text);
  const outside = lab && ['outEnd', 'bestFit'].includes(lab.pos ?? 'bestFit') && g.kind !== 'doughnut';
  const margin = outside ? ts.size * 3 : 6;

  if (g.kind === 'ofPie') return ofPie(ctx, first, area, start, margin);

  const maxExplode = Math.max(0, ...(first.series.points ?? []).map((p) => (p.explosion ?? 0) / 100), (first.series.explosion ?? 0) / 100);
  let r = Math.max(4, Math.min(area.w, area.h) / 2 - margin) / (1 + maxExplode);
  const tilt = three ? Math.max(0.2, Math.sin((((ctx.spec.view3d?.rotX ?? 30) as number) * Math.PI) / 180)) : 1;
  const cx = area.x + area.w / 2;
  let cy = area.y + area.h / 2;
  const depth = three ? Math.max(6, r * 0.18 * ((ctx.spec.view3d?.hPercent ?? 100) / 100)) : 0;
  if (three) {
    r = Math.min(r, (area.w / 2 - margin) / (1 + maxExplode));
    cy -= depth / 2;
  }
  const rx = r;
  const ry = r * tilt;

  if (g.kind === 'doughnut') {
    // One ring per series, outer = first series.
    const hole = (g.holeSize ?? 50) / 100;
    const rings = all.length;
    const ringW = (1 - hole) / rings;
    all.forEach((s, k) => {
      const outer = 1 - k * ringW;
      const inner = outer - ringW;
      const sl = slices(ctx, s, start, s.values.map((_, i) => i));
      for (const p of sl) {
        const m = (p.a0 + p.a1) / 2;
        const ox = Math.sin(m) * p.explode * r;
        const oy = -Math.cos(m) * p.explode * r;
        ctx.push({ t: 'path', id: `point:${s.index}:${p.i}`, d: arcPath(cx + ox, cy + oy, rx * outer, ry * outer, p.a0, p.a1, inner / outer), fill: p.fill ?? undefined, stroke: p.line ?? undefined });
        const l = labelsOf(s);
        const total = sl.reduce((t, q) => t + q.v, 0) || 1;
        const text = l ? labelText(l, s, p.i, { pct: p.v / total }) : null;
        if (text) ctx.label(text, cx + ox + Math.sin(m) * rx * (outer + inner) / 2, cy + oy - Math.cos(m) * ry * (outer + inner) / 2, ctx.text(l?.text), 'middle', 'middle', `labels:${s.index}`);
      }
    });
    ctx.hit('plot', cx - rx, cy - ry, 2 * rx, 2 * ry);
    return;
  }

  const sl = slices(ctx, first, start, first.values.map((_, i) => i));
  const total = sl.reduce((t, q) => t + q.v, 0) || 1;
  if (three) {
    // Rim: the near half of each slice, darker, drawn from the back.
    const order = [...sl].sort((a, b) => Math.cos((b.a0 + b.a1) / 2) - Math.cos((a.a0 + a.a1) / 2));
    for (const p of order) {
      const m = (p.a0 + p.a1) / 2;
      const ox = Math.sin(m) * p.explode * r;
      const oy = -Math.cos(m) * p.explode * ry;
      const fill = p.fill ? shade(p.fill, 0.72) : undefined;
      // Visible rim between angles in the lower half (π/2 … 3π/2).
      const lo = Math.max(p.a0, Math.PI / 2);
      const hi = Math.min(p.a1, (3 * Math.PI) / 2);
      const spans: [number, number][] = [
        [lo, hi],
        [Math.max(p.a0, Math.PI / 2 + TAU), Math.min(p.a1, (3 * Math.PI) / 2 + TAU)],
      ];
      for (const [b0, b1] of spans) {
        if (b1 <= b0) continue;
        const px = (a: number) => cx + ox + Math.sin(a) * rx;
        const py = (a: number) => cy + oy - Math.cos(a) * ry;
        const d = `M${f2(px(b0))} ${f2(py(b0))}A${f2(rx)} ${f2(ry)} 0 0 1 ${f2(px(b1))} ${f2(py(b1))}L${f2(px(b1))} ${f2(py(b1) + depth)}A${f2(rx)} ${f2(ry)} 0 0 0 ${f2(px(b0))} ${f2(py(b0) + depth)}Z`;
        ctx.push({ t: 'path', id: `point:${first.index}:${p.i}`, d, fill, stroke: p.line ?? undefined });
      }
    }
  }
  for (const p of sl) {
    const m = (p.a0 + p.a1) / 2;
    const ox = Math.sin(m) * p.explode * r;
    const oy = -Math.cos(m) * p.explode * ry;
    ctx.push({ t: 'path', id: `point:${first.index}:${p.i}`, d: arcPath(cx + ox, cy + oy, rx, ry, p.a0, p.a1), fill: p.fill ?? undefined, stroke: p.line ?? undefined });
    ctx.hit(`point:${first.index}:${p.i}`, cx + ox + Math.sin(m) * rx * 0.5 - 10, cy + oy - Math.cos(m) * ry * 0.5 - 10, 20, 20);
  }
  if (lab) drawPieLabels(ctx, first, sl, total, cx, cy, rx, ry, r, outside ? 'out' : (lab.pos ?? 'bestFit'));
  ctx.hit('plot', cx - rx, cy - ry, 2 * rx, 2 * ry + depth);
}

function drawPieLabels(ctx: Ctx, s: SeriesData, sl: Slice[], total: number, cx: number, cy: number, rx: number, ry: number, r: number, pos: string) {
  const l = labelsOf(s)!;
  const ts = ctx.text(l.text);
  for (const p of sl) {
    const text = labelText(l, s, p.i, { pct: p.v / total });
    if (!text) continue;
    const m = (p.a0 + p.a1) / 2;
    const ox = Math.sin(m) * p.explode * r;
    const oy = -Math.cos(m) * p.explode * ry;
    const k = pos === 'ctr' ? 0.55 : pos === 'inEnd' ? 0.78 : 1.12;
    const x = cx + ox + Math.sin(m) * rx * k;
    const y = cy + oy - Math.cos(m) * ry * k;
    const anchor = pos === 'out' || pos === 'outEnd' ? (Math.sin(m) >= 0 ? 'start' : 'end') : 'middle';
    // Leader line when the label sits outside a thin slice.
    if ((pos === 'out' || pos === 'bestFit') && p.a1 - p.a0 < 0.35) {
      ctx.push({ t: 'path', id: `leader:${s.index}`, d: `M${f2(cx + ox + Math.sin(m) * rx)} ${f2(cy + oy - Math.cos(m) * ry)}L${f2(x)} ${f2(y)}`, stroke: { color: '#A6A6A6', width: 0.75 * PT } });
    }
    const lines = text.split('\n');
    lines.forEach((t, j) => ctx.label(t, x, y + (j - (lines.length - 1) / 2) * ts.size * 1.15, ts, anchor, 'middle', `labels:${s.index}`));
  }
}

function ofPie(ctx: Ctx, s: SeriesData, area: Rect, start: number, margin: number) {
  const g = s.group;
  const n = s.values.length;
  // Points that go to the secondary plot: the last `splitPos` (default 2) by position, or by value/percent.
  let second: number[] = [];
  const pos = Math.round(g.splitPos ?? 2);
  const idx = s.values.map((_, i) => i);
  const total = s.values.reduce<number>((t, v) => t + Math.abs(v ?? 0), 0) || 1;
  switch (g.splitType) {
    case 'val':
      second = idx.filter((i) => Math.abs(s.values[i] ?? 0) < (g.splitPos ?? 0));
      break;
    case 'percent':
      second = idx.filter((i) => (Math.abs(s.values[i] ?? 0) / total) * 100 < (g.splitPos ?? 10));
      break;
    default:
      second = idx.slice(Math.max(0, n - pos));
  }
  const firstIdx = idx.filter((i) => !second.includes(i));
  const otherV = second.reduce((t, i) => t + Math.abs(s.values[i] ?? 0), 0);
  const r = Math.max(4, Math.min(area.w * 0.28, area.h / 2 - margin));
  const cx = area.x + area.w * 0.3;
  const cy = area.y + area.h / 2;
  // Main pie: first points + one « Autre » slice, placed on the right (3 o'clock) like Excel.
  const totalMain = firstIdx.reduce((t, i) => t + Math.abs(s.values[i] ?? 0), 0) + otherV || 1;
  const otherA = (otherV / totalMain) * TAU;
  let a = Math.PI / 2 + otherA / 2;
  const main: Slice[] = [];
  for (const i of firstIdx) {
    const v = Math.abs(s.values[i] ?? 0);
    const a0 = a;
    a += (v / totalMain) * TAU;
    const look = ctx.seriesLook(s, i, 'fill');
    main.push({ i, v, a0, a1: a, explode: 0, fill: look.fill, line: look.line });
  }
  void start;
  for (const p of main) ctx.push({ t: 'path', id: `point:${s.index}:${p.i}`, d: arcPath(cx, cy, r, r, p.a0, p.a1), fill: p.fill ?? undefined, stroke: p.line ?? undefined });
  ctx.push({ t: 'path', id: `point:${s.index}:other`, d: arcPath(cx, cy, r, r, Math.PI / 2 - otherA / 2, Math.PI / 2 + otherA / 2), fill: '#A5A5A5', stroke: { color: '#FFFFFF', width: 0.75 * PT } });
  // Secondary plot.
  const size = (g.secondPieSize ?? 75) / 100;
  const r2 = r * size;
  const cx2 = area.x + area.w * 0.78;
  const lines = ctx.stroke(g.serLines?.line, { color: '#A6A6A6', width: 0.75 * PT });
  const ax = cx + Math.sin(Math.PI / 2 - otherA / 2) * r;
  const ay1 = cy - Math.cos(Math.PI / 2 - otherA / 2) * r;
  const ay2 = cy - Math.cos(Math.PI / 2 + otherA / 2) * r;
  if (g.ofPieType === 'bar') {
    const h = r * 1.6 * size;
    const w = r2 * 0.6;
    let y = cy - h / 2;
    for (const i of second) {
      const v = Math.abs(s.values[i] ?? 0);
      const bh = (v / (otherV || 1)) * h;
      const look = ctx.seriesLook(s, i, 'fill');
      ctx.push({ t: 'rect', id: `point:${s.index}:${i}`, x: cx2 - w / 2, y, w, h: bh, fill: look.fill ?? undefined, stroke: look.line ?? undefined });
      y += bh;
    }
    if (lines) ctx.push({ t: 'path', id: 'serLines', d: `M${f2(ax)} ${f2(ay1)}L${f2(cx2 - w / 2)} ${f2(cy - h / 2)}M${f2(ax)} ${f2(ay2)}L${f2(cx2 - w / 2)} ${f2(cy + h / 2)}`, stroke: lines });
  } else {
    let b = Math.PI / 2 - Math.PI / 2;
    for (const i of second) {
      const v = Math.abs(s.values[i] ?? 0);
      const b0 = b;
      b += (v / (otherV || 1)) * TAU;
      const look = ctx.seriesLook(s, i, 'fill');
      ctx.push({ t: 'path', id: `point:${s.index}:${i}`, d: arcPath(cx2, cy, r2, r2, b0, b), fill: look.fill ?? undefined, stroke: look.line ?? undefined });
    }
    if (lines) ctx.push({ t: 'path', id: 'serLines', d: `M${f2(ax)} ${f2(ay1)}L${f2(cx2)} ${f2(cy - r2)}M${f2(ax)} ${f2(ay2)}L${f2(cx2)} ${f2(cy + r2)}`, stroke: lines });
  }
  const l = labelsOf(s);
  if (l) {
    const ts = ctx.text(l.text);
    for (const p of main) {
      const t = labelText(l, s, p.i, { pct: p.v / total });
      const m = (p.a0 + p.a1) / 2;
      if (t) ctx.label(t, cx + Math.sin(m) * r * 0.6, cy - Math.cos(m) * r * 0.6, ts, 'middle', 'middle', `labels:${s.index}`);
    }
    if (l.showPct || l.showVal) ctx.label(l.showPct ? `Autre ${formatValue(otherV / total, '0%')}` : formatValue(otherV, s.format), cx + r * 0.6, cy, ts, 'middle', 'middle', `labels:${s.index}`);
  }
  ctx.hit('plot', area.x, area.y, area.w, area.h);
}
