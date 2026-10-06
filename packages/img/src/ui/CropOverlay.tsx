import { useRef } from 'react';

type Rect = [number, number, number, number];
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 0.03;

/**
 * Crop frame over the uncropped image (normalised rect). `ratio` (pixels, width / height) keeps
 * the shape; `fw × fh` is the frame size in pixels. Arrow keys nudge the whole frame.
 */
export function CropOverlay({ rect, ratio, fw, fh, onChange }: { rect: Rect; ratio: number | null; fw: number; fh: number; onChange: (r: Rect) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ h: Handle; x: number; y: number; r: Rect } | null>(null);

  const apply = (h: Handle, dx: number, dy: number, r0: Rect): Rect => {
    let [x0, y0, x1, y1] = r0;
    if (h === 'move') {
      const w = x1 - x0;
      const ht = y1 - y0;
      x0 = Math.min(1 - w, Math.max(0, x0 + dx));
      y0 = Math.min(1 - ht, Math.max(0, y0 + dy));
      return [x0, y0, x0 + w, y0 + ht];
    }
    if (h.includes('w')) x0 = Math.min(x1 - MIN, Math.max(0, x0 + dx));
    if (h.includes('e')) x1 = Math.max(x0 + MIN, Math.min(1, x1 + dx));
    if (h.includes('n')) y0 = Math.min(y1 - MIN, Math.max(0, y0 + dy));
    if (h.includes('s')) y1 = Math.max(y0 + MIN, Math.min(1, y1 + dy));
    if (ratio) {
      // Keep the shape: the dragged side leads, the other follows, inside the frame.
      const wPx = (x1 - x0) * fw;
      const hPx = (y1 - y0) * fh;
      const byWidth = h === 'e' || h === 'w' || (h.length === 2 && wPx / ratio >= hPx);
      let nw = byWidth ? wPx : hPx * ratio;
      let nh = nw / ratio;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const ax = h.includes('w') ? x1 : h.includes('e') ? x0 : null;
      const ay = h.includes('n') ? y1 : h.includes('s') ? y0 : null;
      const maxW = (ax === null ? 2 * Math.min(cx, 1 - cx) : h.includes('w') ? ax : 1 - ax) * fw;
      const maxH = (ay === null ? 2 * Math.min(cy, 1 - cy) : h.includes('n') ? ay : 1 - ay) * fh;
      const k = Math.min(1, maxW / nw, maxH / nh);
      nw = (nw * k) / fw;
      nh = (nh * k) / fh;
      x0 = ax === null ? cx - nw / 2 : h.includes('w') ? ax - nw : ax;
      y0 = ay === null ? cy - nh / 2 : h.includes('n') ? ay - nh : ay;
      x1 = x0 + nw;
      y1 = y0 + nh;
    }
    return [x0, y0, x1, y1];
  };

  const down = (h: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    start.current = { h, x: e.clientX, y: e.clientY, r: rect };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const moveTo = (e: React.PointerEvent) => {
    const s = start.current;
    const b = box.current?.getBoundingClientRect();
    if (!s || !b) return;
    onChange(apply(s.h, (e.clientX - s.x) / b.width, (e.clientY - s.y) / b.height, s.r));
  };
  const [x0, y0, x1, y1] = rect;
  return (
    <div className="atelier-crop" ref={box} onPointerMove={moveTo} onPointerUp={() => (start.current = null)}>
      <div
        className="atelier-crop__frame"
        style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
        onPointerDown={down('move')}
        tabIndex={0}
        role="group"
        aria-label="Cadre de recadrage : glisser pour déplacer, flèches pour ajuster"
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.05 : 0.01;
          const v = ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<string, [number, number]>)[e.key];
          if (!v) return;
          e.preventDefault();
          onChange(apply('move', v[0], v[1], rect));
        }}
      >
        <span className="atelier-crop__thirds" aria-hidden />
        {HANDLES.map((h) => (
          <span key={h} className={`atelier-crop__handle atelier-crop__handle--${h}`} onPointerDown={down(h)} aria-hidden />
        ))}
      </div>
    </div>
  );
}
