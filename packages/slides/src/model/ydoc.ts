/**
 * The live presentation: a Y.Doc holding the deck JSON in collaborative pieces.
 *
 *   meta            Y.Map   formatVersion, seeded, title, width, height, source,
 *                           theme, fonts, preserved, notesMaster, layoutOrder
 *   layouts         Y.Map   layout id → Layout (read-only)
 *   order           Y.Array slide ids, in order
 *   slides          Y.Map   slide id → Y.Map { layout, hidden, src, background,
 *                           notes: Y.Text, els: Y.Array<id>, map: Y.Map<id, Y.Map> }
 *
 * An element is a Y.Map of *facets* (`box`, `fill`, `line`, `geom`, `text`,
 * `name`, `image`, `table`, and `base` for the rest), so two people editing
 * different facets of one shape (one moves it, one types in it) both win.
 * `toDeck()` rebuilds exactly the JSON the codec gave for anything untouched,
 * which is how the writer knows what to leave byte for byte.
 */
import * as Y from 'yjs';
import type { Deck, Element, Layout, Paint, Slide } from './types';

export const FORMAT_VERSION = 1;

/** Origin of local edits (undo tracks only these). */
export const LOCAL = Symbol('oel-slides-local');

export class SlidesFormatError extends Error {
  constructor(found: unknown) {
    super(`Cette présentation a été enregistrée par une autre version de l’éditeur (format ${String(found)}). Importez de nouveau le fichier .pptx.`);
    this.name = 'SlidesFormatError';
  }
}

const FACETS = {
  box: ['x', 'y', 'cx', 'cy', 'rot', 'flipH', 'flipV'],
  fill: ['fill'],
  line: ['line'],
  geom: ['geom'],
  text: ['text'],
  name: ['name', 'descr', 'hidden'],
  image: ['image'],
  table: ['table'],
} as const satisfies Record<string, ReadonlyArray<keyof Element>>;

type Facet = keyof typeof FACETS | 'base';
const FACET_OF = new Map<string, Facet>(Object.entries(FACETS).flatMap(([f, keys]) => keys.map((k) => [k, f as Facet])));

/** Deck-wide settings that do not change while editing. */
export interface DeckInfo {
  title: string;
  width: number;
  height: number;
  source: Deck['source'];
  theme: Deck['theme'];
  fonts: NonNullable<Deck['fonts']>;
  preserved: NonNullable<Deck['preserved']>;
  notesMaster: boolean;
  layouts: Layout[];
  /** Text levels of a plain text box. */
  textDefaults: NonNullable<Deck['textDefaults']>;
}

/** A slide as the editor reads it. */
export interface SlideData {
  id: string;
  layout: string;
  hidden: boolean;
  background: Paint | null;
  hideDecorations: boolean;
  src: string | null;
  elements: Element[];
}

const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

function facetValues(el: Element): Record<Facet, unknown> {
  const out: Partial<Record<Facet, Record<string, unknown>>> = {};
  for (const [k, v] of Object.entries(el)) {
    if (v === undefined) continue;
    const f = FACET_OF.get(k) ?? 'base';
    (out[f] ??= {})[k] = v;
  }
  return out as Record<Facet, unknown>;
}

export class SlidesDoc {
  readonly meta: Y.Map<unknown>;
  readonly layoutMap: Y.Map<Layout>;
  readonly order: Y.Array<string>;
  readonly slides: Y.Map<Y.Map<unknown>>;
  private slideCache = new Map<string, SlideData>();
  private infoCache: DeckInfo | null = null;

  constructor(readonly doc: Y.Doc) {
    this.meta = doc.getMap('meta');
    this.layoutMap = doc.getMap('layouts');
    this.order = doc.getArray('order');
    this.slides = doc.getMap('slides');
    this.slides.observeDeep((events) => {
      for (const e of events) {
        const id = e.path[0];
        if (typeof id === 'string') this.slideCache.delete(id);
        else for (const k of e.changes.keys.keys()) this.slideCache.delete(k);
      }
    });
    this.meta.observe(() => (this.infoCache = null));
    this.layoutMap.observe(() => (this.infoCache = null));
  }

  get seeded(): boolean {
    return !!this.meta.get('seeded');
  }

  /** Refuse a stored deck of another layout version. */
  assertFormat() {
    const v = this.meta.get('formatVersion');
    if (this.seeded && v !== FORMAT_VERSION) throw new SlidesFormatError(v);
  }

  /** Fill an empty doc from the codec's deck. */
  seed(deck: Deck, title?: string) {
    if (this.seeded) return;
    this.doc.transact(() => {
      this.meta.set('formatVersion', FORMAT_VERSION);
      this.meta.set('title', title ?? deck.title ?? '');
      this.meta.set('width', deck.width);
      this.meta.set('height', deck.height);
      this.meta.set('source', deck.source ?? 'new');
      this.meta.set('theme', deck.theme);
      this.meta.set('fonts', deck.fonts ?? []);
      this.meta.set('preserved', deck.preserved ?? []);
      this.meta.set('notesMaster', !!deck.notesMaster);
      this.meta.set('textDefaults', deck.textDefaults ?? []);
      this.meta.set('layoutOrder', deck.layouts.map((l) => l.id));
      for (const l of deck.layouts) this.layoutMap.set(l.id, l);
      for (const s of deck.slides) this.insertSlide(this.order.length, s);
      this.meta.set('seeded', true);
    });
  }

  /** Replace the content with another deck (version restore). */
  replaceWith(deck: Deck) {
    this.doc.transact(() => {
      this.order.delete(0, this.order.length);
      for (const k of [...this.slides.keys()]) this.slides.delete(k);
      for (const s of deck.slides) this.insertSlide(this.order.length, s);
    }, LOCAL);
  }

  info(): DeckInfo {
    if (!this.infoCache) {
      const ids = (this.meta.get('layoutOrder') as string[] | undefined) ?? [...this.layoutMap.keys()];
      this.infoCache = {
        title: (this.meta.get('title') as string) ?? '',
        width: (this.meta.get('width') as number) ?? 12192000,
        height: (this.meta.get('height') as number) ?? 6858000,
        source: (this.meta.get('source') as Deck['source']) ?? 'new',
        theme: (this.meta.get('theme') as Deck['theme']) ?? { major: 'Calibri Light', minor: 'Calibri', colors: [] },
        fonts: (this.meta.get('fonts') as DeckInfo['fonts']) ?? [],
        preserved: (this.meta.get('preserved') as DeckInfo['preserved']) ?? [],
        notesMaster: !!this.meta.get('notesMaster'),
        layouts: ids.map((id) => this.layoutMap.get(id)).filter((l): l is Layout => !!l),
        textDefaults: (this.meta.get('textDefaults') as DeckInfo['textDefaults']) ?? [],
      };
    }
    return this.infoCache;
  }

  layout(id: string): Layout | undefined {
    return this.layoutMap.get(id);
  }

  slideIds(): string[] {
    return this.order.toArray().filter((id) => this.slides.has(id));
  }

  slide(id: string): SlideData | null {
    const cached = this.slideCache.get(id);
    if (cached) return cached;
    const m = this.slides.get(id);
    if (!m) return null;
    const els = m.get('els') as Y.Array<string>;
    const map = m.get('map') as Y.Map<Y.Map<unknown>>;
    const elements = els
      .toArray()
      .map((eid) => map.get(eid))
      .filter((e): e is Y.Map<unknown> => !!e)
      .map((e) => this.readElement(e));
    const data: SlideData = {
      id,
      layout: m.get('layout') as string,
      hidden: !!m.get('hidden'),
      background: (m.get('background') as Paint | null) ?? null,
      hideDecorations: !!m.get('hideDecor'),
      src: (m.get('src') as string | null) ?? null,
      elements,
    };
    this.slideCache.set(id, data);
    return data;
  }

  private readElement(e: Y.Map<unknown>): Element {
    const out: Record<string, unknown> = {};
    for (const [facet, v] of e.entries()) {
      if (v == null) continue;
      if (facet === 'base' || facet in FACETS) Object.assign(out, v as object);
    }
    return strip(out) as unknown as Element;
  }

  notes(id: string): Y.Text | null {
    return (this.slides.get(id)?.get('notes') as Y.Text | undefined) ?? null;
  }

  /** The whole deck, as the codec reads and writes it. */
  toDeck(): Deck {
    const info = this.info();
    const slides: Slide[] = this.slideIds().map((id) => {
      const s = this.slide(id)!;
      return strip({
        id,
        src: s.src ?? undefined,
        layout: s.layout,
        hidden: s.hidden || undefined,
        background: s.background ?? undefined,
        hideDecorations: s.hideDecorations || undefined,
        elements: s.elements,
        notes: this.notes(id)?.toString() ?? '',
      }) as Slide;
    });
    return {
      formatVersion: FORMAT_VERSION,
      width: info.width,
      height: info.height,
      slides,
      layouts: info.layouts,
      theme: info.theme,
      textDefaults: info.textDefaults,
      fonts: info.fonts,
      preserved: info.preserved,
      source: info.source,
      title: info.title || undefined,
      notesMaster: info.notesMaster,
    };
  }

  // -------------------------------------------------------------------------
  // Edits (call inside `edit` so they undo as one step)
  // -------------------------------------------------------------------------

  edit(fn: () => void) {
    this.doc.transact(fn, LOCAL);
  }

  private elementMap(el: Element): Y.Map<unknown> {
    const m = new Y.Map<unknown>();
    for (const [f, v] of Object.entries(facetValues(el))) m.set(f, v);
    return m;
  }

  insertSlide(at: number, s: Slide) {
    const m = new Y.Map<unknown>();
    m.set('layout', s.layout);
    m.set('hidden', !!s.hidden);
    m.set('src', s.src ?? null);
    m.set('background', s.background ?? null);
    m.set('hideDecor', !!s.hideDecorations);
    const notes = new Y.Text();
    notes.insert(0, s.notes ?? '');
    m.set('notes', notes);
    const els = new Y.Array<string>();
    const map = new Y.Map<Y.Map<unknown>>();
    for (const el of s.elements) map.set(el.id, this.elementMap(el));
    els.push(s.elements.map((e) => e.id));
    m.set('els', els);
    m.set('map', map);
    this.slides.set(s.id, m);
    this.order.insert(Math.max(0, Math.min(at, this.order.length)), [s.id]);
  }

  removeSlide(id: string) {
    const i = this.order.toArray().indexOf(id);
    if (i >= 0) this.order.delete(i, 1);
    this.slides.delete(id);
  }

  moveSlide(id: string, to: number) {
    const ids = this.order.toArray();
    const from = ids.indexOf(id);
    if (from < 0 || from === to) return;
    this.order.delete(from, 1);
    this.order.insert(Math.max(0, Math.min(to, this.order.length)), [id]);
  }

  setSlide(id: string, patch: { layout?: string; hidden?: boolean; background?: Paint | null }) {
    const m = this.slides.get(id);
    if (!m) return;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
  }

  private slideParts(id: string) {
    const m = this.slides.get(id);
    if (!m) return null;
    return { els: m.get('els') as Y.Array<string>, map: m.get('map') as Y.Map<Y.Map<unknown>> };
  }

  addElement(slideId: string, el: Element, at?: number) {
    const p = this.slideParts(slideId);
    if (!p) return;
    p.map.set(el.id, this.elementMap(el));
    p.els.insert(at == null ? p.els.length : Math.max(0, Math.min(at, p.els.length)), [el.id]);
  }

  removeElements(slideId: string, ids: string[]) {
    const p = this.slideParts(slideId);
    if (!p) return;
    const list = p.els.toArray();
    for (let i = list.length - 1; i >= 0; i--) if (ids.includes(list[i]!)) p.els.delete(i, 1);
    for (const id of ids) p.map.delete(id);
  }

  /** Set some fields of an element; only the facets they belong to change. */
  updateElement(slideId: string, elId: string, patch: Partial<Element>) {
    const e = this.slideParts(slideId)?.map.get(elId);
    if (!e) return;
    const byFacet = new Map<Facet, Record<string, unknown>>();
    for (const [k, v] of Object.entries(patch)) {
      const f = FACET_OF.get(k) ?? 'base';
      if (!byFacet.has(f)) byFacet.set(f, { ...((e.get(f) as object | undefined) ?? {}) });
      const obj = byFacet.get(f)!;
      if (v === undefined || v === null) delete obj[k];
      else obj[k] = v;
    }
    for (const [f, v] of byFacet) e.set(f, Object.keys(v).length ? v : null);
  }

  /** Move an element in the z-order (0 = back). */
  reorderElement(slideId: string, elId: string, to: number) {
    const p = this.slideParts(slideId);
    if (!p) return;
    const list = p.els.toArray();
    const from = list.indexOf(elId);
    if (from < 0) return;
    p.els.delete(from, 1);
    p.els.insert(Math.max(0, Math.min(to, p.els.length)), [elId]);
  }
}
