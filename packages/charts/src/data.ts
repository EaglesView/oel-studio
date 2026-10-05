/**
 * Series data: read through the host's resolver (live cells of a sheet) when
 * it knows the reference, otherwise from the values cached in the file.
 */
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
      const name = readText(s.nameRef, s.name, resolve) ?? `Série${s.idx + 1}`;
      series.push({ group, series: s, index: index++, name, cats, catLevels: levels, xs, values, sizes: size?.num, format: vals?.format ?? s.val?.format ?? undefined });
    }
  }
  return { spec, series };
}

/** Number of categories across a set of series. */
export function categoryCount(list: SeriesData[]): number {
  return list.reduce((m, s) => Math.max(m, s.values.length, s.cats.length), 0);
}
