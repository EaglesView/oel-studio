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

describe('values in a linked table are read-only, style is not (I6 §2)', () => {
  it('refuses typing and row changes inside, allows marks, attributes and deleting the table', async () => {
    const { yXmlFragmentToProseMirrorRootNode } = await import('@tiptap/y-tiptap');
    const { docsSchema, linkedTableGuard } = await import('../src/extensions');
    const { BODY } = await import('../src/model/ydoc');
    const { EditorState, TextSelection } = await import('@tiptap/pm/state');
    const { setLinkHost } = await import('@oel/links');
    setLinkHost({
      state: () => 'fresh', manage: () => {}, update: () => {}, unlink: () => {}, openSource: () => true, setCarries: () => {}, fileTitle: () => null, setLinkOptions: () => {}, recordTableEdit: () => {}, sendTableToSheet: () => false,
      subscribe: () => () => {},
      copyOf: (oid) => (oid === 't1' ? { linkId: 'l1', source: 'Budget 2027', state: 'fresh', frozen: false, carries: 'table' } : null),
    });
    const ydoc = new Y.Doc();
    insertLinkedTable(ydoc, 't1', table('366 500'), 'source', 'end', 'person');
    const schema = docsSchema();
    const doc = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(BODY), schema);
    const refusedEdits: string[] = [];
    let state = EditorState.create({ doc, schema, plugins: [linkedTableGuard((d) => refusedEdits.push(d.source))] });
    // Position inside the first cell's text.
    let inCell = -1;
    state.doc.descendants((n, pos) => {
      if (inCell < 0 && n.isText && n.text === 'Poste') inCell = pos + 1;
    });
    const typed = state.apply(state.tr.insertText('X', inCell));
    expect(typed).toBe(state);
    expect(refusedEdits).toEqual(['Budget 2027']);
    // Bold on a cell's text: style, allowed.
    const bolded = state.apply(state.tr.addMark(inCell, inCell + 3, schema.marks.italic!.create()));
    expect(bolded).not.toBe(state);
    // A cell fill (attribute change): allowed.
    let cellPos = -1;
    state.doc.descendants((n, pos) => void (cellPos < 0 && n.type.name === 'tableCell' && (cellPos = pos)));
    const filled = state.apply(state.tr.setNodeMarkup(cellPos, undefined, { ...state.doc.nodeAt(cellPos)!.attrs, background: '#FFEEAA' }));
    expect(filled).not.toBe(state);
    // Deleting the whole table: allowed.
    let tablePos = -1;
    state.doc.descendants((n, pos) => void (tablePos < 0 && n.type.name === 'table' && (tablePos = pos)));
    const gone = state.apply(state.tr.delete(tablePos, tablePos + state.doc.nodeAt(tablePos)!.nodeSize));
    expect(gone).not.toBe(state);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    setLinkHost(null);
  });
});

describe('style changes on a linked table become local edits (I6 §1)', () => {
  it('reports cell fills and bold by row and grid column, and keeps local fills under the document theme', async () => {
    const { yXmlFragmentToProseMirrorRootNode } = await import('@tiptap/y-tiptap');
    const { docsSchema, linkedTableStyleChanges } = await import('../src/extensions');
    const { BODY } = await import('../src/model/ydoc');
    const { EditorState } = await import('@tiptap/pm/state');
    const { setLinkHost } = await import('@oel/links');
    setLinkHost({
      state: () => 'fresh', manage: () => {}, update: () => {}, unlink: () => {}, openSource: () => true, setCarries: () => {}, fileTitle: () => null, setLinkOptions: () => {}, recordTableEdit: () => {}, sendTableToSheet: () => false,
      subscribe: () => () => {},
      copyOf: (oid) => (oid === 't1' ? { linkId: 'l1', source: 'Budget 2027', state: 'fresh', frozen: false, carries: 'table' } : null),
    });
    const ydoc = new Y.Doc();
    insertLinkedTable(ydoc, 't1', table('366 500'), 'source', 'end', 'person');
    const schema = docsSchema();
    const state = EditorState.create({ doc: yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(BODY), schema), schema });
    // Row 2 ('Total'), its second cell spans two columns: grid column 1.
    let pos = -1;
    let seen = 0;
    state.doc.descendants((n, p) => void (n.type.name === 'tableCell' && seen++ === 7 && (pos = p)));
    let tr = state.tr.setNodeMarkup(pos, undefined, { ...state.doc.nodeAt(pos)!.attrs, background: '#FFEEAA' });
    const cell = tr.doc.nodeAt(pos)!;
    tr = tr.addMark(pos + 2, pos + cell.nodeSize - 2, schema.marks.bold!.create());
    const changes = linkedTableStyleChanges(state.doc, tr.doc);
    expect(changes).toEqual(
      expect.arrayContaining([
        { linkId: 'l1', r: 2, c: 1, prop: 'fill', value: '#FFEEAA' },
        { linkId: 'l1', r: 2, c: 1, prop: 'bold', value: true },
      ]),
    );
    setLinkHost(null);
    // Refreshed under the document's theme, the local fill stays.
    const withIds = { ...table('370 000'), rowIds: ['a', 'b', 'c'], colIds: ['x', 'y', 'z'] };
    setLinkedTable(ydoc, 't1', withIds, 'target', 'link', [{ id: 'c:y:fill', label: '', at: 1, by: 'JB', patch: { kind: 'cell-style', row: 'c', col: 'y', prop: 'fill', value: '#FFEEAA' } }]);
    const td = ((findLinkedTable(ydoc, 't1')!.toArray()[2] as Y.XmlElement).toArray()[1] as Y.XmlElement).getAttribute('background');
    expect(td).toBe('#FFEEAA');
  });
});

describe('a document table read for « Envoyer vers un tableur… » (Figma I3)', () => {
  it('keeps text, styles and spans, and counts what won’t survive', async () => {
    const { yXmlFragmentToProseMirrorRootNode } = await import('@tiptap/y-tiptap');
    const { docsSchema, tableAsLinked } = await import('../src/extensions');
    const { BODY } = await import('../src/model/ydoc');
    const ydoc = new Y.Doc();
    insertLinkedTable(ydoc, 't1', table('366 500'), 'source', 'end', 'person');
    const doc = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(BODY), docsSchema());
    let node = doc.firstChild!;
    doc.descendants((n) => void (n.type.name === 'table' && (node = n)));
    const { table: t, lossy, nested } = tableAsLinked(node);
    expect(nested).toBe(false);
    expect(lossy).toBe(0);
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([['Poste', 'T1', 'T2'], ['Salaires', '182 000', '184 500'], ['Total', '366 500', '']]);
    expect(t.rows[2]![1]!.colSpan).toBe(2);
    expect(t.rows[2]![2]!.merged).toBe(true);
    expect(t.rows[0]![0]!.bold).toBe(true);
    expect(t.rows[1]![1]).toMatchObject({ fill: '#FFF4D6', align: 'right' });
    expect(t.header).toBe(1);
    expect(t.widths).toEqual([80, 60, 60]);
  });
});
