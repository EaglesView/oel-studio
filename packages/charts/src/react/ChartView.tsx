/**
 * A chart as SVG inside any box, for the DOM editors (slides, documents).
 * `width`/`height` are the box in CSS pixels at 100 %; the SVG scales with it.
 */
import { memo, useMemo } from 'react';
import { renderChart, toSVG } from '../index';
import { canvasMeasure } from '../render/canvas';
import type { ChartSpec, Resolver } from '../types';

const measure = typeof document !== 'undefined' ? canvasMeasure() : undefined;

export interface ChartViewProps {
  spec: ChartSpec;
  width: number;
  height: number;
  resolve?: Resolver;
  fontFamily?: (name: string) => string;
  /** Chart area background when the file gives none (`null` = transparent). */
  background?: string | null;
  className?: string;
  /** Bumped by the host when resolved values change. */
  version?: number;
}

export const ChartView = memo(function ChartView({ spec, width, height, resolve, fontFamily, background = null, className, version }: ChartViewProps) {
  const svg = useMemo(
    () => toSVG(renderChart(spec, { width: Math.max(20, width), height: Math.max(20, height), resolve, fontFamily, background, measure })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, width, height, resolve, fontFamily, background, version],
  );
  return <div className={className ?? 'oel-chart'} style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ') }} />;
});
