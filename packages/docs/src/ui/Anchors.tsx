/**
 * Anchor layers: Word's floating objects (shapes, pictures, text boxes,
 * groups) drawn on each sheet, behind the text (`behindDoc`) or in front of
 * it, ordered by `z`. Positions come from the anchor's reference frame (page,
 * margin, column, paragraph, line…) and the sheet's section geometry.
 */
import { useMemo, type CSSProperties } from 'react';
import type { AnchorAttrs, GroupChild, PMDoc, PMNode, ShapeLook } from '../model/types';
import { EMU_PER_PX } from '../model/types';
import type { PageInfo } from '../model/sections';
import { toHTML } from './actions';
import { Fields, type FieldValues } from './Fields';

const px = (emu: number) => emu / EMU_PER_PX;

/** An anchor to draw on one sheet, with where its anchor sits on that sheet. */
export interface PlacedAnchor {
  key: string;
  attrs: AnchorAttrs;
  paraTop: number;
  lineTop: number;
  charLeft: number;
}

/** Every anchor node of a story (header/footer), in document order. */
export function anchorsOf(doc: PMDoc | PMNode): AnchorAttrs[] {
  const out: AnchorAttrs[] = [];
  const walk = (n: PMNode | PMDoc) => {
    if ((n as PMNode).type === 'anchor' && (n as PMNode).attrs) out.push((n as PMNode).attrs as unknown as AnchorAttrs);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

/** The object's box on its sheet (px), from Word's positioning rules. */
export function anchorBox(a: AnchorAttrs, p: PageInfo, at: Pick<PlacedAnchor, 'paraTop' | 'lineTop' | 'charLeft'>) {
  const w = px(a.cx);
  const h = px(a.cy);
  const m = p.margins;
  const pos = a.position;
  const hRef: Record<string, [number, number]> = {
    page: [0, p.width],
    margin: [m.left, p.width - m.right],
    column: [m.left, p.width - m.right],
    leftMargin: [0, m.left],
    insideMargin: [0, m.left],
    rightMargin: [p.width - m.right, p.width],
    outsideMargin: [p.width - m.right, p.width],
    character: [at.charLeft, at.charLeft],
  };
  const vRef: Record<string, [number, number]> = {
    page: [0, p.height],
    margin: [m.top, p.height - m.bottom],
    topMargin: [0, m.top],
    insideMargin: [0, m.top],
    bottomMargin: [p.height - m.bottom, p.height],
    outsideMargin: [p.height - m.bottom, p.height],
    paragraph: [at.paraTop, at.paraTop],
    line: [at.lineTop, at.lineTop],
  };
  const [x0, x1] = hRef[pos.relH] ?? hRef.column!;
  const [y0, y1] = vRef[pos.relV] ?? vRef.paragraph!;
  const align = (al: string | null, a0: number, a1: number, size: number, off: number | null) => {
    switch (al) {
      case 'left':
      case 'top':
      case 'inside':
        return a0;
      case 'center':
        return (a0 + a1 - size) / 2;
      case 'right':
      case 'bottom':
      case 'outside':
        return a1 - size;
      default:
        return a0 + px(off ?? 0);
    }
  };
  return { left: align(pos.alignH, x0, x1, w, pos.h), top: align(pos.alignV, y0, y1, h, pos.v), width: w, height: h };
}

/** Clip paths for preset geometries a box cannot draw (fill only; lines follow the box). */
const CLIP: Record<string, string> = {
  triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  rtTriangle: 'polygon(0 0, 100% 100%, 0 100%)',
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  parallelogram: 'polygon(25% 0, 100% 0, 75% 100%, 0 100%)',
  trapezoid: 'polygon(25% 0, 75% 0, 100% 100%, 0 100%)',
  pentagon: 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)',
  hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
  octagon: 'polygon(29% 0, 71% 0, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0 71%, 0 29%)',
  rightArrow: 'polygon(0 25%, 60% 25%, 60% 0, 100% 50%, 60% 100%, 60% 75%, 0 75%)',
  leftArrow: 'polygon(100% 25%, 40% 25%, 40% 0, 0 50%, 40% 100%, 40% 75%, 100% 75%)',
  chevron: 'polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%, 25% 50%)',
  star5: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};
const LINES = new Set(['line', 'straightConnector1', 'bentConnector3', 'curvedConnector3']);

function pictureStyle(look: ShapeLook, url: (path: string) => string | null): CSSProperties {
  const pic = look.picture;
  if (!pic) return {};
  const src = url(pic.path);
  if (!src) return {};
  if (pic.tile) return { backgroundImage: `url("${src}")`, backgroundRepeat: 'repeat' };
  const c = pic.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const w = Math.max(0.01, 1 - c.l - c.r);
  const h = Math.max(0.01, 1 - c.t - c.b);
  const pos = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 0);
  return {
    backgroundImage: `url("${src}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${100 / w}% ${100 / h}%`,
    backgroundPosition: `${pos(c.l, c.r)}% ${pos(c.t, c.b)}%`,
  };
}

function Shape({ look, width, height, url, fields }: { look: ShapeLook; width: number; height: number; url: (path: string) => string | null; fields: FieldValues }) {
  const geometry = look.geometry ?? 'rect';
  const transform = [look.rotation ? `rotate(${look.rotation}deg)` : '', look.flipH || look.flipV ? `scale(${look.flipH ? -1 : 1}, ${look.flipV ? -1 : 1})` : ''].filter(Boolean).join(' ');
  if (LINES.has(geometry)) {
    const stroke = /([\d.]+)pt \w+ (.+)$/.exec(look.line ?? '');
    return (
      <svg className="oel-shape__svg" width={Math.max(width, 1)} height={Math.max(height, 1)} style={{ transform: transform || undefined, overflow: 'visible' }} aria-hidden>
        <line x1={0} y1={0} x2={width} y2={height} stroke={stroke?.[2] ?? '#000'} strokeWidth={stroke ? (parseFloat(stroke[1]!) * 4) / 3 : 1} />
      </svg>
    );
  }
  const style: CSSProperties = {
    width,
    height,
    background: look.fill ?? undefined,
    ...pictureStyle(look, url),
    border: look.line && !CLIP[geometry] ? look.line : undefined,
    borderRadius: geometry === 'ellipse' ? '50%' : geometry === 'roundRect' ? Math.min(width, height) / 6 : undefined,
    clipPath: CLIP[geometry],
    transform: transform || undefined,
  };
  const text = look.text;
  const html = useMemo(() => (text ? toHTML(text.doc) : ''), [text]);
  return (
    <div className="oel-shape__box" style={style}>
      {text && (
        <div
          className="oel-shape__text"
          style={{
            padding: `${px(text.insets.t)}px ${px(text.insets.r)}px ${px(text.insets.b)}px ${px(text.insets.l)}px`,
            justifyContent: text.anchor === 'ctr' ? 'center' : text.anchor === 'b' ? 'flex-end' : 'flex-start',
          }}
        >
          <Fields html={html} values={fields} className="oel-doc" />
        </div>
      )}
    </div>
  );
}

function AnchorObject({ a, box, url, fields }: { a: AnchorAttrs; box: ReturnType<typeof anchorBox>; url: (path: string) => string | null; fields: FieldValues }) {
  const label = a.alt || a.title || undefined;
  return (
    <div className={`oel-shape oel-shape--${a.kind}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} role={label ? 'img' : undefined} aria-label={label}>
      {a.kind === 'group' ? (
        <div className="oel-shape__group" style={{ transform: a.shape.rotation ? `rotate(${a.shape.rotation}deg)` : undefined }}>
          {a.children.map((c: GroupChild, i) => (
            <div key={i} className="oel-shape__child" style={{ left: px(c.x), top: px(c.y) }}>
              <Shape look={c.shape} width={px(c.cx)} height={px(c.cy)} url={url} fields={fields} />
            </div>
          ))}
        </div>
      ) : (
        <Shape look={a.shape} width={box.width} height={box.height} url={url} fields={fields} />
      )}
    </div>
  );
}

/** The objects of one sheet, behind or in front of the text, lowest `z` first. */
export function AnchorLayer({ sheet, anchors, behind, url, fields }: { sheet: PageInfo; anchors: PlacedAnchor[]; behind: boolean; url: (path: string) => string | null; fields: FieldValues }) {
  const list = anchors.filter((a) => !!a.attrs.behindDoc === behind && a.attrs.position && a.attrs.shape).sort((x, y) => x.attrs.z - y.attrs.z);
  if (!list.length) return null;
  return (
    <div className={`oel-anchors oel-anchors--${behind ? 'behind' : 'front'}`} aria-hidden={list.every((a) => !a.attrs.alt)}>
      {list.map((a) => (
        <AnchorObject key={a.key} a={a.attrs} box={anchorBox(a.attrs, sheet, a)} url={url} fields={fields} />
      ))}
    </div>
  );
}
