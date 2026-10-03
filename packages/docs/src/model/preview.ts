import type { AnchorAttrs, PMDoc, PMNode } from './types';
import type * as Y from 'yjs';
import { BODY, countWords, fragmentJSON, meta, plainText, sectionsById } from './ydoc';
import { sectionBreaks, sectionOrder } from './sections';

/** Same shape as `@oel/engine`'s document Preview (kept structural to avoid a dependency). */
export interface DocumentPreview {
  kind: 'document';
  blocks: Array<{ type: 'heading' | 'paragraph'; text: string }>;
  pageCount?: number;
  wordCount?: number;
  /** First page size, twips: the desk paper takes its shape. */
  page?: { width: number; height: number };
  /** First page colour (page background, or a behind-text shape covering most of it). */
  background?: string;
}

/**
 * The colour a reader sees behind page 1: a solid behind-text shape of the
 * first section covering at least half the page (a cover), else the page colour.
 */
export function firstPageBackground(doc: PMDoc, page: { width: number; height: number } | undefined, pageColour: string | null): string | undefined {
  const area = page ? page.width * page.height * 635 * 635 : 0;
  let found: string | undefined;
  const visit = (n: PMNode): boolean => {
    if (found) return false;
    if (n.type === 'anchor') {
      const a = n.attrs as unknown as AnchorAttrs;
      const fill = a.shape?.fill;
      if (a.behindDoc && fill && !fill.includes('gradient') && area && a.cx * a.cy >= area / 2) found = fill;
      return true;
    }
    for (const c of n.content ?? []) visit(c);
    // Stop at the end of the first section.
    return !(n.type === 'paragraph' && n.attrs?.section);
  };
  for (const n of doc.content ?? []) if (!visit(n)) break;
  return found ?? pageColour ?? undefined;
}

/** Desk thumbnail content: the first blocks of the document as text. */
export function toPreview(doc: PMDoc, pageCount?: number, limit = 40, page?: { width: number; height: number }, pageColour: string | null = null): DocumentPreview {
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
  const background = firstPageBackground(doc, page, pageColour);
  return { kind: 'document', blocks, wordCount, pageCount: pageCount ?? Math.max(1, Math.ceil(wordCount / 450)), ...(page ? { page } : {}), ...(background ? { background } : {}) };
}

/** Desk preview straight from the shared document (first page size included). */
export function previewFromYDoc(ydoc: Y.Doc, pageCount?: number): DocumentPreview {
  const doc = fragmentJSON(ydoc.getXmlFragment(BODY));
  const first = sectionOrder(sectionBreaks(doc), sectionsById(ydoc))[0];
  return toPreview(doc, pageCount, 40, first ? { width: first.page.width, height: first.page.height } : undefined, (meta(ydoc).get('background') as string | null | undefined) ?? null);
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
