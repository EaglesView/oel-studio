/** Radar charts: one spoke per category, a polygon per series (lines, markers or filled). */
import { categoryCount } from '../data';
import { formatValue } from '../format';
import { frac, valueScale } from '../scale';
import { Ctx, GRID_GREY, PT } from '../style';
import type { ResolvedChart } from '../types';
import { labelsOf, labelText } from './cartesian';
import { drawMarker, hasMarker, markerSymbol, type Rect } from './frame';

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function radar(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const ser = data.series.filter((s) => !s.series.hidden && s.group.kind === 'radar');
  const g = ser[0]?.group;
  if (!g) return;
  const n = Math.max(3, categoryCount(ser));
  const cats = ser[0]!.cats;
  const valAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'val');
  const catAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'cat');
  const vals = ser.flatMap((s) => s.values).filter((v): v is number => v != null);
  const scale = valueScale(Math.min(0, ...vals), Math.max(...vals, 0), { min: valAx?.min, max: valAx?.max, major: valAx?.majorUnit, length: Math.min(area.w, area.h) / 2 });
  const tsCat = ctx.text(catAx?.text);
  const labelSpace = Math.max(0, ...cats.map((c) => ctx.measure(c, tsCat))) + 8;
  const r = Math.max(10, Math.min(area.w / 2 - labelSpace, area.h / 2 - tsCat.size * 2));
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const ang = (i: number) => (i / n) * Math.PI * 2;
  const at = (i: number, v: number): [number, number] => {
    const k = Math.max(0, frac(scale, v)) * r;
    return [cx + Math.sin(ang(i)) * k, cy - Math.cos(ang(i)) * k];
  };
  // Web: rings at each major tick, spokes.
  const grid = ctx.stroke(valAx?.majorGrid?.line, { color: GRID_GREY, width: 0.75 * PT });
  if (grid && valAx?.majorGrid !== undefined) {
    let d = '';
    for (const t of scale.ticks) {
      const pts = Array.from({ length: n }, (_, i) => at(i, t));
      d += pts.map((p, i) => `${i ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`).join('') + 'Z';
    }
    ctx.push({ t: 'path', id: `gridlines:${valAx?.id ?? 0}`, d, stroke: grid });
  }
  const spokes = ctx.stroke(catAx?.majorGrid?.line ?? catAx?.shape?.line, { color: GRID_GREY, width: 0.75 * PT });
  if (spokes) ctx.push({ t: 'path', id: `axis:${catAx?.id ?? 0}`, d: Array.from({ length: n }, (_, i) => `M${f2(cx)} ${f2(cy)}L${f2(at(i, scale.max)[0])} ${f2(at(i, scale.max)[1])}`).join(''), stroke: spokes });
  // Value labels up the first spoke.
  if (!valAx?.delete) {
    const ts = ctx.text(valAx?.text);
    for (const t of scale.ticks) {
      const [x, y] = at(0, t);
      ctx.label(formatValue(t, valAx?.numFmt ?? ser[0]!.format), x - 4, y, ts, 'end', 'middle', `axis:${valAx?.id ?? 0}`);
    }
  }
  // Category labels around.
  if (!catAx?.delete) {
    for (let i = 0; i < n; i++) {
      const a = ang(i);
      const x = cx + Math.sin(a) * (r + 6);
      const y = cy - Math.cos(a) * (r + 6);
      const anchor = Math.abs(Math.sin(a)) < 0.2 ? 'middle' : Math.sin(a) > 0 ? 'start' : 'end';
      ctx.label(cats[i] ?? String(i + 1), x, y, tsCat, anchor, Math.cos(a) > 0.5 ? 'bottom' : Math.cos(a) < -0.5 ? 'top' : 'middle', `axis:${catAx?.id ?? 0}`);
    }
  }
  for (const s of ser) {
    const pts = Array.from({ length: n }, (_, i) => at(i, s.values[i] ?? 0));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`).join('') + 'Z';
    if (g.radarStyle === 'filled') {
      const look = ctx.seriesLook(s, null, 'fill');
      ctx.push({ t: 'path', id: `series:${s.index}`, d, fill: look.fill ?? undefined, stroke: look.line ?? undefined, opacity: s.series.shape?.fill ? undefined : 0.85 });
    } else {
      const look = ctx.seriesLook(s, null, 'line');
      if (look.line) ctx.push({ t: 'path', id: `series:${s.index}`, d, stroke: look.line });
      if (hasMarker(s)) {
        pts.forEach((p, i) => {
          const m = ctx.seriesLook(s, i, 'marker');
          drawMarker(ctx, markerSymbol(s), p[0], p[1], (s.series.marker?.size ?? 5) * PT, m.fill, m.line, `point:${s.index}:${i}`);
        });
      }
    }
    const l = labelsOf(s);
    if (l) pts.forEach((p, i) => {
      const t = labelText(l, s, i);
      if (t) ctx.label(t, p[0], p[1] - 8, ctx.text(l.text), 'middle', 'bottom', `labels:${s.index}`);
    });
    ctx.hit(`series:${s.index}`, cx - r, cy - r, 2 * r, 2 * r);
  }
  ctx.hit('plot', cx - r, cy - r, 2 * r, 2 * r);
}
