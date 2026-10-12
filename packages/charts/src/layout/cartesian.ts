/**
 * Charts on two axes: columns and bars (clustered, stacked, 100 %), lines,
 * areas, scatter, bubbles, stock, and any combination of them (secondary
 * value axes included). Geometry follows Excel: gap width and overlap for
 * bars, categories between tick marks, automatic bounds from `scale.ts`.
 */
import { categoryCount } from '../data';
import { formatValue } from '../format';
import { displayUnits, frac, type Scale, valueScale } from '../scale';
import { fit, movingAverage, stdev } from '../stats';
import { Ctx, GRID_GREY, PT, type ResolvedText } from '../style';
import type { Axis, DataLabels, Group, Paint, ResolvedChart, SeriesData, Stroke } from '../types';
import { drawMarker, hasMarker, markerSymbol, type Rect } from './frame';
import { tr } from '@oel/i18n';

const TICK = 4;

interface ValAxis {
  id: number;
  spec: Axis;
  scale: Scale;
  secondary: boolean;
  /** Labels formatted for display (display units applied). */
  fmt: (v: number) => string;
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`).join('');
  let d = `M${f2(pts[0]![0])} ${f2(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f2(c1[0]!)} ${f2(c1[1]!)} ${f2(c2[0]!)} ${f2(c2[1]!)} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return d;
}

export function linePath(pts: [number, number][]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`).join('');
}

/** Effective labels of a series: series settings over the group's. */
export function labelsOf(sd: SeriesData): DataLabels | null {
  const l = sd.series.labels ?? sd.group.labels;
  if (!l || l.delete) return null;
  if (!(l.showVal || l.showCat || l.showSer || l.showPct || l.showBubble) && !l.points?.some((p) => p.text)) return null;
  return l;
}

export function labelText(l: DataLabels, sd: SeriesData, i: number, extra: { pct?: number; size?: number | null } = {}): string | null {
  const p = l.points?.find((x) => x.idx === i);
  if (p?.delete) return null;
  if (p?.text) return p.text;
  const parts: string[] = [];
  const v = sd.values[i];
  if (l.showSer) parts.push(sd.name);
  if (l.showCat) parts.push(sd.cats[i] ?? '');
  if (l.showVal && v != null) parts.push(formatValue(v, l.numFmt ?? sd.format));
  if (l.showPct && extra.pct != null) parts.push(formatValue(extra.pct, l.numFmt && l.numFmt.includes('%') ? l.numFmt : '0%'));
  if (l.showBubble && extra.size != null) parts.push(formatValue(extra.size, sd.format));
  return parts.length ? parts.join(l.separator ?? ', ') : null;
}

function isStacked(g: Group) {
  return g.grouping === 'stacked' || g.grouping === 'percentStacked';
}

export function cartesian(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const spec = ctx.spec;
  const all = data.series.filter((s) => !s.series.hidden);
  const groups = spec.groups.filter((g) => all.some((s) => s.group === g));
  if (!groups.length) return;
  const horizontal = groups.some((g) => g.kind === 'bar' && g.barDir === 'bar');
  const xy = groups.every((g) => g.kind === 'scatter' || g.kind === 'bubble');
  const axisById = new Map((spec.axes ?? []).map((a) => [a.id, a]));
  const first = groups[0]!;
  const catId = first.axisIds?.[0] ?? -1;
  const priValId = first.axisIds?.[1] ?? -2;
  const catSpec: Axis = axisById.get(catId) ?? { id: catId, kind: xy ? 'val' : 'cat', pos: horizontal ? 'l' : 'b' };
  const n = Math.max(1, categoryCount(all));
  const cats = all.find((s) => s.cats.length)?.cats ?? [];
  const levels = all.find((s) => s.catLevels?.length)?.catLevels;

  // ------------------------------------------------------------ value ranges
  const ranges = new Map<number, { min: number; max: number; zero: boolean; percent: boolean }>();
  const widen = (id: number, lo: number, hi: number, zero: boolean, percent = false) => {
    const r = ranges.get(id) ?? { min: Infinity, max: -Infinity, zero: false, percent: false };
    r.min = Math.min(r.min, lo);
    r.max = Math.max(r.max, hi);
    r.zero ||= zero;
    r.percent ||= percent;
    ranges.set(id, r);
  };
  const stackTops = new Map<SeriesData, { lo: (number | null)[]; hi: (number | null)[] }>();
  for (const g of groups) {
    const ser = all.filter((s) => s.group === g);
    const valId = g.axisIds?.[1] ?? priValId;
    const zero = g.kind === 'bar' || g.kind === 'area';
    if (isStacked(g) && g.kind !== 'scatter') {
      const pct = g.grouping === 'percentStacked';
      for (let i = 0; i < n; i++) {
        const total = ser.reduce((s, x) => s + Math.abs(x.values[i] ?? 0), 0) || 1;
        let pos = 0;
        let neg = 0;
        for (const s of ser) {
          const raw = s.values[i];
          const t = stackTops.get(s) ?? { lo: [], hi: [] };
          stackTops.set(s, t);
          if (raw == null) {
            t.lo[i] = null;
            t.hi[i] = null;
            continue;
          }
          const v = pct ? raw / total : raw;
          if (v >= 0 || g.kind !== 'bar') {
            t.lo[i] = pos;
            pos += v;
            t.hi[i] = pos;
          } else {
            t.lo[i] = neg;
            neg += v;
            t.hi[i] = neg;
          }
        }
        widen(valId, Math.min(neg, pos), Math.max(pos, neg), zero, pct);
      }
    } else {
      for (const s of ser) {
        const vals = s.values.filter((v): v is number => v != null);
        if (vals.length) widen(valId, Math.min(...vals), Math.max(...vals), zero);
        for (const e of s.series.errBars ?? []) {
          if ((e.dir ?? 'y') !== 'y') continue;
          const amt = errorAmount(e, s);
          vals.forEach((v, i) => widen(valId, v - (amt(i)?.[0] ?? 0), v + (amt(i)?.[1] ?? 0), false));
        }
      }
    }
  }
  let xRange: { min: number; max: number } | null = null;
  if (xy) {
    const xs = all.flatMap((s) => s.xs ?? []).filter((v): v is number => v != null);
    xRange = { min: Math.min(...xs), max: Math.max(...xs) };
  }

  // ---------------------------------------------------------------- margins
  const tsCat = ctx.text(catSpec.text);
  const valAxes: ValAxis[] = [];
  const valIds = [...new Set(groups.map((g) => g.axisIds?.[1] ?? priValId))];
  const makeVal = (id: number, length: number): ValAxis => {
    const spec: Axis = axisById.get(id) ?? { id, kind: 'val', pos: horizontal ? 'b' : 'l', majorGrid: id === priValId ? {} : undefined };
    const r = ranges.get(id) ?? { min: 0, max: 1, zero: true, percent: false };
    const scale = valueScale(r.min, r.max, { min: spec.min, max: spec.max, major: spec.majorUnit, minor: spec.minorUnit, logBase: spec.logBase, length, includeZero: r.zero, percent: r.percent });
    const du = displayUnits(spec.dispUnits === 'percentage' ? null : spec.dispUnits);
    const srcFmt = all.find((s) => (s.group.axisIds?.[1] ?? priValId) === id)?.format;
    const code = spec.numFmt && !(spec.sourceLinked && srcFmt) ? spec.numFmt : r.percent ? '0%' : (srcFmt ?? 'General');
    const fmt = (v: number) => formatValue(du ? v / du.div : v, spec.dispUnits === 'percentage' ? '0%' : code);
    return { id, spec, scale, secondary: id !== priValId, fmt };
  };
  // First pass with an estimated length, then again with the real one.
  let inner = { ...area };
  let xScale: Scale | null = null;
  let catRot = 0;
  let catSkip = 1;
  for (let pass = 0; pass < 2; pass++) {
    valAxes.length = 0;
    for (const id of valIds) valAxes.push(makeVal(id, horizontal ? inner.w : inner.h));
    if (xy && xRange) {
      xScale = valueScale(xRange.min, xRange.max, { min: catSpec.min, max: catSpec.max, major: catSpec.majorUnit, logBase: catSpec.logBase, length: horizontal ? inner.h : inner.w });
    }
    let left = 4;
    let right = 6;
    let top = 6;
    let bottom = 4;
    for (const va of valAxes) {
      if (va.spec.delete || va.spec.tickLblPos === 'none') continue;
      const ts = ctx.text(va.spec.text);
      const widest = Math.max(...va.scale.ticks.map((t) => ctx.measure(va.fmt(t), ts)));
      const titleSpace = va.spec.title ? ctx.text(va.spec.title.style, { size: 10, bold: false }).size * 1.6 : 0;
      const du = displayUnits(va.spec.dispUnits === 'percentage' ? null : va.spec.dispUnits);
      const duSpace = du?.label ? ts.size * 1.5 : 0;
      if (horizontal) {
        const h = ts.size * 1.3 + TICK + titleSpace;
        if (va.secondary) top += h;
        else bottom += h;
      } else {
        const w = widest + TICK + 4 + titleSpace + duSpace;
        if (va.secondary || va.spec.pos === 'r') right += w;
        else left += w;
      }
    }
    if (!catSpec.delete && catSpec.tickLblPos !== 'none') {
      const titleSpace = catSpec.title ? ctx.text(catSpec.title.style, { size: 10 }).size * 1.6 : 0;
      if (xy && xScale) {
        if (horizontal) left += Math.max(...xScale.ticks.map((t) => ctx.measure(formatValue(t, catSpec.numFmt), tsCat))) + TICK + 4 + titleSpace;
        else bottom += tsCat.size * 1.3 + TICK + titleSpace;
      } else if (horizontal) {
        left += Math.min(area.w * 0.4, Math.max(0, ...cats.map((c) => ctx.measure(c, tsCat)))) + TICK + 4 + titleSpace;
      } else {
        const slot = (area.w - left - right) / n;
        const widest = Math.max(0, ...cats.map((c) => ctx.measure(c, tsCat)));
        catRot = tsCat.rot ?? 0;
        catSkip = catSpec.tickLblSkip ?? 1;
        if (tsCat.rot == null && widest > slot * 0.95) {
          if (n <= 40) catRot = -45;
          else catSkip = Math.ceil((tsCat.size * 1.3) / Math.max(slot, 1));
        }
        const h = catRot ? Math.min(area.h * 0.45, widest * Math.sin((Math.abs(catRot) * Math.PI) / 180) + tsCat.size) : tsCat.size * 1.3;
        bottom += h + TICK + titleSpace + (levels && levels.length > 1 ? tsCat.size * 1.4 * (levels.length - 1) : 0);
      }
    }
    inner = { x: area.x + left, y: area.y + top, w: Math.max(10, area.w - left - right), h: Math.max(10, area.h - top - bottom) };
  }
  // Points on the tick marks (areas, `midCat`): keep the first and last labels inside the chart.
  const onTicks = (axisById.get(priValId)?.crossBetween ?? (groups.every((g) => g.kind === 'area') ? 'midCat' : 'between')) === 'midCat';
  if (onTicks && !horizontal && !xy && cats.length) {
    const half = (s?: string) => (s ? ctx.measure(s, tsCat) / 2 : 0);
    const l = Math.max(0, half(cats[0]) - (inner.x - area.x));
    const r = Math.max(0, half(cats[cats.length - 1]) - (area.x + area.w - inner.x - inner.w));
    inner = { ...inner, x: inner.x + l, w: Math.max(10, inner.w - l - r) };
  }
  if (spec.plotLayout?.inner && spec.plotLayout.w && spec.plotLayout.h) {
    inner = { x: spec.plotLayout.x * ctx.w, y: spec.plotLayout.y * ctx.h, w: spec.plotLayout.w * ctx.w, h: spec.plotLayout.h * ctx.h };
  }

  // ------------------------------------------------------------- positions
  const catReverse = !!catSpec.reverse;
  const between = (axisById.get(priValId)?.crossBetween ?? (groups.some((g) => g.kind === 'bar' || g.kind === 'stock') ? 'between' : groups.every((g) => g.kind === 'area') ? 'midCat' : 'between')) !== 'midCat';
  const catLen = horizontal ? inner.h : inner.w;
  const slot = between ? catLen / n : catLen / Math.max(1, n - 1);
  /** Centre of category `i` along the category direction (px). */
  const catAt = (i: number) => {
    const k = catReverse ? n - 1 - i : i;
    const off = between ? (k + 0.5) * slot : k * slot;
    return horizontal ? inner.y + inner.h - off : inner.x + off;
  };
  const xAt = (x: number) => {
    const t = frac(xScale!, x);
    const k = catReverse ? 1 - t : t;
    return horizontal ? inner.y + inner.h - k * inner.h : inner.x + k * inner.w;
  };
  const valAt = (va: ValAxis, v: number) => {
    let t = frac(va.scale, v);
    if (va.spec.reverse) t = 1 - t;
    return horizontal ? inner.x + t * inner.w : inner.y + inner.h - t * inner.h;
  };
  const P = (c: number, v: number): [number, number] => (horizontal ? [v, c] : [c, v]);
  const vaOf = (g: Group) => valAxes.find((a) => a.id === (g.axisIds?.[1] ?? priValId)) ?? valAxes[0]!;
  const baseOf = (va: ValAxis) => {
    const c = catSpec.crossesAt ?? (catSpec.crosses === 'max' ? va.scale.max : catSpec.crosses === 'min' ? va.scale.min : 0);
    return Math.max(va.scale.min, Math.min(va.scale.max, va.scale.log ? va.scale.min : c));
  };

  // ------------------------------------------------------------ backgrounds
  const plotLook = ctx.box(spec.plot, null, null);
  if (plotLook.fill || plotLook.line) ctx.push({ t: 'rect', id: 'plot', x: inner.x, y: inner.y, w: inner.w, h: inner.h, fill: plotLook.fill ?? undefined, stroke: plotLook.line ?? undefined });
  ctx.hit('plot', inner.x, inner.y, inner.w, inner.h);
  for (const va of valAxes) {
    for (const [grid, ticks, def] of [
      [va.spec.minorGrid, minorTicks(va.scale), { color: '#F2F2F2', width: 0.75 * PT }],
      [va.spec.majorGrid, va.scale.ticks, { color: GRID_GREY, width: 0.75 * PT }],
    ] as const) {
      if (!grid) continue;
      const st = ctx.stroke(grid.line, def);
      if (!st) continue;
      const d = ticks.map((t) => {
        const p = valAt(va, t);
        return horizontal ? `M${f2(p)} ${f2(inner.y)}V${f2(inner.y + inner.h)}` : `M${f2(inner.x)} ${f2(p)}H${f2(inner.x + inner.w)}`;
      });
      ctx.push({ t: 'path', id: `gridlines:${va.id}`, d: d.join(''), stroke: st });
    }
  }
  if (catSpec.majorGrid) {
    const st = ctx.stroke(catSpec.majorGrid.line, { color: GRID_GREY, width: 0.75 * PT });
    if (st) {
      const marks = xy && xScale ? xScale.ticks.map(xAt) : Array.from({ length: between ? n + 1 : n }, (_, i) => (horizontal ? inner.y + inner.h - i * slot : inner.x + i * slot));
      ctx.push({ t: 'path', id: `gridlines:${catSpec.id}`, d: marks.map((p) => (horizontal ? `M${f2(inner.x)} ${f2(p)}H${f2(inner.x + inner.w)}` : `M${f2(p)} ${f2(inner.y)}V${f2(inner.y + inner.h)}`)).join(''), stroke: st });
    }
  }

  // ----------------------------------------------------------------- series
  const labelJobs: (() => void)[] = [];
  for (const g of groups) {
    const ser = all.filter((s) => s.group === g);
    const va = vaOf(g);
    const base = baseOf(va);
    if (g.kind === 'bar') drawBars(ctx, g, ser, va, n, slot, catAt, valAt, P, base, stackTops, labelJobs);
    else if (g.kind === 'area') drawAreas(ctx, g, ser, va, n, catAt, valAt, P, base, stackTops, labelJobs);
    else if (g.kind === 'line' || g.kind === 'stock') drawLines(ctx, g, ser, va, n, catAt, valAt, P, stackTops, labelJobs, spec.dispBlanksAs);
    else if (g.kind === 'scatter') drawScatter(ctx, g, ser, va, xAt, valAt, P, labelJobs, spec.dispBlanksAs);
    else if (g.kind === 'bubble') drawBubbles(ctx, g, ser, va, xAt, valAt, P, inner, labelJobs);
    // Trendlines and error bars.
    for (const s of ser) {
      const xsOf = (i: number) => (g.kind === 'scatter' || g.kind === 'bubble' ? s.xs?.[i] ?? i + 1 : i + 1);
      const posOf = (x: number) => (g.kind === 'scatter' || g.kind === 'bubble' ? xAt(x) : catAt(x - 1));
      drawTrendlines(ctx, s, va, xsOf, posOf, valAt, P, xy && xScale ? [xScale.min, xScale.max] : [1, n]);
      drawErrorBars(ctx, s, va, n, (i) => (g.kind === 'scatter' || g.kind === 'bubble' ? xAt(s.xs?.[i] ?? i + 1) : catAt(i)), valAt, P, stackTops.get(s));
    }
  }

  // ------------------------------------------------------------------- axes
  for (const va of valAxes) drawValAxis(ctx, va, inner, horizontal, valAt);
  if (xy && xScale) {
    drawValAxis(ctx, { id: catSpec.id, spec: catSpec, scale: xScale, secondary: false, fmt: (v) => formatValue(v, catSpec.numFmt ?? all[0]?.series.cat?.format ?? 'General') }, inner, !horizontal, (_, v) => xAt(v), valAxes[0] ? valAt(valAxes[0], baseOf(valAxes[0])) : undefined);
  } else {
    drawCatAxis(ctx, catSpec, cats, levels, n, inner, horizontal, catAt, slot, between, catRot, catSkip, valAxes[0] ? valAt(valAxes[0], baseOf(valAxes[0])) : undefined);
  }
  for (const job of labelJobs) job();
}

function minorTicks(s: Scale): number[] {
  if (s.log) return [];
  const out: number[] = [];
  for (let v = s.min; v <= s.max + 1e-9; v += s.minor) out.push(Number(v.toPrecision(12)));
  return out;
}

type CatAt = (i: number) => number;
type ValAt = (va: ValAxis, v: number) => number;
type PFn = (c: number, v: number) => [number, number];
type Stacks = Map<SeriesData, { lo: (number | null)[]; hi: (number | null)[] }>;

function defaultLabelPos(g: Group): string {
  if (g.kind === 'bar') return isStacked(g) ? 'ctr' : 'outEnd';
  if (g.kind === 'area') return 'ctr';
  if (g.kind === 'bubble') return 'ctr';
  return 'r';
}

function pushLabel(ctx: Ctx, jobs: (() => void)[], l: DataLabels, sd: SeriesData, i: number, x: number, y: number, pos: string, box?: { w: number; h: number; horizontal: boolean; up: boolean }, extra?: { size?: number | null }) {
  const text = labelText(l, sd, i, extra);
  if (!text) return;
  const ts = ctx.text(l.text);
  jobs.push(() => {
    let ax: 'start' | 'middle' | 'end' = 'middle';
    let bl: 'top' | 'middle' | 'bottom' = 'middle';
    let lx = x;
    let ly = y;
    const g = 4;
    if (box) {
      // x, y = end of the bar (value side); the box gives its size.
      if (box.horizontal) {
        if (pos === 'outEnd') {
          lx = x + (box.up ? g : -g);
          ax = box.up ? 'start' : 'end';
        } else if (pos === 'inEnd') {
          lx = x + (box.up ? -g : g);
          ax = box.up ? 'end' : 'start';
        } else if (pos === 'inBase') {
          lx = x + (box.up ? -box.w + g : box.w - g);
          ax = box.up ? 'start' : 'end';
        } else lx = x + (box.up ? -box.w / 2 : box.w / 2);
      } else if (pos === 'outEnd') {
        ly = y + (box.up ? -g : g);
        bl = box.up ? 'bottom' : 'top';
      } else if (pos === 'inEnd') {
        ly = y + (box.up ? g : -g);
        bl = box.up ? 'top' : 'bottom';
      } else if (pos === 'inBase') {
        ly = y + (box.up ? box.h - g : -box.h + g);
        bl = box.up ? 'bottom' : 'top';
      } else ly = y + (box.up ? box.h / 2 : -box.h / 2);
    } else {
      const d = 6;
      if (pos === 'r') [lx, ax] = [x + d, 'start'];
      else if (pos === 'l') [lx, ax] = [x - d, 'end'];
      else if (pos === 't') [ly, bl] = [y - d, 'bottom'];
      else if (pos === 'b') [ly, bl] = [y + d, 'top'];
    }
    const lines = text.split('\n');
    const lh = ts.size * 1.15;
    lines.forEach((t, k) => ctx.label(t, lx, ly + (k - (lines.length - 1) / 2) * lh, ts, ax, bl, `labels:${sd.index}`));
  });
}

function drawBars(ctx: Ctx, g: Group, ser: SeriesData[], va: ValAxis, n: number, slot: number, catAt: CatAt, valAt: ValAt, P: PFn, base: number, stacks: Stacks, jobs: (() => void)[]) {
  const stacked = isStacked(g);
  const horizontal = g.barDir === 'bar';
  const gap = (g.gapWidth ?? 150) / 100;
  const overlap = (g.overlap ?? (stacked ? 100 : 0)) / 100;
  const k = stacked ? 1 : ser.length;
  const groupW = slot / (1 + gap);
  const barW = groupW / (k - (k - 1) * overlap || 1);
  const step = barW * (1 - overlap);
  ser.forEach((s, si) => {
    const l = labelsOf(s);
    const st = stacks.get(s);
    for (let i = 0; i < n; i++) {
      const raw = s.values[i];
      if (raw == null) continue;
      const lo = stacked ? (st?.lo[i] ?? 0) : base;
      const hi = stacked ? (st?.hi[i] ?? raw) : raw;
      const c0 = catAt(i) - (horizontal ? -1 : 1) * (groupW / 2) + (horizontal ? -1 : 1) * (stacked ? 0 : si * step);
      const v0 = valAt(va, lo);
      const v1 = valAt(va, hi);
      const look = ctx.seriesLook(s, i, 'fill');
      const dpt = s.series.points?.find((p) => p.idx === i);
      const invert = raw < 0 && (dpt?.invertIfNegative ?? s.series.invertIfNegative);
      const fill: Paint | null = invert ? '#FFFFFF' : look.fill;
      const line: Stroke | null = invert ? (look.line ?? { color: typeof look.fill === 'string' ? look.fill : '#595959', width: 0.75 * PT }) : look.line;
      const [x0, y0] = P(c0, Math.min(v0, v1));
      const w = horizontal ? Math.abs(v1 - v0) : barW;
      const h = horizontal ? barW : Math.abs(v1 - v0);
      const rect = horizontal ? { x: Math.min(v0, v1), y: c0 - barW, w, h } : { x: x0, y: y0, w, h };
      ctx.push({ t: 'rect', id: `point:${s.index}:${i}`, ...rect, fill: fill ?? undefined, stroke: line ?? undefined });
      ctx.hit(`point:${s.index}:${i}`, rect.x, rect.y, rect.w, rect.h);
      if (l) {
        const up = horizontal ? v1 >= v0 : v1 <= v0;
        const [ex, ey] = horizontal ? [v1, c0 - barW / 2] : [c0 + barW / 2, v1];
        pushLabel(ctx, jobs, l, s, i, ex, ey, l.pos ?? defaultLabelPos(g), { w: rect.w, h: rect.h, horizontal, up });
      }
    }
  });
  // Series lines (stacked bars): join the tops of each series.
  if (g.serLines && stacked) {
    const sl = ctx.stroke(g.serLines.line, { color: '#A6A6A6', width: 0.75 * PT });
    if (sl) {
      for (const s of ser) {
        const st = stacks.get(s);
        let d = '';
        for (let i = 0; i < n - 1; i++) {
          const a = st?.hi[i];
          const b = st?.hi[i + 1];
          if (a == null || b == null) continue;
          const [x1, y1] = P(catAt(i) + (horizontal ? -1 : 1) * (groupW / 2), valAt(va, a));
          const [x2, y2] = P(catAt(i + 1) - (horizontal ? -1 : 1) * (groupW / 2), valAt(va, b));
          d += `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
        }
        if (d) ctx.push({ t: 'path', id: 'serLines', d, stroke: sl });
      }
    }
  }
}

function drawAreas(ctx: Ctx, g: Group, ser: SeriesData[], va: ValAxis, n: number, catAt: CatAt, valAt: ValAt, P: PFn, base: number, stacks: Stacks, jobs: (() => void)[]) {
  const stacked = isStacked(g);
  for (const s of ser) {
    const st = stacks.get(s);
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const v = stacked ? (st?.hi[i] ?? st?.lo[i] ?? 0) : (s.values[i] ?? 0);
      const b = stacked ? (st?.lo[i] ?? 0) : base;
      top.push(P(catAt(i), valAt(va, v)));
      bottom.push(P(catAt(i), valAt(va, b)));
    }
    const look = ctx.seriesLook(s, null, 'fill');
    const d = linePath(top) + bottom.reverse().map((p) => `L${f2(p[0])} ${f2(p[1])}`).join('') + 'Z';
    ctx.push({ t: 'path', id: `series:${s.index}`, d, fill: look.fill ?? undefined, stroke: look.line ?? undefined });
    const l = labelsOf(s);
    if (l) for (let i = 0; i < n; i++) if (s.values[i] != null) pushLabel(ctx, jobs, l, s, i, ...midpoint(top[i]!, bottom[n - 1 - i]!), l.pos ?? 'ctr');
    const xs = top.map((p) => p[0]);
    const ys = top.map((p) => p[1]);
    ctx.hit(`series:${s.index}`, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys, ...bottom.map((p) => p[1])) - Math.min(...ys));
  }
  if (g.dropLines) drawDropLines(ctx, g, ser, n, catAt, valAt, va, P, base, stacks);
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function drawDropLines(ctx: Ctx, g: Group, ser: SeriesData[], n: number, catAt: CatAt, valAt: ValAt, va: ValAxis, P: PFn, base: number, stacks: Stacks) {
  const st = ctx.stroke(g.dropLines?.line, { color: '#595959', width: 0.75 * PT });
  if (!st) return;
  let d = '';
  for (let i = 0; i < n; i++) {
    let top = -Infinity;
    for (const s of ser) {
      const v = isStacked(g) ? stacks.get(s)?.hi[i] : s.values[i];
      if (v != null) top = Math.max(top, v);
    }
    if (!Number.isFinite(top)) continue;
    const [x1, y1] = P(catAt(i), valAt(va, top));
    const [x2, y2] = P(catAt(i), valAt(va, base));
    d += `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
  }
  if (d) ctx.push({ t: 'path', id: 'dropLines', d, stroke: st });
}

function seriesPoints(s: SeriesData, n: number, pos: (i: number, v: number) => [number, number], blanks: string | null | undefined, value: (i: number) => number | null): [number, number][][] {
  const runs: [number, number][][] = [[]];
  for (let i = 0; i < n; i++) {
    let v = value(i);
    if (v == null) {
      if (blanks === 'zero') v = 0;
      else if (blanks === 'span') continue;
      else {
        if (runs[runs.length - 1]!.length) runs.push([]);
        continue;
      }
    }
    runs[runs.length - 1]!.push(pos(i, v));
  }
  return runs.filter((r) => r.length);
}

function drawLines(ctx: Ctx, g: Group, ser: SeriesData[], va: ValAxis, n: number, catAt: CatAt, valAt: ValAt, P: PFn, stacks: Stacks, jobs: (() => void)[], blanks?: string | null) {
  const stacked = isStacked(g);
  const pos = (i: number, v: number) => P(catAt(i), valAt(va, v));
  const valueOf = (s: SeriesData) => (i: number) => (stacked ? (s.values[i] == null ? null : (stacks.get(s)?.hi[i] ?? null)) : (s.values[i] ?? null));
  // Stock: high-low lines and up/down bars under the series.
  if (g.hiLowLines) {
    const st = ctx.stroke(g.hiLowLines.line, { color: '#595959', width: 0.75 * PT });
    let d = '';
    for (let i = 0; i < n && st; i++) {
      const vals = ser.map((s) => s.values[i]).filter((v): v is number => v != null);
      if (vals.length < 2) continue;
      const [x1, y1] = pos(i, Math.max(...vals));
      const [x2, y2] = pos(i, Math.min(...vals));
      d += `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
    }
    if (d && st) ctx.push({ t: 'path', id: 'hiLowLines', d, stroke: st });
  }
  if (g.upDownBars && ser.length >= 2) {
    const open = ser[0]!;
    const close = ser[ser.length - 1]!;
    const w = (catAt(1) - catAt(0) || 20) / (1 + (g.upDownBars.gapWidth ?? 150) / 100);
    for (let i = 0; i < n; i++) {
      const o = open.values[i];
      const c = close.values[i];
      if (o == null || c == null) continue;
      const up = c >= o;
      const look = ctx.box(up ? g.upDownBars.up : g.upDownBars.down, up ? '#FFFFFF' : '#000000', { color: '#000000', width: 0.75 * PT });
      const [x1, y1] = pos(i, Math.max(o, c));
      const [, y2] = pos(i, Math.min(o, c));
      ctx.push({ t: 'rect', id: up ? 'upBars' : 'downBars', x: x1 - Math.abs(w) / 2, y: y1, w: Math.abs(w), h: Math.max(1, y2 - y1), fill: look.fill ?? undefined, stroke: look.line ?? undefined });
    }
  }
  for (const s of ser) {
    const look = ctx.seriesLook(s, null, 'line');
    const runs = seriesPoints(s, n, pos, blanks, valueOf(s));
    const lineOn = g.kind !== 'stock' || !!s.series.shape?.line && !s.series.shape.line.none;
    if (look.line && lineOn) {
      const d = runs.map((r) => (s.series.smooth ? smoothPath(r) : linePath(r))).join('');
      ctx.push({ t: 'path', id: `series:${s.index}`, d, stroke: { ...look.line } });
    }
    const all = runs.flat();
    if (all.length) ctx.hit(`series:${s.index}`, Math.min(...all.map((p) => p[0])) - 3, Math.min(...all.map((p) => p[1])) - 3, Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])) + 6, Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])) + 6);
    if (hasMarker(s)) {
      const size = (s.series.marker?.size ?? 5) * PT;
      for (let i = 0; i < n; i++) {
        const v = valueOf(s)(i);
        if (v == null) continue;
        const [x, y] = pos(i, v);
        const m = ctx.seriesLook(s, i, 'marker');
        drawMarker(ctx, markerSymbol(s), x, y, size, m.fill, m.line, `point:${s.index}:${i}`);
      }
    }
    const l = labelsOf(s);
    if (l)
      for (let i = 0; i < n; i++) {
        const v = valueOf(s)(i);
        if (v != null) pushLabel(ctx, jobs, l, s, i, ...pos(i, v), l.pos ?? defaultLabelPos(g));
      }
  }
  if (g.dropLines) drawDropLines(ctx, g, ser, n, catAt, valAt, va, P, va.scale.min, stacks);
}

function drawScatter(ctx: Ctx, g: Group, ser: SeriesData[], va: ValAxis, xAt: (x: number) => number, valAt: ValAt, P: PFn, jobs: (() => void)[], blanks?: string | null) {
  const style = g.scatterStyle ?? 'lineMarker';
  for (const s of ser) {
    const n = s.values.length;
    const pos = (i: number, v: number) => P(xAt(s.xs?.[i] ?? i + 1), valAt(va, v));
    const runs = seriesPoints(s, n, pos, blanks, (i) => (s.xs?.[i] == null ? null : (s.values[i] ?? null)));
    const look = ctx.seriesLook(s, null, 'line');
    const lineOn = style !== 'marker' && style !== 'none' && !(s.series.shape?.line?.none ?? false) && !(style === 'lineMarker' && !s.series.shape?.line && hasMarker(s) && s.series.marker?.symbol != null && false);
    if (lineOn && look.line) {
      const smooth = s.series.smooth || style === 'smooth' || style === 'smoothMarker';
      ctx.push({ t: 'path', id: `series:${s.index}`, d: runs.map((r) => (smooth ? smoothPath(r) : linePath(r))).join(''), stroke: look.line });
    }
    if (hasMarker(s) || !lineOn) {
      const size = (s.series.marker?.size ?? 5) * PT;
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        const x = s.xs?.[i];
        if (v == null || x == null) continue;
        const m = ctx.seriesLook(s, i, 'marker');
        drawMarker(ctx, markerSymbol(s), ...pos(i, v), size, m.fill, m.line, `point:${s.index}:${i}`);
      }
    }
    const l = labelsOf(s);
    if (l) for (let i = 0; i < n; i++) if (s.values[i] != null && s.xs?.[i] != null) pushLabel(ctx, jobs, l, s, i, ...pos(i, s.values[i]!), l.pos ?? 'r');
  }
}

function drawBubbles(ctx: Ctx, g: Group, ser: SeriesData[], va: ValAxis, xAt: (x: number) => number, valAt: ValAt, P: PFn, inner: Rect, jobs: (() => void)[]) {
  const sizes = ser.flatMap((s) => s.sizes ?? []).filter((v): v is number => v != null && (g.showNegBubbles || v > 0));
  const maxSize = Math.max(...sizes.map(Math.abs), 1e-9);
  const maxR = ((g.bubbleScale ?? 100) / 100) * 0.125 * Math.min(inner.w, inner.h);
  const byWidth = g.sizeRepresents === 'w';
  for (const s of ser) {
    const order = s.values.map((_, i) => i).sort((a, b) => Math.abs(s.sizes?.[b] ?? 0) - Math.abs(s.sizes?.[a] ?? 0));
    for (const i of order) {
      const v = s.values[i];
      const x = s.xs?.[i];
      const sz = s.sizes?.[i];
      if (v == null || x == null || sz == null || (!g.showNegBubbles && sz <= 0)) continue;
      const r = maxR * (byWidth ? Math.abs(sz) / maxSize : Math.sqrt(Math.abs(sz) / maxSize));
      const [cx, cy] = P(xAt(x), valAt(va, v));
      const look = ctx.seriesLook(s, i, 'fill');
      const fill: Paint | null = g.threeD && typeof look.fill === 'string' ? { kind: 'radial', stops: [{ pos: 0, color: '#FFFFFF' }, { pos: 1, color: look.fill }] } : look.fill;
      ctx.push({ t: 'circle', id: `point:${s.index}:${i}`, cx, cy, r, fill: fill ?? undefined, stroke: look.line ?? undefined, opacity: s.series.shape?.fill ? undefined : 0.85 });
      ctx.hit(`point:${s.index}:${i}`, cx - r, cy - r, 2 * r, 2 * r);
      const l = labelsOf(s);
      if (l) pushLabel(ctx, jobs, l, s, i, cx, cy, l.pos ?? 'ctr', undefined, { size: sz });
    }
  }
}

function errorAmount(e: NonNullable<SeriesData['series']['errBars']>[number], s: SeriesData): (i: number) => [number, number] | null {
  const vals = s.values.filter((v): v is number => v != null);
  const sd = stdev(vals);
  const plus = e.plus?.num ?? [];
  const minus = e.minus?.num ?? [];
  return (i) => {
    const v = s.values[i];
    if (v == null) return null;
    let a: number;
    switch (e.valType) {
      case 'percentage':
        a = (Math.abs(v) * (e.val ?? 5)) / 100;
        break;
      case 'stdDev':
        a = sd * (e.val ?? 1);
        break;
      case 'stdErr':
        a = sd / Math.sqrt(vals.length || 1);
        break;
      case 'cust':
        return [e.barType === 'plus' ? 0 : (minus[i] ?? 0), e.barType === 'minus' ? 0 : (plus[i] ?? 0)];
      default:
        a = e.val ?? 1;
    }
    return [e.barType === 'plus' ? 0 : a, e.barType === 'minus' ? 0 : a];
  };
}

function drawErrorBars(ctx: Ctx, s: SeriesData, va: ValAxis, n: number, at: (i: number) => number, valAt: ValAt, P: PFn, stack?: { hi: (number | null)[] }) {
  for (const e of s.series.errBars ?? []) {
    if ((e.dir ?? 'y') !== 'y') continue;
    const amt = errorAmount(e, s);
    const st = ctx.stroke(e.line, { color: '#000000', width: 0.75 * PT });
    if (!st) continue;
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = amt(i);
      const v = stack?.hi[i] ?? s.values[i];
      if (!a || v == null) continue;
      const c = at(i);
      const [x1, y1] = P(c, valAt(va, v - a[0]));
      const [x2, y2] = P(c, valAt(va, v + a[1]));
      d += `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
      if (!e.noEndCap) {
        const cap = 3;
        for (const [x, y] of [
          [x1, y1],
          [x2, y2],
        ] as const)
          d += x1 === x2 ? `M${f2(x - cap)} ${f2(y)}H${f2(x + cap)}` : `M${f2(x)} ${f2(y - cap)}V${f2(y + cap)}`;
      }
    }
    if (d) ctx.push({ t: 'path', id: `errBars:${s.index}`, d, stroke: st });
  }
}

function drawTrendlines(ctx: Ctx, s: SeriesData, va: ValAxis, xOf: (i: number) => number, posOf: (x: number) => number, valAt: ValAt, P: PFn, xRange: [number, number]) {
  const color = ctx.seriesLook(s, null, s.group.kind === 'line' || s.group.kind === 'scatter' ? 'line' : 'fill');
  const base = color.line?.color ?? (typeof color.fill === 'string' ? color.fill : '#595959');
  for (const [ti, t] of (s.series.trendlines ?? []).entries()) {
    const xs: number[] = [];
    const ys: number[] = [];
    s.values.forEach((v, i) => {
      if (v != null) {
        xs.push(xOf(i));
        ys.push(v);
      }
    });
    const st = ctx.stroke(t.line, { color: base, width: 1.5 * PT, dash: [1.5 * PT, 1.5 * PT] });
    if (!st || xs.length < 2) continue;
    if (t.kind === 'movingAvg') {
      const ma = movingAverage(s.values, t.period ?? 2);
      const pts = ma.map((v, i) => (v == null ? null : P(posOf(xOf(i)), valAt(va, v)))).filter((p): p is [number, number] => !!p);
      ctx.push({ t: 'path', id: `trendline:${s.index}:${ti}`, d: linePath(pts), stroke: { ...st, dash: st.dash ?? [1.5 * PT, 1.5 * PT] } });
      continue;
    }
    const fr = fit(t.kind, xs, ys, t.order ?? 2, t.intercept);
    if (!fr) continue;
    const x0 = Math.min(...xs, xRange[0]) - (t.backward ?? 0);
    const x1 = Math.max(...xs) + (t.forward ?? 0);
    const pts: [number, number][] = [];
    for (let k = 0; k <= 60; k++) {
      const x = x0 + ((x1 - x0) * k) / 60;
      const y = fr.f(x);
      if (Number.isFinite(y) && y >= va.scale.min - (va.scale.max - va.scale.min) && y <= va.scale.max + (va.scale.max - va.scale.min)) pts.push(P(posOf(x), valAt(va, y)));
    }
    ctx.push({ t: 'path', id: `trendline:${s.index}:${ti}`, d: linePath(pts), stroke: { ...st, dash: st.dash ?? [1.5 * PT, 1.5 * PT] } });
    if (t.dispEq || t.dispR2) {
      const end = pts[pts.length - 1];
      if (end) {
        const txt = [t.dispEq ? fr.eq : '', t.dispR2 ? `R² = ${Number(fr.r2.toFixed(4))}` : ''].filter(Boolean);
        const ts = ctx.text(null);
        txt.forEach((line, k) => ctx.label(line, end[0] - 4, end[1] - 8 - (txt.length - 1 - k) * ts.size * 1.2, ts, 'end', 'bottom', `trendlineLabel:${s.index}:${ti}`));
      }
    }
  }
}

function axisLine(ctx: Ctx, a: Axis, fallback: Stroke | null): Stroke | null {
  const s = ctx.stroke(a.shape?.line, fallback);
  return s ?? null;
}

function drawValAxis(ctx: Ctx, va: ValAxis, inner: Rect, horizontal: boolean, valAt: (va: ValAxis, v: number) => number, crossAt?: number) {
  const a = va.spec;
  if (a.delete) return;
  const ts = ctx.text(a.text);
  const right = va.secondary || a.pos === 'r';
  const top = horizontal && (va.secondary || a.pos === 't');
  const line = axisLine(ctx, a, null);
  const edge = horizontal ? (top ? inner.y : (crossAt ?? inner.y + inner.h)) : right ? inner.x + inner.w : inner.x;
  const lineEdge = horizontal ? (top ? inner.y : inner.y + inner.h) : right ? inner.x + inner.w : inner.x;
  if (line) ctx.push({ t: 'path', id: `axis:${a.id}`, d: horizontal ? `M${f2(inner.x)} ${f2(edge)}H${f2(inner.x + inner.w)}` : `M${f2(edge)} ${f2(inner.y)}V${f2(inner.y + inner.h)}`, stroke: line });
  const tick = a.majorTick ?? 'none';
  if (tick !== 'none' && line) {
    const [t0, t1] = tick === 'in' ? [0, TICK] : tick === 'cross' ? [-TICK, TICK] : [-TICK, 0];
    const dir = horizontal ? (top ? -1 : 1) : right ? 1 : -1;
    const d = va.scale.ticks
      .map((t) => {
        const p = valAt(va, t);
        return horizontal ? `M${f2(p)} ${f2(edge - dir * t0)}V${f2(edge - dir * t1)}` : `M${f2(edge - dir * t0)} ${f2(p)}H${f2(edge - dir * t1)}`;
      })
      .join('');
    ctx.push({ t: 'path', id: `axis:${a.id}`, d, stroke: line });
  }
  if (a.tickLblPos === 'none') return;
  let maxW = 0;
  for (const t of va.scale.ticks) {
    const p = valAt(va, t);
    const s = va.fmt(t);
    maxW = Math.max(maxW, ctx.measure(s, ts));
    if (horizontal) ctx.label(s, p, top ? lineEdge - TICK - 2 : lineEdge + TICK + 2, ts, 'middle', top ? 'bottom' : 'top', `axis:${a.id}`);
    else ctx.label(s, right ? lineEdge + TICK + 2 : lineEdge - TICK - 2, p, ts, right ? 'start' : 'end', 'middle', `axis:${a.id}`);
  }
  if (horizontal) ctx.hit(`axis:${a.id}`, inner.x, top ? lineEdge - ts.size * 1.4 - TICK : lineEdge, inner.w, ts.size * 1.4 + TICK);
  else ctx.hit(`axis:${a.id}`, right ? lineEdge : lineEdge - maxW - TICK - 4, inner.y, maxW + TICK + 4, inner.h);
  const du = displayUnits(a.dispUnits === 'percentage' ? null : a.dispUnits);
  if (du?.label && !horizontal) ctx.label(du.label, right ? lineEdge + maxW + TICK + 8 : lineEdge - maxW - TICK - 8, inner.y + inner.h / 2, ts, 'middle', 'bottom', `axis:${a.id}`, -90);
  if (a.title) axisTitle(ctx, a, horizontal ? inner.x + inner.w / 2 : right ? lineEdge + maxW + TICK + (du?.label ? ts.size * 1.6 : 0) + 10 : lineEdge - maxW - TICK - (du?.label ? ts.size * 1.6 : 0) - 10, horizontal ? (top ? lineEdge - ts.size * 1.4 - TICK - 6 : lineEdge + ts.size * 1.4 + TICK + 4) : inner.y + inner.h / 2, !horizontal, right, top);
}

function axisTitle(ctx: Ctx, a: Axis, x: number, y: number, vertical: boolean, right: boolean, top: boolean) {
  const text = a.title?.text ?? tr('Titre de l’axe', 'Axis Title');
  const ts: ResolvedText = ctx.text(a.title?.style, { size: 10, bold: false });
  const rot = ts.rot ?? (vertical ? -90 : 0);
  ctx.label(text, x, y, ts, 'middle', vertical ? (right ? 'top' : 'bottom') : top ? 'bottom' : 'top', `axisTitle:${a.id}`, rot);
}

function drawCatAxis(ctx: Ctx, a: Axis, cats: string[], levels: string[][] | undefined, n: number, inner: Rect, horizontal: boolean, catAt: CatAt, slot: number, between: boolean, rot: number, skip: number, crossAt?: number) {
  if (a.delete) return;
  const ts = ctx.text(a.text);
  const line = axisLine(ctx, a, { color: '#BFBFBF', width: 0.75 * PT });
  const edge = crossAt ?? (horizontal ? inner.x : inner.y + inner.h);
  if (line) ctx.push({ t: 'path', id: `axis:${a.id}`, d: horizontal ? `M${f2(edge)} ${f2(inner.y)}V${f2(inner.y + inner.h)}` : `M${f2(inner.x)} ${f2(edge)}H${f2(inner.x + inner.w)}`, stroke: line });
  const tick = a.majorTick ?? 'none';
  if (tick !== 'none' && line) {
    const [t0, t1] = tick === 'in' ? [0, TICK] : tick === 'cross' ? [-TICK, TICK] : [0, -TICK];
    const count = between ? n + 1 : n;
    let d = '';
    for (let k = 0; k < count; k++) {
      const p = between ? (horizontal ? inner.y + inner.h - k * slot : inner.x + k * slot) : catAt(k);
      d += horizontal ? `M${f2(edge + t0)} ${f2(p)}H${f2(edge - t1)}` : `M${f2(p)} ${f2(edge - t0)}V${f2(edge + -t1)}`;
    }
    ctx.push({ t: 'path', id: `axis:${a.id}`, d, stroke: line });
  }
  if (a.tickLblPos === 'none') return;
  const labelEdge = a.tickLblPos === 'high' ? (horizontal ? inner.x + inner.w : inner.y) : horizontal ? inner.x : inner.y + inner.h;
  const inner0 = levels && levels.length > 1 ? levels[0]! : cats;
  for (let i = 0; i < n; i += skip) {
    const text = inner0[i] ?? '';
    if (!text) continue;
    const c = catAt(i);
    if (horizontal) ctx.label(text, labelEdge - TICK - 2, c, ts, 'end', 'middle', `axis:${a.id}`);
    else if (rot) ctx.label(text, c + ts.size * 0.3, labelEdge + TICK + 2, ts, 'end', 'top', `axis:${a.id}`, rot);
    else ctx.label(text, c, labelEdge + TICK + 2, ts, 'middle', 'top', `axis:${a.id}`);
  }
  // Outer levels of multi-level categories: spans with separators.
  if (levels && levels.length > 1 && !horizontal) {
    for (let lv = 1; lv < levels.length; lv++) {
      const y = labelEdge + TICK + 2 + ts.size * 1.4 * lv;
      let start = 0;
      for (let i = 1; i <= n; i++) {
        const label = levels[lv]![start] ?? '';
        if (i === n || (levels[lv]![i] ?? '') !== '') {
          const x0 = catAt(start) - slot / 2;
          const x1 = catAt(i - 1) + slot / 2;
          if (label) ctx.label(label, (x0 + x1) / 2, y, ts, 'middle', 'top', `axis:${a.id}`);
          if (line) ctx.push({ t: 'path', id: `axis:${a.id}`, d: `M${f2(x0)} ${f2(labelEdge)}V${f2(y + ts.size * 1.2)}`, stroke: line });
          start = i;
        }
      }
    }
  }
  if (horizontal) ctx.hit(`axis:${a.id}`, inner.x - 60, inner.y, 60, inner.h);
  else ctx.hit(`axis:${a.id}`, inner.x, labelEdge, inner.w, ts.size * 1.5 + TICK);
  if (a.title) axisTitle(ctx, a, horizontal ? inner.x - 40 : inner.x + inner.w / 2, horizontal ? inner.y + inner.h / 2 : labelEdge + TICK + ts.size * (rot ? 3 : 1.6) + 4, horizontal, false, false);
}
