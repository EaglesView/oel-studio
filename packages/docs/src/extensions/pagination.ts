/**
 * Print-layout pagination, line by line, section by section.
 *
 * The document is one continuous ProseMirror view. After each change we
 * measure the laid-out lines (with the previous spacers removed, in the same
 * frame, so nothing flickers), find the first line of each page and insert an
 * invisible spacer widget before it that pushes it to the top of the next
 * sheet. Sheets (paper, header, footer, page numbers) are drawn behind the
 * text by the React page view, from `storage.pages`.
 *
 * Sections (Word's `w:sectPr`) give each page its own size and margins: a
 * `nextPage`/`oddPage`/`evenPage` section starts on a new sheet, a
 * `continuous` one on the same sheet (a different page size applies from the
 * next sheet, like Word). The body column spans the union of every section's
 * text column; blocks of a narrower section are inset by node decorations
 * (transparent side borders on paragraphs, so their own Word indents still
 * apply; margins on tables and other blocks).
 *
 * Lines are the unit, so a long paragraph flows across pages like in Docs;
 * table rows are kept whole. Pageless mode simply disables the plugin.
 */
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { AnchorAttrs, DocSettings, Section } from '../model/types';
import { DEFAULT_SETTINGS, defaultSection, frameOf, makePage, sectionOrder, startsNewPage, type SectionFrame, type PageInfo } from '../model/sections';

interface Break {
  pos: number;
  height: number;
  /** Spacer element type: inside text (`span`), between blocks (`div`) or table rows (`tr`). */
  ctx: 'inline' | 'block' | 'row';
  page: number;
}

/** Sections in layout order, the frame they make, and each top-level block's section. */
export interface SectionLayout {
  sections: Section[];
  frame: SectionFrame;
  /** Section index of each top-level child of the doc, by child index. */
  blockSection: number[];
}

/** Where a floating object's anchor landed, for the page view's anchor layers. */
export interface AnchorPlacement {
  pos: number;
  /** Sheet index. */
  page: number;
  /** Tops of the anchor paragraph and of the anchor's line, and the anchor's x (sheet px). */
  paraTop: number;
  lineTop: number;
  charLeft: number;
  attrs: AnchorAttrs;
}

export interface PaginationStorage {
  enabled: boolean;
  gap: number;
  /** Section records by id (order comes from the `section` attrs in the doc). */
  sections: Map<string, Section>;
  settings: DocSettings;
  /** Current layout (derived from the doc and `sections`). */
  layout: SectionLayout;
  pages: PageInfo[];
  /** Floating objects of the body, placed on their sheets (updated with `pages`). */
  anchors: AnchorPlacement[];
  listeners: Set<(pages: PageInfo[]) => void>;
  /** Force a new layout (page setup changed, fonts loaded…). */
  relayout: () => void;
}

declare module '@tiptap/core' {
  interface Storage {
    pagination: PaginationStorage;
  }
}

export const paginationKey = new PluginKey<DecorationSet>('pagination');
export const sectionInsetKey = new PluginKey<DecorationSet>('sectionInset');

/** Ids of the breaks inside a top-level block (a paragraph, or paragraphs of a content control). */
function breaksIn(node: PMNode): string[] {
  if (node.type.name === 'paragraph') return typeof node.attrs.section === 'string' ? [node.attrs.section] : [];
  if (node.type.name !== 'sdtBlock') return [];
  const out: string[] = [];
  node.forEach((c) => out.push(...breaksIn(c)));
  return out;
}

export function sectionLayout(doc: PMNode, byId: Map<string, Section>): SectionLayout {
  const breaks: string[] = [];
  doc.forEach((n) => breaks.push(...breaksIn(n)));
  const sections = sectionOrder(breaks, byId);
  const index = new Map(sections.map((s, i) => [s.id, i]));
  const blockSection: number[] = [];
  let cur = 0;
  doc.forEach((n) => {
    blockSection.push(cur);
    for (const id of breaksIn(n)) {
      const i = index.get(id);
      if (i != null && i >= cur) cur = Math.min(i + 1, sections.length - 1);
    }
  });
  return { sections, frame: frameOf(sections), blockSection };
}

/** Node decorations narrowing the blocks of sections whose text column is inside the union. */
function insetDecorations(doc: PMNode, layout: SectionLayout): DecorationSet {
  const { frame, blockSection } = layout;
  if (frame.insetLeft.every((v) => v === 0) && frame.insetRight.every((v) => v === 0)) return DecorationSet.empty;
  const decos: Decoration[] = [];
  let i = 0;
  doc.forEach((node, pos) => {
    const s = blockSection[i++] ?? 0;
    const l = frame.insetLeft[s] ?? 0;
    const r = frame.insetRight[s] ?? 0;
    if (!l && !r) return;
    const style =
      node.type.name === 'paragraph'
        ? `border-left:${l}px solid transparent;border-right:${r}px solid transparent;background-clip:padding-box`
        : `margin-left:${l}px;margin-right:${r}px`;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { style, 'data-section-inset': '' }));
  });
  return DecorationSet.create(doc, decos);
}

interface Unit {
  top: number;
  bottom: number;
  pos: number;
  ctx: Break['ctx'];
  forced?: boolean;
  /** Section of the unit's top-level block. */
  section: number;
  /** First unit of a section that starts on a new sheet. */
  sectionStart?: boolean;
  /** Collapsed vertical margin between this block and the previous one (block units). */
  el?: HTMLElement;
}

function lineBoxes(el: HTMLElement): Array<{ top: number; bottom: number; left: number }> {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Array<{ top: number; bottom: number; left: number }> = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    // Same line when the boxes overlap vertically by more than half.
    if (last && r.top < last.bottom - Math.min(r.height, last.bottom - last.top) / 2) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.left = Math.min(last.left, r.left);
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left });
    }
  }
  return lines;
}

/** First document position on the visual line starting at `top`. */
function lineStart(view: EditorView, x: number, top: number, bottom: number, min: number, max: number): number | null {
  const hit = view.posAtCoords({ left: x + 1, top: (top + bottom) / 2 });
  if (!hit) return null;
  let p = Math.max(min, Math.min(max, hit.pos));
  const onLine = (q: number) => {
    try {
      return view.coordsAtPos(q, 1).top >= top - 2;
    } catch {
      return false;
    }
  };
  let guard = 0;
  while (p > min && onLine(p - 1) && guard++ < 400) p--;
  guard = 0;
  while (p < max && !onLine(p) && guard++ < 400) p++;
  return p;
}

function collectUnits(view: EditorView, scale: number, originTop: number, layout: SectionLayout): Unit[] {
  const units: Unit[] = [];
  const y = (v: number) => (v - originTop) / scale;
  let section = 0;
  let pending: number | null = null;
  const push = (u: Omit<Unit, 'section'>) => {
    const unit: Unit = { ...u, section };
    if (pending != null && !u.forced) {
      unit.sectionStart = true;
      pending = null;
    }
    units.push(unit);
  };
  const visit = (parent: PMNode, base: number, top: boolean) => {
    let index = 0;
    parent.forEach((node, offset) => {
      if (top) {
        const s = layout.blockSection[index++] ?? section;
        if (s !== section) {
          section = s;
          pending = startsNewPage(layout.sections[s]?.kind ?? 'nextPage').newPage ? s : null;
        }
      }
      const pos = base + offset;
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      if (!dom || !(dom instanceof HTMLElement)) return;
      const name = node.type.name;
      if (name === 'sdtBlock') {
        visit(node, pos + 1, false);
        return;
      }
      if (name === 'table') {
        const rows = dom.querySelectorAll(':scope tr, :scope > table > tbody > tr');
        let i = 0;
        node.forEach((row, rowOffset) => {
          const tr = rows[i++] as HTMLElement | undefined;
          if (!tr) return;
          const r = tr.getBoundingClientRect();
          push({ top: y(r.top), bottom: y(r.bottom), pos: pos + 1 + rowOffset, ctx: 'row' });
        });
        return;
      }
      if (name !== 'paragraph') {
        const r = dom.getBoundingClientRect();
        push({ top: y(r.top), bottom: y(r.bottom), pos, ctx: 'block', el: dom });
        return;
      }
      const lines = lineBoxes(dom);
      if (!lines.length) {
        const r = dom.getBoundingClientRect();
        push({ top: y(r.top), bottom: y(r.bottom), pos, ctx: 'block', el: dom });
      } else {
        const start = pos + 1;
        const end = pos + node.nodeSize - 1;
        lines.forEach((l, i) => {
          if (i === 0) {
            push({ top: y(l.top), bottom: y(l.bottom), pos, ctx: 'block', el: dom });
            return;
          }
          const p = lineStart(view, l.left, l.top, l.bottom, start, end);
          if (p != null) push({ top: y(l.top), bottom: y(l.bottom), pos: p, ctx: 'inline' });
        });
      }
      // Forced page breaks inside the paragraph.
      node.forEach((child, childOffset) => {
        if (child.type.name !== 'pageBreak') return;
        const el = view.nodeDOM(pos + 1 + childOffset) as HTMLElement | null;
        if (!el?.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        push({ top: y(r.bottom), bottom: y(r.bottom), pos: pos + 1 + childOffset + 1, ctx: 'inline', forced: true });
      });
    });
  };
  visit(view.state.doc, 0, true);
  // Forced breaks were appended per paragraph; keep document order.
  units.sort((a, b) => a.top - b.top || a.pos - b.pos);
  return units;
}

function computeBreaks(view: EditorView, storage: PaginationStorage): { breaks: Break[]; pages: PageInfo[] } {
  const { layout, gap } = storage;
  const { sections, frame } = layout;
  const root = view.dom as HTMLElement;
  const rect = root.getBoundingClientRect();
  const scale = rect.width / (root.offsetWidth || rect.width || 1) || 1;
  const units = collectUnits(view, scale, rect.top, layout);
  const pages: PageInfo[] = [makePage(sections, frame, 0, null, gap)];
  const origin = pages[0]!.margins.top;
  // Content area of page k, in body coordinates (y = 0 at the first page's text top).
  const contentTop = (k: number) => pages[k]!.top + pages[k]!.margins.top - origin;
  const contentBottom = (k: number) => pages[k]!.top + pages[k]!.height - pages[k]!.margins.bottom - origin;
  const addPage = (section: number) => {
    pages.push(makePage(sections, frame, section, pages[pages.length - 1]!, gap));
    return pages.length - 1;
  };
  const breaks: Break[] = [];
  let shift = 0;
  let k = 0;
  let lastBottom = 0;
  const collapse = (u: Unit, delta: number) => {
    if (u.ctx !== 'block' || !u.el) return delta;
    // Between blocks the spacer stops the two margins from collapsing
    // (gap becomes mb + h + mt instead of max(mb, mt)): compensate so the
    // block's border lands exactly at the top of the next sheet.
    const mt = parseFloat(getComputedStyle(u.el).marginTop) || 0;
    const prev = u.el.previousElementSibling as HTMLElement | null;
    const mb = prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0;
    return Math.max(0, delta - Math.min(mb, mt));
  };
  const moveTo = (u: Unit, top: number, page: number) => {
    const delta = contentTop(page) - top;
    breaks.push({ pos: u.pos, height: collapse(u, Math.max(0, delta)), ctx: u.ctx, page });
    shift += delta;
    k = page;
  };
  for (const u of units) {
    const top = u.top + shift;
    const bottom = u.bottom + shift;
    if (u.sectionStart) {
      // A new section on a new sheet; odd/even sections may leave a blank page.
      let next = addPage(u.section);
      const parity = startsNewPage(sections[u.section]?.kind ?? 'nextPage').parity;
      if (parity && (pages[next]!.number % 2 === 0) !== (parity === 'even')) {
        pages[next]!.blank = true;
        next = addPage(u.section);
      }
      moveTo(u, top, next);
      lastBottom = Math.max(lastBottom, u.bottom + shift);
      continue;
    }
    if (u.forced) {
      if (top > contentTop(k) + 0.5) moveTo(u, top, addPage(pages[k]!.section));
      continue;
    }
    if (bottom > contentBottom(k) + 0.5 && top > contentTop(k) + 1) {
      // A continuous section's page size applies from the next sheet.
      moveTo(u, top, addPage(u.section));
    }
    // A unit taller than a page spills over; count the pages it covers.
    const b = u.bottom + shift;
    while (b > contentBottom(k) + 0.5 && u.bottom - u.top > contentBottom(k) - contentTop(k)) k = k + 1 < pages.length ? k + 1 : addPage(pages[k]!.section);
    lastBottom = Math.max(lastBottom, b);
  }
  while (lastBottom > contentBottom(pages.length - 1) + 0.01) addPage(pages[pages.length - 1]!.section);
  return { breaks, pages };
}

function spacer(b: Break): HTMLElement {
  const tag = b.ctx === 'row' ? 'tr' : b.ctx === 'inline' ? 'span' : 'div';
  const el = document.createElement(tag);
  el.className = `oel-pgap oel-pgap--${b.ctx}`;
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.page = String(b.page);
  if (b.ctx === 'row') {
    const td = document.createElement('td');
    td.colSpan = 100;
    td.style.height = `${b.height}px`;
    el.append(td);
  } else {
    el.style.height = `${b.height}px`;
  }
  return el;
}

/** Measure where every `anchor` node of the body sits on the laid-out sheets. */
function measureAnchors(view: EditorView, pages: PageInfo[], frame: SectionFrame): AnchorPlacement[] {
  const out: AnchorPlacement[] = [];
  const root = view.dom as HTMLElement;
  const rect = root.getBoundingClientRect();
  const scale = rect.width / (root.offsetWidth || rect.width || 1) || 1;
  const origin = pages[0]?.margins.top ?? 0;
  const sheetAt = (y: number) => {
    let k = 0;
    while (k + 1 < pages.length && pages[k + 1]!.top <= y) k++;
    return k;
  };
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'anchor') return true;
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const $pos = view.state.doc.resolve(pos);
    let paraEl: HTMLElement | null = null;
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'paragraph') {
        paraEl = view.nodeDOM($pos.before(d)) as HTMLElement | null;
        break;
      }
    }
    const pr = paraEl?.getBoundingClientRect?.() ?? r;
    const yPara = (pr.top - rect.top) / scale + origin;
    const yLine = (r.top - rect.top) / scale + origin;
    const attrs = node.attrs as AnchorAttrs;
    const page = sheetAt(attrs.position?.relV === 'paragraph' ? yPara : yLine);
    const sheet = pages[page]!;
    const round = (v: number) => Math.round(v * 10) / 10;
    out.push({ pos, page, paraTop: round(yPara - sheet.top), lineTop: round(yLine - sheet.top), charLeft: round((r.left - rect.left) / scale + frame.textLeft - sheet.sheetLeft), attrs });
    return false;
  });
  return out;
}

function emptyLayout(): SectionLayout {
  const sections = [defaultSection()];
  return { sections, frame: frameOf(sections), blockSection: [] };
}

/** Pages when pagination is off: one sheet of the first section, as tall as needed. */
function singlePage(layout: SectionLayout, gap: number): PageInfo[] {
  return [makePage(layout.sections, layout.frame, 0, null, gap)];
}

export const Pagination = Extension.create<object, PaginationStorage>({
  name: 'pagination',

  addStorage() {
    const layout = emptyLayout();
    return {
      enabled: true,
      gap: 24,
      sections: new Map(),
      settings: { ...DEFAULT_SETTINGS },
      layout,
      pages: singlePage(layout, 24),
      anchors: [],
      listeners: new Set(),
      relayout: () => {},
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const updateLayout = (doc: PMNode) => {
      storage.layout = sectionLayout(doc, storage.sections);
      return insetDecorations(doc, storage.layout);
    };
    return [
      new Plugin<DecorationSet>({
        key: sectionInsetKey,
        state: {
          init: (_, state) => updateLayout(state.doc),
          apply(tr, old) {
            if (tr.docChanged || tr.getMeta(sectionInsetKey)) return updateLayout(tr.doc);
            return old;
          },
        },
        props: {
          decorations: (state) => sectionInsetKey.getState(state),
        },
      }),
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const set = tr.getMeta(paginationKey) as Break[] | undefined;
            if (set) {
              return DecorationSet.create(
                tr.doc,
                set.map((b, i) => Decoration.widget(b.pos, () => spacer(b), { side: -1, key: `pg${i}:${b.ctx}:${Math.round(b.height)}`, ignoreSelection: true })),
              );
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state),
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let frame = 0;
          let destroyed = false;
          const same = (a: PageInfo[], b: PageInfo[]) =>
            a.length === b.length && a.every((p, i) => p.top === b[i]!.top && p.label === b[i]!.label && p.sectionId === b[i]!.sectionId && p.width === b[i]!.width && p.height === b[i]!.height && p.sheetLeft === b[i]!.sheetLeft && !!p.blank === !!b[i]!.blank && p.margins === b[i]!.margins);
          const anchorKey = (list: AnchorPlacement[]) => list.map((a) => `${a.pos}:${a.page}:${a.paraTop}:${a.lineTop}:${a.charLeft}`).join('|');
          const publish = (pages: PageInfo[]) => {
            const anchors = measureAnchors(view, pages, storage.layout.frame);
            const attrsChanged = anchors.some((a, i) => a.attrs !== storage.anchors[i]?.attrs);
            if (same(pages, storage.pages) && !attrsChanged && anchorKey(anchors) === anchorKey(storage.anchors)) return;
            storage.anchors = anchors;
            storage.pages = pages;
            for (const l of storage.listeners) l(pages);
          };
          const layout = () => {
            frame = 0;
            if (destroyed || !view.dom.isConnected) return;
            if (view.composing) return schedule(200);
            const root = view.dom as HTMLElement;
            const hadBreaks = (paginationKey.getState(view.state)?.find().length ?? 0) > 0;
            if (!storage.enabled) {
              if (hadBreaks) view.dispatch(view.state.tr.setMeta(paginationKey, []).setMeta('addToHistory', false));
              root.style.minHeight = '';
              publish(singlePage(storage.layout, storage.gap));
              return;
            }
            // Keep the scroll height while spacers are out, so the viewport does not jump.
            root.style.minHeight = `${root.offsetHeight}px`;
            if (hadBreaks) view.dispatch(view.state.tr.setMeta(paginationKey, []).setMeta('addToHistory', false));
            const { breaks, pages } = computeBreaks(view, storage);
            if (breaks.length) view.dispatch(view.state.tr.setMeta(paginationKey, breaks).setMeta('addToHistory', false));
            const last = pages[pages.length - 1]!;
            root.style.minHeight = `${last.top + last.height - last.margins.bottom - pages[0]!.margins.top}px`;
            publish(pages);
          };
          const schedule = (delay = 60) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (!frame) frame = requestAnimationFrame(layout);
            }, delay);
          };
          storage.relayout = () => {
            // Section records changed: recompute insets now, then the pages.
            if (!destroyed) view.dispatch(view.state.tr.setMeta(sectionInsetKey, true).setMeta('addToHistory', false));
            schedule(0);
          };
          const ro = new ResizeObserver(() => schedule(30));
          ro.observe(view.dom);
          const onLoad = (e: Event) => {
            if ((e.target as HTMLElement).tagName === 'IMG') schedule(0);
          };
          view.dom.addEventListener('load', onLoad, true);
          document.fonts?.ready.then(() => schedule(0));
          // Web fonts loaded later (substitutes, embedded faces) change line breaks.
          const onFonts = () => schedule(0);
          document.fonts?.addEventListener?.('loadingdone', onFonts);
          schedule(0);
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              destroyed = true;
              ro.disconnect();
              document.fonts?.removeEventListener?.('loadingdone', onFonts);
              view.dom.removeEventListener('load', onLoad, true);
              if (timer) clearTimeout(timer);
              if (frame) cancelAnimationFrame(frame);
            },
          };
        },
      }),
    ];
  },
});
