/**
 * Pictures made by links (`@oel/links`, plan I-3): an `image` node with an
 * `oid`, written straight into the Y.Doc so a copy can be placed or updated
 * while the document is closed, like linked charts (`charts.ts`).
 */
import * as Y from 'yjs';
import { BODY } from './ydoc';

export interface PictureAttrs {
  /** Package path of the bytes (`word/media/…`), from `DocSession.addImage`. */
  path: string;
  /** Size, EMU. */
  cx: number;
  cy: number;
  alt?: string;
}

function pictureNode(oid: string, a: PictureAttrs): Y.XmlElement {
  const el = new Y.XmlElement('image');
  el.setAttribute('src', `media:${a.path}`);
  el.setAttribute('path', a.path);
  el.setAttribute('cx', a.cx as unknown as string);
  el.setAttribute('cy', a.cy as unknown as string);
  el.setAttribute('alt', a.alt ?? '');
  el.setAttribute('title', '');
  el.setAttribute('floating', false as unknown as string);
  el.setAttribute('oid', oid);
  return el;
}

/** Add a picture in its own paragraph at the start or the end of the body. */
export function insertPictureParagraph(ydoc: Y.Doc, oid: string, a: PictureAttrs, where: 'start' | 'end', origin: unknown) {
  const body = ydoc.getXmlFragment(BODY);
  ydoc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [pictureNode(oid, a)]);
    body.insert(where === 'start' ? 0 : body.length, [p]);
  }, origin);
}

/** The picture node with this `oid`, anywhere in the body. */
export function findPicture(ydoc: Y.Doc, oid: string): Y.XmlElement | null {
  const walk = (n: Y.XmlFragment | Y.XmlElement): Y.XmlElement | null => {
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'image' && c.getAttribute('oid') === oid) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(ydoc.getXmlFragment(BODY));
}

export function pictureOf(ydoc: Y.Doc, oid: string): PictureAttrs | null {
  const el = findPicture(ydoc, oid);
  if (!el) return null;
  return { path: el.getAttribute('path') as string, cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')), alt: (el.getAttribute('alt') as string) ?? '' };
}

/**
 * Point a linked picture at new bytes. The copy keeps its width (its own
 * size is local, Figma I1) and takes the new picture's proportions.
 */
export function setPicture(ydoc: Y.Doc, oid: string, path: string, aspect: number, origin: unknown): boolean {
  const el = findPicture(ydoc, oid);
  if (!el) return false;
  const cx = Number(el.getAttribute('cx')) || 0;
  ydoc.transact(() => {
    el.setAttribute('path', path);
    el.setAttribute('src', `media:${path}`);
    // The original run no longer matches: the writer builds the picture again.
    el.removeAttribute('xml');
    el.removeAttribute('rid');
    if (cx && aspect > 0) el.setAttribute('cy', Math.round(cx / aspect) as unknown as string);
  }, origin);
  return true;
}
