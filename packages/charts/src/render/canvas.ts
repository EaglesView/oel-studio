/** Scene → Canvas 2D (the sheet grid paints charts in the same pass as its cells). */
import type { Paint, Scene, Stroke } from '../types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function fillStyle(g: Ctx2D, p: Paint, box: { x: number; y: number; w: number; h: number }): string | CanvasGradient {
  if (typeof p === 'string') return p;
  let grad: CanvasGradient;
  if (p.kind === 'radial') {
    grad = g.createRadialGradient(box.x + box.w * 0.35, box.y + box.h * 0.35, 0, box.x + box.w / 2, box.y + box.h / 2, Math.max(box.w, box.h) * 0.75);
  } else {
    const a = (p.angle * Math.PI) / 180;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = (Math.cos(a) * box.w) / 2;
    const dy = (Math.sin(a) * box.h) / 2;
    grad = g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  for (const s of p.stops) grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color);
  return grad;
}

function applyStroke(g: Ctx2D, s: Stroke) {
  g.strokeStyle = s.color;
  g.lineWidth = s.width;
  g.setLineDash(s.dash ?? []);
  g.lineJoin = 'round';
}

const boxOf = (d: string) => {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 };
};

/** Paint a scene at (x, y) of the context, scaled by `scale`. `images` holds already-decoded picture fills. */
export function paintCanvas(g: Ctx2D, scene: Scene, x = 0, y = 0, scale = 1, images?: Map<string, CanvasImageSource>) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.beginPath();
  g.rect(0, 0, scene.w, scene.h);
  g.clip();
  for (const m of scene.marks) {
    g.globalAlpha = m.opacity ?? 1;
    switch (m.t) {
      case 'rect':
        if (m.fill) {
          g.fillStyle = fillStyle(g, m.fill, m);
          g.fillRect(m.x, m.y, m.w, m.h);
        }
        if (m.stroke) {
          applyStroke(g, m.stroke);
          g.strokeRect(m.x, m.y, m.w, m.h);
        }
        break;
      case 'path': {
        const p = new Path2D(m.d);
        if (m.fill) {
          g.fillStyle = fillStyle(g, m.fill, boxOf(m.d));
          g.fill(p);
        }
        if (m.stroke) {
          applyStroke(g, m.stroke);
          g.stroke(p);
        }
        break;
      }
      case 'circle':
        g.beginPath();
        g.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
        if (m.fill) {
          g.fillStyle = fillStyle(g, m.fill, { x: m.cx - m.r, y: m.cy - m.r, w: 2 * m.r, h: 2 * m.r });
          g.fill();
        }
        if (m.stroke) {
          applyStroke(g, m.stroke);
          g.stroke();
        }
        break;
      case 'image': {
        const img = images?.get(m.href);
        if (img) g.drawImage(img, m.x, m.y, m.w, m.h);
        break;
      }
      case 'text':
        g.save();
        g.translate(m.x, m.y);
        if (m.rot) g.rotate((m.rot * Math.PI) / 180);
        g.font = `${m.italic ? 'italic ' : ''}${m.bold ? 'bold ' : ''}${m.size}px ${m.font}`;
        g.fillStyle = m.color;
        g.textAlign = m.anchor === 'start' ? 'left' : m.anchor === 'end' ? 'right' : 'center';
        g.textBaseline = m.baseline === 'top' ? 'top' : m.baseline === 'bottom' ? 'alphabetic' : 'middle';
        g.fillText(m.text, 0, m.baseline === 'bottom' ? -m.size * 0.2 : 0);
        g.restore();
        break;
    }
  }
  g.restore();
}

/** A `measure` option for `renderChart` backed by a canvas (accurate text widths). */
export function canvasMeasure(): (text: string, size: number, font: string, bold?: boolean) => number {
  let g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  return (text, size, font, bold) => {
    if (!g) {
      if (typeof OffscreenCanvas !== 'undefined') g = new OffscreenCanvas(1, 1).getContext('2d');
      else if (typeof document !== 'undefined') g = document.createElement('canvas').getContext('2d');
    }
    if (!g) return text.length * size * 0.5;
    g.font = `${bold ? 'bold ' : ''}${size}px ${font}`;
    return g.measureText(text).width;
  };
}
