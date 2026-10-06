/** Messages between `ImageEngine` (main thread) and the image worker. */

/** What renders: WebGPU, WebGL2 (both through wgpu), or the CPU reference in WASM. */
export type Capability = 'webgpu' | 'webgl2' | 'cpu';

/** `auto` = WebGPU, else WebGL2, else CPU; the others force a path (tests, settings). */
export type GpuPreference = 'auto' | 'webgl2' | 'cpu';

/** RGBA8, sRGB, straight alpha. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ExportOptions {
  /** `image/jpeg`, `image/png` or `image/webp`. */
  mime: string;
  /** 0…1 for JPEG/WebP. */
  quality?: number;
  /** Longest side of the exported image; omitted = full resolution. */
  maxLong?: number;
}

export type ToImage =
  | { id: number; op: 'init'; canvas: OffscreenCanvas | null; gpu: GpuPreference }
  | { id: number; op: 'source'; blob: Blob }
  | { id: number; op: 'recipe'; json: string }
  | { id: number; op: 'draw'; width: number; height: number; interactive: boolean }
  | { id: number; op: 'export'; options: ExportOptions }
  /** `json`: render this recipe instead of the current one, for this request only. */
  | { id: number; op: 'raster'; maxLong: number; json?: string }
  | { id: number; op: 'histogram'; json?: string };

export type FromImage =
  | { id: number; op: 'ready'; capability: Capability; maxSize: number }
  | { id: number; op: 'source'; width: number; height: number }
  | { id: number; op: 'done' }
  | { id: number; op: 'skipped' }
  | { id: number; op: 'blob'; blob: Blob }
  | { id: number; op: 'raster'; raster: Raster }
  | { id: number; op: 'histogram'; bins: Uint32Array }
  | { id: number; op: 'error'; message: string };
