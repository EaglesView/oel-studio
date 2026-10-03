import { describe, expect, it } from 'vitest';
import { fillLine } from '../src/model/fill';
import { parseTSV, toTSV } from '../src/model/clipboard';

const down = { dr: 1, dc: 0 };
const vals = (r: ReturnType<typeof fillLine>) => r.map((x) => x?.f ?? x?.v);

describe('fill handle', () => {
  it('continues numbers, dates, names and numbered text', () => {
    expect(vals(fillLine([{ t: 'n', v: 1 }, { t: 'n', v: 3 }], 3, false, down))).toEqual([5, 7, 9]);
    expect(vals(fillLine([{ t: 'n', v: 5 }], 2, false, down))).toEqual([5, 5]);
    expect(vals(fillLine([{ t: 'n', v: 46023, numFmt: 'yyyy-mm-dd' }], 2, false, down))).toEqual([46024, 46025]);
    expect(vals(fillLine([{ t: 's', v: 'Lundi' }], 3, false, down))).toEqual(['Mardi', 'Mercredi', 'Jeudi']);
    expect(vals(fillLine([{ t: 's', v: 'janv' }, { t: 's', v: 'févr' }], 2, false, down))).toEqual(['mars', 'avr']);
    expect(vals(fillLine([{ t: 's', v: 'Item 1' }], 2, false, down))).toEqual(['Item 2', 'Item 3']);
    expect(vals(fillLine([{ t: 's', v: 'A007' }], 1, false, down))).toEqual(['A008']);
    expect(vals(fillLine([{ t: 's', v: 'x' }, { t: 's', v: 'y' }], 3, false, down))).toEqual(['x', 'y', 'x']);
    expect(vals(fillLine([{ f: 'A1*2' }], 2, false, down))).toEqual(['A2*2', 'A3*2']);
    expect(vals(fillLine([{ t: 'n', v: 10 }, { t: 'n', v: 20 }], 1, true, down))).toEqual([0]);
  });
});

describe('clipboard', () => {
  it('round-trips tab-separated text with quotes and newlines', () => {
    const rows = [['a', 'b\tc'], ['"q"', 'x\ny']];
    expect(parseTSV(toTSV(rows))).toEqual(rows);
    expect(parseTSV('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']]);
  });
});
