/**
 * E5 · Garde-fou de contraste: a colour too light for text and buttons is
 * darkened automatically, and the organiser sees the correction
 * (« #F5C518 · choisie — 1,6:1 refusé → #8A6A00 · appliquée — 5,1:1 AA »).
 */

export const AA = 4.5;

type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const toHex = ([r, g, b]: RGB) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix toward black (amount < 0) or white (amount > 0), keeping the hue. */
function shade(rgb: RGB, amount: number): RGB {
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return rgb.map((c) => c + (t - c) * p) as RGB;
}

export interface ContrastResult {
  picked: string;
  /** Colour actually used for fills (white text on it) and accent text on paper. */
  applied: string;
  pickedRatio: number;
  appliedRatio: number;
  adjusted: boolean;
  /** Lighter variant for accent text on the dark-mode paper. */
  appliedDark: string;
}

const PAPER = '#FBFAF6';
const WHITE = '#FFFFFF';
const DARK_PAPER = '#34333D';

/** Worst of: white text on the accent, accent text on the paper. */
const lightRatio = (hex: string) => Math.min(contrastRatio(hex, WHITE), contrastRatio(hex, PAPER));

export function contrastGuard(picked: string): ContrastResult {
  const rgb = parseHex(picked) ?? parseHex('#7759C5')!;
  const hex = toHex(rgb);
  const pickedRatio = lightRatio(hex);
  let applied = hex;
  for (let i = 1; i <= 40 && lightRatio(applied) < AA; i++) applied = toHex(shade(rgb, -i * 0.025));
  let appliedDark = hex;
  for (let i = 1; i <= 40 && contrastRatio(appliedDark, DARK_PAPER) < AA; i++) appliedDark = toHex(shade(rgb, i * 0.025));
  return { picked: hex, applied, pickedRatio, appliedRatio: lightRatio(applied), adjusted: applied !== hex, appliedDark };
}

export const formatRatio = (r: number) => `${r.toLocaleString('fr-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}:1`;

/** CSS custom properties the respondent page and builder canvas apply on the form root. */
export function accentVars(picked: string): Record<string, string> {
  const g = contrastGuard(picked);
  return {
    '--form-accent': g.applied,
    '--form-accent-dark': g.appliedDark,
  };
}
