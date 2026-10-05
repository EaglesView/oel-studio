import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SheetDoc } from '../src/model/ydoc';
import { rangeAsTable } from '../src/model/linkedTable';

describe('rangeAsTable (plan I-4)', () => {
  it('reads values, formats, merges, and skips hidden rows', () => {
    const d = new SheetDoc(new Y.Doc());
    const s = d.addSheet('Budget');
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
