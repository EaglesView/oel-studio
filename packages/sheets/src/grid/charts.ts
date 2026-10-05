/**
 * Charts on the grid: drawn by @oel/charts from the live values of the calc
 * engine (the ranges a chart reads are fetched even when off screen), cached
 * per chart, size and calc version, painted in the grid's canvas pass.
 */
import { canvasMeasure, cellResolver, parseRef, renderChart, type ChartSpec, type Resolver, type Scene } from '@oel/charts';
import type { Drawing } from '../model/types';
import type { SheetController } from '../ui/controller';

const measure = typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined' ? canvasMeasure() : undefined;

/** Office fonts → the open substitute the editor loads, then generic fallbacks. */
const SUBSTITUTE: Record<string, string> = { Calibri: 'Carlito', 'Calibri Light': 'Carlito', Cambria: 'Caladea', Arial: 'Liberation Sans', 'Times New Roman': 'Liberation Serif' };
export const chartFont = (name: string) => `"${name}", "${SUBSTITUTE[name] ?? name}", Carlito, "Segoe UI", Arial, sans-serif`;

/** Values of chart references, read from the calc cache (and fetched when missing). */
export function sheetResolver(ctl: SheetController, ownSheet: string): Resolver {
  const asked = new Set<string>();
  const indexOf = (name: string | null) => {
    const id = name ? ctl.doc.sheetIdByName(name) : ownSheet;
    return id ? ctl.doc.sheetIds().indexOf(id) : -1;
  };
  const base = cellResolver({
    num: (s, r, c) => {
      const out = ctl.calc.get(indexOf(s), r, c);
      return out?.t === 'n' && typeof out.v === 'number' ? out.v : null;
    },
    text: (s, r, c) => {
      const out = ctl.calc.get(indexOf(s), r, c);
      return out ? out.text : null;
    },
  });
  return (ref) => {
    const areas = parseRef(ref);
    if (!areas) return null;
    for (const a of areas) {
      const si = indexOf(a.sheet);
      if (si < 0) return null;
      const key = `${si}:${a.r0}:${a.c0}:${a.r1}:${a.c1}`;
      if (!asked.has(key)) {
        asked.add(key);
        ctl.calc.prefetch(si, { r0: a.r0, c0: a.c0, r1: a.r1, c1: a.c1 });
      }
    }
    return base(ref);
  };
}

/** Recent scenes by content (the model hands out fresh objects on every read). */
const scenes = new Map<string, Scene>();
const MAX_SCENES = 64;

/** The scene of a chart drawing at a size, rebuilt when the chart or the values change. */
export function chartScene(d: Drawing, w: number, h: number, resolve: Resolver, version: number): Scene | null {
  const spec: ChartSpec | undefined = d.chart;
  if (!spec) return null;
  const key = `${Math.round(w)}x${Math.round(h)}:${version}:${JSON.stringify(spec)}`;
  const hit = scenes.get(key);
  if (hit) {
    scenes.delete(key);
    scenes.set(key, hit);
    return hit;
  }
  const scene = renderChart(spec, { width: w, height: h, resolve, measure, fontFamily: chartFont, background: '#FFFFFF' });
  scenes.set(key, scene);
  if (scenes.size > MAX_SCENES) scenes.delete(scenes.keys().next().value!);
  return scene;
}

/** Colours of the source ranges while a chart is selected (Figma H2): names, categories, values. */
export const RANGE_COLORS = { name: '#1E8E3E', cat: '#B06000', val: '#7759C5' };

/** The ranges a chart reads on `sheetName`, for the grid's coloured highlights. */
export function chartRanges(spec: ChartSpec, sheetName: string): Array<{ range: { r0: number; c0: number; r1: number; c1: number }; color: string }> {
  const out: Array<{ range: { r0: number; c0: number; r1: number; c1: number }; color: string }> = [];
  const add = (f: string | null | undefined, color: string) => {
    for (const a of (f && parseRef(f)) || []) if ((a.sheet ?? sheetName) === sheetName) out.push({ range: { r0: a.r0, c0: a.c0, r1: a.r1, c1: a.c1 }, color });
  };
  for (const g of spec.groups)
    for (const s of g.series) {
      add(s.nameRef, RANGE_COLORS.name);
      add(s.cat?.f, RANGE_COLORS.cat);
      add(s.val?.f, RANGE_COLORS.val);
      add(s.size?.f, RANGE_COLORS.val);
    }
  return out;
}

/** A painter for `paint()`: charts of the current sheet with live values. */
export function chartPainter(ctl: SheetController): (d: Drawing, w: number, h: number) => Scene | null {
  const resolve = sheetResolver(ctl, ctl.sheetId);
  return (d, w, h) => chartScene(d, w, h, resolve, ctl.calc.version);
}
