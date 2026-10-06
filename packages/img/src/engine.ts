/**
 * Main-thread facade of the image worker. The canvas is transferred to the worker, which draws
 * into it directly (WebGPU or WebGL2 through wgpu, else the CPU reference).
 *
 *   const engine = await ImageEngine.create({ createWorker, canvas });
 *   await engine.setSource(blob); engine.setRecipe(recipe); await engine.draw(w, h);
 */
import type { Capability, ExportOptions, FromImage, GpuPreference, Raster, ToImage } from './protocol';
import { outputSize, type Recipe } from './recipe';

/** Shown in the atelier when nothing faster than the CPU is available. */
export const SLOW_PREVIEW_NOTICE = 'Aperçu ralenti : processeur graphique indisponible';

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface ImageEngineOptions {
  /** One small function so a native app can substitute its own transport. */
  createWorker: () => Worker;
  /** Canvas the preview is drawn into (transferred to the worker); omit for export-only use. */
  canvas?: HTMLCanvasElement | null;
  gpu?: GpuPreference;
}

export class ImageEngine {
  private seq = 0;
  private pending = new Map<number, { resolve: (m: FromImage) => void; reject: (e: Error) => void }>();
  private recipe: Recipe = {};
  private source: { width: number; height: number } | null = null;
  capability: Capability = 'cpu';
  maxSize = 0;

  private constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<FromImage>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.op === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    worker.onerror = (e) => this.failAll(new Error(e.message || 'Erreur du moteur d’image'));
  }

  static async create(opts: ImageEngineOptions): Promise<ImageEngine> {
    const engine = new ImageEngine(opts.createWorker());
    const canvas = opts.canvas ? opts.canvas.transferControlToOffscreen() : null;
    const r = await engine.send<'ready'>({ op: 'init', canvas, gpu: opts.gpu ?? 'auto' }, canvas ? [canvas] : []);
    engine.capability = r.capability;
    engine.maxSize = r.maxSize;
    return engine;
  }

  /** `SLOW_PREVIEW_NOTICE` on the CPU path, else null. */
  get notice(): string | null {
    return this.capability === 'cpu' ? SLOW_PREVIEW_NOTICE : null;
  }

  private send<K extends FromImage['op']>(msg: WithoutId<ToImage>, transfer: Transferable[] = []): Promise<Extract<FromImage, { op: K }>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (m: FromImage) => void, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** Decodes the original (EXIF orientation applied) and prepares its proxies. */
  async setSource(blob: Blob): Promise<{ width: number; height: number }> {
    const r = await this.send<'source'>({ op: 'source', blob });
    this.source = { width: r.width, height: r.height };
    return this.source;
  }

  /** The effective recipe (already layered with `stackRecipes`). */
  setRecipe(recipe: Recipe) {
    this.recipe = recipe;
    void this.send({ op: 'recipe', json: JSON.stringify(recipe) }).catch(() => {});
  }

  /** Output size at full resolution (the crop of the original). */
  outputSize(): { width: number; height: number } {
    return this.source ? outputSize(this.recipe, this.source.width, this.source.height) : { width: 0, height: 0 };
  }

  /**
   * Draws into the canvas at `width × height` device pixels (same aspect as `outputSize`).
   * `interactive` renders the half-size proxy (while a slider moves). Resolves false when a
   * newer draw replaced this one before it ran.
   */
  async draw(width: number, height: number, opts: { interactive?: boolean } = {}): Promise<boolean> {
    const r = await this.send<'done' | 'skipped'>({ op: 'draw', width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), interactive: !!opts.interactive });
    return r.op === 'done';
  }

  async export(options: ExportOptions): Promise<Blob> {
    return (await this.send<'blob'>({ op: 'export', options })).blob;
  }

  /** The rendered image, long side at most `maxLong` (thumbnails). */
  async raster(maxLong: number): Promise<Raster> {
    return (await this.send<'raster'>({ op: 'raster', maxLong })).raster;
  }

  async histogram(): Promise<Histogram> {
    const b = (await this.send<'histogram'>({ op: 'histogram' })).bins;
    return { r: b.subarray(0, 256), g: b.subarray(256, 512), b: b.subarray(512, 768), luma: b.subarray(768, 1024) };
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  dispose() {
    this.worker.terminate();
    this.failAll(new Error('Moteur d’image arrêté'));
  }
}
