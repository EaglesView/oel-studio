import { useRef, type PointerEvent } from 'react';
import { rectOf, union } from '../core/geometry';
import type { DeskStore } from '../core/store';
import { useDeskState } from './hooks';

export interface MinimapProps<D> {
  store: DeskStore<D>;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Mini-carte (B1 · 8): situates the view on a large desk. Pointer convenience
 * only: hidden from assistive tech because every action it offers has a key
 * (Shift+arrows to pan, 0 to fit, 1/2/3 for zoom levels).
 */
export function Minimap<D>({ store, width = 216, height = 136, className }: MinimapProps<D>) {
  const nodesMap = useDeskState(store, (s) => s.nodes);
  const order = useDeskState(store, (s) => s.order);
  const selection = useDeskState(store, (s) => s.selection);
  const viewport = useDeskState(store, (s) => s.viewport);
  const screen = useDeskState(store, (s) => s.screen);
  const dragging = useRef(false);

  const nodes = order.map((id) => nodesMap[id]!).filter(Boolean);
  const view = { x: viewport.x, y: viewport.y, w: screen.w / viewport.zoom, h: screen.h / viewport.zoom };
  const content = union([...nodes.map(rectOf), view]) ?? view;
  const pad = 8;
  const scale = Math.min((width - pad * 2) / content.w, (height - pad * 2) / content.h);
  const ox = pad + ((width - pad * 2) - content.w * scale) / 2;
  const oy = pad + ((height - pad * 2) - content.h * scale) / 2;
  const tx = (x: number) => ox + (x - content.x) * scale;
  const ty = (y: number) => oy + (y - content.y) * scale;

  const panTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left - ox) / scale + content.x;
    const wy = (e.clientY - r.top - oy) / scale + content.y;
    store.centerOn({ x: wx, y: wy });
  };

  return (
    <div
      className={['desk-minimap', className].filter(Boolean).join(' ')}
      style={{ width, height }}
      aria-hidden
      data-desk-ui
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        panTo(e);
      }}
      onPointerMove={(e) => dragging.current && panTo(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      {nodes.map((n) => (
        <span
          key={n.id}
          className="desk-minimap__node"
          data-selected={selection.includes(n.id) || undefined}
          style={{ left: tx(n.x), top: ty(n.y), width: Math.max(2, n.w * scale), height: Math.max(2, n.h * scale) }}
        />
      ))}
      <span
        className="desk-minimap__view"
        style={{ left: tx(view.x), top: ty(view.y), width: view.w * scale, height: view.h * scale }}
      />
    </div>
  );
}
