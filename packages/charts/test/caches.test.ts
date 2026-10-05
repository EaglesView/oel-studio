import { describe, expect, it } from 'vitest';
import { cellResolver, chartName, keepLook, withCaches, type ChartSpec } from '../src';

const cells: Record<string, string | number> = { A2: 'Jan', A3: 'Fév', B1: 'Montant', B2: 1200, B3: 4500 };
const resolve = cellResolver({
  num: (_s, r, c) => {
    const v = cells[`${'AB'[c]}${r + 1}`];
    return typeof v === 'number' ? v : null;
  },
  text: (_s, r, c) => {
    const v = cells[`${'AB'[c]}${r + 1}`];
    return v == null ? null : String(v);
  },
});

const spec: ChartSpec = {
  groups: [{ kind: 'bar', series: [{ idx: 0, order: 0, nameRef: 'Budget!$B$1', name: 'Ancien', cat: { f: 'Budget!$A$2:$A$3', str: ['x'] }, val: { f: 'Budget!$B$2:$B$3', num: [1] } }] }],
} as ChartSpec;

describe('withCaches', () => {
  it('fills names, categories and values from the cells, keeping the references', () => {
    const out = withCaches(spec, resolve);
    const s = out.groups[0]!.series[0]!;
    expect(s.name).toBe('Montant');
    expect(s.cat).toMatchObject({ f: 'Budget!$A$2:$A$3', str: ['Jan', 'Fév'], count: 2 });
    expect(s.val).toMatchObject({ f: 'Budget!$B$2:$B$3', num: [1200, 4500], count: 2 });
    expect(chartName(out)).toBe('Montant');
    expect(chartName({ ...out, title: { text: 'Dépenses par mois' } })).toBe('Dépenses par mois');
  });
});

describe('keepLook', () => {
  it('takes data from the source and the look from the copy', () => {
    const copy = { ...spec, palette: ['#111111'], legend: { pos: 'r' }, groups: [{ ...spec.groups[0]!, series: [{ ...spec.groups[0]!.series[0]!, shape: { fill: { kind: 'solid', color: '#ff0000' } } }] }] } as unknown as ChartSpec;
    const source = withCaches(spec, resolve);
    const out = keepLook(copy, source);
    expect(out.palette).toEqual(['#111111']);
    expect(out.legend).toEqual({ pos: 'r' });
    expect(out.groups[0]!.series[0]!.val?.num).toEqual([1200, 4500]);
    expect(out.groups[0]!.series[0]!.shape).toEqual(copy.groups[0]!.series[0]!.shape);
    expect(keepLook(null, source)).toBe(source);
  });
});
