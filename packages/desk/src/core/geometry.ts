import type { DeskNode, Lod, Rect, Vec, Viewport } from './types';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

/** B5 rule: under 40 % piles, 40–80 % thumbnails, above that live content. */
export const LOD_THRESHOLDS = { far: 0.4, mid: 0.8 } as const;

/** Presets bound to keys 1 / 2 / 3 (Ensemble · Repérage · Travail). */
export const ZOOM_PRESETS = [0.3, 0.6, 1] as const;

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function lodForZoom(zoom: number): Lod {
  if (zoom < LOD_THRESHOLDS.far) return 'far';
  if (zoom < LOD_THRESHOLDS.mid) return 'mid';
  return 'near';
}

export function rectOf(n: Pick<DeskNode, 'x' | 'y' | 'w' | 'h'>): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

export function center(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
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
export function zoomAt(v: Viewport, anchor: Vec, factor: number): Viewport {
  const zoom = clamp(v.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const world = screenToWorld(anchor, v);
  return { zoom, x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom };
}

export function zoomTo(v: Viewport, anchor: Vec, zoom: number): Viewport {
  return zoomAt(v, anchor, zoom / v.zoom);
}

/** Viewport that fits `bounds` into a screen of `size`, with `padding` px. */
export function fitRect(bounds: Rect, size: { w: number; h: number }, padding = 64, maxZoom = 1): Viewport {
  const zoom = clamp(
    Math.min((size.w - padding * 2) / Math.max(bounds.w, 1), (size.h - padding * 2) / Math.max(bounds.h, 1)),
    ZOOM_MIN,
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

export interface Pile {
  key: string;
  ids: string[];
  bounds: Rect;
}

/** Far-zoom grouping (B5: the desk tidies itself into labelled piles with counters). */
export function pilesBy<N extends DeskNode>(nodes: N[], keyOf: (n: N) => string): Pile[] {
  const groups = new Map<string, N[]>();
  for (const n of nodes) {
    const k = keyOf(n);
    const list = groups.get(k);
    if (list) list.push(n);
    else groups.set(k, [n]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    ids: list.map((n) => n.id),
    bounds: union(list.map(rectOf))!,
  }));
}
