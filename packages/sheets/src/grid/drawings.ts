/**
 * Pictures, shapes and charts painted on the grid canvas, in the same pass
 * as the cells: they stay locked to their cells while scrolling and zooming.
 * Charts are drawn by @oel/charts (see `charts.ts`).
 */
import { paintCanvas, type Scene } from '@oel/charts';
import type { Drawing, DrawingMarker } from '../model/types';
import type { Layout } from './render';

/** DrawingML lengths: 914 400 EMU per inch, 96 px per inch. */
export const EMU_PER_PX = 9525;

/** Frame of a drawing in the layout's logical pixels. */
export function drawingFrame(d: Drawing, L: Layout): { x: number; y: number; w: number; h: number } | null {
  const point = (m: DrawingMarker) => ({ x: L.x(m.c) + (m.dx ?? 0) / EMU_PER_PX, y: L.y(m.r) + (m.dy ?? 0) / EMU_PER_PX });
  const a = point(d.from);
  // « Move but don't size with cells »: the size read from the file, whatever the columns do now.
  const fixed = (d.editAs === 'oneCell' || d.editAs === 'absolute') && !!d.cx && !!d.cy;
  const b = d.to && !fixed ? point(d.to) : { x: a.x + (d.cx ?? 0) / EMU_PER_PX, y: a.y + (d.cy ?? 0) / EMU_PER_PX };
  const w = b.x - a.x;
  const h = b.y - a.y;
  return w > 0 && h > 0 ? { x: a.x, y: a.y, w, h } : null;
}

/**
 * Paint the drawings anchored in one pane (frozen rows/columns are panes of
 * their own, as in Excel). The context is already clipped to the pane.
 */
export function paintDrawings(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  drawings: Drawing[],
  images: ReadonlyMap<string, CanvasImageSource>,
  pane: { frozenRows: boolean; frozenCols: boolean },
  font: string,
  chart?: (d: Drawing, w: number, h: number) => Scene | null,
) {
  for (const d of drawings) {
    if (d.from.r < L.fr !== pane.frozenRows || d.from.c < L.fc !== pane.frozenCols) continue;
    const f = drawingFrame(d, L);
    if (!f || f.x > L.w || f.y > L.h || f.x + f.w < 0 || f.y + f.h < 0) continue;
    ctx.save();
    ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
    if (d.rot) ctx.rotate((d.rot * Math.PI) / 180);
    if (d.flipH || d.flipV) ctx.scale(d.flipH ? -1 : 1, d.flipV ? -1 : 1);
    ctx.translate(-f.w / 2, -f.h / 2);
    if (d.kind === 'picture') {
      const img = d.media ? images.get(d.media) : undefined;
      // Excel stretches the picture to its frame (`a:stretch`).
      if (img) ctx.drawImage(img, 0, 0, f.w, f.h);
    } else if (d.kind === 'shape') {
      paintShape(ctx, d, f.w, f.h);
    } else if (d.kind === 'chart') {
      const scene = chart?.(d, f.w, f.h);
      if (scene) paintCanvas(ctx, scene, 0, 0, 1, images as Map<string, CanvasImageSource>);
      else paintChartFrame(ctx, d, f.w, f.h, font);
    }
    ctx.restore();
  }
}

function shapePath(ctx: CanvasRenderingContext2D, geom: string | undefined, w: number, h: number) {
  ctx.beginPath();
  if (geom === 'ellipse') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (geom === 'roundRect') ctx.roundRect(0, 0, w, h, Math.min(w, h) * 0.16);
  else ctx.rect(0, 0, w, h);
}

function paintShape(ctx: CanvasRenderingContext2D, d: Drawing, w: number, h: number) {
  shapePath(ctx, d.geom, w, h);
  if (d.fill) {
    ctx.fillStyle = d.fill;
    ctx.fill();
  }
  if (d.line) {
    ctx.strokeStyle = d.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (d.text) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.font = '14.67px Calibri, Carlito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = d.text.split('\n');
    lines.forEach((t, i) => ctx.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 18));
    ctx.restore();
  }
}

/** A chart we could not read: a labelled frame keeps its place. */
function paintChartFrame(ctx: CanvasRenderingContext2D, d: Drawing, w: number, h: number, font: string) {
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#b9b9b9';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.setLineDash([]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const cx = w / 2;
  const cy = h / 2;
  // Bar-chart glyph.
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - 11, cy - 40, 22, 22);
  for (const [dx, bh] of [[-5, 6], [0, 11], [5, 8]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - 22);
    ctx.lineTo(cx + dx, cy - 22 - bh);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#555';
  ctx.font = `500 13px ${font}`;
  ctx.fillText(d.name || 'Graphique', cx, cy);
  ctx.fillStyle = '#777';
  ctx.font = `400 12px ${font}`;
  ctx.fillText('Graphique conservé dans le fichier,', cx, cy + 20);
  ctx.fillText('mais illisible ici.', cx, cy + 36);
  ctx.restore();
}
