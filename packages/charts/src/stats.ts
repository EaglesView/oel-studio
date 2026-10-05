/** Trendlines (least squares, as Excel computes them), error amounts and quartiles. */

export interface Fit {
  f: (x: number) => number;
  r2: number;
  /** Equation as Excel shows it (`y = 1.2x + 3.4`). */
  eq: string;
}

const fmt = (v: number) => {
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e6) ? v.toExponential(3).replace('e', 'E') : Number(v.toPrecision(5)).toString();
};
const term = (c: number, s: string, first: boolean) => (first ? (c < 0 ? '-' : '') : c < 0 ? ' - ' : ' + ') + fmt(Math.abs(c)) + s;

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const d = m[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = m[r]![c]! / d;
      for (let k2 = c; k2 <= n; k2++) m[r]![k2]! -= k * m[c]![k2]!;
    }
  }
  return m.map((row, i) => row[n]! / (row[i] || 1e-12));
}

function polyFit(xs: number[], ys: number[], order: number): number[] {
  const n = order + 1;
  const a = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < xs.length; i++) {
    for (let r = 0; r < n; r++) {
      b[r]! += ys[i]! * xs[i]! ** r;
      for (let c = 0; c < n; c++) a[r]![c]! += xs[i]! ** (r + c);
    }
  }
  return solve(a, b);
}

function r2(xs: number[], ys: number[], f: (x: number) => number): number {
  const mean = ys.reduce((s, v) => s + v, 0) / (ys.length || 1);
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < xs.length; i++) {
    ssr += (ys[i]! - f(xs[i]!)) ** 2;
    sst += (ys[i]! - mean) ** 2;
  }
  return sst ? 1 - ssr / sst : 1;
}

export function fit(kind: string, xs: number[], ys: number[], order = 2, intercept?: number | null): Fit | null {
  if (xs.length < 2) return null;
  switch (kind) {
    case 'exp': {
      const ok = ys.every((y) => y > 0);
      if (!ok) return null;
      const [a0, b] = polyFit(xs, ys.map(Math.log), 1) as [number, number];
      const a = Math.exp(a0);
      const f = (x: number) => a * Math.exp(b * x);
      return { f, r2: r2(xs, ys, f), eq: `y = ${fmt(a)}e^${fmt(b)}x` };
    }
    case 'log': {
      if (!xs.every((x) => x > 0)) return null;
      const [a, b] = polyFit(xs.map(Math.log), ys, 1) as [number, number];
      const f = (x: number) => a + b * Math.log(x);
      return { f, r2: r2(xs, ys, f), eq: `y = ${fmt(b)}ln(x)${term(a, '', false)}` };
    }
    case 'power': {
      if (!xs.every((x) => x > 0) || !ys.every((y) => y > 0)) return null;
      const [a0, b] = polyFit(xs.map(Math.log), ys.map(Math.log), 1) as [number, number];
      const a = Math.exp(a0);
      const f = (x: number) => a * x ** b;
      return { f, r2: r2(xs, ys, f), eq: `y = ${fmt(a)}x^${fmt(b)}` };
    }
    case 'poly': {
      const k = Math.max(2, Math.min(6, order));
      const c = polyFit(xs, ys, k);
      const f = (x: number) => c.reduce((s, ci, i) => s + ci * x ** i, 0);
      let eq = 'y = ';
      for (let i = k, first = true; i >= 0; i--, first = false) eq += term(c[i]!, i === 0 ? '' : i === 1 ? 'x' : `x^${i}`, first);
      return { f, r2: r2(xs, ys, f), eq };
    }
    default: {
      let b: number;
      let a: number;
      if (intercept != null) {
        let num = 0;
        let den = 0;
        for (let i = 0; i < xs.length; i++) {
          num += xs[i]! * (ys[i]! - intercept);
          den += xs[i]! ** 2;
        }
        b = den ? num / den : 0;
        a = intercept;
      } else [a, b] = polyFit(xs, ys, 1) as [number, number];
      const f = (x: number) => a + b * x;
      return { f, r2: r2(xs, ys, f), eq: `y = ${fmt(b)}x${term(a, '', false)}` };
    }
  }
}

export function movingAverage(ys: (number | null)[], period: number): (number | null)[] {
  return ys.map((_, i) => {
    if (i < period - 1) return null;
    const w = ys.slice(i - period + 1, i + 1).filter((v): v is number => v != null);
    return w.length ? w.reduce((s, v) => s + v, 0) / w.length : null;
  });
}

export function stdev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Quartiles for box and whisker (`exclusive` = Excel's QUARTILE.EXC, default; `inclusive` = QUARTILE.INC). */
export function quartiles(values: number[], method: string | null | undefined) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const q = (p: number) => {
    if (!n) return 0;
    const h = method === 'inclusive' ? (n - 1) * p : (n + 1) * p - 1;
    const lo = Math.max(0, Math.min(n - 1, Math.floor(h)));
    const hi = Math.max(0, Math.min(n - 1, lo + 1));
    return v[lo]! + (h - Math.floor(h)) * (v[hi]! - v[lo]!);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return {
    q1,
    median: q(0.5),
    q3,
    mean: n ? v.reduce((s, x) => s + x, 0) / n : 0,
    lo: inside[0] ?? q1,
    hi: inside[inside.length - 1] ?? q3,
    outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr),
  };
}
