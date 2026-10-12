/**
 * Versions of a picture the worker keeps on the GPU: the preview (long side ≤ PREVIEW_LONG) and
 * a half-size one used while a slider is dragged, so integrated GPUs keep up (plan L-2 timings).
 * Export renders the original.
 */

export const PREVIEW_LONG = 2560;
export const DRAG_FACTOR = 0.5;
export const MIN_DRAG_LONG = 640;

export interface Size {
  width: number;
  height: number;
}

/** `w × h` scaled down so its long side is at most `long` (never up). */
export function fit(w: number, h: number, long: number): Size {
  const k = Math.min(1, long / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

export function proxySizes(w: number, h: number, maxSize: number): { preview: Size; drag: Size } {
  const preview = fit(w, h, Math.min(PREVIEW_LONG, maxSize));
  const long = Math.max(preview.width, preview.height);
  const drag = fit(w, h, Math.max(Math.min(MIN_DRAG_LONG, long), Math.round(long * DRAG_FACTOR)));
  return { preview, drag };
}

/** Renderer `scale` of a version: its pixels per original pixel. */
export const scaleOf = (version: Size, original: Size): number => Math.max(version.width, version.height) / Math.max(original.width, original.height, 1);
