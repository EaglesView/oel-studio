// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docsSchema } from '../src/extensions';
import { chartOf, insertChartParagraph, setChart } from '../src/model/charts';
import { exportJsonFromYDoc, seedYDoc } from '../src/model/ydoc';
import { blankDocxJson } from '../src/model/blank';
import type { ChartSpec } from '@oel/engine/generated/oelchart';

const spec = (n: number): ChartSpec => ({ groups: [{ kind: 'bar', series: [{ idx: 0, order: 0, val: { num: [n] } }] }] }) as unknown as ChartSpec;

describe('linked charts in the Y.Doc', () => {
  it('inserts a chart paragraph the schema accepts, and updates it in place', () => {
    const schema = docsSchema();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, blankDocxJson(), schema);
    insertChartParagraph(ydoc, 'c1', spec(1), 'end', 'test');
    expect(chartOf(ydoc, 'c1')).toEqual(spec(1));
    expect(setChart(ydoc, 'c1', spec(2), 'test')).toBe(true);
    expect(chartOf(ydoc, 'c1')).toEqual(spec(2));
    expect(setChart(ydoc, 'nope', spec(2), 'test')).toBe(false);
    const json = exportJsonFromYDoc(ydoc);
    const doc = schema.nodeFromJSON(json.doc);
    let found: Record<string, unknown> | null = null;
    doc.descendants((n) => {
      if (n.type.name === 'ooxmlInline' && n.attrs.oid === 'c1') found = n.attrs;
    });
    expect(found).toMatchObject({ oid: 'c1', cx: 5_400_000, floating: false, chart: spec(2) });
  });
});

describe('copying a linked chart in the editor', () => {
  it('gives the pasted chart its own id and its own link to the same source', async () => {
    const { Editor } = await import('@tiptap/core');
    const { Slice } = await import('@tiptap/pm/model');
    const { docsExtensions } = await import('../src/extensions');
    const { linksOf } = await import('@oel/links');
    const schema = docsSchema();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, blankDocxJson(), schema);
    insertChartParagraph(ydoc, 'c1', spec(1), 'end', 'test');
    linksOf(ydoc).put({
      id: 'l1',
      source: { docId: 'budget', kind: 'spreadsheet', ref: { kind: 'chart', sheetId: 's', chartId: 'g' }, title: 'Budget', label: 'Dépenses' },
      target: { objectId: 'c1', label: '§ 2' },
      carries: 'chart',
      mode: 'manual',
      snapshot: { rev: 'r', at: 1, by: 'JB' },
    });
    const editor = new Editor({ element: document.createElement('div'), extensions: docsExtensions({ fragment: ydoc.getXmlFragment('body'), pagination: false }) });
    try {
      let chartPos = -1;
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === 'ooxmlInline' && n.attrs.oid === 'c1') chartPos = pos;
      });
      expect(chartPos).toBeGreaterThanOrEqual(0);
      const slice = editor.state.doc.slice(chartPos, chartPos + 1);
      let pasted: InstanceType<typeof Slice> | null = null;
      editor.view.someProp('transformPasted', (f) => {
        pasted = f(slice, editor.view, false);
      });
      let oid: string | null = null;
      pasted!.content.descendants((n) => {
        if (n.type.name === 'ooxmlInline') oid = n.attrs.oid as string;
      });
      expect(oid).toBeTruthy();
      expect(oid).not.toBe('c1');
      const copy = linksOf(ydoc).byObject(oid!);
      expect(copy).toMatchObject({ mode: 'manual', source: { docId: 'budget' } });
      expect(copy!.id).not.toBe('l1');
      expect(linksOf(ydoc).get('l1')?.target.objectId).toBe('c1');
    } finally {
      editor.destroy();
    }
  });
});
