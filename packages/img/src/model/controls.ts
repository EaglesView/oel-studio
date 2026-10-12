/**
 * What the atelier shows: Simple controls (macros over Avancé leaves) and the Avancé panels
 * (Figma L1). Both edit the same recipe.
 */
import { fieldSpec, leafValue, type Recipe } from '../recipe';
import type { Display } from './format';
import { tr } from '@oel/i18n';

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
    label: tr('Lumière', 'Light'),
    controls: [
      {
        id: 'luminosite',
        label: tr('Luminosité', 'Brightness'),
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
        label: tr('Contraste', 'Contrast'),
        min: -100,
        max: 100,
        step: 1,
        display: { signed: true },
        read: (r) => num(r, 'contrast'),
        write: (v) => ({ contrast: v, whites: v === undefined ? undefined : Math.round(v * 0.15) }),
      },
      {
        id: 'ombres',
        label: tr('Ombres', 'Shadows'),
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
    label: tr('Couleur', 'Colour'),
    controls: [
      {
        id: 'chaleur',
        label: tr('Chaleur', 'Warmth'),
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
        label: tr('Éclat', 'Vividness'),
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
    label: tr('Base', 'Basic'),
    open: true,
    body: {
      kind: 'sliders',
      groups: [
        {
          sliders: [
            s('whiteBalance.tempK', tr('Température', 'Temperature'), { kelvin: true }, 'temp'),
            s('whiteBalance.tint', tr('Teinte', 'Tint'), { signed: true }, 'tint'),
            s('exposure', tr('Exposition', 'Exposure'), { signed: true, digits: 2 }),
            s('contrast', tr('Contraste', 'Contrast')),
            s('highlights', tr('Hautes lumières', 'Highlights')),
            s('shadows', tr('Ombres', 'Shadows')),
            s('whites', tr('Blancs', 'Whites')),
            s('blacks', tr('Noirs', 'Blacks')),
          ],
        },
      ],
    },
  },
  {
    id: 'presence',
    label: tr('Présence', 'Presence'),
    open: true,
    body: {
      kind: 'sliders',
      groups: [
        {
          sliders: [
            s('presence.texture', 'Texture'),
            s('presence.clarity', tr('Clarté', 'Clarity')),
            s('presence.dehaze', tr('Correction du voile', 'Dehaze')),
            s('presence.vibrance', 'Vibrance'),
            s('presence.saturation', 'Saturation'),
          ],
        },
      ],
    },
  },
  { id: 'curve', label: tr('Courbe des tonalités', 'Tone curve'), body: { kind: 'curve' } },
  { id: 'hsl', label: tr('Mélangeur de couleurs (TSL)', 'Colour mixer (HSL)'), body: { kind: 'hsl' } },
  { id: 'grading', label: tr('Étalonnage des couleurs', 'Colour grading'), body: { kind: 'grading' } },
  {
    id: 'detail',
    label: tr('Détail (netteté, bruit)', 'Detail (sharpening, noise)'),
    body: {
      kind: 'sliders',
      groups: [
        {
          label: tr('Netteté', 'Sharpening'),
          sliders: [
            s('detail.sharpen.amount', tr('Quantité', 'Amount'), plain),
            s('detail.sharpen.radius', tr('Rayon', 'Radius'), { digits: 1 }),
            s('detail.sharpen.detail', tr('Détail', 'Detail'), plain),
            s('detail.sharpen.masking', tr('Masquage', 'Masking'), plain),
          ],
        },
        { label: tr('Réduction du bruit', 'Noise reduction'), sliders: [s('detail.noise.luma', 'Luminance', plain), s('detail.noise.color', tr('Couleur', 'Colour'), plain)] },
      ],
    },
  },
  { id: 'geometry', label: tr('Optique et géométrie', 'Optics and geometry'), body: { kind: 'geometry' } },
  {
    id: 'effects',
    label: tr('Effets (vignette, grain)', 'Effects (vignette, grain)'),
    body: {
      kind: 'sliders',
      groups: [
        {
          label: 'Vignette',
          sliders: [
            s('effects.vignette.amount', tr('Quantité', 'Amount')),
            s('effects.vignette.midpoint', tr('Point milieu', 'Midpoint'), plain),
            s('effects.vignette.roundness', tr('Rondeur', 'Roundness')),
            s('effects.vignette.feather', tr('Contour progressif', 'Feather'), plain),
          ],
        },
        {
          label: 'Grain',
          sliders: [s('effects.grain.amount', tr('Quantité', 'Amount'), plain), s('effects.grain.size', tr('Taille', 'Size'), plain), s('effects.grain.roughness', tr('Rugosité', 'Roughness'), plain)],
        },
      ],
    },
  },
  { id: 'masks', label: tr('Masques', 'Masks'), body: { kind: 'soon', text: tr('Pinceau, dégradés, sujet et ciel : bientôt.', 'Brush, gradients, subject and sky: coming soon.') } },
];

export const HSL_BANDS: Array<{ id: string; label: string; color: string }> = [
  { id: 'red', label: tr('Rouge', 'Red'), color: '#d8433b' },
  { id: 'orange', label: 'Orange', color: '#e98a2f' },
  { id: 'yellow', label: tr('Jaune', 'Yellow'), color: '#e3c53a' },
  { id: 'green', label: tr('Vert', 'Green'), color: '#4fa64a' },
  { id: 'aqua', label: tr('Turquoise', 'Aqua'), color: '#3cb3b0' },
  { id: 'blue', label: tr('Bleu', 'Blue'), color: '#3f6fd1' },
  { id: 'purple', label: tr('Violet', 'Purple'), color: '#7d55c7' },
  { id: 'magenta', label: 'Magenta', color: '#c84aa8' },
];

export const HSL_ASPECTS: Array<{ id: 'hue' | 'sat' | 'lum'; label: string }> = [
  { id: 'hue', label: tr('Teinte', 'Hue') },
  { id: 'sat', label: 'Saturation' },
  { id: 'lum', label: 'Luminance' },
];

export const GRADING_WHEELS: Array<{ id: 'shadows' | 'midtones' | 'highlights'; label: string }> = [
  { id: 'shadows', label: tr('Ombres', 'Shadows') },
  { id: 'midtones', label: tr('Tons moyens', 'Midtones') },
  { id: 'highlights', label: tr('Hautes lumières', 'Highlights') },
];
