/**
 * Values as the atelier shows them (fr-CA: comma decimals, true minus sign, « 5 600 K »), and the
 * geometry edits that keep the crop where the user sees it.
 */
import { leafValue, type Recipe } from '../recipe';
import { locale, tr } from '@oel/i18n';

type Rect = [number, number, number, number];

const nf = (digits: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

export interface Display {
  /** Decimals shown. */
  digits?: number;
  /** `+12` / `−40` for controls centred on zero. */
  signed?: boolean;
  unit?: string;
  /** Kelvins, by steps of 50 (`5 600 K`). */
  kelvin?: boolean;
}

/** fr-CA value text: comma decimals, true minus sign. */
export function formatValue(v: number, d: Display = {}): string {
  if (d.kelvin) return `${nf(0).format(Math.round(v / 50) * 50)} K`;
  const digits = d.digits ?? 0;
  const rounded = Number(v.toFixed(digits));
  const sign = rounded < 0 ? '−' : d.signed && rounded > 0 ? '+' : '';
  return `${sign}${nf(digits).format(Math.abs(rounded))}${d.unit ?? ''}`;
}

export interface AspectChoice {
  id: string;
  label: string;
  /** Width / height, or null (free, original). */
  ratio: number | null;
}

export const ASPECTS: AspectChoice[] = [
  { id: 'original', label: tr('Original', 'Original'), ratio: null },
  { id: 'libre', label: tr('Libre', 'Free'), ratio: null },
  { id: '1:1', label: tr('Carré (1:1)', 'Square (1:1)'), ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

/** Ratio (in pixels) an aspect id asks for, for a frame of `fw × fh`. */
export function aspectRatio(id: string, fw: number, fh: number): number | null {
  if (id === 'original') return fw / fh;
  return ASPECTS.find((a) => a.id === id)?.ratio ?? null;
}

/** Largest rectangle of `ratio` (pixels) centred on `crop`, inside the frame. */
export function cropForAspect(crop: Rect, ratio: number | null, fw: number, fh: number): Rect {
  if (!ratio) return crop;
  const [x0, y0, x1, y1] = crop;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // Half extents in pixels, limited by the frame around the centre.
  const maxHw = Math.min(cx, 1 - cx) * fw;
  const maxHh = Math.min(cy, 1 - cy) * fh;
  let hw = ((x1 - x0) * fw) / 2;
  let hh = hw / ratio;
  if (hh > ((y1 - y0) * fh) / 2) {
    hh = ((y1 - y0) * fh) / 2;
    hw = hh * ratio;
  }
  const k = Math.min(1, maxHw / hw, maxHh / hh);
  hw *= k;
  hh *= k;
  return [cx - hw / fw, cy - hh / fh, cx + hw / fw, cy + hh / fh];
}

const crop = (r: Recipe) => leafValue(r, 'geometry.crop') as Rect;

/** Leaves for turning what the user sees by a quarter turn (`+1` clockwise, `-1` counter-clockwise). */
export function turnLeaves(r: Recipe, dir: 1 | -1): Record<string, unknown> {
  const [x0, y0, x1, y1] = crop(r);
  const k = (Number(leafValue(r, 'geometry.rotate')) || 0) + (dir === 1 ? 1 : 3);
  // Turning the screen image swaps the mirror axes (R·Fh = Fv·R); the crop turns with it.
  return {
    'geometry.rotate': k % 4,
    'geometry.flipH': leafValue(r, 'geometry.flipV'),
    'geometry.flipV': leafValue(r, 'geometry.flipH'),
    'geometry.crop': dir === 1 ? [1 - y1, x0, 1 - y0, x1] : [y0, 1 - x1, y1, 1 - x0],
  };
}

/** Leaves for mirroring what the user sees (the straightening angle mirrors too). */
export function flipLeaves(r: Recipe, axis: 'h' | 'v'): Record<string, unknown> {
  const [x0, y0, x1, y1] = crop(r);
  const angle = -(Number(leafValue(r, 'geometry.angle')) || 0);
  return axis === 'h'
    ? { 'geometry.flipH': !leafValue(r, 'geometry.flipH'), 'geometry.angle': angle, 'geometry.crop': [1 - x1, y0, 1 - x0, y1] }
    : { 'geometry.flipV': !leafValue(r, 'geometry.flipV'), 'geometry.angle': angle, 'geometry.crop': [x0, 1 - y1, x1, 1 - y0] };
}
