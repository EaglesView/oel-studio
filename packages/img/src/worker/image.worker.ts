/// <reference lib="webworker" />
/**
 * Image worker: owns the transferred OffscreenCanvas and the oel-img renderer (wgpu: WebGPU,
 * else WebGL2; else the CPU reference). Requests run one at a time; a draw still waiting when a
 * newer one arrives is answered `skipped`, so dragging a slider never queues stale frames.
 */
import init, { GpuView, histogram_rgba, render_rgba } from 'oelimg-wasm';
import type { FromImage, GpuPreference, Raster, ToImage } from '../protocol';
import { CpuBackend, GpuBackend, type Backend } from './backend';
import { createImageHandler, type Platform } from './handler';

const ready = init();
const wasm = { render_rgba, histogram_rgba };

const platform: Platform = {
  async decode(blob) {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' });
    const r = rasterOf(bmp, bmp.width, bmp.height);
    bmp.close();
    return r;
  },
  async resize(r, width, height) {
    const bmp = await createImageBitmap(imageData(r), { resizeWidth: width, resizeHeight: height, resizeQuality: 'high', premultiplyAlpha: 'none' });
    const out = rasterOf(bmp, width, height);
    bmp.close();
    return out;
  },
  async encode(r, mime, quality) {
    const c = new OffscreenCanvas(r.width, r.height);
    c.getContext('2d')!.putImageData(imageData(r), 0, 0);
    return c.convertToBlob({ type: mime, quality });
  },
};

function imageData(r: Raster): ImageData {
  return new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer, r.data.byteOffset, r.data.byteLength), r.width, r.height);
}

function rasterOf(src: CanvasImageSource, width: number, height: number): Raster {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, width, height);
  const d = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8Array(d.data.buffer) };
}

async function createBackend(canvas: OffscreenCanvas | null, gpu: GpuPreference): Promise<Backend> {
  await ready;
  if (canvas && gpu !== 'cpu') {
    try {
      // Probe on a scratch canvas first: a failed attempt on the real one would leave it with a
      // GPU context, and the CPU path needs a 2D one.
      (await GpuView.create(new OffscreenCanvas(1, 1), gpu === 'auto')).free();
      return new GpuBackend(await GpuView.create(canvas, gpu === 'auto'), canvas);
    } catch (e) {
      console.warn('oel-img : rendu processeur graphique indisponible', e);
    }
  }
  const ctx = canvas?.getContext('2d') ?? null;
  return new CpuBackend(wasm, (r, width, height) => {
    if (!canvas || !ctx) return;
    canvas.width = width;
    canvas.height = height;
    void createImageBitmap(imageData(r)).then((bmp) => {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, width, height);
      bmp.close();
    });
  });
}

const handle = createImageHandler({ createBackend, platform, cpu: wasm });
const post = (m: FromImage) => {
  const transfer: Transferable[] = m.op === 'raster' ? [m.raster.data.buffer as ArrayBuffer] : m.op === 'histogram' ? [m.bins.buffer as ArrayBuffer] : [];
  (self as unknown as Worker).postMessage(m, transfer);
};

let queue: Promise<void> = Promise.resolve();
let waitingDraw: Extract<ToImage, { op: 'draw' }> | null = null;

self.onmessage = (e: MessageEvent<ToImage>) => {
  const m = e.data;
  if (m.op === 'draw') {
    if (waitingDraw) post({ id: waitingDraw.id, op: 'skipped' });
    waitingDraw = m;
    queue = queue.then(async () => {
      if (waitingDraw !== m) return;
      waitingDraw = null;
      post(await handle(m));
    });
    return;
  }
  queue = queue.then(async () => post(await handle(m)));
};
