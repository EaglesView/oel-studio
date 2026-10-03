import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { SheetDoc, editText, parseInput } from '../src/model/ydoc';
import { cycleAbsolute, decodeFormula, encodeFormula, shiftFormula } from '../src/model/formula';
import type { Workbook } from '../src/model/types';

const require = createRequire(import.meta.url);
const codec = require('oelxlsx-node') as {
  xlsx_to_model(b: Uint8Array): string;
  WasmCalc: new (json: string) => { values(s: number, r0: number, c0: number, r1: number, c1: number): string; structural(op: string): void; evaluate(): string; free(): void };
};
const FIXTURE = new URL('../../../fixtures/xlsx/rich-lo.xlsx', import.meta.url);

const load = (): Workbook => JSON.parse(codec.xlsx_to_model(new Uint8Array(readFileSync(FIXTURE))));
const seeded = () => {
  const d = new SheetDoc(new Y.Doc());
  d.seed(load());
  return d;
};
/** Every computed cell's text, per sheet, from an engine built on this workbook. */
function computed(wb: Workbook): string[] {
  const calc = new codec.WasmCalc(JSON.stringify(wb));
  const out = wb.sheets.map((_, i) => (JSON.parse(calc.values(i, 0, 0, 200, 50)) as Array<{ r: number; c: number; text: string }>).map((o) => `${i}:${o.r},${o.c}=${o.text}`).join('|'));
  calc.free();
  return out;
}

describe('formula text', () => {
  it('shifts like copy/fill', () => {
    expect(shiftFormula('B2/$B$7', 1, 0)).toBe('B3/$B$7');
    expect(shiftFormula("SUM(A1:A5)+'Mon budget'!C$1", 2, 1)).toBe("SUM(B3:B7)+'Mon budget'!D$1");
    expect(shiftFormula('"A1"&LOG10(A1)&Montants', 1, 0)).toBe('"A1"&LOG10(A2)&Montants');
    expect(shiftFormula('A1', -1, 0)).toBe('#REF!');
  });
  it('cycles $ with F4', () => {
    expect(cycleAbsolute('SUM(A1)', 5).text).toBe('SUM($A$1)');
    expect(cycleAbsolute('SUM($A$1)', 6).text).toBe('SUM(A$1)');
    expect(cycleAbsolute('SUM(A$1)', 6).text).toBe('SUM($A1)');
    expect(cycleAbsolute('SUM($A1)', 6).text).toBe('SUM(A1)');
  });
});

describe('input parsing', () => {
  it('reads what is typed as Excel does', () => {
    expect(parseInput('=sum(A1:A3)')).toEqual({ f: 'sum(A1:A3)' });
    expect(parseInput('1,234.5')).toEqual({ t: 'n', v: 1234.5 });
    expect(parseInput('007')).toEqual({ t: 's', v: '007' });
    expect(parseInput("'123")).toEqual({ t: 's', v: '123' });
    expect(parseInput('12.5%')).toEqual({ t: 'n', v: 0.125, fmt: '0.00%' });
    expect(parseInput('2026-01-05')).toEqual({ t: 'n', v: 46027, fmt: 'yyyy-mm-dd' });
    expect(parseInput('1 234,50 $')).toEqual({ t: 'n', v: 1234.5, fmt: '#,##0.00 "$"' });
    expect(parseInput('true')).toEqual({ t: 'b', v: true });
    expect(parseInput('#N/A')).toEqual({ t: 'e', v: '#N/A' });
    expect(parseInput('14:30')).toEqual({ t: 'n', v: 14.5 / 24, fmt: 'h:mm' });
  });
  it('shows numbers for editing as Excel does', () => {
    expect(editText(46023, 'yyyy-mm-dd')).toBe('2026-01-01');
    expect(editText(46023.5, 'yyyy-mm-dd h:mm')).toBe('2026-01-01 12:00');
    expect(editText(0.635, '0.0%')).toBe('63.5%');
    expect(editText(1234.5, '#,##0.00 "$"')).toBe('1234.5');
    expect(editText(0.1 + 0.2, 'General')).toBe('0.3');
  });
});

describe('SheetDoc', () => {
  it('round-trips the codec JSON', () => {
    const wb = load();
    const d = new SheetDoc(new Y.Doc());
    d.seed(wb);
    const back = d.toWorkbook();
    expect(back.sheets.map((s) => s.name)).toEqual(['Budget', 'Données', 'Caché']);
    const strip = (w: Workbook) => w.sheets.map((s) => s.cells.filter((c) => c.f || c.t).map((c) => ({ r: c.r, c: c.c, f: c.f, v: c.f ? undefined : c.v, s: c.s ?? 0 })).sort((a, b) => a.r - b.r || a.c - b.c));
    expect(strip(back)).toEqual(strip(wb));
    expect(back.sheets[0]!.merges).toEqual(['A15:C15']);
    expect(back.sheets[0]!.frozenRows).toBe(1);
    expect(back.names!.find((n) => n.name === 'Montants')!.formula).toBe('Budget!$B$2:$B$5');
    expect(computed(back)).toEqual(computed(wb));
  });

  it('inserts and deletes rows and columns with Excel semantics', () => {
    // Budget: B7 =SUM(B2:B5), C2 =B2/$B$7, name Montants = Budget!$B$2:$B$5.
    const cases: Array<{ run: (d: SheetDoc, s: string) => void; expect: Record<string, string>; name: string }> = [
      { run: (d, s) => d.insertRows(s, 2, 2), expect: { B9: '=SUM(B2:B7)', C2: '=B2/$B$9', C5: '=B5/$B$9' }, name: 'Budget!$B$2:$B$7' },
      { run: (d, s) => d.deleteRows(s, 2, 1), expect: { B6: '=SUM(B2:B4)', C2: '=B2/$B$6', C3: '=B3/$B$6' }, name: 'Budget!$B$2:$B$4' },
      // The last row of the range goes: the range shrinks.
      { run: (d, s) => d.deleteRows(s, 4, 1), expect: { B6: '=SUM(B2:B4)', C4: '=B4/$B$6' }, name: 'Budget!$B$2:$B$4' },
      // The first row goes: the range shrinks from the top.
      { run: (d, s) => d.deleteRows(s, 1, 1), expect: { B6: '=SUM(B2:B4)', C2: '=B2/$B$6' }, name: 'Budget!$B$2:$B$4' },
      // The whole range goes: #REF!.
      { run: (d, s) => d.deleteRows(s, 1, 4), expect: { B3: '=SUM(#REF!)' }, name: 'Budget!#REF!' },
      { run: (d, s) => d.insertCols(s, 1, 1), expect: { C7: '=SUM(C2:C5)', D2: '=C2/$C$7' }, name: 'Budget!$C$2:$C$5' },
      { run: (d, s) => d.deleteCols(s, 2, 1), expect: { B7: '=SUM(B2:B5)', C2: '2026-01-01' }, name: 'Budget!$B$2:$B$5' },
    ];
    for (const [i, t] of cases.entries()) {
      const d = seeded();
      const sheet = d.sheetIds()[0]!;
      t.run(d, sheet);
      for (const [ref, want] of Object.entries(t.expect)) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
        const c = m[1]!.charCodeAt(0) - 65;
        expect(d.inputText(sheet, Number(m[2]) - 1, c), `case ${i}: ${ref}`).toBe(want);
      }
      expect(d.names().find((n) => n.name === 'Montants')!.formula, `case ${i}: name`).toBe(t.name);
      // The engine computes it; references into deleted rows read #REF! as in Excel, nothing else breaks.
      const wb = d.toWorkbook();
      const texts = computed(wb)[0]!;
      expect(texts, `case ${i}`).not.toMatch(/#VALUE!/);
    }
    // The merge A15:C15 follows inserted rows.
    const d = seeded();
    d.insertRows(d.sheetIds()[0]!, 3, 1);
    expect(d.merges(d.sheetIds()[0]!)).toEqual([{ r0: 15, c0: 0, r1: 15, c1: 2 }]);
  });

  it('merges concurrent structural edits and formula edits', () => {
    const a = new Y.Doc();
    const da = new SheetDoc(a);
    da.seed(load());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const db = new SheetDoc(b);
    const sheet = da.sheetIds()[0]!;
    // A inserts two rows above the amounts while B (offline) types a formula below them.
    da.insertRows(sheet, 1, 2);
    db.setInput(sheet, 15, 1, '=SUM(B2:B5)*2');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(da.inputText(sheet, 17, 1)).toBe('=SUM(B4:B7)*2');
    expect(db.inputText(sheet, 17, 1)).toBe('=SUM(B4:B7)*2');
    expect(da.inputText(sheet, 8, 1)).toBe('=SUM(B4:B7)');
  });

  it('encodes references by id and renders #REF! when they go', () => {
    const d = seeded();
    const sheet = d.sheetIds()[0]!;
    const other = d.sheetIds()[1]!;
    d.doc.transact(() => {
      const sf = encodeFormula("A1+Données!B2+'Données'!C3", sheet, d);
      expect(decodeFormula(sf, sheet, d)).toBe('A1+Données!B2+Données!C3');
      d.renameSheet(other, 'Mes données');
      expect(decodeFormula(sf, sheet, d)).toBe("A1+'Mes données'!B2+'Mes données'!C3");
      d.deleteSheet(other);
      expect(decodeFormula(sf, sheet, d)).toBe('A1+#REF!+#REF!');
    });
  });

  it('formats ranges with shared, appended styles', () => {
    const d = seeded();
    const sheet = d.sheetIds()[0]!;
    const n = d.toWorkbook().styles.length;
    d.formatRange(sheet, { r0: 20, c0: 0, r1: 21, c1: 1 }, (s) => ({ ...s, font: { ...s.font, bold: true } }));
    const wb = d.toWorkbook();
    expect(wb.styles.length).toBe(n + 1);
    expect(wb.sheets[0]!.cells.filter((c) => c.r >= 20 && c.s === n).length).toBe(4);
    expect(wb.baseStyles).toBe(n);
  });
});
