/**
 * Linked tables (`@oel/links`, plan I-4, Figma I2): a real table node with an
 * `oid`, built straight into the Y.Doc from a `LinkedTable`, so a copy can be
 * placed or refreshed while the document is closed. Values come from the
 * sheet; with the `source` theme so do fonts, colours and fills, with the
 * `target` theme the table wears the document's look (bold and italics stay:
 * they are part of what the cells say).
 */
import * as Y from 'yjs';
import type { LinkedTable, LinkTheme } from '@oel/links';
import { BODY } from './ydoc';

const PX_PER_PT = 96 / 72;
const TWIPS_PER_PT = 20;

function cellText(text: string, c: LinkedTable['rows'][number][number], theme: LinkTheme, font?: LinkedTable['font']): Y.XmlText {
  const t = new Y.XmlText();
  if (!text) return t;
  const marks: Record<string, unknown> = {};
  if (c.bold) marks.bold = {};
  if (c.italic) marks.italic = {};
  if (theme === 'source') {
    const style: Record<string, unknown> = {};
    if (c.color) style.color = c.color;
    if (font?.family) style.fontFamily = font.family;
    if (font?.size) style.fontSize = `${font.size}pt`;
    if (Object.keys(style).length) marks.textStyle = style;
  }
  t.insert(0, text, marks);
  return t;
}

function rows(table: LinkedTable, theme: LinkTheme): Y.XmlElement[] {
  const widthsPx = table.widths.map((w) => Math.round(w * PX_PER_PT));
  return table.rows.map((row, ri) => {
    const tr = new Y.XmlElement('tableRow');
    tr.setAttribute('header', (ri < table.header) as unknown as string);
    let col = 0;
    const cells: Y.XmlElement[] = [];
    for (const c of row) {
      const span = c.colSpan ?? 1;
      if (!c.merged) {
        const td = new Y.XmlElement('tableCell');
        td.setAttribute('colspan', span as unknown as string);
        td.setAttribute('rowspan', (c.rowSpan ?? 1) as unknown as string);
        td.setAttribute('colwidth', widthsPx.slice(col, col + span) as unknown as string);
        if (theme === 'source' && c.fill) td.setAttribute('background', c.fill);
        const p = new Y.XmlElement('paragraph');
        if (c.align && c.align !== 'left') p.setAttribute('align', c.align);
        p.insert(0, [cellText(c.text, c, theme, table.font)]);
        td.insert(0, [p]);
        cells.push(td);
      }
      col += c.merged ? 1 : span;
    }
    tr.insert(0, cells);
    return tr;
  });
}

function setGrid(el: Y.XmlElement, table: LinkedTable) {
  el.setAttribute('grid', table.widths.map((w) => Math.round(w * TWIPS_PER_PT)) as unknown as string);
}

/** Add a linked table at the start or the end of the body, with an empty paragraph after it for the caret. */
export function insertLinkedTable(ydoc: Y.Doc, oid: string, table: LinkedTable, theme: LinkTheme, where: 'start' | 'end', origin: unknown) {
  const body = ydoc.getXmlFragment(BODY);
  ydoc.transact(() => {
    const el = new Y.XmlElement('table');
    el.setAttribute('oid', oid);
    setGrid(el, table);
    el.insert(0, rows(table, theme));
    const after = new Y.XmlElement('paragraph');
    body.insert(where === 'start' ? 0 : body.length, [el, after]);
  }, origin);
}

/** The table node with this `oid`, anywhere in the body. */
export function findLinkedTable(ydoc: Y.Doc, oid: string): Y.XmlElement | null {
  const walk = (n: Y.XmlFragment | Y.XmlElement): Y.XmlElement | null => {
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'table' && c.getAttribute('oid') === oid) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(ydoc.getXmlFragment(BODY));
}

/** Refresh a linked table's rows from the source (the table node itself, and its place, stay). */
export function setLinkedTable(ydoc: Y.Doc, oid: string, table: LinkedTable, theme: LinkTheme, origin: unknown): boolean {
  const el = findLinkedTable(ydoc, oid);
  if (!el) return false;
  ydoc.transact(() => {
    setGrid(el, table);
    el.delete(0, el.length);
    el.insert(0, rows(table, theme));
  }, origin);
  return true;
}

/** The text of a linked table's cells, row by row (what the copy shows now). */
export function linkedTableText(ydoc: Y.Doc, oid: string): string[][] | null {
  const el = findLinkedTable(ydoc, oid);
  if (!el) return null;
  const plain = (t: Y.XmlText | undefined) => (t ? (t.toDelta() as Array<{ insert: unknown }>).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('') : '');
  return el.toArray().map((tr) => (tr as Y.XmlElement).toArray().map((td) => (td as Y.XmlElement).toArray().map((p) => plain((p as Y.XmlElement).toArray()[0] as Y.XmlText | undefined)).join('\n')));
}
