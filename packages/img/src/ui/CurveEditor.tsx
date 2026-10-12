import { useRef, useState } from 'react';
import { Tab, TabList, Tabs } from '@oel/emboss';
import { tr } from '@oel/i18n';

type Pt = [number, number];
const CHANNELS = [
  { id: 'rgb', label: tr('RVB', 'RGB'), color: 'var(--emboss-text)' },
  { id: 'r', label: 'R', color: '#d6483f' },
  { id: 'g', label: tr('V', 'G'), color: '#4ca050' },
  { id: 'b', label: 'B', color: '#406ed2' },
] as const;

/** Monotone cubic through the points, sampled for drawing (same family as the renderer's). */
function sample(points: Pt[], n = 64): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const k = p.length;
  if (k < 2) return [[0, 0], [1, 1]];
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - x || 1e-6));
  const m = xs.map((_, i) => (i === 0 ? d[0]! : i === k - 1 ? d[k - 2]! : d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2));
  const out: Pt[] = [];
  for (let s = 0; s <= n; s++) {
    const x = s / n;
    if (x <= xs[0]!) out.push([x, ys[0]!]);
    else if (x >= xs[k - 1]!) out.push([x, ys[k - 1]!]);
    else {
      const i = xs.findIndex((v, j) => j < k - 1 && x >= v && x <= xs[j + 1]!);
      const h = xs[i + 1]! - xs[i]!;
      const t = (x - xs[i]!) / h;
      const y = (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i]! + (t ** 3 - 2 * t ** 2 + t) * h * m[i]! + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1]! + (t ** 3 - t ** 2) * h * m[i + 1]!;
      out.push([x, Math.min(1, Math.max(0, y))]);
    }
  }
  return out;
}

/**
 * Courbe des tonalités: click to add a point, drag to move, double-click a point to remove it.
 * End points stay at x = 0 and x = 1. Arrow keys move the focused point.
 */
export function CurveEditor({ curves, onChange, onStart, onEnd }: { curves: Record<string, Pt[]>; onChange: (channel: string, points: Pt[]) => void; onStart: () => void; onEnd: () => void }) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]['id']>('rgb');
  const [focus, setFocus] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const points = curves[channel] ?? [[0, 0], [1, 1]];
  const color = CHANNELS.find((c) => c.id === channel)!.color;
  const S = 200;

  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const move = (i: number, p: Pt) => {
    const next = points.map((q) => [...q] as Pt);
    const last = next.length - 1;
    const lo = i === 0 ? 0 : next[i - 1]![0] + 0.01;
    const hi = i === last ? 1 : next[i + 1]![0] - 0.01;
    next[i] = [i === 0 ? 0 : i === last ? 1 : Math.min(hi, Math.max(lo, p[0])), p[1]];
    onChange(channel, next);
  };

  return (
    <div className="atelier-curve">
      <Tabs selectedKey={channel} onSelectionChange={(k) => setChannel(k as typeof channel)}>
        <TabList aria-label={tr('Canal de la courbe', 'Curve channel')} className="atelier-curve__channels">
          {CHANNELS.map((c) => (
            <Tab key={c.id} id={c.id}>
              {c.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      <svg
        ref={svg}
        viewBox={`0 0 ${S} ${S}`}
        className="atelier-curve__plot"
        role="group"
        aria-label={tr('Courbe des tonalités : cliquer pour ajouter un point, double-cliquer un point pour le retirer', 'Tone curve: click to add a point, double-click a point to remove it')}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('circle')) return;
          const p = at(e);
          const next = [...points, p].sort((a, b) => a[0] - b[0]) as Pt[];
          onStart();
          onChange(channel, next);
          drag.current = next.indexOf(p);
          setFocus(drag.current);
          svg.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag.current !== null && move(drag.current, at(e))}
        onPointerUp={() => {
          if (drag.current !== null) onEnd();
          drag.current = null;
        }}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="atelier-curve__grid">
            <line x1={g * S} x2={g * S} y1={0} y2={S} />
            <line y1={g * S} y2={g * S} x1={0} x2={S} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} className="atelier-curve__diagonal" />
        <polyline points={sample(points).map(([x, y]) => `${x * S},${(1 - y) * S}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * S}
            cy={(1 - y) * S}
            r={focus === i ? 6 : 5}
            tabIndex={0}
            role="slider"
            aria-label={tr(`Point ${i + 1} : entrée ${Math.round(x * 100)} %, sortie ${Math.round(y * 100)} %`, `Point ${i + 1}: input ${Math.round(x * 100)} %, output ${Math.round(y * 100)} %`)}
            aria-valuenow={Math.round(y * 100)}
            className="atelier-curve__point"
            onFocus={() => setFocus(i)}
            onPointerDown={(e) => {
              e.stopPropagation();
              onStart();
              drag.current = i;
              svg.current!.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={() => {
              if (i === 0 || i === points.length - 1) return;
              onStart();
              onChange(channel, points.filter((_, j) => j !== i));
              onEnd();
            }}
            onKeyDown={(e) => {
              const d = (e.shiftKey ? 0.1 : 0.01) * ({ ArrowUp: 1, ArrowDown: -1 } as Record<string, number>)[e.key]!;
              const dx = (e.shiftKey ? 0.1 : 0.01) * ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key]!;
              if (!d && !dx) return;
              e.preventDefault();
              onStart();
              move(i, [x + (dx || 0), Math.min(1, Math.max(0, y + (d || 0)))]);
              onEnd();
            }}
          />
        ))}
      </svg>
      <p className="atelier-hint">{tr('Cliquer pour ajouter un point · double-cliquer un point pour le retirer', 'Click to add a point · double-click a point to remove it')}</p>
    </div>
  );
}
