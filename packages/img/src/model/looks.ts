/**
 * Built-in styles and Auto. A style is a whole look: applying it replaces every leaf except the
 * geometry. Project styles (plan N) will join these.
 */
import { flattenRecipe, isGeometryPath } from './recipeDoc';
import type { Recipe } from '../recipe';
import { tr } from '@oel/i18n';

export interface Style {
  id: string;
  label: string;
  recipe: Recipe;
}

export const BUILTIN_STYLES: Style[] = [
  { id: 'naturel', label: tr('Naturel', 'Natural'), recipe: {} },
  {
    id: 'chaud',
    label: tr('Chaud', 'Warm'),
    recipe: {
      whiteBalance: { tempK: 7600, tint: 6 },
      contrast: 10,
      presence: { vibrance: 15 },
      grading: { highlights: { hue: 38, sat: 25 }, shadows: { hue: 230, sat: 12 } },
    },
  },
  {
    id: 'doux',
    label: tr('Doux', 'Soft'),
    recipe: { contrast: -20, highlights: -25, shadows: 25, blacks: 20, presence: { clarity: -15, saturation: -12 } },
  },
  { id: 'nb', label: tr('N&B', 'B&W'), recipe: { contrast: 18, presence: { saturation: -100, clarity: 10 } } },
];

/** The non-geometry leaves of `r`. */
export function lookOf(r: Recipe): Record<string, unknown> {
  return Object.fromEntries(Object.entries(flattenRecipe(r)).filter(([k]) => !isGeometryPath(k)));
}

/** The built-in style `r` currently matches, if any. */
export function currentStyle(r: Recipe): Style | undefined {
  const look = JSON.stringify(lookOf(r));
  return BUILTIN_STYLES.find((s) => JSON.stringify(lookOf(s.recipe)) === look);
}

const decode = (e: number) => Math.pow(Math.max(0, e), 2.2);
const round = (v: number, step = 1) => Math.round(v / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Percentile (0…1) of a 256-bin histogram, as an encoded level 0…1. */
export function percentile(bins: ArrayLike<number>, p: number): number {
  let total = 0;
  for (let i = 0; i < bins.length; i++) total += bins[i]!;
  if (!total) return 0.5;
  let acc = 0;
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i]!;
    if (acc >= p * total) return i / 255;
  }
  return 1;
}

/**
 * Auto (Simple): Base leaves from the luminance histogram of the unedited image — exposure
 * brings the median to mid-grey, shadows / highlights recover what sits at the ends (and what
 * is clipped), whites and blacks stretch the range, a touch of vibrance.
 */
export function autoTone(luma: ArrayLike<number>): Record<string, number> {
  const lo = percentile(luma, 0.005);
  const mid = percentile(luma, 0.5);
  const hi = percentile(luma, 0.995);
  const exposure = clamp(round(Math.log2(decode(0.46) / Math.max(decode(mid), 1e-4)), 0.05), -1.5, 1.5);
  // Where the ends land after the exposure change (encoded levels).
  const k = Math.pow(2, exposure / 2.2);
  const hi2 = hi * k;
  const lo2 = lo * k;
  // Pixels already at 255 stay flat whatever the exposure: recover them with highlights.
  let total = 0;
  for (let i = 0; i < luma.length; i++) total += luma[i]!;
  const clipped = total ? (luma[255] ?? 0) / total : 0;
  const out: Record<string, number> = {
    exposure,
    highlights: clamp(round(-(Math.max(0, hi2 - 0.9) * 400 + clipped * 300)), -70, 0),
    shadows: clamp(round(Math.max(0, 0.4 - mid * k) * 120), 0, 50),
    whites: clamp(round((0.97 - Math.min(hi2, 1)) * 150), -30, 40),
    blacks: clamp(round(-(lo2 - 0.02) * 150), -40, 20),
    contrast: 8,
    'presence.vibrance': 10,
  };
  for (const key of Object.keys(out)) if (out[key] === 0 || Object.is(out[key], -0)) out[key] = 0;
  return out;
}
