import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { LinkedTable } from '@oel/links';
import { findLinkedTable, insertLinkedTable, linkedTableText, setLinkedTable } from '../src/model/tables';

const table = (total: string): LinkedTable => ({
  rows: [
    [{ text: 'Poste', bold: true }, { text: 'T1', bold: true }, { text: 'T2', bold: true }],
    [{ text: 'Salaires' }, { text: '182 000', num: 182000, align: 'right', fill: '#FFF4D6' }, { text: '184 500', num: 184500, align: 'right' }],
    [{ text: 'Total', bold: true }, { text: total, colSpan: 2 }, { text: '', merged: true }],
  ],
  widths: [80, 60, 60],
  header: 1,
  font: { family: 'Calibri', size: 11 },
});

describe('linked tables in a document (plan I-4)', () => {
  it('builds a real table with spans and refreshes it in place', () => {
    const ydoc = new Y.Doc();
    insertLinkedTable(ydoc, 't1', table('366 500'), 'source', 'end', 'person');
    const el = findLinkedTable(ydoc, 't1')!;
    expect(el.getAttribute('grid')).toEqual([1600, 1200, 1200]);
    expect(linkedTableText(ydoc, 't1')).toEqual([['Poste', 'T1', 'T2'], ['Salaires', '182 000', '184 500'], ['Total', '366 500']]);
    const fill = ((el.toArray()[1] as Y.XmlElement).toArray()[1] as Y.XmlElement).getAttribute('background');
    expect(fill).toBe('#FFF4D6');
    const span = ((el.toArray()[2] as Y.XmlElement).toArray()[1] as Y.XmlElement).getAttribute('colspan');
    expect(span).toBe(2);
    expect(setLinkedTable(ydoc, 't1', table('370 000'), 'target', 'link')).toBe(true);
    expect(linkedTableText(ydoc, 't1')![2]).toEqual(['Total', '370 000']);
    // The document's theme: no fills from the sheet.
    expect(((findLinkedTable(ydoc, 't1')!.toArray()[1] as Y.XmlElement).toArray()[1] as Y.XmlElement).getAttribute('background')).toBeUndefined();
    expect(setLinkedTable(ydoc, 'gone', table('x'), 'source', 'link')).toBe(false);
  });
});

describe('linked copies load into the document schema', () => {
  it('tables and pictures built in the Y.Doc are valid ProseMirror nodes', async () => {
    const { yXmlFragmentToProseMirrorRootNode } = await import('@tiptap/y-tiptap');
    const { docsSchema } = await import('../src/extensions');
    const { insertPictureParagraph } = await import('../src/model/pictures');
    const { BODY } = await import('../src/model/ydoc');
    const ydoc = new Y.Doc();
    insertLinkedTable(ydoc, 't1', table('366 500'), 'source', 'end', 'person');
    insertPictureParagraph(ydoc, 'p1', { path: 'word/media/a.png', cx: 100, cy: 50 }, 'start', 'person');
    const doc = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(BODY), docsSchema());
    expect(() => doc.check()).not.toThrow();
    const types: string[] = [];
    doc.descendants((n) => void types.push(n.type.name));
    expect(types).toContain('table');
    expect(types).toContain('image');
    let tableOid: unknown = null;
    doc.descendants((n) => void (n.type.name === 'table' && (tableOid = n.attrs.oid)));
    expect(tableOid).toBe('t1');
    const marks = new Set<string>();
    doc.descendants((n) => void n.marks.forEach((m) => marks.add(m.type.name)));
    expect([...marks]).toEqual(expect.arrayContaining(['bold', 'textStyle']));
  });
});
