/**
 * A spreadsheet as a link source: its session plus a calc engine of its own.
 * Charts (their ranges' values cached in), ranges as tables (plan I-4) and
 * single cells as values (plan I-6), all read through that engine.
 */
import { withCaches, type ChartSpec } from '@oel/charts';
import { CalcClient, rangeAsTable, sheetResolver, type CalcPort, type CellShown } from '@oel/sheets';
import type { LinkedValue, SourceRef } from '@oel/links';
import type { Paper } from '../../bureau/model';
import { createCalcWorker, sheetSessionFor } from '../../bureau/sheets';
import type { LinkSource } from '../kinds';

export async function openSheetSource(p: Paper): Promise<LinkSource> {
  const session = await sheetSessionFor(p, () => {});
  const calc = new CalcClient(session.sheet, createCalcWorker() as unknown as CalcPort);

  /** The chart as a copy shows it, its ranges' values cached in. */
  const readChart = async (ref: Extract<SourceRef, { kind: 'chart' }>): Promise<ChartSpec | null | undefined> => {
    // First pass asks the engine for the ranges; once it has caught up, the second reads them.
    // A rebuild of the engine in between (rows inserted…) drops fetched values: read again.
    for (let attempt = 0; attempt < 3; attempt++) {
      await calc.settled();
      const loads = calc.loads;
      const hit = session.sheet.drawingById(ref.chartId);
      if (!hit?.drawing.chart) return null;
      const resolve = sheetResolver({ doc: session.sheet, calc }, hit.sheet);
      withCaches(hit.drawing.chart, resolve);
      await calc.settled();
      const again = session.sheet.drawingById(ref.chartId);
      if (!again?.drawing.chart) return null;
      if (calc.loads === loads) return { ...withCaches(again.drawing.chart, resolve), part: '' };
    }
    return undefined;
  };

  /** Values of a block of cells, once the engine has them (`undefined` when it kept rebuilding). */
  const readBlock = async <T,>(sheet: string, r: { r0: number; c0: number; r1: number; c1: number }, build: (shown: (row: number, col: number) => CellShown) => T): Promise<T | undefined> => {
    const si = session.sheet.sheetIds().indexOf(sheet);
    if (si < 0) return undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await calc.settled();
      const loads = calc.loads;
      calc.prefetch(si, r);
      await calc.settled();
      if (calc.loads !== loads) continue;
      return build((row, col) => {
        const out = calc.get(si, row, col);
        if (!out) return undefined;
        return { text: out.text, ...(out.t === 'n' && typeof out.v === 'number' ? { num: out.v } : {}) };
      });
    }
    return undefined;
  };

  return {
    docId: session.status.docId,
    ydoc: session.ydoc,
    async read(ref): Promise<LinkedValue | null | undefined> {
      if (ref.kind === 'chart') {
        const spec = await readChart(ref);
        return spec ? { kind: 'chart', spec } : spec;
      }
      if (ref.kind === 'range') {
        const r = session.sheet.range(ref.sheetId, ref.ids);
        if (!r) return null; // its rows or columns were deleted
        const table = await readBlock(ref.sheetId, r, (shown) => rangeAsTable(session.sheet, ref.sheetId, r, shown));
        return table ? { kind: 'table', table } : undefined;
      }
      if (ref.kind === 'cell') {
        const row = session.sheet.rowIndex(ref.sheetId, ref.ids.r);
        const col = session.sheet.colIndex(ref.sheetId, ref.ids.c);
        if (row == null || col == null) return null;
        // Wrapped, so an empty cell (no value) is not mistaken for « not read yet ».
        const got = await readBlock(ref.sheetId, { r0: row, c0: col, r1: row, c1: col }, (shown) => ({ v: shown(row, col) }));
        if (!got) return undefined;
        return { kind: 'value', text: got.v?.text ?? '', ...(got.v?.num != null ? { num: got.v.num } : {}) };
      }
      return null;
    },
    onChange(fn) {
      // Cell edits (anyone's), undo, rows moved…
      session.ydoc.on('afterTransaction', fn);
      return () => session.ydoc.off('afterTransaction', fn);
    },
    dispose: () => calc.dispose(),
  };
}
