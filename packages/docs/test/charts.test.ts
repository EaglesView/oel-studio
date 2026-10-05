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
