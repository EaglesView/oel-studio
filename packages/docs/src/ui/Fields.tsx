import { useLayoutEffect, useRef } from 'react';

export interface FieldValues {
  page: string;
  pages: number;
  sectionPages: number;
}

/** Fill PAGE / NUMPAGES / SECTIONPAGES fields inside a static header or footer. */
export function Fields({ html, values, className }: { html: string; values: FieldValues; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const value = (field: string | undefined) =>
      field === 'PAGE' ? values.page : field === 'NUMPAGES' ? String(values.pages) : field === 'SECTIONPAGES' ? String(values.sectionPages) : null;
    // Simple fields (w:fldSimple) render as one element.
    root.querySelectorAll<HTMLElement>('[data-field]:not([data-hidden])').forEach((el) => {
      const v = value(el.dataset.field);
      if (v != null) el.textContent = v;
    });
    // Complex fields: begin … instrText … separate [cached result] end. Replace the cached result.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let field: string | null = null;
    let inResult = false;
    let first = true;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof HTMLElement && n.dataset.ooxml) {
        const xml = n.dataset.ooxml;
        if (n.dataset.field) field = n.dataset.field;
        if (xml.includes('fldCharType="separate"')) {
          inResult = value(field ?? undefined) != null;
          first = true;
        } else if (xml.includes('fldCharType="end"')) {
          inResult = false;
          field = null;
        }
        continue;
      }
      if (inResult && n.nodeType === Node.TEXT_NODE && !n.parentElement?.closest('[data-ooxml]')) {
        n.textContent = first ? value(field ?? undefined)! : '';
        first = false;
      }
    }
  }, [html, values.page, values.pages, values.sectionPages]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

