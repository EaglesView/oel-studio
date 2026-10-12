/**
 * Printing what the page view shows (Ctrl+P): one printed page per laid-out
 * sheet, each at its section's size (a named `@page` per size), with its
 * background, behind/in-front objects, header and footer, and the body
 * blocks that fall on it, placed where pagination put them.
 *
 * Printing happens in this document (not an iframe) so the document styles
 * and the fonts registered with the FontFace API (substitutes, embedded
 * faces) apply.
 */
import type { Editor } from '@tiptap/core';
import type { PageInfo } from '../model/sections';

const pageName = (p: PageInfo) => `oel${Math.round(p.width)}x${Math.round(p.height)}`;

/** Print the paginated document; false when pagination is off (the caller falls back to a flow print). */
export function printPages(editor: Editor, title: string): boolean {
  const st = editor.storage.pagination;
  const body = editor.view.dom as HTMLElement;
  const inner = body.closest('.oel-pages__inner') as HTMLElement | null;
  const pages = st.pages;
  if (!st.enabled || !inner || !pages.length) return false;

  const rect = body.getBoundingClientRect();
  const scale = rect.width / (body.offsetWidth || 1) || 1;
  const origin = pages[0]!.margins.top;
  const frame = st.layout.frame;

  // Note calls are numbered by CSS counters, which would restart in every page window: freeze them.
  const counts: Record<string, number> = {};
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('.oel-noteref'))) {
    const kind = el.dataset.kind ?? 'footnote';
    counts[kind] = (counts[kind] ?? 0) + 1;
    el.dataset.printN = kind === 'endnote' ? roman(counts[kind]!) : String(counts[kind]);
  }

  const blocks = Array.from(body.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('oel-pgap'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: (r.top - rect.top) / scale, bottom: (r.bottom - rect.top) / scale, left: (r.left - rect.left) / scale, width: r.width / scale };
    });
  const sheets = Array.from(inner.querySelectorAll<HTMLElement>(':scope > .oel-pagestack > .oel-sheet'));
  const fronts = Array.from(inner.querySelectorAll<HTMLElement>(':scope > .oel-anchors-front > .oel-anchors-front__sheet'));

  const root = document.createElement('div');
  root.className = 'oel-print';
  pages.forEach((p, k) => {
    const page = document.createElement('div');
    page.className = 'oel-print__page';
    page.style.cssText = `width:${p.width}px;height:${p.height}px;page:${pageName(p)}`;
    const place = (el: HTMLElement | undefined) => {
      if (!el) return;
      const c = el.cloneNode(true) as HTMLElement;
      c.style.top = '0';
      c.style.left = '0';
      page.append(c);
    };
    place(sheets[k]);
    const top = p.top + p.margins.top - origin;
    const bottom = p.top + p.height - p.margins.bottom - origin;
    const win = document.createElement('div');
    win.className = 'oel-print__text oel-doc';
    win.style.cssText = `top:${p.margins.top}px;height:${bottom - top}px`;
    for (const b of blocks) {
      if (b.bottom <= top + 0.5 || b.top >= bottom - 0.5) continue;
      const c = b.el.cloneNode(true) as HTMLElement;
      c.style.position = 'absolute';
      c.style.top = `${b.top - top}px`;
      c.style.left = `${b.left + frame.textLeft - p.sheetLeft}px`;
      c.style.width = `${b.width}px`;
      c.style.margin = '0';
      c.style.boxSizing = 'border-box';
      win.append(c);
    }
    page.append(win);
    place(fronts[k]);
    root.append(page);
  });

  const sizes = new Map(pages.map((p) => [pageName(p), p]));
  const style = document.createElement('style');
  style.textContent = [
    ...[...sizes].map(([name, p]) => `@page ${name} { size: ${p.width}px ${p.height}px; margin: 0; }`),
    '@media screen { .oel-print { display: none; } }',
    '@media print { body > :not(.oel-print) { display: none !important; } html, body { margin: 0 !important; padding: 0 !important; background: none !important; } }',
  ].join('\n');

  const previousTitle = document.title;
  document.title = title;
  document.head.append(style);
  document.body.append(root);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    root.remove();
    style.remove();
    document.title = previousTitle;
    for (const el of Array.from(body.querySelectorAll<HTMLElement>('[data-print-n]'))) delete el.dataset.printN;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Let images in the clones decode before the print dialog snapshots the page.
  requestAnimationFrame(() => {
    window.print();
    setTimeout(cleanup, 60_000);
  });
  return true;
}

function roman(n: number): string {
  return ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n - 1] ?? String(n);
}
