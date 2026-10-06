/**
 * Render backends the image worker drives: the wgpu view (WebGPU / WebGL2) or the CPU
 * reference. Sources are versions of one picture at different sizes (preview, drag, full);
 * `scale` tells the renderer how they relate to the original.
 */
import type { Capability, Raster } from '../protocol';

export interface Backend {
  readonly capability: Capability;
  /** Largest source side accepted. */
  readonly maxSize: number;
  /** Uploads a version of the source; returns its slot. */
  addSource(r: Raster): number;
  clearSources(): void;
  /** Renders from `slot` with `recipeJson`; `scale` = slot pixels per original pixel. */
  use(slot: number, recipeJson: string, scale: number): void;
  /** Output size of the current slot. */
  outputSize(): { width: number; height: number };
  /** Draws the output into the canvas at `width × height`. */
  draw(width: number, height: number): Promise<void>;
  /** The output of the current slot at its own resolution. */
  render(): Promise<Raster>;
  histogram(): Promise<Uint32Array>;
}

/** The wasm module surface the backends need (`oelimg-wasm` in the browser, `oelimg-node` in tests). */
export interface OelImgWasm {
  render_rgba(rgba: Uint8Array, width: number, height: number, recipeJson: string, scale: number, displayP3: boolean): { width: number; height: number; pixels: Uint8Array; free(): void };
  histogram_rgba(rgba: Uint8Array, width: number, height: number): Uint32Array;
}

/** The `GpuView` class of `oelimg-wasm` (browser only). */
export interface GpuViewLike {
  readonly backend: string;
  readonly maxSize: number;
  addSource(rgba: Uint8Array, width: number, height: number): number;
  useSource(slot: number): void;
  clearSources(): void;
  setRecipe(recipeJson: string, scale: number): void;
  outputSize(): Uint32Array | number[];
  draw(width: number, height: number): void;
  render(width: number, height: number): Promise<{ width: number; height: number; pixels: Uint8Array; free(): void }>;
  histogram(): Promise<Uint32Array>;
}

export class GpuBackend implements Backend {
  readonly capability: Capability;
  constructor(
    private view: GpuViewLike,
    private canvas: { width: number; height: number } | null = null,
  ) {
    this.capability = view.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  }
  get maxSize() {
    return this.view.maxSize;
  }
  addSource(r: Raster) {
    return this.view.addSource(r.data, r.width, r.height);
  }
  clearSources() {
    this.view.clearSources();
  }
  use(slot: number, recipeJson: string, scale: number) {
    this.view.useSource(slot);
    this.view.setRecipe(recipeJson, scale);
  }
  outputSize() {
    const [width = 0, height = 0] = this.view.outputSize();
    return { width, height };
  }
  async draw(width: number, height: number) {
    if (this.canvas && (this.canvas.width !== width || this.canvas.height !== height)) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.view.draw(width, height);
  }
  async render(): Promise<Raster> {
    const r = await this.view.render(0, 0);
    const out = { width: r.width, height: r.height, data: r.pixels };
    r.free();
    return out;
  }
  histogram() {
    return this.view.histogram();
  }
}

export class CpuBackend implements Backend {
  readonly capability = 'cpu' as const;
  readonly maxSize = 1 << 15;
  private sources: Raster[] = [];
  private slot = 0;
  private recipe = '{}';
  private scale = 1;
  private cached: Raster | null = null;

  constructor(
    private wasm: OelImgWasm,
    private present: (r: Raster, width: number, height: number) => void,
  ) {}

  addSource(r: Raster) {
    this.sources.push(r);
    return this.sources.length - 1;
  }
  clearSources() {
    this.sources = [];
    this.cached = null;
  }
  use(slot: number, recipeJson: string, scale: number) {
    if (slot !== this.slot || recipeJson !== this.recipe || scale !== this.scale) this.cached = null;
    this.slot = slot;
    this.recipe = recipeJson;
    this.scale = scale;
  }
  outputSize() {
    const s = this.sources[this.slot];
    if (!s) return { width: 0, height: 0 };
    const crop = (JSON.parse(this.recipe) as { geometry?: { crop?: number[] } }).geometry?.crop ?? [0, 0, 1, 1];
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = crop;
    return { width: Math.max(1, Math.round(Math.abs(x1 - x0) * s.width)), height: Math.max(1, Math.round(Math.abs(y1 - y0) * s.height)) };
  }
  async draw(width: number, height: number) {
    this.present(await this.render(), width, height);
  }
  async render(): Promise<Raster> {
    if (this.cached) return this.cached;
    const s = this.sources[this.slot];
    if (!s) throw new Error('Aucune image chargée');
    const r = this.wasm.render_rgba(s.data, s.width, s.height, this.recipe, this.scale, false);
    this.cached = { width: r.width, height: r.height, data: r.pixels };
    r.free();
    return this.cached;
  }
  async histogram() {
    const r = await this.render();
    return this.wasm.histogram_rgba(r.data, r.width, r.height);
  }
}
