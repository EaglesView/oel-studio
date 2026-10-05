/**
 * Building blocks of edits: new slides from a layout, new shapes, text boxes
 * and pictures, a layout change, copies. Pure functions over the deck JSON;
 * `SlidesDoc` stores the result.
 */
import { DEFAULT_LEVEL } from './text';
import type { SlideData, DeckInfo } from './ydoc';
import type { ChartSpec } from '@oel/charts';
import type { Element, Layout, Level, Paint, Placeholder, Slide, TextBody } from './types';

let counter = 0;
/** A new id, unique enough within a deck (`n-…`). */
export const newId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Placeholders a new slide gets from its layout (dates, footers and numbers stay off, as in PowerPoint). */
const CONTENT_PH = (ph?: Placeholder) => !!ph && !['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type);

const emptyText = (t: TextBody | undefined): TextBody | undefined => (t ? { ...t, paras: [] } : undefined);

function freshPlaceholder(p: Element): Element {
  const el: Element = { ...p, id: newId('ph'), src: undefined, text: emptyText(p.text) };
  if (el.kind === 'picture') el.image = { media: '', mime: '' };
  return el;
}

export function slideFromLayout(layout: Layout, id = newId('s')): Slide {
  return { id, layout: layout.id, elements: (layout.placeholders ?? []).filter((p) => CONTENT_PH(p.ph)).map(freshPlaceholder), notes: '' };
}

/** A copy of a slide: same source part (the writer copies it), same element sources. */
export function copySlide(s: SlideData, notes: string, id = newId('s')): Slide {
  return { id, src: s.src ?? undefined, layout: s.layout, hidden: s.hidden || undefined, background: s.background ?? undefined, hideDecorations: s.hideDecorations || undefined, elements: s.elements, notes };
}

/** The layout placeholder an element takes its place and look from (same rules as the codec). */
export function matchPlaceholder(list: Element[], ph: Placeholder): Element | undefined {
  const phs = list.filter((e) => e.ph);
  const cls = (t: string) => (t === 'title' || t === 'ctrTitle' ? 'title' : ['dt', 'ftr', 'sldNum', 'hdr'].includes(t) ? t : 'body');
  return (
    (ph.idx != null ? phs.find((e) => e.ph!.idx === ph.idx) : undefined) ??
    phs.find((e) => e.ph!.type === ph.type) ??
    phs.find((e) => cls(e.ph!.type) === cls(ph.type))
  );
}

/**
 * Elements of a slide moved to another layout: placeholders take the new
 * layout's place and look (their text stays); new content placeholders appear.
 */
export function applyLayout(elements: Element[], layout: Layout): Element[] {
  const phs = layout.placeholders ?? [];
  const used = new Set<Element>();
  const out = elements.map((e) => {
    if (!e.ph) return e;
    const m = matchPlaceholder(phs.filter((p) => !used.has(p)), e.ph);
    if (!m) return e;
    used.add(m);
    return {
      ...e,
      ph: m.ph,
      x: m.x,
      y: m.y,
      cx: m.cx,
      cy: m.cy,
      rot: m.rot,
      geom: m.geom ?? e.geom,
      look: m.look,
      text: e.text && m.text ? { ...e.text, body: m.text.body, levels: m.text.levels, prompt: m.text.prompt } : e.text,
    } satisfies Element;
  });
  for (const p of phs) if (!used.has(p) && CONTENT_PH(p.ph)) out.push(freshPlaceholder(p));
  return out;
}

function levels(info: DeckInfo, over: Partial<Level> = {}): Level[] {
  const base = info.textDefaults.length ? info.textDefaults : [DEFAULT_LEVEL];
  return base.map((l) => ({ ...l, ...over }));
}

const body = (anchor: string, autofit: string): TextBody['body'] => ({ anchor, l: 91440, t: 45720, r: 91440, b: 45720, wrap: true, autofit, fontScale: 1, lineReduction: 0, vert: 'horz' });

/** A text box (grows with its text, like PowerPoint's). */
export function textBox(info: DeckInfo, box: { x: number; y: number; cx: number; cy: number }): Element {
  return {
    id: newId('t'),
    kind: 'shape',
    name: 'ZoneDeTexte',
    ...box,
    geom: { type: 'preset', prst: 'rect' },
    text: { body: body('t', 'shape'), levels: levels(info), paras: [{ runs: [], props: {}, end: {} }] },
  };
}

const themeColor = (info: DeckInfo, name: string, fallback: string) => info.theme.colors.find((c) => c.name === name)?.color ?? fallback;

/** A shape in PowerPoint's default look: accent fill, darker outline, centred light text. */
export function shape(info: DeckInfo, prst: string, box: { x: number; y: number; cx: number; cy: number }): Element {
  const accent = themeColor(info, 'accent1', '#4472C4');
  const light = themeColor(info, 'lt1', '#FFFFFF');
  if (prst === 'line') {
    return { id: newId('l'), kind: 'connector', name: 'Connecteur', ...box, cy: 0, geom: { type: 'preset', prst: 'line' }, line: { paint: { type: 'solid', color: accent }, width: 19050 } };
  }
  return {
    id: newId('f'),
    kind: 'shape',
    name: 'Forme',
    ...box,
    geom: { type: 'preset', prst },
    fill: { type: 'solid', color: accent },
    line: { paint: { type: 'solid', color: shade(accent, 0.7) }, width: 12700 },
    text: { body: body('ctr', 'none'), levels: levels(info, { color: light, align: 'ctr' }), paras: [{ runs: [], props: { align: 'ctr' }, end: { color: light } }] },
  };
}

export function picture(media: string, mime: string, box: { x: number; y: number; cx: number; cy: number }, descr = ''): Element {
  return { id: newId('i'), kind: 'picture', name: 'Image', descr, ...box, geom: { type: 'preset', prst: 'rect' }, image: { media, mime } };
}

/** A chart frame (a linked copy, Figma G2), drawn by @oel/charts from the values cached in the spec. */
export function chartFrame(spec: ChartSpec, box: { x: number; y: number; cx: number; cy: number }, name = 'Graphique'): Element {
  return { id: newId('c'), kind: 'graphic', name, ...box, chart: { ...spec, part: '' } };
}

/**
 * A new slide holding a chart (« Lier dans… › Nouvelle diapositive », Figma G2):
 * a « Titre seul » layout when the deck has one, the title filled, the chart
 * below it. Returns the slide and the chart element's id.
 */
export function chartSlide(info: DeckInfo, spec: ChartSpec, title: string, fallbackLayout?: string): { slide: Slide; chartId: string } {
  const layout =
    info.layouts.find((l) => /title only|titre seul/i.test(l.name)) ?? info.layouts.find((l) => l.id === fallbackLayout) ?? info.layouts[0];
  const slide: Slide = layout ? slideFromLayout(layout) : { id: newId('s'), layout: '', elements: [], notes: '' };
  const isTitle = (e: Element) => !!e.ph && /title/i.test(e.ph.type);
  slide.elements = slide.elements
    .filter((e) => isTitle(e))
    .map((e) => (e.text ? { ...e, text: { ...e.text, paras: [{ lvl: 0, props: {}, runs: [{ kind: 'text', text: title, props: {} }], end: {} }] } as TextBody } : e));
  const chart = chartFrame(spec, chartBoxOn(info, slide.elements), title);
  slide.elements.push(chart);
  return { slide, chartId: chart.id };
}

/** Where a chart goes on a slide: under its title (if any), across 80 % of the width. */
export function chartBoxOn(info: DeckInfo, elements: Element[]): { x: number; y: number; cx: number; cy: number } {
  const title = elements.find((e) => !!e.ph && /title/i.test(e.ph.type));
  const top = title ? Math.min(title.y + title.cy + info.height * 0.03, info.height * 0.4) : info.height * 0.12;
  const cx = Math.round(info.width * 0.8);
  const cy = Math.round(Math.min(info.height - top - info.height * 0.06, cx * 0.6));
  return { x: Math.round((info.width - cx) / 2), y: Math.round(top), cx, cy };
}

/** A colour darkened by a factor (outline of new shapes). */
export function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`.toUpperCase();
}

/** A solid colour of a paint (for swatches and thumbnails). */
export function paintColor(p: Paint | null | undefined): string | undefined {
  if (!p) return undefined;
  if (p.type === 'solid') return p.color;
  if (p.type === 'gradient') return p.stops[0]?.color;
  if (p.type === 'pattern') return p.fg;
  return undefined;
}
