import { Icon } from '@oel/emboss';
import type { Layout } from '../grid/render';
import type { Drawing, DrawingMarker } from '../model/types';

/** DrawingML lengths: 914 400 EMU per inch, 96 px per inch. */
const EMU_PER_PX = 9525;

/**
 * Pictures, shapes and chart frames of the sheet, over the cells (read-only:
 * the file's drawing part is written back as it came). Positioned with the
 * grid's layout, so they scroll, zoom and follow frozen panes like the cells.
 * Charts are not drawn yet: a labelled frame keeps their place.
 */
export function Drawings({ drawings, layout, zoom, media }: { drawings: Drawing[]; layout: Layout; zoom: number; media: ReadonlyMap<string, string> }) {
  if (!drawings.length) return null;
  const point = (m: DrawingMarker) => ({ x: layout.x(m.c) + (m.dx ?? 0) / EMU_PER_PX, y: layout.y(m.r) + (m.dy ?? 0) / EMU_PER_PX });
  return (
    <div className="oel-drawings" style={{ clipPath: `inset(${layout.headerH * zoom}px 0 0 ${layout.headerW * zoom}px)` }} aria-hidden>
      {drawings.map((d, i) => {
        const a = point(d.from);
        const b = d.to ? point(d.to) : { x: a.x + (d.cx ?? 0) / EMU_PER_PX, y: a.y + (d.cy ?? 0) / EMU_PER_PX };
        const w = Math.max(0, b.x - a.x);
        const h = Math.max(0, b.y - a.y);
        if (!w || !h) return null;
        const flips = `${d.flipH ? ' scaleX(-1)' : ''}${d.flipV ? ' scaleY(-1)' : ''}`;
        const style = {
          left: a.x * zoom,
          top: a.y * zoom,
          width: w * zoom,
          height: h * zoom,
          transform: d.rot || flips ? `rotate(${d.rot ?? 0}deg)${flips}` : undefined,
        };
        const key = `${i}:${d.name}`;
        if (d.kind === 'picture') {
          const src = d.media ? media.get(d.media) : undefined;
          return src ? <img key={key} className="oel-drawing oel-drawing--picture" style={style} src={src} alt="" draggable={false} /> : null;
        }
        if (d.kind === 'shape') {
          const round = d.geom === 'ellipse' ? '50%' : d.geom === 'roundRect' ? `${Math.min(w, h) * 0.16 * zoom}px` : undefined;
          return (
            <div
              key={key}
              className="oel-drawing oel-drawing--shape"
              style={{ ...style, background: d.fill ?? undefined, border: d.line ? `${Math.max(1, zoom)}px solid ${d.line}` : undefined, borderRadius: round, fontSize: 14.67 * zoom }}
            >
              {d.text}
            </div>
          );
        }
        if (d.kind === 'chart') {
          return (
            <div key={key} className="oel-drawing oel-drawing--chart" style={style} title={d.descr ?? d.name}>
              <Icon name="chart" size={Math.round(Math.max(16, Math.min(40, 28 * zoom)))} />
              <span>{d.name || 'Graphique'}</span>
              <small>Graphique conservé dans le fichier — l’affichage arrive bientôt.</small>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
