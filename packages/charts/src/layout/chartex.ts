/**
 * Office 2016+ charts (chartEx): histogram and Pareto, box and whisker,
 * waterfall, funnel, treemap and sunburst. Region maps need geographic data
 * and show their fallback image or a placeholder.
 */
import { formatValue } from '../format';
import { frac, valueScale, type Scale } from '../scale';
import { quartiles } from '../stats';
import { Ctx, GRID_GREY, PT, shade } from '../style';
import type { Paint, ResolvedChart, SeriesData } from '../types';
import type { Rect } from './frame';
import { tr } from '@oel/i18n';

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

function axes(ctx: Ctx, area: Rect, scale: Scale, cats: string[], fmt: (v: number) => string, right?: { scale: Scale; fmt: (v: number) => string }) {
  const ts = ctx.text(null);
  const lw = Math.max(...scale.ticks.map((t) => ctx.measure(fmt(t), ts))) + 8;
  const rw = right ? Math.max(...right.scale.ticks.map((t) => ctx.measure(right.fmt(t), ts))) + 8 : 6;
  const slot0 = (area.w - lw - rw) / Math.max(1, cats.length);
  const widest0 = Math.max(0, ...cats.map((c) => ctx.measure(c, ts)));
  const labelH = widest0 > slot0 * 0.95 ? Math.min(area.h * 0.4, widest0 * 0.71 + ts.size) : ts.size * 1.6;
  const inner = { x: area.x + lw, y: area.y + 6, w: area.w - lw - rw, h: area.h - labelH - 10 };
  const y = (v: number, s = scale) => inner.y + inner.h - frac(s, v) * inner.h;
  ctx.push({ t: 'path', id: 'gridlines', d: scale.ticks.map((t) => `M${f2(inner.x)} ${f2(y(t))}H${f2(inner.x + inner.w)}`).join(''), stroke: { color: GRID_GREY, width: 0.75 * PT } });
  for (const t of scale.ticks) ctx.label(fmt(t), inner.x - 4, y(t), ts, 'end', 'middle', 'axis:1');
  if (right) for (const t of right.scale.ticks) ctx.label(right.fmt(t), inner.x + inner.w + 4, y(t, right.scale), ts, 'start', 'middle', 'axis:2');
  const slot = inner.w / Math.max(1, cats.length);
  const widest = Math.max(0, ...cats.map((c) => ctx.measure(c, ts)));
  const rot = widest > slot * 0.95 ? -45 : 0;
  cats.forEach((c, i) => ctx.label(c, inner.x + (i + 0.5) * slot + (rot ? ts.size * 0.3 : 0), inner.y + inner.h + 4, ts, rot ? 'end' : 'middle', 'top', 'axis:0', rot || undefined));
  ctx.hit('plot', inner.x, inner.y, inner.w, inner.h);
  return { inner, y, slot };
}

function colorOf(ctx: Ctx, s: SeriesData, i: number | null, fallbackIdx: number): Paint {
  const dpt = i != null ? s.series.points?.find((p) => p.idx === i) : undefined;
  const p = ctx.paint(dpt?.shape?.fill ?? s.series.shape?.fill);
  return p ?? ctx.auto(fallbackIdx);
}

export function chartEx(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const all = data.series.filter((s) => !s.series.hidden);
  const main = all[0];
  if (!main) {
    // A Pareto's columns may be the hidden series: fall back to any.
    return;
  }
  switch (main.group.kind) {
    case 'clusteredColumn':
      return histogram(ctx, data, area);
    case 'boxWhisker':
      return boxWhisker(ctx, all.filter((s) => s.group.kind === 'boxWhisker'), area);
    case 'waterfall':
      return waterfall(ctx, main, area);
    case 'funnel':
      return funnel(ctx, main, area);
    case 'treemap':
      return treemap(ctx, main, area);
    case 'sunburst':
      return sunburst(ctx, main, area);
    default: {
      const ts = ctx.text(null, { size: 11 });
      if (ctx.spec.fallback && ctx.opts.media?.(ctx.spec.fallback)) {
        ctx.push({ t: 'image', id: 'plot', x: area.x, y: area.y, w: area.w, h: area.h, href: ctx.opts.media(ctx.spec.fallback)! });
      } else {
        ctx.push({ t: 'rect', id: 'plot', ...area, fill: '#F2F2F2', stroke: { color: GRID_GREY, width: 0.75 * PT, dash: [4, 3] } });
        ctx.label(tr('Carte : aperçu indisponible (données géographiques requises)', 'Map: no preview (geographic data needed)'), area.x + area.w / 2, area.y + area.h / 2, ts);
      }
    }
  }
}

function histogram(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const cols = data.series.find((s) => s.group.kind === 'clusteredColumn');
  if (!cols) return;
  const ex = cols.series.ex ?? {};
  const pareto = data.series.some((s) => s.group.kind === 'paretoLine' && (s.series.ex?.owner ?? -1) === cols.series.idx);
  let labels: string[] = [];
  let counts: number[] = [];
  if (ex.aggregation || pareto) {
    // One bar per category (sum of its values); Pareto sorts them, largest first.
    const map = new Map<string, number>();
    cols.values.forEach((v, i) => {
      const k = cols.cats[i] ?? String(i + 1);
      map.set(k, (map.get(k) ?? 0) + (v ?? 0));
    });
    let entries = [...map.entries()];
    if (pareto) entries = entries.sort((a, b) => b[1] - a[1]);
    labels = entries.map((e) => e[0]);
    counts = entries.map((e) => e[1]);
  } else {
    const vals = cols.values.filter((v): v is number => v != null);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    // Excel's automatic bins: Scott's rule.
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - vals.reduce((a, b) => a + b, 0) / vals.length) ** 2, 0) / Math.max(1, vals.length - 1));
    const width = ex.binSize ?? (ex.binCount ? (max - min) / ex.binCount : (3.5 * sd) / Math.cbrt(vals.length || 1) || 1);
    const bins = Math.max(1, ex.binCount ?? Math.ceil((max - min) / width || 1));
    counts = new Array<number>(bins).fill(0);
    for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - min) / width))]!++;
    labels = counts.map((_, i) => `[${formatValue(min + i * width, '0.##')}, ${formatValue(min + (i + 1) * width, '0.##')}${i === bins - 1 ? ']' : ')'}`);
  }
  const scale = valueScale(0, Math.max(...counts, 1), { includeZero: true, length: area.h });
  const pct = valueScale(0, 1, { percent: true });
  const { inner, y, slot } = axes(ctx, area, scale, labels, (v) => formatValue(v, cols.format), pareto ? { scale: pct, fmt: (v) => formatValue(v, '0%') } : undefined);
  // chartEx gap width is a ratio of the bar width (histograms default to none).
  const ratio = ctx.spec.axes?.find((a) => a.kind === 'cat')?.gapWidth ?? 0;
  const barW = slot / (1 + ratio);
  counts.forEach((c, i) => {
    const top = y(c);
    ctx.push({ t: 'rect', id: `point:${cols.index}:${i}`, x: inner.x + i * slot + (slot - barW) / 2 + 0.5, y: top, w: Math.max(1, barW - 1), h: inner.y + inner.h - top, fill: colorOf(ctx, cols, i, 0) });
  });
  if (pareto) {
    const line = data.series.find((s) => s.group.kind === 'paretoLine');
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const pts = counts.map((c, i) => {
      acc += c;
      return [inner.x + (i + 0.5) * slot, y(acc / total, pct)] as const;
    });
    const st = ctx.stroke(line?.series.shape?.line, { color: ctx.auto(1), width: 2.25 * PT });
    if (st) ctx.push({ t: 'path', id: `series:${line?.index ?? 1}`, d: pts.map((p, i) => `${i ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`).join(''), stroke: st });
  }
}

function boxWhisker(ctx: Ctx, ser: SeriesData[], area: Rect) {
  const cats = [...new Set(ser.flatMap((s) => s.cats))];
  const groups = cats.length ? cats : [''];
  const allVals = ser.flatMap((s) => s.values).filter((v): v is number => v != null);
  const scale = valueScale(Math.min(...allVals), Math.max(...allVals), { length: area.h });
  const { inner, y, slot } = axes(ctx, area, scale, groups, (v) => formatValue(v, ser[0]?.format));
  const k = ser.length;
  const bw = (slot / (1 + 1)) / k;
  groups.forEach((cat, ci) => {
    ser.forEach((s, si) => {
      const vals = s.values.filter((v, i): v is number => v != null && (!cats.length || s.cats[i] === cat));
      if (!vals.length) return;
      const ex = s.series.ex ?? {};
      const q = quartiles(vals, ex.quartile);
      const color = colorOf(ctx, s, null, s.series.idx);
      const cx = inner.x + ci * slot + slot / 4 + (si + 0.5) * bw;
      const line = { color: typeof color === 'string' ? (shade(color, 0.6) as string) : '#404040', width: 0.75 * PT };
      ctx.push({ t: 'path', id: `series:${s.index}`, d: `M${f2(cx)} ${f2(y(q.hi))}V${f2(y(q.q3))}M${f2(cx)} ${f2(y(q.q1))}V${f2(y(q.lo))}M${f2(cx - bw / 4)} ${f2(y(q.hi))}H${f2(cx + bw / 4)}M${f2(cx - bw / 4)} ${f2(y(q.lo))}H${f2(cx + bw / 4)}`, stroke: line });
      ctx.push({ t: 'rect', id: `series:${s.index}`, x: cx - bw * 0.4, y: y(q.q3), w: bw * 0.8, h: Math.max(1, y(q.q1) - y(q.q3)), fill: color, stroke: line });
      ctx.push({ t: 'path', id: `series:${s.index}`, d: `M${f2(cx - bw * 0.4)} ${f2(y(q.median))}H${f2(cx + bw * 0.4)}`, stroke: { color: '#FFFFFF', width: 1.25 * PT } });
      if (ex.meanMarker !== false) ctx.push({ t: 'path', id: `series:${s.index}`, d: `M${f2(cx - 3)} ${f2(y(q.mean) - 3)}L${f2(cx + 3)} ${f2(y(q.mean) + 3)}M${f2(cx + 3)} ${f2(y(q.mean) - 3)}L${f2(cx - 3)} ${f2(y(q.mean) + 3)}`, stroke: { color: '#FFFFFF', width: 1.25 } });
      if (ex.outliers !== false) for (const o of q.outliers) ctx.push({ t: 'circle', id: `series:${s.index}`, cx, cy: y(o), r: 2.5, fill: '#FFFFFF', stroke: line });
    });
  });
}

function waterfall(ctx: Ctx, s: SeriesData, area: Rect) {
  const totals = new Set(s.series.ex?.subtotals ?? []);
  let run = 0;
  const bars = s.values.map((v, i) => {
    const val = v ?? 0;
    if (totals.has(i)) {
      const b = { lo: 0, hi: run, kind: 'total' as const };
      return b;
    }
    const lo = run;
    run += val;
    return { lo, hi: run, kind: val >= 0 ? ('up' as const) : ('down' as const) };
  });
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.lo, b.hi)));
  const hi = Math.max(...bars.map((b) => Math.max(b.lo, b.hi)), 0);
  const scale = valueScale(lo, hi, { includeZero: true, length: area.h });
  const { inner, y, slot } = axes(ctx, area, scale, s.cats, (v) => formatValue(v, s.format));
  const w = slot / 1.5;
  bars.forEach((b, i) => {
    const x = inner.x + i * slot + (slot - w) / 2;
    const fill = colorOf(ctx, s, i, b.kind === 'up' ? 0 : b.kind === 'down' ? 1 : 2);
    ctx.push({ t: 'rect', id: `point:${s.index}:${i}`, x, y: y(Math.max(b.lo, b.hi)), w, h: Math.max(1, Math.abs(y(b.lo) - y(b.hi))), fill });
    const next = bars[i + 1];
    if (next) ctx.push({ t: 'path', id: 'connectors', d: `M${f2(x + w)} ${f2(y(b.hi))}H${f2(x + slot)}`, stroke: { color: '#A6A6A6', width: 0.75 * PT, dash: [2, 2] } });
    const lbl = s.series.labels?.showVal !== false;
    if (lbl) ctx.label(formatValue(totals.has(i) ? b.hi : (s.values[i] ?? 0), s.format), x + w / 2, y(Math.max(b.lo, b.hi)) - 3, ctx.text(null), 'middle', 'bottom', `labels:${s.index}`);
  });
}

function funnel(ctx: Ctx, s: SeriesData, area: Rect) {
  const ts = ctx.text(null);
  const n = s.values.length || 1;
  const lw = Math.max(0, ...s.cats.map((c) => ctx.measure(c, ts))) + 10;
  const inner = { x: area.x + lw, y: area.y + 4, w: area.w - lw - 6, h: area.h - 8 };
  const max = Math.max(...s.values.map((v) => Math.abs(v ?? 0)), 1e-9);
  const rowH = inner.h / n;
  s.values.forEach((v, i) => {
    const w = (Math.abs(v ?? 0) / max) * inner.w;
    const y = inner.y + i * rowH;
    ctx.push({ t: 'rect', id: `point:${s.index}:${i}`, x: inner.x + (inner.w - w) / 2, y: y + rowH * 0.08, w, h: rowH * 0.84, fill: colorOf(ctx, s, i, 0) });
    ctx.label(formatValue(v, s.format), inner.x + inner.w / 2, y + rowH / 2, { ...ts, color: '#FFFFFF' }, 'middle', 'middle', `labels:${s.index}`);
    ctx.label(s.cats[i] ?? '', inner.x - 6, y + rowH / 2, ts, 'end', 'middle', 'axis:0');
  });
  ctx.hit('plot', inner.x, inner.y, inner.w, inner.h);
}

interface Node {
  label: string;
  value: number;
  children: Node[];
  color?: Paint;
}

/** Hierarchy from multi-level categories (levels: innermost first, as in the file). */
function hierarchy(ctx: Ctx, s: SeriesData): Node {
  const levels = s.catLevels?.length ? [...s.catLevels].reverse() : [s.cats];
  const root: Node = { label: '', value: 0, children: [] };
  const n = s.values.length;
  const last: (string | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    let node = root;
    for (let l = 0; l < levels.length; l++) {
      // Blank cells repeat the label above (Excel's layout of hierarchical data).
      const label = levels[l]![i] || last[l] || '';
      last[l] = label;
      for (let k = l + 1; k < levels.length; k++) if (levels[l]![i]) last[k] = undefined;
      if (!label && l > 0) break;
      let child = node.children.find((c) => c.label === label);
      if (!child) {
        child = { label, value: 0, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.value += Math.abs(s.values[i] ?? 0);
  }
  const sum = (nd: Node): number => (nd.children.length ? (nd.value = nd.children.reduce((t, c) => t + sum(c), 0)) : nd.value);
  sum(root);
  root.children.forEach((c, i) => (c.color = colorOf(ctx, s, null, i)));
  return root;
}

/** Squarified treemap of `nodes` inside `r`. */
function squarify(nodes: Node[], r: Rect, out: { node: Node; r: Rect }[]) {
  const items = nodes.filter((n) => n.value > 0).sort((a, b) => b.value - a.value);
  let rect = { ...r };
  let i = 0;
  while (i < items.length) {
    const total = items.slice(i).reduce((t, n) => t + n.value, 0);
    const short = Math.min(rect.w, rect.h);
    let row: Node[] = [];
    let worst = Infinity;
    for (let j = i; j < items.length; j++) {
      const cand = [...row, items[j]!];
      const s = cand.reduce((t, n) => t + n.value, 0);
      const area = (s / total) * rect.w * rect.h;
      const len = area / short;
      const w = Math.max(...cand.map((n) => Math.max(((n.value / s) * short) / len, len / ((n.value / s) * short))));
      if (w > worst) break;
      worst = w;
      row = cand;
    }
    const s = row.reduce((t, n) => t + n.value, 0);
    const thick = ((s / total) * rect.w * rect.h) / short;
    let off = 0;
    for (const n of row) {
      const len = (n.value / s) * short;
      out.push({ node: n, r: rect.w >= rect.h ? { x: rect.x, y: rect.y + off, w: thick, h: len } : { x: rect.x + off, y: rect.y, w: len, h: thick } });
      off += len;
    }
    rect = rect.w >= rect.h ? { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h } : { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
    i += row.length;
  }
}

function treemap(ctx: Ctx, s: SeriesData, area: Rect) {
  const root = hierarchy(ctx, s);
  const ts = ctx.text(null);
  const banner = s.series.ex?.parentLabel === 'banner';
  const top: { node: Node; r: Rect }[] = [];
  squarify(root.children, area, top);
  for (const t of top) {
    const color = t.node.color ?? ctx.auto(0);
    const body = banner && t.node.children.length ? { ...t.r, y: t.r.y + ts.size * 1.5, h: t.r.h - ts.size * 1.5 } : t.r;
    const leaves: { node: Node; r: Rect }[] = [];
    if (t.node.children.length && !(t.node.children.length === 1 && !t.node.children[0]!.label)) squarify(t.node.children, body, leaves);
    else leaves.push({ node: t.node, r: body });
    if (banner && t.node.children.length) {
      ctx.push({ t: 'rect', id: `point:${s.index}:${t.node.label}`, ...t.r, fill: color, stroke: { color: '#FFFFFF', width: 1 } });
      ctx.label(t.node.label, t.r.x + 4, t.r.y + 3, { ...ts, color: '#FFFFFF', bold: true }, 'start', 'top', `labels:${s.index}`);
    }
    for (const l of leaves) {
      ctx.push({ t: 'rect', id: `point:${s.index}:${l.node.label}`, ...l.r, fill: color, stroke: { color: '#FFFFFF', width: 1 } });
      if (l.r.w > 24 && l.r.h > ts.size * 1.4) ctx.label(l.node.label, l.r.x + 4, l.r.y + 3, { ...ts, color: '#FFFFFF' }, 'start', 'top', `labels:${s.index}`);
    }
  }
  ctx.hit('plot', area.x, area.y, area.w, area.h);
}

function sunburst(ctx: Ctx, s: SeriesData, area: Rect) {
  const root = hierarchy(ctx, s);
  const depth = (n: Node): number => (n.children.length ? 1 + Math.max(...n.children.map(depth)) : 0);
  const levels = Math.max(1, depth(root));
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const R = Math.min(area.w, area.h) / 2 - 4;
  const ring = R / (levels + 0.4);
  const ts = ctx.text(null);
  const draw = (n: Node, a0: number, a1: number, level: number, color: Paint) => {
    let a = a0;
    for (const c of n.children) {
      const span = ((a1 - a0) * c.value) / (n.value || 1);
      const col = level === 0 ? (c.color ?? color) : shade(color, 1 + level * 0.12);
      const r0 = ring * (level + 0.4);
      const r1 = r0 + ring;
      const pt = (ang: number, r: number) => `${f2(cx + Math.sin(ang) * r)} ${f2(cy - Math.cos(ang) * r)}`;
      const large = span > Math.PI ? 1 : 0;
      const d = `M${pt(a, r0)}L${pt(a, r1)}A${f2(r1)} ${f2(r1)} 0 ${large} 1 ${pt(a + span, r1)}L${pt(a + span, r0)}A${f2(r0)} ${f2(r0)} 0 ${large} 0 ${pt(a, r0)}Z`;
      ctx.push({ t: 'path', id: `point:${s.index}:${c.label}`, d, fill: col, stroke: { color: '#FFFFFF', width: 1 } });
      if (span * (r0 + ring / 2) > ctx.measure(c.label, ts) + 4) {
        const m = a + span / 2;
        ctx.label(c.label, cx + Math.sin(m) * (r0 + ring / 2), cy - Math.cos(m) * (r0 + ring / 2), { ...ts, color: '#FFFFFF' }, 'middle', 'middle', `labels:${s.index}`);
      }
      draw(c, a, a + span, level + 1, col);
      a += span;
    }
  };
  draw(root, 0, Math.PI * 2, 0, ctx.auto(0));
  ctx.hit('plot', cx - R, cy - R, 2 * R, 2 * R);
}
