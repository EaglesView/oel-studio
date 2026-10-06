/**
 * Drawing slides: the layout's background and decorations, then the slide's
 * elements, in slide points (1 CSS px = 1 pt, scaled by the caller). Shapes
 * are SVG (geometry from `model/geometry`), text is HTML on top, styled from
 * the deck's resolved levels — the same code draws the canvas, the
 * filmstrip, the slideshow and the presenter view.
 */
import { ChartView } from '@oel/charts/react';
import { createContext, memo, useContext, useId, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@oel/emboss';
import { MODE_LABEL, STATE_LABEL, linkHost, onLinkHost, type LinkDef, type LinkState, type LinksDoc } from '@oel/links';
import { geometryPaths, isLinePreset } from '../model/geometry';
import {
  fieldText,
  hasText,
  isEmptyBody,
  levelOf,
  numbering,
  autoNumber,
  paraCss,
  resolvePara,
  resolveRun,
  runCss,
  fontStack,
  type TextCtx,
} from '../model/text';
import type { DeckInfo, SlideData } from '../model/ydoc';
import { pt, type Element, type Layout, type Line, type LineEnd, type Paint, type TextBody } from '../model/types';

export interface RenderCtx extends TextCtx {
  /** Display URL of a media part (`null` while unknown). */
  media: (path: string) => string | null;
  /** Editing view: prompts of empty placeholders, frames of empty pictures. */
  editing: boolean;
  /** Element whose text is being edited (drawn without it). */
  editingText?: string | null;
  /** Links of the deck: linked copies show their badge while editing (Figma G4). */
  links?: LinksDoc | null;
  /** A media part showing a retouch preview: drawn whole, fitted inside its frame (L3). */
  previewing?: (path: string) => boolean;
}

const Ctx = createContext<RenderCtx | null>(null);
/** The paint a `grpFill` child takes from its group. */
const GroupFill = createContext<Paint | undefined>(undefined);

export const PROMPTS: Record<string, string> = {
  title: 'Cliquez pour ajouter un titre',
  ctrTitle: 'Cliquez pour ajouter un titre',
  subTitle: 'Cliquez pour ajouter un sous-titre',
  body: 'Cliquez pour ajouter du texte',
  obj: 'Cliquez pour ajouter du texte',
  pic: 'Cliquez pour ajouter une image',
  tbl: 'Tableau',
  chart: 'Graphique',
  media: 'Média',
  clipArt: 'Image',
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** CSS background for a slide paint. */
export function paintCss(p: Paint | null | undefined, media: (path: string) => string | null): CSSProperties {
  if (!p) return { background: '#FFFFFF' };
  switch (p.type) {
    case 'none':
      return { background: '#FFFFFF' };
    case 'solid':
      return { background: p.color };
    case 'gradient': {
      const stops = p.stops.map((s) => `${s.color} ${r3(s.pos * 100)}%`).join(', ');
      return { background: p.path ? `radial-gradient(circle at center, ${stops})` : `linear-gradient(${r3(p.angle + 90)}deg, ${stops})` };
    }
    case 'image': {
      const url = media(p.media);
      return url ? { backgroundImage: `url("${url}")`, backgroundSize: p.tile ? 'auto' : '100% 100%', backgroundRepeat: p.tile ? 'repeat' : 'no-repeat' } : { background: '#FFFFFF' };
    }
    case 'pattern':
      return { background: p.bg, backgroundImage: `repeating-linear-gradient(45deg, ${p.fg} 0 1px, transparent 1px 4px)` };
    default:
      return {};
  }
}

/** An SVG paint: a colour, or a reference to a definition it needs. */
function svgPaint(p: Paint | null | undefined, id: string, w: number, h: number, media: (path: string) => string | null, group?: Paint): { fill: string; def?: ReactNode } {
  if (!p || p.type === 'none') return { fill: 'none' };
  if (p.type === 'group') return group ? svgPaint(group, id, w, h, media) : { fill: 'none' };
  if (p.type === 'solid') return { fill: p.color };
  if (p.type === 'pattern') return { fill: p.fg };
  if (p.type === 'gradient') {
    const stops = p.stops.map((s, i) => <stop key={i} offset={s.pos} stopColor={s.color} />);
    const def = p.path ? (
      <radialGradient id={id} cx="0.5" cy="0.5" r="0.7">
        {stops}
      </radialGradient>
    ) : (
      <linearGradient id={id} x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform={`rotate(${r3(p.angle)} 0.5 0.5)`}>
        {stops}
      </linearGradient>
    );
    return { fill: `url(#${id})`, def };
  }
  const url = media(p.media);
  if (!url) return { fill: 'none' };
  const c = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const iw = 1 / Math.max(0.01, 1 - c.l - c.r);
  const ih = 1 / Math.max(0.01, 1 - c.t - c.b);
  const def = (
    <pattern id={id} patternUnits="userSpaceOnUse" width={w} height={h}>
      <image href={url} x={-c.l * iw * w} y={-c.t * ih * h} width={iw * w} height={ih * h} preserveAspectRatio="none" />
    </pattern>
  );
  return { fill: `url(#${id})`, def };
}

const DASH: Record<string, number[]> = {
  dash: [4, 3],
  dot: [1, 1],
  sysDot: [1, 1],
  sysDash: [3, 1],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

const END_SIZE: Record<string, number> = { sm: 2, med: 3, lg: 5 };

function marker(end: LineEnd, id: string, color: string, start: boolean): ReactNode {
  const w = END_SIZE[end.w ?? 'med'] ?? 3;
  const l = END_SIZE[end.len ?? 'med'] ?? 3;
  const shapes: Record<string, ReactNode> = {
    triangle: <path d="M0,0 L10,5 L0,10 Z" fill={color} />,
    stealth: <path d="M0,0 L10,5 L0,10 L3,5 Z" fill={color} />,
    diamond: <path d="M0,5 L5,0 L10,5 L5,10 Z" fill={color} />,
    oval: <circle cx="5" cy="5" r="5" fill={color} />,
    arrow: <path d="M0,0 L10,5 L0,10" fill="none" stroke={color} strokeWidth="1.6" />,
  };
  const s = shapes[end.type];
  if (!s) return null;
  return (
    <marker key={id} id={id} viewBox="0 0 10 10" refX={end.type === 'arrow' ? 9 : 5} refY="5" markerWidth={l} markerHeight={w} markerUnits="strokeWidth" orient={start ? 'auto-start-reverse' : 'auto'}>
      {s}
    </marker>
  );
}

const mergeLine = (a?: Line, b?: Line): Line | undefined => (a || b ? { ...a, ...Object.fromEntries(Object.entries(b ?? {}).filter(([, v]) => v != null)) } : undefined);

/** Effective fill and outline: the element's own over what it inherits. */
export const effectiveFill = (el: Element): Paint | undefined => el.fill ?? el.look?.fill;
export const effectiveLine = (el: Element): Line | undefined => mergeLine(el.look?.line, el.line);

function Shape({ el, w, h }: { el: Element; w: number; h: number }) {
  const ctx = useContext(Ctx)!;
  const group = useContext(GroupFill);
  const uid = useId().replace(/:/g, '');
  const prst = el.geom?.type === 'preset' ? el.geom.prst : undefined;
  const paths = useMemo(() => geometryPaths(el.geom, w, h), [el.geom, w, h]);
  const line = effectiveLine(el);
  const isLine = el.kind === 'connector' || isLinePreset(prst);
  const fill = isLine ? { fill: 'none' } : svgPaint(effectiveFill(el), `${uid}f`, w, h, ctx.media, group);
  const stroke = line?.paint && line.paint.type !== 'none' ? (line.paint.type === 'solid' ? line.paint.color : line.paint.type === 'gradient' ? (line.paint.stops[0]?.color ?? '#000') : '#000') : undefined;
  const sw = stroke ? Math.max(0.25, pt(line?.width ?? 9525)) : 0;
  const dash = line?.dash && DASH[line.dash] ? DASH[line.dash]!.map((d) => d * sw).join(' ') : undefined;
  const defs: ReactNode[] = [];
  if (fill.def) defs.push(<g key="f">{fill.def}</g>);
  const head = stroke && line?.head && line.head.type !== 'none' ? marker(line.head, `${uid}h`, stroke, true) : null;
  const tail = stroke && line?.tail && line.tail.type !== 'none' ? marker(line.tail, `${uid}t`, stroke, false) : null;
  if (head) defs.push(head);
  if (tail) defs.push(tail);
  const shadow = el.look?.shadow;
  const filter = shadow && !shadow.inner ? `drop-shadow(${r3(pt(shadow.dist) * Math.cos((shadow.dir * Math.PI) / 180))}px ${r3(pt(shadow.dist) * Math.sin((shadow.dir * Math.PI) / 180))}px ${r3(pt(shadow.blur) / 2)}px ${shadow.color})` : undefined;
  const pic = el.kind === 'picture' || (el.kind === 'graphic' && el.image?.media) ? el.image : undefined;
  const picUrl = pic ? ctx.media(pic.svg ?? pic.media) ?? (pic.svg ? ctx.media(pic.media) : null) : null;
  const clip = `${uid}c`;
  let image: ReactNode = null;
  if (pic && picUrl && ctx.previewing?.(pic.media)) {
    // The retouch's own crop and turns give its shape; the frame takes it when the panel closes.
    image = <image href={picUrl} x={0} y={0} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity={pic.alpha ?? undefined} />;
  } else if (pic && picUrl) {
    const c = pic.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const iw = w / Math.max(0.01, 1 - c.l - c.r);
    const ih = h / Math.max(0.01, 1 - c.t - c.b);
    defs.push(
      <clipPath key="c" id={clip}>
        {paths.map((p, i) => (
          <path key={i} d={p.d} />
        ))}
      </clipPath>,
    );
    image = <image href={picUrl} x={-c.l * iw} y={-c.t * ih} width={iw} height={ih} preserveAspectRatio="none" clipPath={`url(#${clip})`} opacity={pic.alpha ?? undefined} />;
  }
  const flip = el.flipH || el.flipV ? `translate(${el.flipH ? w : 0} ${el.flipV ? h : 0}) scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1})` : undefined;
  return (
    <svg className="oel-el__svg" width={Math.max(w, 0.01)} height={Math.max(h, 0.01)} viewBox={`0 0 ${Math.max(w, 0.01)} ${Math.max(h, 0.01)}`} style={{ filter }} aria-hidden>
      {defs.length > 0 && <defs>{defs}</defs>}
      <g transform={flip}>
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.fill === 'none' || image ? 'none' : fill.fill}
            fillRule="evenodd"
            stroke={p.stroke && stroke ? stroke : 'none'}
            strokeWidth={sw}
            strokeDasharray={dash}
            strokeLinecap={line?.cap === 'rnd' ? 'round' : line?.cap === 'sq' ? 'square' : 'butt'}
            strokeLinejoin="round"
            markerStart={head ? `url(#${uid}h)` : undefined}
            markerEnd={tail ? `url(#${uid}t)` : undefined}
          />
        ))}
        {image}
        {image && stroke && paths.map((p, i) => <path key={`o${i}`} d={p.d} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />)}
      </g>
    </svg>
  );
}

/** Text of a body, as HTML paragraphs. */
export function TextView({ body, prompt, ctx }: { body: TextBody; prompt?: string | null; ctx: TextCtx }) {
  const b = body.body;
  const fit = { fontScale: b.autofit === 'norm' ? b.fontScale : 1, lineReduction: b.autofit === 'norm' ? b.lineReduction : 0 };
  const showPrompt = prompt && isEmptyBody(body);
  const nums = numbering(body);
  const paras = showPrompt ? [{ lvl: 0, props: {}, runs: [{ kind: 'text', text: prompt, props: {} }], end: {} }] : body.paras.length ? body.paras : [{ lvl: 0, props: {}, runs: [], end: {} }];
  return (
    <>
      {paras.map((p, i) => {
        const level = levelOf(body, p.lvl ?? 0);
        const rp = resolvePara(level, p.props ?? {});
        const first = p.runs.find((r) => r.kind !== 'br');
        const firstRun = resolveRun(level, first?.props ?? p.end ?? {}, ctx);
        const style = paraCss(rp, firstRun.size, fit) as CSSProperties;
        const n = nums.get(i);
        const bullet =
          !showPrompt && hasText(p) && rp.bullet.kind !== 'none'
            ? rp.bullet.kind === 'auto'
              ? autoNumber(rp.bullet.scheme, n ?? 1)
              : (rp.bullet.char ?? '•')
            : null;
        const indent = rp.indent / 12700;
        return (
          <p key={i} className="oel-para" style={style}>
            {bullet && (
              <span
                className="oel-bullet"
                style={{
                  minWidth: indent < 0 ? `${-indent}px` : undefined,
                  fontFamily: rp.bullet.font ? fontStack(rp.bullet.font, ctx) : fontStack(firstRun.font, ctx),
                  color: rp.bullet.color ?? firstRun.color,
                  fontSize: `${r3(firstRun.size * fit.fontScale * (rp.bullet.size ?? 1))}px`,
                }}
              >
                {bullet}
              </span>
            )}
            {p.runs.length === 0 && <span style={runCss(firstRun, ctx, fit) as CSSProperties}>{'​'}</span>}
            {p.runs.map((r, k) => {
              if (r.kind === 'br') return <br key={k} />;
              const rr = resolveRun(level, r.props ?? {}, ctx);
              const css = runCss(rr, ctx, fit) as CSSProperties;
              return (
                <span key={k} style={css} className={showPrompt ? 'oel-prompt' : undefined}>
                  {r.kind === 'field' ? fieldText(r, ctx) : r.text}
                </span>
              );
            })}
          </p>
        );
      })}
    </>
  );
}

const ANCHOR: Record<string, string> = { t: 'flex-start', ctr: 'center', b: 'flex-end', just: 'space-between', dist: 'space-between' };

/** The positioned text frame of a shape (insets, anchor, wrapping, columns). */
export function textFrameStyle(body: TextBody, el: Element): CSSProperties {
  const b = body.body;
  const vert = b.vert !== 'horz';
  return {
    padding: `${r3(pt(b.t))}px ${r3(pt(b.r))}px ${r3(pt(b.b))}px ${r3(pt(b.l))}px`,
    justifyContent: ANCHOR[b.anchor] ?? 'flex-start',
    whiteSpace: b.wrap ? 'pre-wrap' : 'pre',
    columnCount: b.cols ?? undefined,
    writingMode: vert ? 'vertical-rl' : undefined,
    transform: el.flipV ? 'rotate(180deg)' : b.vert === 'vert270' ? 'rotate(180deg)' : undefined,
    alignItems: b.anchorCtr ? 'center' : undefined,
  };
}

function TableView({ el }: { el: Element }) {
  const ctx = useContext(Ctx)!;
  const t = el.table!;
  const border = (l?: Line) => {
    if (!l?.paint || l.paint.type === 'none') return undefined;
    const c = l.paint.type === 'solid' ? l.paint.color : '#000';
    return `${r3(Math.max(0.5, pt(l.width ?? 12700)))}px ${l.dash && l.dash !== 'solid' ? 'dashed' : 'solid'} ${c}`;
  };
  return (
    <table className="oel-table" style={{ width: pt(el.cx) }}>
      <colgroup>
        {t.cols.map((w, i) => (
          <col key={i} style={{ width: pt(w) }} />
        ))}
      </colgroup>
      <tbody>
        {t.rows.map((row, r) => (
          <tr key={r} style={{ height: pt(row.h) }}>
            {row.cells.map((c, k) =>
              c.hMerge || c.vMerge ? null : (
                <td
                  key={k}
                  data-cell={`${r}:${k}`}
                  colSpan={c.gridSpan ?? 1}
                  rowSpan={c.rowSpan ?? 1}
                  style={{
                    ...paintCss(c.fill?.type === 'none' ? undefined : c.fill, ctx.media),
                    ...(c.fill && c.fill.type !== 'none' ? {} : { background: 'transparent' }),
                    borderLeft: border(c.borders?.l),
                    borderRight: border(c.borders?.r),
                    borderTop: border(c.borders?.t),
                    borderBottom: border(c.borders?.b),
                    padding: `${pt(c.text.body.t)}px ${pt(c.text.body.r)}px ${pt(c.text.body.b)}px ${pt(c.text.body.l)}px`,
                    verticalAlign: c.text.body.anchor === 'ctr' ? 'middle' : c.text.body.anchor === 'b' ? 'bottom' : 'top',
                  }}
                >
                  {ctx.editingText === `${el.id}:${r}:${k}` ? null : <TextView body={c.text} ctx={ctx} />}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One element, positioned in its parent's space. */
export const ElementView = memo(function ElementView({ el, offset }: { el: Element; offset?: { x: number; y: number } }) {
  const ctx = useContext(Ctx)!;
  if (el.hidden || el.kind === 'other') return null;
  const w = pt(el.cx);
  const h = pt(el.cy);
  const style: CSSProperties = {
    left: pt(el.x - (offset?.x ?? 0)),
    top: pt(el.y - (offset?.y ?? 0)),
    width: w,
    height: h,
    transform: el.rot ? `rotate(${el.rot}deg)` : undefined,
  };
  let body: ReactNode;
  if (el.kind === 'group') {
    const f = el.childFrame ?? { x: el.x, y: el.y, cx: el.cx, cy: el.cy };
    const sx = f.cx ? el.cx / f.cx : 1;
    const sy = f.cy ? el.cy / f.cy : 1;
    const flip = `${el.flipH ? ' scaleX(-1)' : ''}${el.flipV ? ' scaleY(-1)' : ''}`;
    body = (
      <GroupFill.Provider value={el.fill}>
        <div className="oel-group" style={{ width: pt(f.cx), height: pt(f.cy), transform: `scale(${sx}, ${sy})${flip}` }}>
          {(el.children ?? []).map((c) => (
            <ElementView key={c.id} el={c} offset={{ x: f.x, y: f.y }} />
          ))}
        </div>
      </GroupFill.Provider>
    );
  } else if (el.kind === 'table' && el.table) {
    body = <TableView el={el} />;
  } else {
    // Only a picture placeholder waits for a picture; a picture whose file is missing draws nothing.
    const emptyPic = el.kind === 'picture' && !el.image?.media;
    const waiting = emptyPic && !!el.ph;
    const showText = el.text && ctx.editingText !== el.id;
    const prompt = ctx.editing && el.ph ? (el.text?.prompt ?? PROMPTS[el.ph.type] ?? null) : null;
    body = (
      <>
        {!emptyPic && <Shape el={el} w={w} h={h} />}
        {waiting && ctx.editing && (
          <div className="oel-el__empty">
            <span>{el.label ?? PROMPTS.pic}</span>
          </div>
        )}
        {el.kind === 'graphic' && el.chart && (
          <div className="oel-el__chart">
            <ChartView spec={el.chart} width={(w * 96) / 72} height={(h * 96) / 72} fontFamily={(f) => fontStack(f, ctx)} />
          </div>
        )}
        {el.kind === 'graphic' && !el.image?.media && !el.chart && (
          <div className="oel-el__graphic">
            <span>{el.label ?? 'Objet'}</span>
            <small>Conservé tel quel</small>
          </div>
        )}
        {showText && (!isEmptyBody(el.text) || prompt) && (
          <div className="oel-el__text" style={textFrameStyle(el.text!, el)}>
            <TextView body={el.text!} prompt={prompt} ctx={ctx} />
          </div>
        )}
      </>
    );
  }
  return (
    <div className={`oel-el oel-el--${el.kind}`} style={style} data-el={el.id}>
      {body}
      {ctx.editing && ctx.links && (el.kind === 'graphic' || el.kind === 'picture' || el.kind === 'table') && <LinkBadge links={ctx.links} objectId={el.id} />}
    </div>
  );
});

/** « Lié · Budget 2027 · À jour » on a linked copy; opens the link's popover. */
function LinkBadge({ links, objectId }: { links: LinksDoc; objectId: string }) {
  const host = useSyncExternalStore(onLinkHost, linkHost, linkHost);
  // Snapshots must be stable: compare the link as text.
  const json = useSyncExternalStore(
    (fn) => links.observe(fn),
    () => JSON.stringify(links.byObject(objectId)),
    () => 'null',
  );
  const link = useMemo(() => JSON.parse(json) as LinkDef | null, [json]);
  // Re-render on state changes too (the link object above only changes with the Y.Doc).
  const state = useSyncExternalStore<LinkState>(host.subscribe, () => (link ? host.state(link.id) : 'waiting'), () => 'waiting');
  if (!link) return null;
  const label = link.mode === 'frozen' ? MODE_LABEL.frozen : STATE_LABEL[state];
  return (
    <button
      type="button"
      className="oel-link-badge"
      data-state={link.mode === 'frozen' ? 'frozen' : state}
      aria-label={`Copie liée de ${link.source.title} › ${link.source.label}, ${label}. Gérer le lien`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        host.manage(link.id, { x: r.x, y: r.y, width: r.width, height: r.height });
      }}
    >
      <Icon name="link" size={12} aria-hidden /> Lié · {link.source.title} · {label}
    </button>
  );
}

/** A slide at its natural size in points; wrap it in a scaled box to zoom. */
export const SlideView = memo(function SlideView({ slide, info, ctx, children }: { slide: SlideData; info: DeckInfo; ctx: RenderCtx; children?: ReactNode }) {
  const layout: Layout | undefined = info.layouts.find((l) => l.id === slide.layout);
  const bg = slide.background ?? layout?.background;
  return (
    <Ctx.Provider value={ctx}>
      <div className="oel-slide" style={{ width: pt(info.width), height: pt(info.height), ...paintCss(bg, ctx.media) }}>
        {!slide.hideDecorations && layout?.decorations?.map((el) => <ElementView key={el.id} el={el} />)}
        {slide.elements.map((el) => (
          <ElementView key={el.id} el={el} />
        ))}
        {children}
      </div>
    </Ctx.Provider>
  );
});

/** A slide scaled into a box of `width` CSS pixels. */
export function ScaledSlide({ slide, info, ctx, width, className }: { slide: SlideData; info: DeckInfo; ctx: RenderCtx; width: number; className?: string }) {
  const k = width / pt(info.width);
  return (
    <div className={`oel-scaled ${className ?? ''}`} style={{ width, height: pt(info.height) * k }}>
      <div className="oel-scaled__inner" style={{ transform: `scale(${k})` }}>
        <SlideView slide={slide} info={info} ctx={ctx} />
      </div>
    </div>
  );
}
