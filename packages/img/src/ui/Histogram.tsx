import { useEffect, useRef } from 'react';
import type { Histogram as Bins } from '../engine';
import { tr } from '@oel/i18n';

/** Luminance as a filled area, the three channels as thin lines (Figma L1, top of the panel). */
export function Histogram({ bins }: { bins: Bins | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (c.width = Math.round(c.clientWidth * dpr));
    const h = (c.height = Math.round(c.clientHeight * dpr));
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (!bins) return;
    const css = getComputedStyle(c);
    let max = 1;
    for (const ch of [bins.r, bins.g, bins.b, bins.luma]) for (let i = 1; i < 255; i++) max = Math.max(max, Math.sqrt(ch[i]!));
    const y = (v: number) => h - (Math.sqrt(v) / max) * (h - 2 * dpr);
    const path = (ch: Uint32Array) => {
      ctx.beginPath();
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, y(ch[i]!));
    };
    path(bins.luma);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = css.getPropertyValue('--atelier-histogram').trim() || 'rgba(110,100,120,0.45)';
    ctx.fill();
    ctx.lineWidth = dpr;
    for (const [ch, color] of [[bins.r, 'rgba(214,72,64,0.7)'], [bins.g, 'rgba(76,160,80,0.7)'], [bins.b, 'rgba(64,110,210,0.7)']] as const) {
      path(ch);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }, [bins]);
  return <canvas ref={ref} className="atelier__histogram" role="img" aria-label={tr('Histogramme', 'Histogram')} />;
}
