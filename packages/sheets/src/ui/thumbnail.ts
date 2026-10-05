import { CalcClient, type CalcPort } from '../calc/client';
import type { SheetSession } from '../collab/session';
import { Layout, conditionalFormats, paint, readTheme, rowHeaderWidth } from '../grid/render';
import { chartPainter } from '../grid/charts';
import { parseRange } from '../model/a1';
import { SheetController } from './controller';
import { drawingImagePaths, drawingImageUrls } from './media';

const loadImage = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

/**
 * The top-left of the first visible sheet, painted by the grid's own painter
 * (computed values, formats, conditional formats, pictures) without the
 * selection, for desk thumbnails. `width`/`height` are CSS pixels at 100 %;
 * the canvas holds `scale` device pixels per CSS pixel.
 */
export async function renderSheetThumbnail(
  session: SheetSession,
  createCalcWorker: () => unknown,
  { width, height, scale = 2 }: { width: number; height: number; scale?: number },
): Promise<HTMLCanvasElement> {
  const calc = new CalcClient(session.sheet, createCalcWorker() as CalcPort);
  const ctl = new SheetController(session.sheet, calc);
  const urls = new Map<string, string>();
  try {
    const { rows, cols } = ctl.geometry();
    const props = ctl.props;
    const layout = new Layout(rows, cols, props.frozenRows, props.frozenCols, 0, 0, width, height, rowHeaderWidth(rows.indexAt(height)));
    const [, r1] = layout.rowsShown;
    const [, c1] = layout.colsShown;
    // Once the workbook is loaded in the engine, ask for what shows (and what conditional formats scale over).
    await calc.settled();
    calc.setViewport(ctl.sheetIndex, { r0: 0, c0: 0, r1, c1 });
    for (const f of ctl.doc.condFormats(ctl.sheetId))
      for (const rg of f.sqref.split(/\s+/)) {
        const r = parseRange(rg);
        if (r) calc.prefetch(ctl.sheetIndex, r);
      }
    const drawings = ctl.doc.drawings(ctl.sheetId);
    // Charts read their ranges: a dry run asks the engine for them before the paint.
    const charts = chartPainter(ctl);
    for (const d of drawings) if (d.chart) charts(d, 10, 10);
    const [, media] = await Promise.all([calc.settled(), drawings.length ? drawingImageUrls(session, calc, drawingImagePaths(ctl.doc)) : new Map<string, string>()]);
    media.forEach((u, p) => urls.set(p, u));
    const images = new Map<string, HTMLImageElement>();
    await Promise.all([...urls].map(async ([path, url]) => {
      const img = await loadImage(url);
      if (img) images.set(path, img);
    }));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const si = ctl.sheetIndex;
    const cf = conditionalFormats(ctl.doc.condFormats(ctl.sheetId), ctl.doc.toWorkbook().dxfs ?? [], (r, c) => ctl.numberAt(r, c), (r, c) => calc.get(si, r, c)?.text ?? '');
    // A detached element has no tokens: the thumbnail keeps the light look whatever the theme.
    const theme = readTheme(document.createElement('div'));
    paint({ ctx: canvas.getContext('2d')!, ctl, layout, theme, dpr: scale, zoom: 1, drawings, images, charts, editing: null, cf, refHighlights: [], focused: false, selection: false });
    return canvas;
  } finally {
    ctl.dispose();
    calc.dispose();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
