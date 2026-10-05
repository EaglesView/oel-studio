/**
 * Drawing context: units, fonts, text measurement, and the Office defaults a
 * chart falls back to when the file says nothing (Office 2013+ look: 9 pt
 * grey labels, 14 pt title, light gridlines, accent palette).
 */
import type { ChartSpec, Fill, Hit, Line, Mark, Paint, RenderOptions, SeriesData, Shape, Stroke, TextStyle } from './types';

export const PT = 96 / 72;

/** Office's default text colour in charts (tx1, 65 % lighter). */
export const TEXT_GREY = '#595959';
export const GRID_GREY = '#D9D9D9';
const FALLBACK_PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E', '#636363', '#997300', '#255E91', '#43682B'];

export interface ResolvedText {
  size: number;
  font: string;
  color: string;
  bold: boolean;
  italic: boolean;
  rot?: number;
}

export class Ctx {
  marks: Mark[] = [];
  hits: Hit[] = [];
  readonly palette: string[];
  readonly baseFont: string;

  constructor(
    readonly spec: ChartSpec,
    readonly opts: RenderOptions,
  ) {
    this.palette = spec.palette?.length ? spec.palette : FALLBACK_PALETTE;
    this.baseFont = spec.text?.font ?? spec.font ?? 'Calibri';
  }

  get w() {
    return this.opts.width;
  }
  get h() {
    return this.opts.height;
  }

  font(name?: string | null): string {
    const n = name || this.baseFont;
    return this.opts.fontFamily ? this.opts.fontFamily(n) : `"${n}", Carlito, Calibri, "Segoe UI", Arial, sans-serif`;
  }

  /** Effective text style: element style over the chart's default, over Office defaults. */
  text(el?: TextStyle | null, def: { size?: number; bold?: boolean; color?: string } = {}): ResolvedText {
    const base = this.spec.text ?? {};
    return {
      size: (el?.size ?? def.size ?? base.size ?? 9) * PT,
      font: this.font(el?.font ?? base.font),
      color: el?.color ?? def.color ?? base.color ?? TEXT_GREY,
      bold: el?.bold ?? def.bold ?? base.bold ?? false,
      italic: el?.italic ?? base.italic ?? false,
      rot: el?.rot ?? undefined,
    };
  }

  measure(text: string, t: ResolvedText): number {
    if (this.opts.measure) return this.opts.measure(text, t.size, t.font, t.bold);
    // Estimate: average Calibri glyph ≈ 0.5 em; narrow and wide letters adjusted.
    let w = 0;
    for (const ch of text) w += /[il.,;:'|!1 ]/.test(ch) ? 0.28 : /[mwMW@%]/.test(ch) ? 0.82 : /[A-Z0-9$]/.test(ch) ? 0.58 : 0.5;
    return w * t.size * (t.bold ? 1.06 : 1);
  }

  push(m: Mark) {
    this.marks.push(m);
  }

  hit(id: string, x: number, y: number, w: number, h: number) {
    this.hits.push({ id, x, y, w, h });
  }

  label(text: string, x: number, y: number, t: ResolvedText, anchor: 'start' | 'middle' | 'end' = 'middle', baseline: 'top' | 'middle' | 'bottom' = 'middle', id?: string, rot?: number) {
    this.push({ t: 'text', id, x, y, text, size: t.size, font: t.font, color: t.color, bold: t.bold, italic: t.italic, anchor, baseline, rot: rot ?? t.rot });
  }

  // ---------------------------------------------------------------- paints

  /** A file fill → paint; `null` = explicitly none; `undefined` = not set. */
  paint(f?: Fill | null): Paint | null | undefined {
    if (!f) return undefined;
    switch (f.kind) {
      case 'none':
        return null;
      case 'gradient':
        if (f.stops?.length) {
          return f.path ? { kind: 'radial', stops: f.stops } : { kind: 'linear', angle: f.angle ?? 90, stops: f.stops };
        }
        return f.color ?? undefined;
      case 'pattern':
        return f.color ?? undefined;
      case 'picture':
        return f.color ?? '#BFBFBF';
      default:
        return f.color ?? undefined;
    }
  }

  stroke(l?: Line | null, fallback?: Stroke | null): Stroke | null | undefined {
    if (!l) return fallback ?? undefined;
    if (l.none) return null;
    const color = l.color ?? fallback?.color;
    if (!color) return fallback ?? undefined;
    return { color, width: (l.width ?? (fallback ? fallback.width / PT : 0.75)) * PT, dash: dashOf(l.dash, (l.width ?? 0.75) * PT) };
  }

  /** Box of a chart element (chart area, plot area, legend…). */
  box(s: Shape | null | undefined, defFill: Paint | null, defLine: Stroke | null) {
    const fill = this.paint(s?.fill);
    const line = this.stroke(s?.line, defLine);
    return { fill: fill === undefined ? defFill : fill, line: line === undefined ? defLine : line };
  }

  // --------------------------------------------------------- series colour

  auto(i: number): string {
    return this.palette[((i % this.palette.length) + this.palette.length) % this.palette.length]!;
  }

  /** Fill and outline of a series (or one of its points). `kind` picks Office's defaults. */
  seriesLook(sd: SeriesData, point: number | null, kind: 'fill' | 'line' | 'marker') {
    const vary = point != null && sd.group.varyColors && this.spec.groups.reduce((n, g) => n + g.series.length, 0) === 1;
    const ofPie = ['pie', 'doughnut', 'ofPie'].includes(sd.group.kind) && point != null && sd.group.varyColors;
    const autoColor = this.auto(vary || ofPie ? point! : sd.series.idx);
    const dpt = point != null ? sd.series.points?.find((p) => p.idx === point) : undefined;
    const shape = dpt?.shape ?? sd.series.shape;
    const fromShapeFill = this.paint(dpt?.shape?.fill ?? sd.series.shape?.fill);
    if (kind === 'line') {
      const l = shape?.line;
      const s = this.stroke(l, { color: autoColor, width: 2.25 * PT });
      return { fill: null as Paint | null, line: s === undefined ? { color: autoColor, width: 2.25 * PT } : s };
    }
    if (kind === 'marker') {
      const m = dpt?.marker ?? sd.series.marker;
      const mf = this.paint(m?.shape?.fill);
      const ml = this.stroke(m?.shape?.line, { color: autoColor, width: 0.75 * PT });
      return { fill: mf === undefined ? autoColor : mf, line: ml === undefined ? { color: autoColor, width: 0.75 * PT } : ml };
    }
    const fill = fromShapeFill === undefined ? autoColor : fromShapeFill;
    const defLine = ['pie', 'doughnut', 'ofPie'].includes(sd.group.kind) ? { color: '#FFFFFF', width: 0.75 * PT } : null;
    const line = this.stroke(shape?.line, defLine);
    return { fill, line: line === undefined ? defLine : line };
  }
}

export function dashOf(dash: string | null | undefined, w: number): number[] | undefined {
  const u = Math.max(w, 1);
  switch (dash) {
    case 'dash':
    case 'sysDash':
      return [4 * u, 3 * u];
    case 'dot':
    case 'sysDot':
      return [u, u * 1.5];
    case 'dashDot':
    case 'sysDashDot':
      return [4 * u, 3 * u, u, 3 * u];
    case 'lgDash':
      return [8 * u, 3 * u];
    case 'lgDashDot':
      return [8 * u, 3 * u, u, 3 * u];
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return [8 * u, 3 * u, u, 3 * u, u, 3 * u];
    default:
      return undefined;
  }
}

/** Darken (k < 1) or lighten (k > 1) a CSS colour, for 3-D faces. */
export function shade(color: Paint, k: number): Paint {
  if (typeof color !== 'string') return { ...color, stops: color.stops.map((s) => ({ ...s, color: shade(s.color, k) as string })) };
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color);
  let r: number, g: number, b: number, a = 1;
  if (m) {
    const n = parseInt(m[1]!, 16);
    r = n >> 16;
    g = (n >> 8) & 255;
    b = n & 255;
  } else if (rgba) {
    const p = rgba[1]!.split(',').map((x) => Number(x.trim()));
    [r = 0, g = 0, b = 0] = p;
    a = p[3] ?? 1;
  } else return color;
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, k < 1 ? c * k : c + (255 - c) * (k - 1))));
  return a < 1 ? `rgba(${f(r)}, ${f(g)}, ${f(b)}, ${a})` : `#${[f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
