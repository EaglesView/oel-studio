import { lang } from '@oel/i18n';
/**
 * Value axis scaling, after Excel's automatic bounds:
 * - the minimum is 0 unless every value is positive and the smallest is more
 *   than 5/6 of the largest (then the axis starts near the data), and the
 *   same rule mirrored for negative data;
 * - the major unit is 1, 2 or 5 × 10ⁿ, chosen so that the axis has at most
 *   about 10 intervals for the plot height;
 * - the maximum is the first major tick above the data, with a little
 *   headroom (Excel leaves ~5 % above the largest value).
 */

export interface Scale {
  min: number;
  max: number;
  major: number;
  minor: number;
  ticks: number[];
  log?: number;
}

function niceUnit(range: number, maxIntervals: number): number {
  if (!(range > 0)) return 1;
  const raw = range / maxIntervals;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (m * p >= raw) return m * p;
  }
  return 10 * p;
}

const clean = (v: number) => Number(v.toPrecision(12));

export interface ScaleOpts {
  min?: number | null;
  max?: number | null;
  major?: number | null;
  minor?: number | null;
  logBase?: number | null;
  /** Plot length in px along the axis (more room → more ticks, like Excel). */
  length?: number;
  /** Bars and areas always include zero. */
  includeZero?: boolean;
  /** Percent-stacked: 0…1 fixed. */
  percent?: boolean;
}

export function valueScale(dataMin: number, dataMax: number, o: ScaleOpts = {}): Scale {
  if (o.logBase && o.logBase > 1) return logScale(dataMin, dataMax, o);
  if (o.percent) {
    const min = o.min ?? (dataMin < 0 ? -1 : 0);
    const max = o.max ?? (dataMax > 0 ? 1 : 0);
    const major = o.major ?? niceUnit(max - min, 10);
    return finish(min, max, major, o.minor ?? major / 5);
  }
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    dataMin = 0;
    dataMax = 1;
  }
  if (dataMin === dataMax) {
    if (dataMin === 0) dataMax = 1;
    else if (dataMin > 0) dataMin = 0;
    else dataMax = 0;
  }
  let lo = dataMin;
  let hi = dataMax;
  if (o.min == null) {
    if (lo >= 0 && (o.includeZero || lo <= (hi * 5) / 6)) lo = 0;
  } else lo = o.min;
  if (o.max == null) {
    if (hi <= 0 && (o.includeZero || hi >= (lo * 5) / 6)) hi = 0;
  } else hi = o.max;
  const maxIntervals = Math.max(2, Math.min(10, Math.floor((o.length ?? 300) / 28)));
  const major = o.major ?? niceUnit((hi - lo) * 1.05, maxIntervals);
  const min = o.min ?? (lo === 0 ? 0 : Math.floor(clean(lo / major)) * major - (lo > 0 && lo % major === 0 ? major : 0));
  let max = o.max ?? Math.ceil(clean(hi / major)) * major;
  if (o.max == null && hi > 0 && max - hi < major * 0.05) max += major;
  if (max <= min) max = min + major;
  return finish(clean(min), clean(max), major, o.minor ?? major / 5);
}

function finish(min: number, max: number, major: number, minor: number): Scale {
  const ticks: number[] = [];
  const n = Math.round((max - min) / major);
  for (let i = 0; i <= n && i < 200; i++) ticks.push(clean(min + i * major));
  return { min, max, major, minor, ticks };
}

function logScale(dataMin: number, dataMax: number, o: ScaleOpts): Scale {
  const b = o.logBase!;
  const lg = (v: number) => Math.log(v) / Math.log(b);
  const lo = o.min ?? b ** Math.floor(lg(Math.max(dataMin, Number.MIN_VALUE) || 1));
  const hi = o.max ?? b ** Math.ceil(lg(Math.max(dataMax, lo * b)));
  const ticks: number[] = [];
  for (let v = lo; v <= hi * 1.0000001 && ticks.length < 60; v *= b) ticks.push(clean(v));
  return { min: lo, max: hi, major: b, minor: b, ticks, log: b };
}

/** Position of `v` on a scale, 0…1 (log aware, unclamped). */
export function frac(s: Scale, v: number): number {
  if (s.log) {
    const lg = (x: number) => Math.log(Math.max(x, Number.MIN_VALUE)) / Math.log(s.log!);
    return (lg(v) - lg(s.min)) / (lg(s.max) - lg(s.min) || 1);
  }
  return (v - s.min) / (s.max - s.min || 1);
}

/** Excel's display units (`thousands`…) → divisor and the label Excel shows. */
export function displayUnits(u?: string | null): { div: number; label: string } | null {
  if (!u) return null;
  const en = lang() === 'en';
  const table: Record<string, [number, string]> = {
    hundreds: [1e2, en ? 'Hundreds' : 'Centaines'],
    thousands: [1e3, en ? 'Thousands' : 'Milliers'],
    tenThousands: [1e4, en ? 'Ten Thousands' : 'Dizaines de milliers'],
    hundredThousands: [1e5, en ? 'Hundred Thousands' : 'Centaines de milliers'],
    millions: [1e6, en ? 'Millions' : 'Millions'],
    tenMillions: [1e7, en ? 'Ten Millions' : 'Dizaines de millions'],
    hundredMillions: [1e8, en ? 'Hundred Millions' : 'Centaines de millions'],
    billions: [1e9, en ? 'Billions' : 'Milliards'],
    trillions: [1e12, en ? 'Trillions' : 'Billions'],
  };
  const t = table[u];
  if (t) return { div: t[0], label: t[1] };
  const n = Number(u);
  return Number.isFinite(n) && n > 0 ? { div: n, label: '' } : null;
}
