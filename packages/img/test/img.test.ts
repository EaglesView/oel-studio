import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getLeaf, isEmptyRecipe, leafValue, outputSize, RECIPE_FIELDS, setLeaf, stackRecipes, type Recipe } from '../src/recipe';
import { proxySizes, scaleOf } from '../src/proxies';
import { CpuBackend, type OelImgWasm } from '../src/worker/backend';
import { createImageHandler, type Platform } from '../src/worker/handler';
import type { FromImage, Raster } from '../src/protocol';

const wasm = createRequire(import.meta.url)('oelimg-node') as OelImgWasm & { stack_recipes(json: string): string };

const gallery: Recipe = { exposure: 0.5, presence: { clarity: 20, vibrance: 10 }, toneCurve: { rgb: [[0, 0], [0.5, 0.6], [1, 1]] } };
const image: Recipe = { presence: { clarity: -5 }, geometry: { crop: [0.1, 0.1, 0.9, 0.9] } };

describe('recipes', () => {
  it('layers like the Rust crate', () => {
    for (const layers of [[image, gallery], [gallery, image], [{}, gallery], [image, {}], [image]]) {
      expect(stackRecipes(layers)).toEqual(JSON.parse(wasm.stack_recipes(JSON.stringify(layers))));
    }
    expect(leafValue(stackRecipes([image, gallery]), 'presence.clarity')).toBe(-5);
    expect(leafValue(stackRecipes([image, gallery]), 'presence.vibrance')).toBe(10);
  });

  it('reads and writes leaves by path', () => {
    let r: Recipe = {};
    r = setLeaf(r, 'hsl.red.sat', -40);
    expect(getLeaf(r, 'hsl.red.sat')).toBe(-40);
    expect(leafValue(r, 'hsl.red.hue')).toBe(0);
    expect(leafValue(r, 'grading.blending')).toBe(50);
    r = setLeaf(r, 'hsl.red.sat', undefined);
    expect(r).toEqual({});
    expect(isEmptyRecipe(r)).toBe(true);
    for (const f of RECIPE_FIELDS) expect(leafValue({}, f.path), f.path).not.toBeUndefined();
  });

  it('computes the output size the renderer produces', () => {
    const src = new Uint8Array(37 * 23 * 4).fill(128);
    for (const r of [{ geometry: { crop: [0.13, 0.2, 0.71, 0.95] } }, { geometry: { rotate: 1, crop: [0.13, 0.2, 0.71, 0.95] } }, { geometry: { rotate: 3 } }] as Recipe[]) {
      const out = wasm.render_rgba(src, 37, 23, JSON.stringify(r), 1, false);
      expect(outputSize(r, 37, 23)).toEqual({ width: out.width, height: out.height });
    }
  });
});

describe('proxies', () => {
  it('fits the preview and halves it for dragging', () => {
    expect(proxySizes(6000, 4000, 8192)).toEqual({ preview: { width: 2560, height: 1707 }, drag: { width: 1280, height: 853 } });
    expect(proxySizes(6000, 4000, 2048).preview).toEqual({ width: 2048, height: 1365 });
    expect(proxySizes(800, 600, 8192)).toEqual({ preview: { width: 800, height: 600 }, drag: { width: 640, height: 480 } });
    expect(proxySizes(300, 200, 8192).drag).toEqual({ width: 300, height: 200 });
    expect(scaleOf({ width: 1280, height: 853 }, { width: 6000, height: 4000 })).toBeCloseTo(0.2133, 3);
  });
});

/** Gradient test picture. */
function picture(w: number, h: number): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([(x * 255) / w, (y * 255) / h, 128, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

/** Node stand-ins for createImageBitmap / OffscreenCanvas: blobs carry rasters, resize is nearest. */
function fakePlatform(): Platform & { blobOf(r: Raster): Blob } {
  const rasters = new WeakMap<Blob, Raster>();
  return {
    blobOf(r) {
      const b = new Blob([r.data as Uint8Array<ArrayBuffer>]);
      rasters.set(b, r);
      return b;
    },
    async decode(blob) {
      return rasters.get(blob)!;
    },
    async resize(r, width, height) {
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const sx = Math.floor(((x + 0.5) * r.width) / width);
          const sy = Math.floor(((y + 0.5) * r.height) / height);
          data.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * width + x) * 4);
        }
      return { width, height, data };
    },
    async encode(r, mime) {
      const b = new Blob([r.data as Uint8Array<ArrayBuffer>], { type: mime });
      rasters.set(b, r);
      return b;
    },
  };
}

describe('image worker handler (CPU backend)', () => {
  async function setup(maxSize?: number) {
    const platform = fakePlatform();
    const presented: Array<{ raster: Raster; width: number; height: number }> = [];
    const backend = new CpuBackend(wasm, (raster, width, height) => presented.push({ raster, width, height }));
    if (maxSize) Object.defineProperty(backend, 'maxSize', { value: maxSize });
    const handle = createImageHandler({ createBackend: async () => backend, platform, cpu: wasm });
    let id = 0;
    const call = async (m: Record<string, unknown>) => {
      const r = (await handle({ ...m, id: ++id } as never)) as FromImage;
      if (r.op === 'error') throw new Error(r.message);
      return r;
    };
    return { platform, presented, call };
  }

  it('loads, draws the preview and the drag proxy, exports and histograms', async () => {
    const { platform, presented, call } = await setup();
    expect(await call({ op: 'init', canvas: null, gpu: 'cpu' })).toMatchObject({ op: 'ready', capability: 'cpu' });
    const pic = picture(3000, 2000);
    expect(await call({ op: 'source', blob: platform.blobOf(pic) })).toMatchObject({ width: 3000, height: 2000 });
    await call({ op: 'recipe', json: JSON.stringify({ exposure: 0.5, geometry: { crop: [0, 0, 0.5, 1] } }) });

    await call({ op: 'draw', width: 400, height: 533, interactive: false });
    expect(presented.at(-1)!.raster).toMatchObject({ width: 1280, height: 1707 });
    await call({ op: 'draw', width: 400, height: 533, interactive: true });
    expect(presented.at(-1)!.raster).toMatchObject({ width: 640, height: 853 });
    expect(presented.at(-1)!).toMatchObject({ width: 400, height: 533 });

    const out = await call({ op: 'export', options: { mime: 'image/png' } });
    const full = await platform.decode((out as Extract<FromImage, { op: 'blob' }>).blob);
    expect(full).toMatchObject({ width: 1500, height: 2000 });
    const small = await call({ op: 'export', options: { mime: 'image/jpeg', maxLong: 500 } });
    expect(await platform.decode((small as Extract<FromImage, { op: 'blob' }>).blob)).toMatchObject({ width: 375, height: 500 });

    const thumb = (await call({ op: 'raster', maxLong: 200 })) as Extract<FromImage, { op: 'raster' }>;
    expect(thumb.raster).toMatchObject({ width: 150, height: 200 });

    const h = (await call({ op: 'histogram' })) as Extract<FromImage, { op: 'histogram' }>;
    expect(h.bins.length).toBe(1024);
    expect(h.bins.subarray(768).reduce((a, b) => a + b, 0)).toBe(1280 * 1707);
  }, 60_000);

  it('exports originals larger than the backend accepts through the CPU reference', async () => {
    const { platform, call } = await setup(1000);
    await call({ op: 'init', canvas: null, gpu: 'cpu' });
    await call({ op: 'source', blob: platform.blobOf(picture(1600, 900)) });
    const out = (await call({ op: 'export', options: { mime: 'image/png' } })) as Extract<FromImage, { op: 'blob' }>;
    expect(await platform.decode(out.blob)).toMatchObject({ width: 1600, height: 900 });
  });

  it('reports errors instead of throwing', async () => {
    const { call } = await setup();
    await expect(call({ op: 'draw', width: 10, height: 10, interactive: false })).rejects.toThrow('non initialisé');
  });
});
