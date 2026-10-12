/**
 * Types shared by the renderer. The chart itself (`ChartSpec`) is generated
 * from the Rust codec (`crates/oel-chart`); the rest describes the resolved
 * data and the scene of marks the backends (SVG, Canvas) draw.
 */
import type { ChartSpec, Group, Series } from '@oel/engine/generated/oelchart';

export type * from '@oel/engine/generated/oelchart';

/** Values behind a reference, as the host reads them (cells of a sheet). */
export interface RefValues {
  /** Numbers by point (`null` = empty or text). */
  num: (number | null)[];
  /** Display text by point (formatted by the host, or the cell's text). */
  text: (string | null)[];
  /** Number format of the first cell. */
  format?: string;
}

/** Reads a chart reference (`'Budget'!$B$2:$B$8`); `null` when unknown (the cache is used). */
export type Resolver = (ref: string) => RefValues | null;

/** One series with its data resolved. */
export interface SeriesData {
  group: Group;
  series: Series;
  /** Position in the plot (series order, over all groups). */
  index: number;
  name: string;
  /** Category labels (or X values as text). */
  cats: string[];
  /** Multi-level categories, outer level last. */
  catLevels?: string[][];
  /** Numeric X values (scatter, bubble). */
  xs?: (number | null)[];
  values: (number | null)[];
  sizes?: (number | null)[];
  /** Number format of the values. */
  format?: string;
}

export interface ResolvedChart {
  spec: ChartSpec;
  series: SeriesData[];
}

/** A colour or a gradient. */
export type Paint =
  | string
  | { kind: 'linear'; angle: number; stops: { pos: number; color: string }[] }
  | { kind: 'radial'; stops: { pos: number; color: string }[] };

export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
}

interface MarkBase {
  /** Chart element the mark belongs to (`title`, `legend`, `series:2`, `point:2:5`, `axis:10`…). */
  id?: string;
  opacity?: number;
}

export type Mark =
  | (MarkBase & { t: 'rect'; x: number; y: number; w: number; h: number; fill?: Paint; stroke?: Stroke; r?: number })
  | (MarkBase & { t: 'path'; d: string; fill?: Paint; stroke?: Stroke })
  | (MarkBase & { t: 'circle'; cx: number; cy: number; r: number; fill?: Paint; stroke?: Stroke })
  | (MarkBase & {
      t: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      font: string;
      color: string;
      anchor: 'start' | 'middle' | 'end';
      baseline: 'top' | 'middle' | 'bottom';
      bold?: boolean;
      italic?: boolean;
      rot?: number;
    })
  | (MarkBase & { t: 'image'; x: number; y: number; w: number; h: number; href: string });

/** Where a chart element is, for selection and hit testing. */
export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scene {
  w: number;
  h: number;
  marks: Mark[];
  hits: Hit[];
  /** Plain-text summary for screen readers. */
  label: string;
}

export interface RenderOptions {
  /** Size in CSS pixels. */
  width: number;
  height: number;
  /** Reads cell references; without it, the values cached in the file are used. */
  resolve?: Resolver;
  /** CSS font-family list for a font name (substitutes, fallbacks). */
  fontFamily?: (name: string) => string;
  /** Background when the chart area has no fill of its own (`white` for sheets, none for slides). */
  background?: string | null;
  /** Measures text (canvas `measureText`); defaults to an estimate. */
  measure?: (text: string, sizePx: number, font: string, bold?: boolean) => number;
  /** Media of picture fills, by package path → URL. */
  media?: (path: string) => string | undefined;
}
