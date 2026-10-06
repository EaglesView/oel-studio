/**
 * What the atelier shows: Simple controls (macros over Avancé leaves) and the Avancé panels
 * (Figma L1). Both edit the same recipe.
 */
import { fieldSpec, leafValue, type Recipe } from '../recipe';
import type { Display } from './format';

export interface SliderControl {
  /** Leaf path (Avancé) or Simple control id. */
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  display: Display;
  /** Track tint (`temp`, `tint`, `hue`, or a CSS colour for HSL bands). */
  track?: string;
}

/** A slider bound to one recipe leaf. */
export function leafSlider(path: string, label: string, display: Display = { signed: true }, track?: string): SliderControl {
  const f = fieldSpec(path);
  if (!f) throw new Error(`Réglage inconnu : ${path}`);
  return { id: path, label, min: f.min, max: f.max, step: f.step, display, track };
}

// ── Simple ──────────────────────────────────────────────────────────────────────────────────

export interface SimpleControl extends SliderControl {
  /** Value shown, read back from the recipe (its primary leaf). */
  read(r: Recipe): number;
  /** Leaves written for `v`; `undefined` everywhere when reset. */
  write(v: number | undefined): Record<string, unknown>;
}

const num = (r: Recipe, p: string) => Number(leafValue(r, p)) || 0;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MIRED_6500 = 1e6 / 6500;

/** Simple « Chaleur » ↔ kelvins: linear in mireds, so equal steps feel equal. */
export const warmthToKelvin = (v: number) => Math.round(1e6 / (MIRED_6500 - v * 0.75) / 50) * 50;
export const kelvinToWarmth = (k: number) => Math.round((MIRED_6500 - 1e6 / k) / 0.75);

export const SIMPLE_GROUPS: Array<{ id: string; label: string; controls: SimpleControl[] }> = [
  {
    id: 'lumiere',
    label: 'Lumière',
    controls: [
      {
        id: 'luminosite',
        label: 'Luminosité',
        min: -2,
        max: 2,
        step: 0.05,
        display: { signed: true, digits: 2 },
        read: (r) => num(r, 'exposure'),
        // Brighter: protect the highlights a little.
        write: (v) => ({ exposure: v, highlights: v === undefined ? undefined : clamp(Math.round(-v * 15), -100, 100) }),
      },
      {
        id: 'contraste',
        label: 'Contraste',
        min: -100,
        max: 100,
        step: 1,
        display: { signed: true },
        read: (r) => num(r, 'contrast'),
        write: (v) => ({ contrast: v, whites: v === undefined ? undefined : Math.round(v * 0.15) }),
      },
      {
        id: 'ombres',
        label: 'Ombres',
        min: -100,
        max: 100,
        step: 1,
        display: { signed: true },
        read: (r) => num(r, 'shadows'),
        write: (v) => ({ shadows: v, blacks: v === undefined ? undefined : Math.round(v * 0.25) }),
      },
    ],
  },
  {
    id: 'couleur',
    label: 'Couleur',
    controls: [
      {
        id: 'chaleur',
        label: 'Chaleur',
        min: -100,
        max: 100,
        step: 1,
        display: { signed: true },
        track: 'temp',
        read: (r) => kelvinToWarmth(num(r, 'whiteBalance.tempK') || 6500),
        write: (v) => ({ 'whiteBalance.tempK': v === undefined ? undefined : warmthToKelvin(v) }),
      },
      {
        id: 'eclat',
        label: 'Éclat',
        min: -100,
        max: 100,
        step: 1,
        display: { signed: true },
        read: (r) => num(r, 'presence.vibrance'),
        write: (v) => ({ 'presence.vibrance': v, 'presence.saturation': v === undefined ? undefined : Math.round(v * 0.3) }),
      },
    ],
  },
];

// ── Avancé ──────────────────────────────────────────────────────────────────────────────────

export type PanelBody =
  | { kind: 'sliders'; groups: Array<{ label?: string; sliders: SliderControl[] }> }
  | { kind: 'curve' }
  | { kind: 'hsl' }
  | { kind: 'grading' }
  | { kind: 'geometry' }
  | { kind: 'soon'; text: string };

export interface Panel {
  id: string;
  label: string;
  body: PanelBody;
  /** Open when the atelier opens. */
  open?: boolean;
}

const s = (path: string, label: string, display?: Display, track?: string) => leafSlider(path, label, display, track);
const plain: Display = {};

export const ADVANCED_PANELS: Panel[] = [
  {
    id: 'base',
    label: 'Base',
    open: true,
    body: {
      kind: 'sliders',
      groups: [
        {
          sliders: [
            s('whiteBalance.tempK', 'Température', { kelvin: true }, 'temp'),
            s('whiteBalance.tint', 'Teinte', { signed: true }, 'tint'),
            s('exposure', 'Exposition', { signed: true, digits: 2 }),
            s('contrast', 'Contraste'),
            s('highlights', 'Hautes lumières'),
            s('shadows', 'Ombres'),
            s('whites', 'Blancs'),
            s('blacks', 'Noirs'),
          ],
        },
      ],
    },
  },
  {
    id: 'presence',
    label: 'Présence',
    open: true,
    body: {
      kind: 'sliders',
      groups: [
        {
          sliders: [
            s('presence.texture', 'Texture'),
            s('presence.clarity', 'Clarté'),
            s('presence.dehaze', 'Correction du voile'),
            s('presence.vibrance', 'Vibrance'),
            s('presence.saturation', 'Saturation'),
          ],
        },
      ],
    },
  },
  { id: 'curve', label: 'Courbe des tonalités', body: { kind: 'curve' } },
  { id: 'hsl', label: 'Mélangeur de couleurs (TSL)', body: { kind: 'hsl' } },
  { id: 'grading', label: 'Étalonnage des couleurs', body: { kind: 'grading' } },
  {
    id: 'detail',
    label: 'Détail (netteté, bruit)',
    body: {
      kind: 'sliders',
      groups: [
        {
          label: 'Netteté',
          sliders: [
            s('detail.sharpen.amount', 'Quantité', plain),
            s('detail.sharpen.radius', 'Rayon', { digits: 1 }),
            s('detail.sharpen.detail', 'Détail', plain),
            s('detail.sharpen.masking', 'Masquage', plain),
          ],
        },
        { label: 'Réduction du bruit', sliders: [s('detail.noise.luma', 'Luminance', plain), s('detail.noise.color', 'Couleur', plain)] },
      ],
    },
  },
  { id: 'geometry', label: 'Optique et géométrie', body: { kind: 'geometry' } },
  {
    id: 'effects',
    label: 'Effets (vignette, grain)',
    body: {
      kind: 'sliders',
      groups: [
        {
          label: 'Vignette',
          sliders: [
            s('effects.vignette.amount', 'Quantité'),
            s('effects.vignette.midpoint', 'Point milieu', plain),
            s('effects.vignette.roundness', 'Rondeur'),
            s('effects.vignette.feather', 'Contour progressif', plain),
          ],
        },
        {
          label: 'Grain',
          sliders: [s('effects.grain.amount', 'Quantité', plain), s('effects.grain.size', 'Taille', plain), s('effects.grain.roughness', 'Rugosité', plain)],
        },
      ],
    },
  },
  { id: 'masks', label: 'Masques', body: { kind: 'soon', text: 'Pinceau, dégradés, sujet et ciel : bientôt.' } },
];

export const HSL_BANDS: Array<{ id: string; label: string; color: string }> = [
  { id: 'red', label: 'Rouge', color: '#d8433b' },
  { id: 'orange', label: 'Orange', color: '#e98a2f' },
  { id: 'yellow', label: 'Jaune', color: '#e3c53a' },
  { id: 'green', label: 'Vert', color: '#4fa64a' },
  { id: 'aqua', label: 'Turquoise', color: '#3cb3b0' },
  { id: 'blue', label: 'Bleu', color: '#3f6fd1' },
  { id: 'purple', label: 'Violet', color: '#7d55c7' },
  { id: 'magenta', label: 'Magenta', color: '#c84aa8' },
];

export const HSL_ASPECTS: Array<{ id: 'hue' | 'sat' | 'lum'; label: string }> = [
  { id: 'hue', label: 'Teinte' },
  { id: 'sat', label: 'Saturation' },
  { id: 'lum', label: 'Luminance' },
];

export const GRADING_WHEELS: Array<{ id: 'shadows' | 'midtones' | 'highlights'; label: string }> = [
  { id: 'shadows', label: 'Ombres' },
  { id: 'midtones', label: 'Tons moyens' },
  { id: 'highlights', label: 'Hautes lumières' },
];
