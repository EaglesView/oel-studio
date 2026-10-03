/**
 * Row and column positions in CSS pixels. Sizes default to the sheet's
 * default; the few lines with their own size are kept sorted with running
 * differences, so offsets and hit tests are binary searches.
 */

/** Excel column width (characters of the default font, Calibri 11 ≈ 7 px) → pixels. */
export const colWidthPx = (chars: number) => (chars <= 0 ? 0 : Math.round(chars * 7 + 5));
export const pxToColWidth = (px: number) => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);
/** Points → pixels. */
export const rowHeightPx = (pt: number) => Math.round((pt * 4) / 3);
export const pxToRowHeight = (px: number) => Math.round(((px * 3) / 4) * 100) / 100;

export class Axis {
  /** Indices with their own size, ascending. */
  private idx: number[] = [];
  private px: number[] = [];
  /** cum[i] = sum over idx[0..i) of (px - def). */
  private cum: number[] = [0];

  constructor(
    readonly def: number,
    readonly count: number,
    overrides: Map<number, number> = new Map(),
  ) {
    const entries = [...overrides].filter(([i]) => i < count).sort((a, b) => a[0] - b[0]);
    for (const [i, p] of entries) {
      this.idx.push(i);
      this.px.push(p);
      this.cum.push(this.cum[this.cum.length - 1]! + (p - def));
    }
  }

  /** Number of overrides strictly before index i. */
  private before(i: number): number {
    let lo = 0;
    let hi = this.idx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.idx[mid]! < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  size(i: number): number {
    const k = this.before(i);
    return this.idx[k] === i ? this.px[k]! : this.def;
  }

  /** Left/top edge of line i. */
  offset(i: number): number {
    return i * this.def + this.cum[this.before(i)]!;
  }

  get total(): number {
    return this.offset(this.count);
  }

  /** The line under pixel position p (clamped to the axis). */
  indexAt(p: number): number {
    if (p <= 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offset(mid) <= p) lo = mid;
      else hi = mid - 1;
    }
    // Skip zero-size (hidden) lines forward.
    while (lo < this.count - 1 && this.size(lo) === 0) lo++;
    return lo;
  }

  hidden(i: number): boolean {
    return this.size(i) === 0;
  }

  /** Next visible line from i in direction d (stays at i when there is none). */
  step(i: number, d: 1 | -1): number {
    let j = i + d;
    while (j >= 0 && j < this.count && this.hidden(j)) j += d;
    return j < 0 || j >= this.count ? i : j;
  }
}
