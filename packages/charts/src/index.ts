/**
 * @oel/charts — draws the charts of Office files and of the editors.
 *
 *   const scene = renderChart(spec, { width, height, resolve });
 *   el.innerHTML = toSVG(scene);          // DOM editors, print, thumbnails
 *   paintCanvas(ctx2d, scene, x, y);      // the sheet grid
 *
 * `spec` is the `ChartSpec` the codecs read (`crates/oel-chart`). `resolve`
 * gives live values for cell references; without it the file's cache is used.
 */
import { resolveChart } from './data';
import { formatValue } from './format';
import { cartesian } from './layout/cartesian';
import { chartArea, inset, legend, legendEntries, title, type LegendEntry } from './layout/frame';
import { chartEx } from './layout/chartex';
import { pie } from './layout/pie';
import { radar } from './layout/radar';
import { bars3d, surface, surfaceBands, surfaceScale } from './layout/three';
import { Ctx } from './style';
import type { ChartSpec, RenderOptions, ResolvedChart, Scene } from './types';
import { messages, plural } from '@oel/i18n';

const t = messages(
  {
    notShown: 'Graphique non affiché',
    chart: 'Graphique',
    kinds: { bar: 'Histogramme', line: 'Courbes', pie: 'Secteurs', doughnut: 'Anneau', area: 'Aires', scatter: 'Nuage de points', bubble: 'Bulles', radar: 'Radar', stock: 'Boursier', surface: 'Surface' } as Record<string, string>,
    range: (name: string, lo: string, hi: string) => `${name} : ${lo} à ${hi}`,
    describe: (kind: string, title: string | undefined, n: number, parts: string[]) =>
      `${kind}${title ? ` « ${title} »` : ''}, ${n} ${plural(n, 'série', 'séries')}${parts.length ? ` (${parts.join(' ; ')})` : ''}.`,
  },
  {
    notShown: 'Chart not shown',
    chart: 'Chart',
    kinds: { bar: 'Column chart', line: 'Line chart', pie: 'Pie chart', doughnut: 'Doughnut chart', area: 'Area chart', scatter: 'Scatter chart', bubble: 'Bubble chart', radar: 'Radar chart', stock: 'Stock chart', surface: 'Surface chart' },
    range: (name, lo, hi) => `${name}: ${lo} to ${hi}`,
    describe: (kind, title, n, parts) => `${kind}${title ? ` “${title}”` : ''}, ${n} ${plural(n, 'series', 'series')}${parts.length ? ` (${parts.join('; ')})` : ''}.`,
  },
);

export type * from './types';
export { chartName, keepLook, resolveChart, withCaches } from './data';
export { formatValue, isDateFormat } from './format';
export { valueScale } from './scale';
export { cellResolver, parseRef, type CellReader, type RefArea } from './refs';
export { toSVG, toDataURL } from './render/svg';
export { paintCanvas, canvasMeasure } from './render/canvas';
export { applyType, chartFamily, CHART_FALLBACK_NAME, CHART_TITLE, CHART_TYPES, FAMILIES, seriesName, newChart, recommend, type CellBlock, type ChartTypeInfo } from './catalog';

export type Family = 'cartesian' | 'pie' | 'radar' | 'surface' | 'three' | 'ex';

export function familyOf(spec: ChartSpec): Family {
  const g = spec.groups[0];
  if (!g) return 'cartesian';
  if (spec.ex) return 'ex';
  if (['pie', 'doughnut', 'ofPie'].includes(g.kind)) return 'pie';
  if (g.kind === 'radar') return 'radar';
  if (g.kind === 'surface') return 'surface';
  if (g.threeD && ['bar', 'line', 'area'].includes(g.kind)) return 'three';
  return 'cartesian';
}

function entries(ctx: Ctx, data: ResolvedChart): LegendEntry[] {
  if (familyOf(ctx.spec) === 'surface') {
    const ser = data.series.filter((s) => s.group.kind === 'surface');
    const fmt = ser[0]?.format;
    return surfaceBands(surfaceScale(ctx, ser), ctx.palette).map((b, i) => ({ label: `${formatValue(b.lo, fmt)}-${formatValue(b.hi, fmt)}`, fill: b.color, line: null, id: `band:${i}` }));
  }
  if (ctx.spec.ex) {
    const kind = ctx.spec.groups[0]?.kind;
    if (kind === 'treemap' || kind === 'sunburst') {
      const s = data.series[0];
      const top = s?.catLevels?.length ? s.catLevels[s.catLevels.length - 1]! : (s?.cats ?? []);
      const seen: string[] = [];
      for (let i = 0; i < top.length; i++) {
        const v = top[i] || seen[seen.length - 1];
        if (v && !seen.includes(v)) seen.push(v);
      }
      return seen.map((l, i) => ({ label: l, fill: ctx.auto(i), line: null, id: `legend:${i}` }));
    }
    return data.series.filter((s) => !s.series.hidden && s.group.kind !== 'paretoLine').map((s) => ({ label: s.name, fill: ctx.paint(s.series.shape?.fill) ?? ctx.auto(s.series.idx), line: null, id: `series:${s.index}` }));
  }
  return legendEntries(ctx, data);
}

/** Lay a chart out into a scene of marks. */
export function renderChart(spec: ChartSpec, opts: RenderOptions): Scene {
  const ctx = new Ctx(spec, opts);
  const data = resolveChart(spec, opts.resolve);
  chartArea(ctx);
  let r = inset({ x: 0, y: 0, w: opts.width, h: opts.height });
  r = title(ctx, data, r);
  r = legend(ctx, entries(ctx, data), r);
  if (spec.plotLayout && !spec.plotLayout.inner && spec.plotLayout.w && spec.plotLayout.h) {
    r = { x: spec.plotLayout.x * opts.width, y: spec.plotLayout.y * opts.height, w: spec.plotLayout.w * opts.width, h: spec.plotLayout.h * opts.height };
  }
  try {
    switch (familyOf(spec)) {
      case 'pie':
        pie(ctx, data, r);
        break;
      case 'radar':
        radar(ctx, data, r);
        break;
      case 'surface':
        surface(ctx, data, r);
        break;
      case 'three':
        bars3d(ctx, data, r);
        break;
      case 'ex':
        chartEx(ctx, data, r);
        break;
      default:
        cartesian(ctx, data, r);
    }
  } catch (e) {
    // A chart we cannot lay out still shows its frame and a reason.
    ctx.label(t.notShown, r.x + r.w / 2, r.y + r.h / 2, ctx.text(null, { size: 11 }));
    console.warn('@oel/charts', e);
  }
  return { w: opts.width, h: opts.height, marks: ctx.marks, hits: ctx.hits, label: describe(data) };
}

/** A sentence for screen readers: type, title, series and their ranges. */
export function describe(data: ResolvedChart): string {
  const s = data.series.filter((x) => !x.series.hidden);
  const kind = s[0]?.group.kind ?? '';
  const title = data.spec.title?.text;
  const parts = s.slice(0, 6).map((x) => {
    const vals = x.values.filter((v): v is number => v != null);
    return vals.length ? t.range(x.name, formatValue(Math.min(...vals), x.format), formatValue(Math.max(...vals), x.format)) : x.name;
  });
  return t.describe(t.kinds[kind] ?? t.chart, title, s.length, parts);
}
