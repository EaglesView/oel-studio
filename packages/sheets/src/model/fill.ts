/**
 * The fill handle (and Ctrl+D / Ctrl+R): extends a source block along one
 * axis the way Excel's AutoFill does — linear trends for numbers, +1 day for
 * a single date, "Item 1 → Item 2", weekday and month names (fr/en), formulas
 * moved by their offset, everything else repeated.
 */
import { shiftFormula } from './formula';
import { isDateFormat } from './ydoc';

export interface FillSource {
  /** Formula text (A1, no `=`) or literal value. */
  f?: string;
  t?: 'n' | 's' | 'b' | 'e';
  v?: number | string | boolean;
  s?: number;
  numFmt?: string;
}

export type FillResult = { f?: string; t?: 'n' | 's' | 'b' | 'e'; v?: number | string | boolean; s?: number } | null;

const LISTS: string[][] = [
  ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
  ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'],
  ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
];

function matchCase(word: string, like: string) {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0]!.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

function listOf(s: string): { list: string[]; i: number } | null {
  const low = s.toLowerCase().replace(/\.$/, '');
  for (const list of LISTS) {
    const i = list.indexOf(low);
    if (i >= 0) return { list, i };
  }
  return null;
}

/** Least-squares line through (0, y0), (1, y1)… — Excel's trend for 2+ numbers. */
function trend(ys: number[]): (k: number) => number {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  const slope = den ? num / den : 0;
  return (k) => +(my + slope * (k - mx)).toPrecision(15);
}

/**
 * Values for `count` new cells after (forward) or before (backward) a line
 * of `src` cells. `step` is the row/column distance between consecutive
 * cells (for moving formulas): (dr, dc) per cell.
 */
export function fillLine(src: FillSource[], count: number, backward: boolean, step: { dr: number; dc: number }): FillResult[] {
  const n = src.length;
  const out: FillResult[] = [];
  if (!n) return out;
  const nums = src.every((s) => !s.f && s.t === 'n' && typeof s.v === 'number');
  const numTrend = nums && n >= 2 ? trend(src.map((s) => s.v as number)) : null;
  const singleDate = nums && n === 1 && isDateFormat(src[0]!.numFmt ?? 'General');
  // "Item 3": text with a trailing integer.
  const numbered = src.map((s) => (s.t === 's' && typeof s.v === 'string' ? /^(.*?)(\d+)$/.exec(s.v) : null));
  const named = src.map((s) => (s.t === 's' && typeof s.v === 'string' ? listOf(s.v) : null));
  const samePrefix = numbered.every((m) => m && m[1] === numbered[0]![1]);
  const numberedRun = samePrefix ? (n === 1 ? (k: number) => Number(numbered[0]![2]) + k : trend(numbered.map((m) => Number(m![2])))) : null;
  // Zero-padded codes keep their width ("A007" → "A008").
  const numberedWidth = samePrefix && numbered[0]![2]!.startsWith('0') ? numbered[0]![2]!.length : 0;
  for (let k = 1; k <= count; k++) {
    // Position in the series relative to the source (k past the end, or before the start).
    const idx = backward ? -k : n - 1 + k;
    const from = ((idx % n) + n) % n;
    const s = src[from]!;
    if (numTrend) {
      out.push({ t: 'n', v: numTrend(idx), s: s.s });
    } else if (singleDate) {
      out.push({ t: 'n', v: (s.v as number) + (backward ? -k : k), s: s.s });
    } else if (s.f != null) {
      const offset = idx - from;
      out.push({ f: shiftFormula(s.f, offset * step.dr, offset * step.dc), s: s.s });
    } else if (named[from] && named.every((x) => x)) {
      // A run of names continues from the last one (lundi, mardi → mercredi).
      const base = named[backward ? 0 : n - 1]!;
      const pos = base.i + (backward ? -k : k);
      const word = base.list[((pos % base.list.length) + base.list.length) % base.list.length]!;
      out.push({ t: 's', v: matchCase(word, String(src[backward ? 0 : n - 1]!.v)), s: s.s });
    } else if (numberedRun) {
      // "Item 1" counts up; "Item 1, Item 3" follows its trend.
      const v = Math.round(numberedRun(idx));
      out.push(v < 0 ? (s.t ? { t: s.t, v: s.v, s: s.s } : null) : { t: 's', v: `${numbered[0]![1]}${String(v).padStart(numberedWidth, '0')}`, s: s.s });
    } else {
      out.push(s.t ? { t: s.t, v: s.v, s: s.s } : s.s ? { s: s.s } : null);
    }
  }
  return out;
}
