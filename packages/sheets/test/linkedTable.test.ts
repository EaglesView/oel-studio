import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SheetDoc } from '../src/model/ydoc';
import { rangeAsTable } from '../src/model/linkedTable';
import { DEFAULT_STYLE } from '../src/model/types';

/** A workbook as sessions seed it: style 0 is the default, so new styles get real ids. */
const seeded = (name: string) => {
  const d = new SheetDoc(new Y.Doc());
  d.seed({ sheets: [{ id: 'xl/worksheets/sheet1.xml', name, cells: [] }], styles: [DEFAULT_STYLE], baseStyles: 1, source: 'new' } as never);
  return { d, s: d.sheetIds()[0]! };
};

describe('rangeAsTable (plan I-4)', () => {
  it('reads values, formats, merges, and skips hidden rows', () => {
    const { d, s } = seeded('Budget');
    const put = (r: number, c: number, v: string) => d.setInput(s, r, c, v);
    put(0, 0, 'Poste'); put(0, 1, 'T1'); put(0, 2, 'T2');
    put(1, 0, 'Salaires'); put(1, 1, '182000'); put(1, 2, '184500');
    put(2, 0, 'Caché'); put(2, 1, '1'); put(2, 2, '2');
    put(3, 0, 'Total'); put(3, 1, '182001');
    d.formatRange(s, { r0: 0, c0: 0, r1: 0, c1: 2 }, (st) => ({ ...st, font: { ...st.font, bold: true } }));
    d.setRowMeta(s, 2, 2, { hidden: true });
    d.setMerges(s, [{ r0: 3, c0: 1, r1: 3, c1: 2 }]);
    const shown = (r: number, c: number) => {
      const t = d.inputText(s, r, c);
      return t ? { text: t, ...(/^\d+$/.test(t) ? { num: Number(t) } : {}) } : undefined;
    };
    const t = rangeAsTable(d, s, { r0: 0, c0: 0, r1: 3, c1: 2 }, shown);
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['Poste', 'T1', 'T2'],
      ['Salaires', '182000', '184500'],
      ['Total', '182001', ''],
    ]);
    expect(t.header).toBe(1);
    expect(t.rows[0]![0]!.bold).toBe(true);
    expect(t.rows[1]![1]).toMatchObject({ num: 182000, align: 'right' });
    expect(t.rows[2]![1]!.colSpan).toBe(2);
    expect(t.rows[2]![2]!.merged).toBe(true);
    expect(t.widths).toHaveLength(3);
    expect(rangeAsTable(d, s, { r0: 0, c0: 0, r1: 3, c1: 2 }, shown, true).rows).toHaveLength(4);
  });
});

describe('table → sheet (plan I-5, Figma I3)', () => {
  it('reads fr-CA numbers, keeps codes and text', async () => {
    const { frInput } = await import('../src/model/linkedTable');
    expect(frInput('1 240 000 $')).toEqual({ input: '1240000', fmt: '#,##0 $' });
    expect(frInput('1 240 000,50 $')).toEqual({ input: '1240000.5', fmt: '#,##0.00 $' });
    expect(frInput('18 %')).toEqual({ input: '0.18', fmt: '0%' });
    expect(frInput('18,5 %').fmt).toBe('0.0%');
    expect(frInput('1 234,5')).toEqual({ input: '1234.5', fmt: '#,##0.0' });
    expect(frInput('48200')).toEqual({ input: '48200' });
    expect(frInput('007')).toEqual({ input: '007' });
    expect(frInput('Québec')).toEqual({ input: 'Québec' });
  });
  it('writes values, styles and merges, then reads back the same table', async () => {
    const { writeTable } = await import('../src/model/linkedTable');
    const { d, s } = seeded('Tableau 1');
    const r = writeTable(d, s, { r: 0, c: 0 }, {
      rows: [
        [{ text: 'Région', bold: true }, { text: 'Revenus', bold: true }],
        [{ text: 'Québec' }, { text: '1 240 000 $', fill: '#FFF4D6' }],
        [{ text: 'Total', colSpan: 2 }, { text: '', merged: true }],
      ],
      widths: [80, 80],
      header: 1,
    });
    expect(r).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 });
    expect(d.inputText(s, 1, 1)).not.toBe('');
    expect(d.style(d.getCell(s, 1, 1)!.s!).numFmt).toBe('#,##0 $');
    expect(d.style(d.getCell(s, 1, 1)!.s!).fill?.css).toBe('#FFF4D6');
    expect(d.style(d.getCell(s, 0, 0)!.s!).font.bold).toBe(true);
    expect(d.merges(s)).toEqual([{ r0: 2, c0: 0, r1: 2, c1: 1 }]);
  });
});
