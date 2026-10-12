/**
 * DrawingML shape geometry → SVG paths.
 *
 * Shapes are defined like in ECMA-376 `presetShapeDefinitions.xml`: adjust
 * values, guides (`*\/ w adj 100000`, `+- r 0 x1`, `pin 0 adj 50000`…) and
 * paths of moveTo/lnTo/arcTo/cubicBezTo/quadBezTo/close in shape units.
 * Freeforms from the file (`custGeom`) use the same evaluator, so every shape
 * is recomputed for any size (resizing keeps corners round, arrows sharp).
 */
import type { CustomGeometry, Geometry, GeomPath, Guide, PathCmd } from './types';
import { tr } from '@oel/i18n';

/** Angles are in 60 000ths of a degree. */
const ANGLE = 60000;
const rad = (a: number) => ((a / ANGLE) * Math.PI) / 180;

type Vars = Map<string, number>;

function builtins(w: number, h: number): Vars {
  const ss = Math.min(w, h);
  const ls = Math.max(w, h);
  const v: Vars = new Map([
    ['w', w], ['h', h], ['l', 0], ['t', 0], ['r', w], ['b', h], ['hc', w / 2], ['vc', h / 2],
    ['ss', ss], ['ls', ls],
    ['cd2', 10800000], ['cd4', 5400000], ['cd8', 2700000], ['3cd4', 16200000], ['3cd8', 8100000], ['5cd8', 13500000], ['7cd8', 18900000],
  ]);
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    v.set(`wd${n}`, w / n);
    v.set(`hd${n}`, h / n);
    v.set(`ssd${n}`, ss / n);
  }
  return v;
}

function value(vars: Vars, token: string): number {
  const n = Number(token);
  if (Number.isFinite(n) && token.trim() !== '') return n;
  return vars.get(token) ?? 0;
}

/** Evaluate one guide formula. */
export function formula(fmla: string, vars: Vars): number {
  const [op, ...args] = fmla.trim().split(/\s+/);
  const [x = 0, y = 0, z = 0] = args.map((a) => value(vars, a));
  switch (op) {
    case 'val': return x;
    case '*/': return z === 0 ? 0 : (x * y) / z;
    case '+-': return x + y - z;
    case '+/': return z === 0 ? 0 : (x + y) / z;
    case '?:': return x > 0 ? y : z;
    case 'abs': return Math.abs(x);
    case 'at2': return (Math.atan2(y, x) * 180 * ANGLE) / Math.PI;
    case 'cat2': return x * Math.cos(Math.atan2(z, y));
    case 'sat2': return x * Math.sin(Math.atan2(z, y));
    case 'cos': return x * Math.cos(rad(y));
    case 'sin': return x * Math.sin(rad(y));
    case 'tan': return x * Math.tan(rad(y));
    case 'max': return Math.max(x, y);
    case 'min': return Math.min(x, y);
    case 'mod': return Math.sqrt(x * x + y * y + z * z);
    case 'pin': return y < x ? x : y > z ? z : y;
    case 'sqrt': return Math.sqrt(Math.max(0, x));
    default: return 0;
  }
}

/** Compact preset definition: adjust defaults, guides, and paths in a small path language. */
interface PresetDef {
  av?: Record<string, number>;
  gd?: string;
  /** `M x y`, `L x y`, `A wR hR st sw`, `C x1 y1 x2 y2 x y`, `Q x1 y1 x y`, `Z`; one string per path. */
  paths: Array<string | { d: string; fill?: 'none' | 'norm' | 'darken' | 'lighten'; stroke?: boolean; w?: number; h?: number }>;
}

const ELLIPSE = 'M l vc A wd2 hd2 cd2 cd4 A wd2 hd2 3cd4 cd4 A wd2 hd2 0 cd4 A wd2 hd2 cd4 cd4 Z';
const RECT = 'M l t L r t L r b L l b Z';

/** Guides as `name: fmla;` lines. */
const PRESETS: Record<string, PresetDef> = {
  rect: { paths: [RECT] },
  flowChartProcess: { paths: [RECT] },
  roundRect: {
    av: { adj: 16667 },
    gd: 'a: pin 0 adj 50000; x1: */ ss a 100000; x2: +- r 0 x1; y2: +- b 0 x1',
    paths: ['M l x1 A x1 x1 cd2 cd4 L x2 t A x1 x1 3cd4 cd4 L r y2 A x1 x1 0 cd4 L x1 b A x1 x1 cd4 cd4 Z'],
  },
  flowChartAlternateProcess: {
    gd: 'x2: +- r 0 ssd6; y2: +- b 0 ssd6',
    paths: ['M l ssd6 A ssd6 ssd6 cd2 cd4 L x2 t A ssd6 ssd6 3cd4 cd4 L r y2 A ssd6 ssd6 0 cd4 L ssd6 b A ssd6 ssd6 cd4 cd4 Z'],
  },
  ellipse: { paths: [ELLIPSE] },
  flowChartConnector: { paths: [ELLIPSE] },
  triangle: { av: { adj: 50000 }, gd: 'a: pin 0 adj 100000; x2: */ w a 100000', paths: ['M l b L x2 t L r b Z'] },
  rtTriangle: { paths: ['M l b L l t L r b Z'] },
  diamond: { paths: ['M l vc L hc t L r vc L hc b Z'] },
  flowChartDecision: { paths: ['M l vc L hc t L r vc L hc b Z'] },
  parallelogram: {
    av: { adj: 25000 },
    gd: 'maxAdj: */ 100000 w ss; a: pin 0 adj maxAdj; x2: */ ss a 100000; x5: +- r 0 x2',
    paths: ['M l b L x2 t L r t L x5 b Z'],
  },
  trapezoid: {
    av: { adj: 25000 },
    gd: 'maxAdj: */ 50000 w ss; a: pin 0 adj maxAdj; x2: */ ss a 100000; x3: +- r 0 x2',
    paths: ['M l b L x2 t L x3 t L r b Z'],
  },
  pentagon: {
    av: { hf: 105146, vf: 110557 },
    gd: 'swd2: */ wd2 hf 100000; shd2: */ hd2 vf 100000; svc: */ vc vf 100000; dx1: cos swd2 1080000; dx2: cos swd2 18360000; dy1: sin shd2 1080000; dy2: sin shd2 18360000; x1: +- hc 0 dx1; x2: +- hc 0 dx2; x3: +- hc dx2 0; x4: +- hc dx1 0; y1: +- svc 0 dy1; y2: +- svc 0 dy2',
    paths: ['M x1 y1 L hc t L x4 y1 L x3 y2 L x2 y2 Z'],
  },
  hexagon: {
    av: { adj: 25000, vf: 115470 },
    gd: 'maxAdj: */ 50000 w ss; a: pin 0 adj maxAdj; shd2: */ hd2 vf 100000; x1: */ ss a 100000; x2: +- r 0 x1; dy1: sin shd2 3600000; y1: +- vc 0 dy1; y2: +- vc dy1 0',
    paths: ['M l vc L x1 y1 L x2 y1 L r vc L x2 y2 L x1 y2 Z'],
  },
  octagon: {
    av: { adj: 29289 },
    gd: 'a: pin 0 adj 50000; x1: */ ss a 100000; x2: +- r 0 x1; y2: +- b 0 x1',
    paths: ['M l x1 L x1 t L x2 t L r x1 L r y2 L x2 b L x1 b L l y2 Z'],
  },
  homePlate: {
    av: { adj: 50000 },
    gd: 'maxAdj: */ 100000 w ss; a: pin 0 adj maxAdj; dx1: */ ss a 100000; x1: +- r 0 dx1',
    paths: ['M l t L x1 t L r vc L x1 b L l b Z'],
  },
  chevron: {
    av: { adj: 50000 },
    gd: 'maxAdj: */ 100000 w ss; a: pin 0 adj maxAdj; x1: */ ss a 100000; x2: +- r 0 x1',
    paths: ['M l t L x2 t L r vc L x2 b L l b L x1 vc Z'],
  },
  plaque: {
    av: { adj: 16667 },
    gd: 'a: pin 0 adj 50000; x1: */ ss a 100000; x2: +- r 0 x1; y2: +- b 0 x1',
    paths: ['M l x1 A x1 x1 cd4 -5400000 L x2 t A x1 x1 cd2 -5400000 L r y2 A x1 x1 3cd4 -5400000 L x1 b A x1 x1 0 -5400000 Z'],
  },
  line: { paths: [{ d: 'M l t L r b', fill: 'none' }] },
  straightConnector1: { paths: [{ d: 'M l t L r b', fill: 'none' }] },
  bentConnector2: { paths: [{ d: 'M l t L r t L r b', fill: 'none' }] },
  bentConnector3: { av: { adj1: 50000 }, gd: 'x1: */ w adj1 100000', paths: [{ d: 'M l t L x1 t L x1 b L r b', fill: 'none' }] },
  curvedConnector3: {
    av: { adj1: 50000 },
    gd: 'x2: */ w adj1 100000; x1: +/ l x2 2; x3: +/ r x2 2; y3: */ h 3 4',
    paths: [{ d: 'M l t C x1 t x2 hd4 x2 vc C x2 y3 x3 b r b', fill: 'none' }],
  },
  rightArrow: {
    av: { adj1: 50000, adj2: 50000 },
    gd: 'maxAdj2: */ 100000 w ss; a1: pin 0 adj1 100000; a2: pin 0 adj2 maxAdj2; dx1: */ ss a2 100000; x1: +- r 0 dx1; dy1: */ h a1 200000; y1: +- vc 0 dy1; y2: +- vc dy1 0',
    paths: ['M l y1 L x1 y1 L x1 t L r vc L x1 b L x1 y2 L l y2 Z'],
  },
  leftArrow: {
    av: { adj1: 50000, adj2: 50000 },
    gd: 'maxAdj2: */ 100000 w ss; a1: pin 0 adj1 100000; a2: pin 0 adj2 maxAdj2; dx2: */ ss a2 100000; x2: +- l dx2 0; dy1: */ h a1 200000; y1: +- vc 0 dy1; y2: +- vc dy1 0',
    paths: ['M l vc L x2 t L x2 y1 L r y1 L r y2 L x2 y2 L x2 b Z'],
  },
  upArrow: {
    av: { adj1: 50000, adj2: 50000 },
    gd: 'maxAdj2: */ 100000 h ss; a1: pin 0 adj1 100000; a2: pin 0 adj2 maxAdj2; dy2: */ ss a2 100000; y2: +- t dy2 0; dx1: */ w a1 200000; x1: +- hc 0 dx1; x2: +- hc dx1 0',
    paths: ['M l y2 L hc t L r y2 L x2 y2 L x2 b L x1 b L x1 y2 Z'],
  },
  downArrow: {
    av: { adj1: 50000, adj2: 50000 },
    gd: 'maxAdj2: */ 100000 h ss; a1: pin 0 adj1 100000; a2: pin 0 adj2 maxAdj2; dy1: */ ss a2 100000; y1: +- b 0 dy1; dx1: */ w a1 200000; x1: +- hc 0 dx1; x2: +- hc dx1 0',
    paths: ['M l y1 L x1 y1 L x1 t L x2 t L x2 y1 L r y1 L hc b Z'],
  },
  leftRightArrow: {
    av: { adj1: 50000, adj2: 50000 },
    gd: 'maxAdj2: */ 50000 w ss; a1: pin 0 adj1 100000; a2: pin 0 adj2 maxAdj2; x2: */ ss a2 100000; x3: +- r 0 x2; dy: */ h a1 200000; y1: +- vc 0 dy; y2: +- vc dy 0',
    paths: ['M l vc L x2 t L x2 y1 L x3 y1 L x3 t L r vc L x3 b L x3 y2 L x2 y2 L x2 b Z'],
  },
  star4: {
    av: { adj: 12500 },
    gd: 'a: pin 0 adj 50000; iwd2: */ wd2 a 50000; ihd2: */ hd2 a 50000; sdx: cos iwd2 2700000; sdy: sin ihd2 2700000; sx1: +- hc 0 sdx; sx2: +- hc sdx 0; sy1: +- vc 0 sdy; sy2: +- vc sdy 0',
    paths: ['M l vc L sx1 sy1 L hc t L sx2 sy1 L r vc L sx2 sy2 L hc b L sx1 sy2 Z'],
  },
  star5: {
    av: { adj: 19098, hf: 105146, vf: 110557 },
    gd: 'a: pin 0 adj 50000; swd2: */ wd2 hf 100000; shd2: */ hd2 vf 100000; svc: */ vc vf 100000; dx1: cos swd2 1080000; dx2: cos swd2 18360000; dy1: sin shd2 1080000; dy2: sin shd2 18360000; x1: +- hc 0 dx1; x2: +- hc 0 dx2; x3: +- hc dx2 0; x4: +- hc dx1 0; y1: +- svc 0 dy1; y2: +- svc 0 dy2; iwd2: */ swd2 a 50000; ihd2: */ shd2 a 50000; sdx1: cos iwd2 20520000; sdx2: cos iwd2 3240000; sdy1: sin ihd2 3240000; sdy2: sin ihd2 20520000; sx1: +- hc 0 sdx1; sx2: +- hc 0 sdx2; sx3: +- hc sdx2 0; sx4: +- hc sdx1 0; sy1: +- svc 0 sdy1; sy2: +- svc 0 sdy2; sy3: +- svc ihd2 0',
    paths: ['M x1 y1 L sx2 sy1 L hc t L sx3 sy1 L x4 y1 L sx4 sy2 L x3 y2 L hc sy3 L x2 y2 L sx1 sy2 Z'],
  },
  donut: {
    av: { adj: 25000 },
    gd: 'a: pin 0 adj 50000; dr: */ ss a 100000; iwd2: +- wd2 0 dr; ihd2: +- hd2 0 dr',
    paths: [`${ELLIPSE} M dr vc A iwd2 ihd2 cd2 -5400000 A iwd2 ihd2 cd4 -5400000 A iwd2 ihd2 0 -5400000 A iwd2 ihd2 3cd4 -5400000 Z`],
  },
  frame: {
    av: { adj1: 12500 },
    gd: 'a1: pin 0 adj1 50000; x1: */ ss a1 100000; x4: +- r 0 x1; y4: +- b 0 x1',
    paths: [`${RECT} M x1 x1 L x1 y4 L x4 y4 L x4 x1 Z`],
  },
  plus: {
    av: { adj: 25000 },
    gd: 'a: pin 0 adj 50000; x1: */ ss a 100000; x2: +- r 0 x1; y2: +- b 0 x1',
    paths: ['M l x1 L x1 x1 L x1 t L x2 t L x2 x1 L r x1 L r y2 L x2 y2 L x2 b L x1 b L x1 y2 L l y2 Z'],
  },
  corner: {
    av: { adj1: 50000, adj2: 50000 },
    gd: 'maxAdj1: */ 100000 h ss; maxAdj2: */ 100000 w ss; a1: pin 0 adj1 maxAdj1; a2: pin 0 adj2 maxAdj2; x1: */ ss a2 100000; dy1: */ ss a1 100000; y1: +- b 0 dy1',
    paths: ['M l t L x1 t L x1 y1 L r y1 L r b L l b Z'],
  },
  snip1Rect: {
    av: { adj: 16667 },
    gd: 'a: pin 0 adj 50000; dx1: */ ss a 100000; x1: +- r 0 dx1',
    paths: ['M l t L x1 t L r dx1 L r b L l b Z'],
  },
  snip2SameRect: {
    av: { adj1: 16667, adj2: 0 },
    gd: 'a1: pin 0 adj1 50000; a2: pin 0 adj2 50000; tx1: */ ss a1 100000; tx2: +- r 0 tx1; bx1: */ ss a2 100000; bx2: +- r 0 bx1; by1: +- b 0 bx1',
    paths: ['M tx1 t L tx2 t L r tx1 L r by1 L bx2 b L bx1 b L l by1 L l tx1 Z'],
  },
  round1Rect: {
    av: { adj: 16667 },
    gd: 'a: pin 0 adj 50000; dx1: */ ss a 100000; x1: +- r 0 dx1',
    paths: ['M l t L x1 t A dx1 dx1 3cd4 cd4 L r b L l b Z'],
  },
  round2SameRect: {
    av: { adj1: 16667, adj2: 0 },
    gd: 'a1: pin 0 adj1 50000; a2: pin 0 adj2 50000; tx1: */ ss a1 100000; tx2: +- r 0 tx1; bx1: */ ss a2 100000; bx2: +- r 0 bx1; by1: +- b 0 bx1',
    paths: ['M tx1 t L tx2 t A tx1 tx1 3cd4 cd4 L r by1 A bx1 bx1 0 cd4 L bx1 b A bx1 bx1 cd4 cd4 L l tx1 A tx1 tx1 cd2 cd4 Z'],
  },
  flowChartTerminator: { paths: [{ d: 'M 3475 0 L 18125 0 A 3475 10800 3cd4 cd2 L 3475 21600 A 3475 10800 cd4 cd2 Z', w: 21600, h: 21600 }] },
  teardrop: {
    av: { adj: 100000 },
    gd: 'a: pin 0 adj 200000; r2: sqrt 2; tw: */ r2 wd2 1; th: */ r2 hd2 1; sw: */ tw a 100000; sh: */ th a 100000; dx1: cos sw 2700000; dy1: sin sh 2700000; x1: +- hc dx1 0; y1: +- vc 0 dy1; x2: +/ hc x1 2; y2: +/ vc y1 2',
    paths: ['M l vc A wd2 hd2 cd2 cd4 Q x2 t x1 y1 Q r y2 r vc A wd2 hd2 0 cd4 A wd2 hd2 cd4 cd4 Z'],
  },
  heart: {
    gd: 'dx1: */ w 49 48; dx2: */ w 10 48; x1: +- hc 0 dx1; x2: +- hc 0 dx2; x3: +- hc dx2 0; x4: +- hc dx1 0; y1: +- t 0 hd3',
    paths: ['M hc hd4 C x3 y1 x4 hd4 hc b C x1 hd4 x2 y1 hc hd4 Z'],
  },
  arc: {
    av: { adj1: 16200000, adj2: 0 },
    gd: 'stAng: pin 0 adj1 21599999; enAng: pin 0 adj2 21599999; sw11: +- enAng 0 stAng; sw12: +- sw11 21600000 0; swAng: ?: sw11 sw11 sw12; wt1: sin wd2 stAng; ht1: cos hd2 stAng; dx1: cat2 wd2 ht1 wt1; dy1: sat2 hd2 ht1 wt1; x1: +- hc dx1 0; y1: +- vc dy1 0',
    paths: [{ d: 'M x1 y1 A wd2 hd2 stAng swAng', fill: 'none' }],
  },
  wedgeRectCallout: {
    av: { adj1: -20833, adj2: 62500 },
    gd: 'dxPos: */ w adj1 100000; dyPos: */ h adj2 100000; xPos: +- hc dxPos 0; yPos: +- vc dyPos 0; xb1: */ w 5 12; xb2: */ w 7 12',
    paths: ['M l t L r t L r b L xb2 b L xPos yPos L xb1 b L l b Z'],
  },
  wedgeRoundRectCallout: {
    av: { adj1: -20833, adj2: 62500, adj3: 16667 },
    gd: 'dxPos: */ w adj1 100000; dyPos: */ h adj2 100000; xPos: +- hc dxPos 0; yPos: +- vc dyPos 0; xb1: */ w 5 12; xb2: */ w 7 12; a3: pin 0 adj3 50000; u1: */ ss a3 100000; u2: +- r 0 u1; v2: +- b 0 u1',
    paths: ['M l u1 A u1 u1 cd2 cd4 L u2 t A u1 u1 3cd4 cd4 L r v2 A u1 u1 0 cd4 L xb2 b L xPos yPos L xb1 b L u1 b A u1 u1 cd4 cd4 Z'],
  },
};

/** Shapes the « Formes » menu offers (fr-CA labels). */
export const SHAPE_CHOICES: Array<{ prst: string; label: string }> = [
  { prst: 'rect', label: 'Rectangle' },
  { prst: 'roundRect', label: tr('Rectangle arrondi', 'Rounded rectangle') },
  { prst: 'ellipse', label: 'Ellipse' },
  { prst: 'triangle', label: 'Triangle' },
  { prst: 'diamond', label: tr('Losange', 'Diamond') },
  { prst: 'hexagon', label: tr('Hexagone', 'Hexagon') },
  { prst: 'star5', label: tr('Étoile', 'Star') },
  { prst: 'rightArrow', label: tr('Flèche', 'Arrow') },
  { prst: 'chevron', label: 'Chevron' },
  { prst: 'wedgeRoundRectCallout', label: tr('Bulle', 'Callout') },
  { prst: 'line', label: tr('Ligne', 'Line') },
];

export const hasPreset = (prst: string) => prst in PRESETS;

/** Lines: presets drawn only as a stroke. */
export const isLinePreset = (prst: string | undefined) => !!prst && (/connector/i.test(prst) || prst === 'line' || prst === 'arc');

export interface SvgPath {
  d: string;
  fill: string;
  stroke: boolean;
}

function parseGuides(gd: string | undefined): Guide[] {
  return (gd ?? '')
    .split(';')
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => {
      const i = g.indexOf(':');
      return { name: g.slice(0, i).trim(), fmla: g.slice(i + 1).trim() };
    });
}

function parsePath(d: string): PathCmd[] {
  const tok = d.trim().split(/\s+/);
  const out: PathCmd[] = [];
  let i = 0;
  while (i < tok.length) {
    const c = tok[i++];
    const take = (n: number) => tok.slice(i, (i += n));
    switch (c) {
      case 'M': { const [x = '0', y = '0'] = take(2); out.push({ t: 'M', x, y }); break; }
      case 'L': { const [x = '0', y = '0'] = take(2); out.push({ t: 'L', x, y }); break; }
      case 'A': { const [wr = '0', hr = '0', st = '0', sw = '0'] = take(4); out.push({ t: 'A', wr, hr, st, sw }); break; }
      case 'C': out.push({ t: 'C', p: take(6) }); break;
      case 'Q': out.push({ t: 'Q', p: take(4) }); break;
      case 'Z': out.push({ t: 'Z' }); break;
    }
  }
  return out;
}

const presetCache = new Map<string, CustomGeometry>();

/** A preset as a custom geometry (adjust values from `av` override the defaults). */
export function presetGeometry(prst: string): CustomGeometry {
  let g = presetCache.get(prst);
  if (!g) {
    const def = PRESETS[prst] ?? PRESETS.rect!;
    g = {
      av: Object.entries(def.av ?? {}).map(([name, v]) => ({ name, fmla: `val ${v}` })),
      gd: parseGuides(def.gd),
      paths: def.paths.map((p) => {
        const spec = typeof p === 'string' ? { d: p } : p;
        return { w: spec.w, h: spec.h, fill: spec.fill ?? 'norm', stroke: spec.stroke ?? true, cmds: parsePath(spec.d) } satisfies GeomPath;
      }),
    };
    presetCache.set(prst, g);
  }
  return g;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Point on an ellipse at a visual angle (DrawingML arcs use the angle as seen, not the parameter). */
function ellipsePoint(wr: number, hr: number, ang: number): [number, number] {
  const a = rad(ang);
  const t = Math.atan2(wr * Math.sin(a), hr * Math.cos(a));
  return [wr * Math.cos(t), hr * Math.sin(t)];
}

/**
 * SVG paths of a geometry at a size (in the same unit as `w`, `h`).
 * `null` geometry = rectangle.
 */
export function geometryPaths(geom: Geometry | null | undefined, w: number, h: number): SvgPath[] {
  const g: CustomGeometry = !geom ? presetGeometry('rect') : geom.type === 'preset' ? presetGeometry(geom.prst) : geom;
  const vars = builtins(w, h);
  const own = geom?.type === 'preset' ? geom.av ?? [] : [];
  for (const a of g.av ?? []) vars.set(a.name, formula(own.find((o) => o.name === a.name)?.fmla ?? a.fmla, vars));
  for (const a of own) if (!vars.has(a.name)) vars.set(a.name, formula(a.fmla, vars));
  for (const gd of g.gd ?? []) vars.set(gd.name, formula(gd.fmla, vars));
  return g.paths.map((p) => {
    const sx = p.w ? w / p.w : 1;
    const sy = p.h ? h / p.h : 1;
    const X = (v: string) => value(vars, v) * sx;
    const Y = (v: string) => value(vars, v) * sy;
    let cx = 0;
    let cy = 0;
    let d = '';
    for (const c of p.cmds) {
      switch (c.t) {
        case 'M':
          cx = X(c.x);
          cy = Y(c.y);
          d += `M${fmt(cx)} ${fmt(cy)}`;
          break;
        case 'L':
          cx = X(c.x);
          cy = Y(c.y);
          d += `L${fmt(cx)} ${fmt(cy)}`;
          break;
        case 'C': {
          const v = c.p.map((s, i) => (i % 2 ? Y(s) : X(s)));
          d += `C${v.map(fmt).join(' ')}`;
          cx = v[4]!;
          cy = v[5]!;
          break;
        }
        case 'Q': {
          const v = c.p.map((s, i) => (i % 2 ? Y(s) : X(s)));
          d += `Q${v.map(fmt).join(' ')}`;
          cx = v[2]!;
          cy = v[3]!;
          break;
        }
        case 'A': {
          const wr = X(c.wr);
          const hr = Y(c.hr);
          const st = value(vars, c.st);
          const sw = value(vars, c.sw);
          if (wr <= 0 || hr <= 0) break;
          const [sx0, sy0] = ellipsePoint(wr, hr, st);
          const ox = cx - sx0;
          const oy = cy - sy0;
          // SVG arcs cannot draw a full turn: split long sweeps.
          const steps = Math.ceil(Math.abs(sw) / 10800000) || 1;
          const part = sw / steps;
          let a = st;
          for (let k = 0; k < steps; k++) {
            a += part;
            const [ex, ey] = ellipsePoint(wr, hr, a);
            cx = ox + ex;
            cy = oy + ey;
            d += `A${fmt(wr)} ${fmt(hr)} 0 ${Math.abs(part) > 10800000 ? 1 : 0} ${part > 0 ? 1 : 0} ${fmt(cx)} ${fmt(cy)}`;
          }
          break;
        }
        case 'Z':
          d += 'Z';
          break;
      }
    }
    return { d, fill: p.fill, stroke: p.stroke };
  });
}
