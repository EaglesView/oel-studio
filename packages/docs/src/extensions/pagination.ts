/**
 * Print-layout pagination, line by line.
 *
 * The document is one continuous ProseMirror view. After each change we
 * measure the laid-out lines (with the previous spacers removed, in the same
 * frame, so nothing flickers), find the first line of each page and insert an
 * invisible spacer widget before it that pushes it to the top of the next
 * sheet. Sheets (paper, header, footer, page numbers) are drawn behind the
 * text by the React page view, from `storage.pages`.
 *
 * Lines are the unit, so a long paragraph flows across pages like in Docs;
 * table rows are kept whole. Pageless mode simply disables the plugin.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export interface PageGeometry {
  /** All in CSS px at 100 %. */
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  gap: number;
}

interface Break {
  pos: number;
  height: number;
  /** Spacer element type: inside text (`span`), between blocks (`div`) or table rows (`tr`). */
  ctx: 'inline' | 'block' | 'row';
  page: number;
}

export interface PaginationStorage {
  enabled: boolean;
  geometry: PageGeometry;
  pages: number;
  listeners: Set<(pages: number) => void>;
  /** Force a new layout (page setup changed, fonts loaded…). */
  relayout: () => void;
}

declare module '@tiptap/core' {
  interface Storage {
    pagination: PaginationStorage;
  }
}

export const paginationKey = new PluginKey<DecorationSet>('pagination');

const contentHeight = (g: PageGeometry) => g.pageHeight - g.marginTop - g.marginBottom;

interface Unit {
  top: number;
  bottom: number;
  pos: number;
  ctx: Break['ctx'];
  forced?: boolean;
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

function collectUnits(view: EditorView, scale: number, originTop: number): Unit[] {
  const units: Unit[] = [];
  const y = (v: number) => (v - originTop) / scale;
  const visit = (parent: import('@tiptap/pm/model').Node, base: number) => {
    parent.forEach((node, offset) => {
      const pos = base + offset;
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      if (!dom || !(dom instanceof HTMLElement)) return;
      const name = node.type.name;
      if (name === 'sdtBlock') {
        visit(node, pos + 1);
        return;
      }
      if (name === 'table') {
        const rows = dom.querySelectorAll(':scope tr, :scope > table > tbody > tr');
        let i = 0;
        node.forEach((row, rowOffset) => {
          const tr = rows[i++] as HTMLElement | undefined;
          if (!tr) return;
          const r = tr.getBoundingClientRect();
          units.push({ top: y(r.top), bottom: y(r.bottom), pos: pos + 1 + rowOffset, ctx: 'row' });
        });
        return;
      }
      if (name !== 'paragraph') {
        const r = dom.getBoundingClientRect();
        units.push({ top: y(r.top), bottom: y(r.bottom), pos, ctx: 'block', el: dom });
        return;
      }
      const lines = lineBoxes(dom);
      if (!lines.length) {
        const r = dom.getBoundingClientRect();
        units.push({ top: y(r.top), bottom: y(r.bottom), pos, ctx: 'block', el: dom });
      } else {
        const start = pos + 1;
        const end = pos + node.nodeSize - 1;
        lines.forEach((l, i) => {
          if (i === 0) {
            units.push({ top: y(l.top), bottom: y(l.bottom), pos, ctx: 'block', el: dom });
            return;
          }
          const p = lineStart(view, l.left, l.top, l.bottom, start, end);
          if (p != null) units.push({ top: y(l.top), bottom: y(l.bottom), pos: p, ctx: 'inline' });
        });
      }
      // Forced page breaks inside the paragraph.
      node.forEach((child, childOffset) => {
        if (child.type.name !== 'pageBreak') return;
        const el = view.nodeDOM(pos + 1 + childOffset) as HTMLElement | null;
        if (!el?.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        units.push({ top: y(r.bottom), bottom: y(r.bottom), pos: pos + 1 + childOffset + 1, ctx: 'inline', forced: true });
      });
    });
  };
  visit(view.state.doc, 0);
  // Forced breaks were appended per paragraph; keep document order.
  units.sort((a, b) => a.top - b.top || a.pos - b.pos);
  return units;
}

function computeBreaks(view: EditorView, g: PageGeometry): { breaks: Break[]; pages: number } {
  const root = view.dom as HTMLElement;
  const rect = root.getBoundingClientRect();
  const scale = rect.width / (root.offsetWidth || rect.width || 1) || 1;
  const units = collectUnits(view, scale, rect.top);
  const H = contentHeight(g);
  const stride = g.pageHeight + g.gap;
  const breaks: Break[] = [];
  let shift = 0;
  let k = 0;
  let lastBottom = 0;
  for (const u of units) {
    const top = u.top + shift;
    const bottom = u.bottom + shift;
    const pageTop = k * stride;
    const pageBottom = pageTop + H;
    const nextTop = (k + 1) * stride;
    if (u.forced) {
      if (top > pageTop + 0.5) {
        breaks.push({ pos: u.pos, height: Math.max(0, nextTop - top), ctx: u.ctx, page: k + 1 });
        shift += nextTop - top;
        k++;
      }
      continue;
    }
    if (bottom > pageBottom + 0.5 && top > pageTop + 1) {
      const delta = nextTop - top;
      let height = delta;
      if (u.ctx === 'block' && u.el) {
        // Between blocks the spacer stops the two margins from collapsing
        // (gap becomes mb + h + mt instead of max(mb, mt)): compensate so the
        // block's border lands exactly at the top of the next sheet.
        const mt = parseFloat(getComputedStyle(u.el).marginTop) || 0;
        const prev = u.el.previousElementSibling as HTMLElement | null;
        const mb = prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0;
        height = Math.max(0, delta - Math.min(mb, mt));
      }
      breaks.push({ pos: u.pos, height, ctx: u.ctx, page: k + 1 });
      shift += delta;
      k++;
    }
    // A unit taller than a page spills over; count the pages it covers.
    const b = u.bottom + shift;
    while (b > k * stride + H + 0.5 && u.bottom - u.top > H) k++;
    lastBottom = Math.max(lastBottom, b);
  }
  const pages = Math.max(k + 1, Math.ceil((lastBottom + 0.01) / stride) || 1);
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

export const Pagination = Extension.create<object, PaginationStorage>({
  name: 'pagination',

  addStorage() {
    return {
      enabled: true,
      geometry: { pageHeight: 1056, marginTop: 96, marginBottom: 96, gap: 24 },
      pages: 1,
      listeners: new Set(),
      relayout: () => {},
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
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
          const publish = (pages: number) => {
            if (pages === storage.pages) return;
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
              publish(1);
              return;
            }
            // Keep the scroll height while spacers are out, so the viewport does not jump.
            root.style.minHeight = `${root.offsetHeight}px`;
            if (hadBreaks) view.dispatch(view.state.tr.setMeta(paginationKey, []).setMeta('addToHistory', false));
            const { breaks, pages } = computeBreaks(view, storage.geometry);
            if (breaks.length) view.dispatch(view.state.tr.setMeta(paginationKey, breaks).setMeta('addToHistory', false));
            const g = storage.geometry;
            root.style.minHeight = `${(pages - 1) * (g.pageHeight + g.gap) + contentHeight(g)}px`;
            publish(pages);
          };
          const schedule = (delay = 60) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (!frame) frame = requestAnimationFrame(layout);
            }, delay);
          };
          storage.relayout = () => schedule(0);
          const ro = new ResizeObserver(() => schedule(30));
          ro.observe(view.dom);
          const onLoad = (e: Event) => {
            if ((e.target as HTMLElement).tagName === 'IMG') schedule(0);
          };
          view.dom.addEventListener('load', onLoad, true);
          document.fonts?.ready.then(() => schedule(0));
          schedule(0);
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              destroyed = true;
              ro.disconnect();
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
