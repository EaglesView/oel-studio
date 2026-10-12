/**
 * Series data: read through the host's resolver (live cells of a sheet) when
 * it knows the reference, otherwise from the values cached in the file.
 */
import { applyType, chartFamily, CHART_FALLBACK_NAME, seriesName } from './catalog';
import { formatValue, isDateFormat } from './format';
import type { ChartSpec, DataRef, RefValues, ResolvedChart, Resolver, SeriesData } from './types';

function read(ref: DataRef | undefined, resolve?: Resolver): RefValues | null {
  if (!ref) return null;
  const live = ref.f && resolve ? resolve(ref.f) : null;
  if (live) return live;
  const n = Math.max(ref.count ?? 0, ref.num?.length ?? 0, ref.str?.length ?? 0);
  const num: (number | null)[] = [];
  const text: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const v = ref.num?.[i] ?? null;
    const s = ref.str?.[i] ?? null;
    num.push(v ?? (s != null && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null));
    text.push(s ?? (v != null ? formatValue(v, ref.format) : null));
  }
  return { num, text, format: ref.format ?? undefined };
}

/** Text of a single-cell reference (series name, title linked to a cell). */
export function readText(f: string | undefined | null, cached: string | undefined | null, resolve?: Resolver): string | undefined {
  if (f && resolve) {
    const v = resolve(f);
    const t = v?.text.find((x) => x != null && x !== '');
    if (t) return t;
  }
  return cached ?? undefined;
}

export function resolveChart(spec: ChartSpec, resolve?: Resolver): ResolvedChart {
  const series: SeriesData[] = [];
  let index = 0;
  for (const group of spec.groups) {
    const xy = group.kind === 'scatter' || group.kind === 'bubble';
    for (const s of [...group.series].sort((a, b) => a.order - b.order)) {
      const vals = read(s.val ?? undefined, resolve);
      const cat = read(s.cat ?? undefined, resolve);
      const size = read(s.size ?? undefined, resolve);
      const values = vals?.num ?? [];
      const n = Math.max(values.length, cat?.text.length ?? 0);
      let cats: string[] = [];
      let xs: (number | null)[] | undefined;
      if (cat) {
        const dateCats = isDateFormat(cat.format) && cat.num.some((v) => v != null);
        cats = cat.text.map((t, i) => (dateCats && cat.num[i] != null ? formatValue(cat.num[i], cat.format) : (t ?? '')));
        if (xy) xs = cat.num.some((v) => v != null) ? cat.num : cat.num.map((_, i) => i + 1);
      }
      if (cats.length < n) for (let i = cats.length; i < n; i++) cats.push(String(i + 1));
      if (xy && !xs) xs = values.map((_, i) => i + 1);
      const levels = s.cat?.levels?.length ? s.cat.levels.map((l) => l.map((x) => x ?? '')) : undefined;
      const name = readText(s.nameRef, s.name, resolve) ?? seriesName(s.idx + 1);
      series.push({ group, series: s, index: index++, name, cats, catLevels: levels, xs, values, sizes: size?.num, format: vals?.format ?? s.val?.format ?? undefined });
    }
  }
  return { spec, series };
}

/** Number of categories across a set of series. */
export function categoryCount(list: SeriesData[]): number {
  return list.reduce((m, s) => Math.max(m, s.values.length, s.cats.length), 0);
}

/**
 * The chart with its caches filled from live values: what a copy of it shows
 * without the cells (a chart linked into a slide or a document, Figma G2).
 * References stay as they are; values, texts and formats come from `resolve`.
 */
export function withCaches(spec: ChartSpec, resolve: Resolver): ChartSpec {
  const fill = (ref: DataRef | undefined | null): DataRef | undefined => {
    if (!ref?.f) return ref ?? undefined;
    const v = resolve(ref.f);
    if (!v) return ref;
    const hasNum = v.num.some((x) => x != null);
    return {
      ...ref,
      format: v.format ?? ref.format,
      num: hasNum ? v.num : undefined,
      str: hasNum ? undefined : v.text,
      count: Math.max(v.num.length, v.text.length),
    };
  };
  return {
    ...spec,
    title: spec.title?.f ? { ...spec.title, text: readText(spec.title.f, spec.title.text, resolve) } : spec.title,
    groups: spec.groups.map((g) => ({
      ...g,
      series: g.series.map((s) => ({
        ...s,
        name: s.nameRef ? readText(s.nameRef, s.name, resolve) : s.name,
        cat: fill(s.cat),
        val: fill(s.val),
        size: fill(s.size),
      })),
    })),
  };
}

/** A short name for a chart: its title, else its only series, else « Graphique ». */
export function chartName(spec: ChartSpec): string {
  const t = spec.title?.text?.trim();
  if (t) return t;
  const series = spec.groups.flatMap((g) => g.series);
  return (series.length === 1 && series[0]!.name?.trim()) || CHART_FALLBACK_NAME;
}

/**
 * The source chart with the look of `target` kept: what a copy linked with
 * « Données seulement » shows (Figma G3 « Transporte »). Series, values and
 * the kind of chart follow the source; colours, fonts, legend, title style
 * and the variant within the same family (stacked, with markers, 3-D…) stay.
 */
export function keepLook(target: ChartSpec | null, source: ChartSpec): ChartSpec {
  if (!target) return source;
  const look = withLook(target, source);
  const mine = chartFamily(target);
  const theirs = chartFamily(source);
  if (!mine || !theirs || mine.id === theirs.id || mine.family !== theirs.family || mine.ex || theirs.ex) return look;
  return { ...applyType(look, mine.id), view3d: target.view3d };
}

function withLook(target: ChartSpec, source: ChartSpec): ChartSpec {
  return {
    ...source,
    palette: target.palette,
    style: target.style,
    space: target.space,
    plot: target.plot,
    text: target.text,
    font: target.font,
    legend: target.legend,
    title: target.title ? { ...target.title, text: source.title?.text ?? target.title.text } : source.title,
    groups: source.groups.map((g, gi) => ({
      ...g,
      series: g.series.map((s, si) => {
        const t = target.groups[gi]?.series[si];
        return t ? { ...s, shape: t.shape, marker: t.marker, labels: t.labels } : s;
      }),
    })),
  };
}
