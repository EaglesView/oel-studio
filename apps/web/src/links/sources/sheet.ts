/**
 * A spreadsheet as a link source: its session plus a calc engine of its own
 * (the values of a chart's ranges). Charts today; ranges and cells (plan I-4,
 * I-6) read through the same engine.
 */
import { withCaches, type ChartSpec } from '@oel/charts';
import { CalcClient, sheetResolver, type CalcPort } from '@oel/sheets';
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

  return {
    docId: session.status.docId,
    ydoc: session.ydoc,
    async read(ref): Promise<LinkedValue | null | undefined> {
      if (ref.kind !== 'chart') return null;
      const spec = await readChart(ref);
      return spec ? { kind: 'chart', spec } : spec;
    },
    onChange(fn) {
      // Cell edits (anyone's), undo, rows moved…
      session.ydoc.on('afterTransaction', fn);
      return () => session.ydoc.off('afterTransaction', fn);
    },
    dispose: () => calc.dispose(),
  };
}
