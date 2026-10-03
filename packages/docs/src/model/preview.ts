import type { PMDoc, PMNode } from './types';
import type * as Y from 'yjs';
import { BODY, countWords, fragmentJSON, plainText, sectionsById } from './ydoc';
import { sectionBreaks, sectionOrder } from './sections';

/** Same shape as `@oel/engine`'s document Preview (kept structural to avoid a dependency). */
export interface DocumentPreview {
  kind: 'document';
  blocks: Array<{ type: 'heading' | 'paragraph'; text: string }>;
  pageCount?: number;
  wordCount?: number;
  /** First page size, twips: the desk paper takes its shape. */
  page?: { width: number; height: number };
}

/** Desk thumbnail content: the first blocks of the document as text. */
export function toPreview(doc: PMDoc, pageCount?: number, limit = 40, page?: { width: number; height: number }): DocumentPreview {
  const blocks: DocumentPreview['blocks'] = [];
  const visit = (n: PMNode) => {
    if (blocks.length >= limit) return;
    if (n.type === 'paragraph') {
      const text = plainText(n).replace(/\s+/g, ' ').trim();
      blocks.push({ type: n.attrs?.outline != null ? 'heading' : 'paragraph', text });
      return;
    }
    for (const c of n.content ?? []) visit(c);
  };
  visit(doc);
  const wordCount = countWords(plainText(doc));
  return { kind: 'document', blocks, wordCount, pageCount: pageCount ?? Math.max(1, Math.ceil(wordCount / 450)), ...(page ? { page } : {}) };
}

/** Desk preview straight from the shared document (first page size included). */
export function previewFromYDoc(ydoc: Y.Doc, pageCount?: number): DocumentPreview {
  const doc = fragmentJSON(ydoc.getXmlFragment(BODY));
  const first = sectionOrder(sectionBreaks(doc), sectionsById(ydoc))[0];
  return toPreview(doc, pageCount, 40, first ? { width: first.page.width, height: first.page.height } : undefined);
}

/** A document from the preview engine's blocks (papers created before the codec existed). */
export function docFromPreview(blocks: DocumentPreview['blocks']): PMDoc {
  const content: PMNode[] = blocks.map((b) => ({
    type: 'paragraph',
    attrs: b.type === 'heading' ? { styleId: 'Heading1', outline: 0 } : {},
    content: b.text ? [{ type: 'text', text: b.text }] : undefined,
  }));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
