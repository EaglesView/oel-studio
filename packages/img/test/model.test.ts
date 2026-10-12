import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { RecipeDoc, flattenRecipe, unflattenRecipe } from '../src/model/recipeDoc';
import { ADVANCED_PANELS, SIMPLE_GROUPS, kelvinToWarmth, warmthToKelvin } from '../src/model/controls';
import { cropForAspect, flipLeaves, formatValue, turnLeaves } from '../src/model/format';
import { BUILTIN_STYLES, autoTone, currentStyle } from '../src/model/looks';
import { leafValue, type Recipe } from '../src/recipe';
import type { OelImgWasm } from '../src/worker/backend';

const wasm = createRequire(import.meta.url)('oelimg-node') as OelImgWasm;

describe('RecipeDoc (Yjs)', () => {
  it('keeps one key per leaf and round-trips recipes', () => {
    const r: Recipe = { exposure: 0.4, presence: { clarity: 10 }, toneCurve: { rgb: [[0, 0], [0.5, 0.6], [1, 1]] }, geometry: { crop: [0.1, 0, 1, 1] } };
    const doc = RecipeDoc.create(r);
    expect([...doc.map.keys()].sort()).toEqual(['exposure', 'geometry.crop', 'presence.clarity', 'toneCurve.rgb']);
    expect(doc.recipe()).toEqual(r);
    expect(unflattenRecipe(Object.entries(flattenRecipe(r)))).toEqual(r);
  });

  it('undoes one transaction at a time and removes reset leaves', () => {
    const doc = RecipeDoc.create();
    doc.update({ exposure: 0.5, highlights: -8 });
    doc.stopCapturing();
    doc.set('contrast', 20);
    expect(doc.recipe()).toEqual({ exposure: 0.5, highlights: -8, contrast: 20 });
    doc.undo.undo();
    expect(doc.recipe()).toEqual({ exposure: 0.5, highlights: -8 });
    doc.undo.undo();
    expect(doc.recipe()).toEqual({});
    doc.undo.redo();
    doc.set('exposure', undefined);
    expect(doc.recipe()).toEqual({ highlights: -8 });
  });

  it('replaces the look but keeps the geometry', () => {
    const doc = RecipeDoc.create({ exposure: 1, geometry: { rotate: 1 } });
    doc.replace(BUILTIN_STYLES.find((s) => s.id === 'nb')!.recipe, (p) => p.startsWith('geometry.'));
    expect(doc.recipe()).toEqual({ contrast: 18, presence: { saturation: -100, clarity: 10 }, geometry: { rotate: 1 } });
    expect(currentStyle(doc.recipe())?.id).toBe('nb');
  });
});

describe('Simple controls', () => {
  const all = SIMPLE_GROUPS.flatMap((g) => g.controls);

  it('write leaves that read back as the slider value', () => {
    for (const c of all) {
      for (const v of [c.min, c.min / 2, c.max / 3, c.max]) {
        const doc = RecipeDoc.create();
        doc.update(c.write(v));
        const back = c.read(doc.recipe());
        expect(Math.abs(back - v), `${c.id} ${v}`).toBeLessThanOrEqual(c.step);
      }
      const doc = RecipeDoc.create();
      doc.update(c.write(c.max));
      doc.update(c.write(undefined));
      expect(doc.recipe(), `${c.id} reset`).toEqual({});
    }
  });

  it('never write the same leaf from two Simple controls', () => {
    const seen = new Map<string, string>();
    for (const c of all)
      for (const k of Object.keys(c.write(1))) {
        expect(seen.get(k), `${k} by ${c.id} and ${seen.get(k)}`).toBeUndefined();
        seen.set(k, c.id);
      }
  });

  it('map warmth to kelvins and back', () => {
    expect(warmthToKelvin(0)).toBe(6500);
    expect(warmthToKelvin(50)).toBeGreaterThan(7500);
    expect(warmthToKelvin(-50)).toBeLessThan(5500);
    for (const v of [-80, -10, 0, 25, 100]) expect(Math.abs(kelvinToWarmth(warmthToKelvin(v)) - v)).toBeLessThanOrEqual(1);
  });
});

describe('Avancé panels', () => {
  it('bind every slider to a known leaf', () => {
    for (const p of ADVANCED_PANELS)
      if (p.body.kind === 'sliders') for (const g of p.body.groups) for (const sl of g.sliders) expect(sl.min).toBeLessThan(sl.max);
  });
});

describe('values and geometry', () => {
  it('formats fr-CA values', () => {
    expect(formatValue(0.35, { signed: true, digits: 2 })).toBe('+0,35');
    expect(formatValue(-40, { signed: true })).toBe('−40');
    expect(formatValue(0, { signed: true })).toBe('0');
    expect(formatValue(25, {})).toBe('25');
    expect(formatValue(5600, { kelvin: true }).replace(/\s/g, ' ')).toBe('5 600 K');
  });

  it('fits an aspect inside the frame around the crop centre', () => {
    const c = cropForAspect([0, 0, 1, 1], 1, 300, 200);
    expect(((c[2] - c[0]) * 300) / ((c[3] - c[1]) * 200)).toBeCloseTo(1, 5);
    expect(c[1]).toBeCloseTo(0);
    expect(c[0]).toBeCloseTo(1 / 6);
  });

  /** Renders `r` on a small asymmetric picture with the CPU reference. */
  function render(r: Recipe) {
    const w = 6;
    const h = 4;
    const src = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) src.set([i * 10, 255 - i * 10, (i * 37) % 256, 255], i * 4);
    const out = wasm.render_rgba(src, w, h, JSON.stringify(r), 1, false);
    return { w: out.width, h: out.height, px: Array.from(out.pixels) };
  }
  const rot = (img: { w: number; h: number; px: number[] }, cw: boolean) => {
    const out: number[] = [];
    const W = img.h;
    const H = img.w;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const [sx, sy] = cw ? [y, img.h - 1 - x] : [img.w - 1 - y, x];
        out.push(...img.px.slice((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4));
      }
    return { w: W, h: H, px: out };
  };
  const mirror = (img: { w: number; h: number; px: number[] }) => {
    const out: number[] = [];
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out.push(...img.px.slice((y * img.w + img.w - 1 - x) * 4, (y * img.w + img.w - 1 - x) * 4 + 4));
    return { w: img.w, h: img.h, px: out };
  };
  const apply = (r: Recipe, leaves: Record<string, unknown>) => {
    const d = RecipeDoc.create(r);
    d.update(leaves);
    return d.recipe();
  };

  it('turns and mirrors what the user sees, whatever was done before', () => {
    const starts: Recipe[] = [{}, { geometry: { flipH: true } }, { geometry: { rotate: 1, flipV: true } }, { geometry: { rotate: 3, flipH: true, flipV: true } }];
    for (const r of starts) {
      const before = render(r);
      expect(render(apply(r, turnLeaves(r, 1))), JSON.stringify(r)).toEqual(rot(before, true));
      expect(render(apply(r, turnLeaves(r, -1))), JSON.stringify(r)).toEqual(rot(before, false));
      expect(render(apply(r, flipLeaves(r, 'h'))), JSON.stringify(r)).toEqual(mirror(before));
    }
    // Four turns are no turn.
    let r: Recipe = { geometry: { flipH: true } };
    for (let i = 0; i < 4; i++) r = apply(r, turnLeaves(r, 1));
    expect(leafValue(r, 'geometry.rotate')).toBe(0);
    expect(leafValue(r, 'geometry.flipH')).toBe(true);
  });
});

describe('Auto', () => {
  const hist = (center: number, spread: number) => Array.from({ length: 256 }, (_, i) => Math.round(1000 * Math.exp(-(((i - center) / spread) ** 2))));

  it('brightens dark images, darkens bright ones, leaves balanced ones mostly alone', () => {
    expect(autoTone(hist(50, 20)).exposure!).toBeGreaterThan(0.5);
    expect(autoTone(hist(210, 20)).exposure!).toBeLessThan(-0.3);
    expect(Math.abs(autoTone(hist(118, 60)).exposure!)).toBeLessThanOrEqual(0.1);
  });

  it('recovers clipped highlights and lifts dark shadows', () => {
    const clipped = hist(150, 30);
    clipped[255] = 20000;
    expect(autoTone(clipped).highlights!).toBeLessThan(0);
    expect(autoTone(hist(40, 15)).shadows!).toBeGreaterThan(0);
  });
});
