import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { SheetDoc } from '../src/model/ydoc';
import { CalcClient, type CalcPort } from '../src/calc/client';
import { createCalcHandler } from '../src/calc/handler';
import type { FromCalc, ToCalc } from '../src/calc/protocol';

const require = createRequire(import.meta.url);
const codec = require('oelxlsx-node') as { xlsx_to_model(b: Uint8Array): string; WasmCalc: new (json: string) => never; XlsxParts: new (b: Uint8Array) => never };
const FIXTURE = new URL('../../../fixtures/xlsx/rich-lo.xlsx', import.meta.url);

/** An in-process "worker" running the real engine (Node WASM build). */
function localPort(): CalcPort {
  const handle = createCalcHandler((json) => new codec.WasmCalc(json), undefined, (b) => new codec.XlsxParts(b));
  const port: CalcPort = {
    onmessage: null,
    postMessage(m: ToCalc) {
      void handle(m).then((r) => port.onmessage?.({ data: r } as MessageEvent<FromCalc>));
    },
  };
  return port;
}

const text = (calc: CalcClient, s: number, r: number, c: number) => calc.get(s, r, c)?.text;

describe('CalcClient', () => {
  it('computes, follows edits and structural changes', async () => {
    const d = new SheetDoc(new Y.Doc());
    d.seed(JSON.parse(codec.xlsx_to_model(new Uint8Array(readFileSync(FIXTURE)))));
    const calc = new CalcClient(d, localPort());
    calc.setViewport(0, { r0: 0, c0: 0, r1: 30, c1: 10 });
    await calc.settled();
    expect(text(calc, 0, 6, 1)).toBe('2,285.50 $');
    expect(text(calc, 0, 1, 4)).toBe('007');

    const sheet = d.sheetIds()[0]!;
    d.setInput(sheet, 1, 1, '2000');
    await calc.settled();
    expect(text(calc, 0, 1, 1)).toBe('2,000.00 $');
    expect(text(calc, 0, 6, 1)).toBe('2,835.00 $');

    // Structural: the engine is rebuilt; text cells keep their leading zeros.
    d.insertRows(sheet, 1, 1);
    await calc.settled();
    await calc.settled();
    expect(text(calc, 0, 7, 1)).toBe('2,835.00 $');
    expect(text(calc, 0, 2, 4)).toBe('007');

    // Remote edit (another Y.Doc) arrives through an update.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(d.doc));
    new SheetDoc(other).setInput(sheet, 2, 1, '1000');
    Y.applyUpdate(d.doc, Y.encodeStateAsUpdate(other));
    await calc.settled();
    expect(text(calc, 0, 7, 1)).toBe('1,835.00 $');
    calc.dispose();
  });
});

describe('tables and drawings', () => {
  const COMPLEX = new URL('../../../fixtures/xlsx/complex_sheet_graph.xlsx', import.meta.url);

  it('computes structured references and follows the table when rows are inserted', async () => {
    const bytes = new Uint8Array(readFileSync(COMPLEX));
    const d = new SheetDoc(new Y.Doc());
    d.seed(JSON.parse(codec.xlsx_to_model(bytes)));
    const calc = new CalcClient(d, localPort());
    calc.setViewport(0, { r0: 0, c0: 0, r1: 30, c1: 10 });
    await calc.settled();
    expect(text(calc, 0, 6, 4)).toBe('23.18%');
    expect(text(calc, 0, 16, 5)).toBe('100.00%');

    const sheet = d.sheetIds()[0]!;
    expect(d.tables(sheet).map((t) => t.ref)).toEqual(['C6:F17']);
    d.insertRows(sheet, 8, 1);
    expect(d.tables(sheet).map((t) => t.ref)).toEqual(['C6:F18']);
    await calc.settled();
    await calc.settled();
    expect(text(calc, 0, 17, 5)).toBe('100.00%');

    // Drawings keep their anchors; images are read from the original package by the worker.
    const drawings = d.drawings(sheet);
    expect(drawings.map((x) => x.kind)).toEqual(['chart', 'picture', 'shape', 'picture']);
    const files = await calc.media(bytes, [drawings[1]!.media!]);
    expect(new TextDecoder().decode(files[0]!.bytes.slice(0, 4))).toBe('<svg');
    calc.dispose();
  });
});
