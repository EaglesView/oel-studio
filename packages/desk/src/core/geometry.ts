import type { DeskNode, Lod, Rect, Vec, Viewport, ZoomLimits } from './types';

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.25, max: 4 };

/** Below this zoom papers are drawn as thumbnails. */
export const THUMBNAIL_BELOW = 0.5;

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function lodForZoom(zoom: number): Lod {
  return zoom < THUMBNAIL_BELOW ? 'thumbnail' : 'live';
}

export function rectOf(n: Pick<DeskNode, 'x' | 'y' | 'w' | 'h'>): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

export function center(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Where the line from a rect's centre toward `toward` leaves the rect. */
export function edgePoint(r: Rect, toward: Vec): Vec {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * A thread between two rects (Figma G1): a soft S-curve from edge to edge,
 * leaving sideways when the rects sit side by side, vertically when stacked.
 * `mid` is the curve's middle, where its chip goes.
 */
export function threadPath(a: Rect, b: Rect): { d: string; from: Vec; to: Vec; mid: Vec } {
  const from = edgePoint(a, center(b));
  const to = edgePoint(b, center(a));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const side = Math.abs(dx) >= Math.abs(dy);
  const c1 = side ? { x: from.x + dx / 2, y: from.y } : { x: from.x, y: from.y + dy / 2 };
  const c2 = side ? { x: to.x - dx / 2, y: to.y } : { x: to.x, y: to.y - dy / 2 };
  const f = (n: number) => Math.round(n * 10) / 10;
  return {
    d: `M${f(from.x)} ${f(from.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(to.x)} ${f(to.y)}`,
    from,
    to,
    mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
  };
}

export function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Area shared by two rects (0 when apart). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function contains(r: Rect, p: Vec) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function normalizeRect(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function worldToScreen(p: Vec, v: Viewport): Vec {
  return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom };
}

export function screenToWorld(p: Vec, v: Viewport): Vec {
  return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y };
}

export function rectToScreen(r: Rect, v: Viewport): Rect {
  const p = worldToScreen(r, v);
  return { x: p.x, y: p.y, w: r.w * v.zoom, h: r.h * v.zoom };
}

/** Zoom by `factor` keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(v: Viewport, anchor: Vec, factor: number, limits: ZoomLimits = DEFAULT_ZOOM_LIMITS): Viewport {
  const zoom = clamp(v.zoom * factor, limits.min, limits.max);
  const world = screenToWorld(anchor, v);
  return { zoom, x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom };
}

export function zoomTo(v: Viewport, anchor: Vec, zoom: number, limits: ZoomLimits = DEFAULT_ZOOM_LIMITS): Viewport {
  return zoomAt(v, anchor, zoom / v.zoom, limits);
}

/**
 * Wheel delta → zoom factor. Normalises line/page deltas and caps each event so
 * a mouse-wheel notch is a small step (~11 %) while trackpad pinches stay smooth.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, speed = 0.002): number {
  const px = deltaMode === 1 ? deltaY * 20 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -60, 60) * speed);
}

/** Viewport that fits `bounds` into a screen of `size`, with `padding` px. */
export function fitRect(bounds: Rect, size: { w: number; h: number }, padding = 64, maxZoom = 1, minZoom = DEFAULT_ZOOM_LIMITS.min): Viewport {
  const zoom = clamp(
    Math.min((size.w - padding * 2) / Math.max(bounds.w, 1), (size.h - padding * 2) / Math.max(bounds.h, 1)),
    minZoom,
    maxZoom,
  );
  const c = center(bounds);
  return { zoom, x: c.x - size.w / 2 / zoom, y: c.y - size.h / 2 / zoom };
}

/** Keyboard reading order: rows top-to-bottom (tolerance `rowTol`), then left-to-right. */
export function readingOrder<N extends Pick<DeskNode, 'id' | 'x' | 'y'>>(nodes: N[], rowTol = 80): N[] {
  return [...nodes].sort((a, b) => (Math.abs(a.y - b.y) > rowTol ? a.y - b.y : a.x - b.x));
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Spatial navigation: the best candidate in `dir` from `from`. Scores by distance
 * along the axis plus a penalty for drifting sideways, so arrows feel predictable.
 */
export function nearestInDirection<N extends Pick<DeskNode, 'id' | 'x' | 'y' | 'w' | 'h'>>(
  from: N,
  candidates: N[],
  dir: Direction,
): N | null {
  const o = center(from);
  let best: N | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.id === from.id) continue;
    const p = center(c);
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** A resize handle: corners and edges. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * The rect after dragging `handle` of `start` by `d` (world px). `keepAspect` keeps the shape,
 * `fromCenter` grows both sides (Alt), `min` is the smallest side.
 */
export function resizeRect(start: Rect, handle: ResizeHandle, d: Vec, { keepAspect = false, fromCenter = false, min = 1 } = {}): Rect {
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const k = fromCenter ? 2 : 1;
  // Dragged past the opposite edge: stop at the smallest size instead of flipping.
  let w = Math.max(1e-3, start.w + sx * d.x * k);
  let h = Math.max(1e-3, start.h + sy * d.y * k);
  if (keepAspect) {
    const ratio = start.w / start.h;
    // Corners follow the larger change; edges drive their own side.
    const byWidth = sy === 0 || (sx !== 0 && Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1));
    if (byWidth) h = w / ratio;
    else w = h * ratio;
    const s = Math.max(min / w, min / h, 1);
    w *= s;
    h *= s;
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const x = fromCenter || sx === 0 ? cx - w / 2 : sx > 0 ? start.x : start.x + start.w - w;
  const y = fromCenter || sy === 0 ? cy - h / 2 : sy > 0 ? start.y : start.y + start.h - h;
  return { x, y, w, h };
}
