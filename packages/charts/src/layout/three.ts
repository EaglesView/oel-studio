/**
 * 3-D charts drawn as projected polygons, sorted back to front (painter's
 * algorithm), which is how Office draws them: 3-D columns and bars (boxes,
 * cylinders, cones, pyramids), 3-D lines (ribbons), 3-D areas, 3-D and
 * wireframe surfaces, and the flat contour charts.
 */
import { categoryCount } from '../data';
import { formatValue } from '../format';
import { frac, type Scale, valueScale } from '../scale';
import { Ctx, GRID_GREY, PT, shade } from '../style';
import type { Paint, ResolvedChart, SeriesData, Stroke } from '../types';
import type { Rect } from './frame';

type V3 = [number, number, number];
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

interface Face {
  pts: V3[];
  fill: Paint | null;
  line: Stroke | null;
  id?: string;
  /** Faces of walls are always drawn first. */
  wall?: boolean;
}

/** Camera from `view3D`: world (x right, y up, z into the screen) → screen. */
function camera(ctx: Ctx, box: V3, area: Rect, oblique: boolean) {
  const v = ctx.spec.view3d ?? {};
  const rx = ((v.rotX ?? 15) * Math.PI) / 180;
  const ry = ((v.rotY ?? 20) * Math.PI) / 180;
  const persp = oblique || v.rAngAx ? 0 : ((v.perspective ?? 30) / 240) * 1.2;
  const c: V3 = [box[0] / 2, box[1] / 2, box[2] / 2];
  const rot = (p: V3): V3 => {
    const x = p[0] - c[0];
    const y = p[1] - c[1];
    const z = p[2] - c[2];
    if (oblique || v.rAngAx) {
      // Right-angle axes: x and y stay axis-aligned, depth goes up and to the right.
      const k = 0.55;
      return [x + z * Math.cos(rx) * Math.sin(ry) * k * 1.8, y + z * Math.sin(rx) * k * 1.8, z];
    }
    const x1 = x * Math.cos(ry) + z * Math.sin(ry);
    const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
    const y2 = y * Math.cos(rx) + z1 * Math.sin(rx);
    const z2 = -y * Math.sin(rx) + z1 * Math.cos(rx);
    return [x1, y2, z2];
  };
  const span = Math.max(...box);
  const proj0 = (p: V3): [number, number, number] => {
    const [x, y, z] = rot(p);
    const k = persp ? 1 / (1 + (persp * z) / span) : 1;
    return [x * k, -y * k, z];
  };
  // Fit the projected bounding box into the area.
  const corners: V3[] = [];
  for (const x of [0, box[0]]) for (const y of [0, box[1]]) for (const z of [0, box[2]]) corners.push([x, y, z]);
  const pc = corners.map(proj0);
  const minX = Math.min(...pc.map((p) => p[0]));
  const maxX = Math.max(...pc.map((p) => p[0]));
  const minY = Math.min(...pc.map((p) => p[1]));
  const maxY = Math.max(...pc.map((p) => p[1]));
  const s = Math.min(area.w / (maxX - minX || 1), area.h / (maxY - minY || 1));
  const ox = area.x + (area.w - (maxX - minX) * s) / 2 - minX * s;
  const oy = area.y + (area.h - (maxY - minY) * s) / 2 - minY * s;
  return {
    p: (q: V3): [number, number] => {
      const [x, y] = proj0(q);
      return [ox + x * s, oy + y * s];
    },
    depth: (q: V3) => rot(q)[2],
  };
}

function polyD(pts: [number, number][]) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`).join('') + 'Z';
}

function drawFaces(ctx: Ctx, cam: ReturnType<typeof camera>, faces: Face[]) {
  const visible = faces
    .map((f) => {
      const sp = f.pts.map(cam.p);
      let area2 = 0;
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i]!;
        const b = sp[(i + 1) % sp.length]!;
        area2 += a[0] * b[1] - b[0] * a[1];
      }
      const depth = f.pts.reduce((s, q) => s + cam.depth(q), 0) / f.pts.length;
      return { f, sp, area2, depth };
    })
    .filter((x) => x.f.wall || Math.abs(x.area2) > 0.01);
  visible.sort((a, b) => (a.f.wall === b.f.wall ? b.depth - a.depth : a.f.wall ? -1 : 1));
  for (const { f, sp } of visible) ctx.push({ t: 'path', id: f.id, d: polyD(sp), fill: f.fill ?? undefined, stroke: f.line ?? undefined });
}

/** A prism (box, cylinder, cone, pyramid) from y0 to y1 centred on (cx, cz). */
function prism(x: number, z: number, w: number, d: number, y0: number, y1: number, shapeName: string, yMax: number, fill: Paint | null, line: Stroke | null, id: string): Face[] {
  const round = shapeName.startsWith('cylinder') || shapeName.startsWith('cone');
  const k = round ? 16 : 4;
  const taper = shapeName.startsWith('cone') || shapeName.startsWith('pyramid');
  const toMax = shapeName.endsWith('ToMax');
  const top = taper ? (toMax ? Math.max(0, 1 - y1 / (yMax || 1)) : 0) : 1;
  const bottom = taper && toMax ? Math.max(0, 1 - y0 / (yMax || 1)) : 1;
  const ring = (y: number, sc: number): V3[] =>
    Array.from({ length: k }, (_, i) => {
      const a = round ? (i / k) * Math.PI * 2 : (i / 4) * Math.PI * 2 + Math.PI / 4;
      const r = round ? 0.5 : Math.SQRT1_2;
      return [x + Math.cos(a) * w * r * sc, y, z + Math.sin(a) * d * r * sc] as V3;
    });
  const lo = ring(y0, bottom);
  const hi = ring(y1, top);
  const faces: Face[] = [];
  const side = (i: number) => (round ? shade(fill ?? '#BFBFBF', 0.75 + 0.25 * Math.cos((i / k) * Math.PI * 2 - 0.8)) : i % 2 ? shade(fill ?? '#BFBFBF', 0.78) : fill);
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    faces.push({ pts: [lo[i]!, lo[j]!, hi[j]!, hi[i]!], fill: side(i), line: round ? null : line, id });
  }
  if (top > 0) faces.push({ pts: [...hi].reverse(), fill: fill ? shade(fill, 1.12) : null, line, id });
  faces.push({ pts: lo, fill, line, id });
  return faces;
}

function walls(ctx: Ctx, W: number, H: number, D: number, scale: Scale, yOf: (v: number) => number): Face[] {
  const spec = ctx.spec;
  const look = (s: typeof spec.floor, def: Paint | null) => ctx.box(s, def, null);
  const back = look(spec.backWall, null);
  const side = look(spec.sideWall, null);
  const floor = look(spec.floor, null);
  const edge: Stroke = { color: GRID_GREY, width: 0.75 * PT };
  const faces: Face[] = [
    { pts: [[0, 0, D], [W, 0, D], [W, H, D], [0, H, D]], fill: back.fill, line: back.line ?? null, wall: true, id: 'backWall' },
    { pts: [[0, 0, 0], [0, 0, D], [0, H, D], [0, H, 0]], fill: side.fill, line: side.line ?? null, wall: true, id: 'sideWall' },
    { pts: [[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]], fill: floor.fill, line: floor.line ?? edge, wall: true, id: 'floor' },
  ];
  // Gridlines on the back and side walls.
  for (const t of scale.ticks) {
    const y = yOf(t);
    faces.push({ pts: [[0, y, D], [W, y, D], [W, y, D], [0, y, D]], fill: null, line: edge, wall: true, id: 'gridlines' });
    faces.push({ pts: [[0, y, 0], [0, y, D], [0, y, D], [0, y, 0]], fill: null, line: edge, wall: true, id: 'gridlines' });
  }
  return faces;
}

export function bars3d(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const all = data.series.filter((s) => !s.series.hidden && s.group.threeD && ['bar', 'line', 'area'].includes(s.group.kind));
  const g = all[0]?.group;
  if (!g) return;
  const horizontal = g.kind === 'bar' && g.barDir === 'bar';
  const n = Math.max(1, categoryCount(all));
  const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
  const pct = g.grouping === 'percentStacked';
  // `standard` grouping (3-D columns, lines, areas): series stand one behind the other.
  const deep = g.kind !== 'bar' || g.grouping === 'standard';
  const rows = deep ? all.length : 1;
  const totals = Array.from({ length: n }, (_, i) => all.reduce((t, s) => t + Math.abs(s.values[i] ?? 0), 0) || 1);
  const tops: { lo: number; hi: number }[][] = all.map(() => []);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    let pos = 0;
    let neg = 0;
    all.forEach((s, k) => {
      const raw = s.values[i] ?? 0;
      const v = pct ? raw / totals[i]! : raw;
      if (stacked) {
        if (v >= 0) {
          tops[k]![i] = { lo: pos, hi: pos + v };
          pos += v;
        } else {
          tops[k]![i] = { lo: neg, hi: neg + v };
          neg += v;
        }
      } else tops[k]![i] = { lo: 0, hi: v };
      lo = Math.min(lo, tops[k]![i]!.lo, tops[k]![i]!.hi);
      hi = Math.max(hi, tops[k]![i]!.lo, tops[k]![i]!.hi);
    });
  }
  const valAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'val');
  const catAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'cat');
  const serAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'ser');
  const scale = valueScale(lo, hi, { min: valAx?.min, max: valAx?.max, major: valAx?.majorUnit, length: area.h, includeZero: true, percent: pct });
  const v3 = ctx.spec.view3d ?? {};
  const W = n;
  const D = rows * ((v3.depthPercent ?? 100) / 100) * (deep ? 1 : 0.9);
  const H = Math.max(n, rows) * 0.62 * ((v3.hPercent ?? 100) / 100);
  const yOf = (v: number) => frac(scale, v) * H;
  // Leave room for labels around the projection.
  const ts = ctx.text(valAx?.text);
  const lw = Math.max(...scale.ticks.map((t) => ctx.measure(formatValue(t, valAx?.numFmt ?? all[0]!.format), ts))) + 10;
  const inner = { x: area.x + (horizontal ? 60 : lw), y: area.y + 6, w: area.w - (horizontal ? 60 : lw) - (deep ? 50 : 10), h: area.h - ts.size * 2.4 - 6 };
  // Horizontal 3-D bars: draw columns in a rotated world (x = value, y = category).
  const box: V3 = horizontal ? [H, W, D] : [W, H, D];
  const cam = camera(ctx, box, inner, false);
  const faces: Face[] = [];
  if (!horizontal) faces.push(...walls(ctx, W, H, D, scale, yOf));
  else {
    const edge: Stroke = { color: GRID_GREY, width: 0.75 * PT };
    faces.push({ pts: [[0, 0, D], [H, 0, D], [H, W, D], [0, W, D]], fill: null, line: null, wall: true, id: 'backWall' });
    for (const t of scale.ticks) faces.push({ pts: [[yOf(t), 0, D], [yOf(t), W, D], [yOf(t), W, D], [yOf(t), 0, D]], fill: null, line: edge, wall: true, id: 'gridlines' });
  }
  const gap = (g.gapWidth ?? 150) / 100;
  const shapeName = g.shape ?? 'box';
  all.forEach((s, k) => {
    const look = ctx.seriesLook(s, null, 'fill');
    const zc = deep ? (k + 0.5) * (D / rows) : D / 2;
    const dz = (D / rows) * (deep ? 1 / (1 + ((g.gapDepth ?? 150) / 100) * 0.5) : 0.6);
    if (g.kind === 'bar') {
      const clusters = deep || stacked ? 1 : all.length;
      const w = 1 / (1 + gap) / clusters;
      for (let i = 0; i < n; i++) {
        if (s.values[i] == null) continue;
        const t = tops[k]![i]!;
        const pl = ctx.seriesLook(s, i, 'fill');
        const xc = i + 0.5 + (clusters > 1 ? (k - (clusters - 1) / 2) * w : 0);
        const fl = prism(xc, zc, w * 0.98, dz, yOf(Math.min(t.lo, t.hi)), yOf(Math.max(t.lo, t.hi)), shapeName, yOf(scale.max), pl.fill, pl.line, `point:${s.index}:${i}`);
        faces.push(...(horizontal ? fl.map((f) => ({ ...f, pts: f.pts.map(([x, y, z]) => [y, x, z] as V3) })) : fl));
      }
    } else if (g.kind === 'line') {
      // Ribbon along the categories, a little thickness downward.
      const th = H * 0.025;
      const lineLook = ctx.seriesLook(s, null, 'line');
      const fill = lineLook.line?.color ?? (typeof look.fill === 'string' ? look.fill : '#4472C4');
      for (let i = 0; i < n - 1; i++) {
        const a = s.values[i];
        const b = s.values[i + 1];
        if (a == null || b == null) continue;
        const x0 = i + 0.5;
        const x1 = i + 1.5;
        const y0 = yOf(stacked ? tops[k]![i]!.hi : a);
        const y1 = yOf(stacked ? tops[k]![i + 1]!.hi : b);
        const z0 = zc - dz / 2;
        const z1 = zc + dz / 2;
        faces.push({ pts: [[x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]], fill: shade(fill, 1.1), line: null, id: `series:${s.index}` });
        faces.push({ pts: [[x0, y0, z0], [x1, y1, z0], [x1, y1 - th, z0], [x0, y0 - th, z0]], fill, line: null, id: `series:${s.index}` });
      }
    } else {
      // 3-D area: front face, top strips, end caps.
      const z0 = zc - dz / 2;
      const z1 = zc + dz / 2;
      const ys = Array.from({ length: n }, (_, i) => yOf(stacked ? (tops[k]![i]?.hi ?? 0) : (s.values[i] ?? 0)));
      const bases = Array.from({ length: n }, (_, i) => yOf(stacked ? (tops[k]![i]?.lo ?? 0) : Math.max(0, scale.min)));
      const xs = Array.from({ length: n }, (_, i) => (n === 1 ? 0.5 : (i / (n - 1)) * W));
      const front: V3[] = [...xs.map((x, i) => [x, ys[i]!, z0] as V3), ...xs.map((x, i) => [x, bases[i]!, z0] as V3).reverse()];
      faces.push({ pts: front, fill: look.fill, line: look.line, id: `series:${s.index}` });
      for (let i = 0; i < n - 1; i++) faces.push({ pts: [[xs[i]!, ys[i]!, z0], [xs[i + 1]!, ys[i + 1]!, z0], [xs[i + 1]!, ys[i + 1]!, z1], [xs[i]!, ys[i]!, z1]], fill: look.fill ? shade(look.fill, 1.15) : null, line: null, id: `series:${s.index}` });
      faces.push({ pts: [[xs[n - 1]!, bases[n - 1]!, z0], [xs[n - 1]!, ys[n - 1]!, z0], [xs[n - 1]!, ys[n - 1]!, z1], [xs[n - 1]!, bases[n - 1]!, z1]], fill: look.fill ? shade(look.fill, 0.75) : null, line: null, id: `series:${s.index}` });
    }
  });
  drawFaces(ctx, cam, faces);
  // Labels: values up the left edge of the back wall, categories along the front, series along the depth.
  if (!valAx?.delete) {
    for (const t of scale.ticks) {
      const [x, y] = horizontal ? cam.p([yOf(t), 0, 0]) : cam.p([0, yOf(t), D]);
      ctx.label(formatValue(t, valAx?.numFmt ?? (pct ? '0%' : all[0]!.format)), horizontal ? x : x - 6, horizontal ? y + 6 : y, ts, horizontal ? 'middle' : 'end', horizontal ? 'top' : 'middle', `axis:${valAx?.id ?? 0}`);
    }
  }
  if (!catAx?.delete) {
    const tc = ctx.text(catAx?.text);
    const cats = all[0]!.cats;
    for (let i = 0; i < n; i++) {
      const xi = g.kind === 'area' ? (n === 1 ? 0.5 : (i / (n - 1)) * W) : i + 0.5;
      const [x, y] = horizontal ? cam.p([0, xi, 0]) : cam.p([xi, 0, 0]);
      ctx.label(cats[i] ?? '', horizontal ? x - 6 : x, horizontal ? y : y + 6, tc, horizontal ? 'end' : 'middle', horizontal ? 'middle' : 'top', `axis:${catAx?.id ?? 0}`);
    }
  }
  if (deep && !serAx?.delete) {
    const tser = ctx.text(serAx?.text);
    all.forEach((s, k) => {
      const [x, y] = cam.p([W, 0, (k + 0.5) * (D / rows)]);
      ctx.label(s.name, x + 6, y, tser, 'start', 'middle', `axis:${serAx?.id ?? 0}`);
    });
  }
  ctx.hit('plot', inner.x, inner.y, inner.w, inner.h);
}

// ---------------------------------------------------------------- surfaces

export function surfaceBands(scale: Scale, palette: string[]) {
  const bands: { lo: number; hi: number; color: string }[] = [];
  for (let i = 0; i < scale.ticks.length - 1; i++) bands.push({ lo: scale.ticks[i]!, hi: scale.ticks[i + 1]!, color: palette[i % palette.length]! });
  return bands;
}

export function surfaceScale(ctx: Ctx, series: SeriesData[]) {
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const valAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'val');
  return valueScale(Math.min(...vals), Math.max(...vals), { min: valAx?.min, max: valAx?.max, major: valAx?.majorUnit, length: 200 });
}

export function surface(ctx: Ctx, data: ResolvedChart, area: Rect) {
  const ser = data.series.filter((s) => !s.series.hidden && s.group.kind === 'surface');
  const g = ser[0]?.group;
  if (!g) return;
  const n = Math.max(2, categoryCount(ser));
  const m = ser.length;
  const scale = surfaceScale(ctx, ser);
  const bands = surfaceBands(scale, ctx.palette);
  const band = (v: number) => bands.find((b) => v >= b.lo && v <= b.hi) ?? bands[bands.length - 1]!;
  const z = (i: number, j: number) => ser[j]?.values[i] ?? 0;
  const wire = g.wireframe;
  const valAx = (ctx.spec.axes ?? []).find((a) => a.kind === 'val');
  const ts = ctx.text(valAx?.text);
  if (!g.threeD) {
    // Contour: seen from above, one cell per pair of neighbours, coloured by band.
    const cw = area.w / Math.max(1, n - 1);
    const ch = area.h / Math.max(1, m - 1);
    for (let j = 0; j < Math.max(1, m - 1); j++) {
      for (let i = 0; i < n - 1; i++) {
        const avg = (z(i, j) + z(i + 1, j) + z(i, Math.min(m - 1, j + 1)) + z(i + 1, Math.min(m - 1, j + 1))) / 4;
        const b = band(avg);
        ctx.push({ t: 'rect', id: 'plot', x: area.x + i * cw, y: area.y + area.h - (j + 1) * ch, w: cw + 0.5, h: ch + 0.5, fill: wire ? undefined : b.color, stroke: wire ? { color: b.color, width: 1 } : undefined });
      }
    }
    ctx.hit('plot', area.x, area.y, area.w, area.h);
    return;
  }
  const W = n - 1;
  const D = Math.max(1, m - 1);
  const H = Math.max(W, D) * 0.6;
  const yOf = (v: number) => frac(scale, v) * H;
  const lw = Math.max(...scale.ticks.map((t) => ctx.measure(formatValue(t, valAx?.numFmt), ts))) + 10;
  const inner = { x: area.x + lw, y: area.y + 6, w: area.w - lw - 40, h: area.h - ts.size * 2.4 - 6 };
  const cam = camera(ctx, [W, H, D], inner, false);
  const faces: Face[] = walls(ctx, W, H, D, scale, yOf);
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const q: V3[] = [
        [i, yOf(z(i, j)), j],
        [i + 1, yOf(z(i + 1, j)), j],
        [i + 1, yOf(z(i + 1, Math.min(m - 1, j + 1))), j + 1],
        [i, yOf(z(i, Math.min(m - 1, j + 1))), j + 1],
      ];
      const avg = (z(i, j) + z(i + 1, j) + z(i, Math.min(m - 1, j + 1)) + z(i + 1, Math.min(m - 1, j + 1))) / 4;
      const b = band(avg);
      faces.push({ pts: q, fill: wire ? null : b.color, line: wire ? { color: b.color, width: 1 } : { color: shade(b.color, 0.7) as string, width: 0.4 }, id: 'plot', wall: false });
    }
  }
  // Surfaces are seen from both sides: keep back faces.
  drawFacesTwoSided(ctx, cam, faces);
  for (const t of scale.ticks) {
    const [x, y] = cam.p([0, yOf(t), D]);
    ctx.label(formatValue(t, valAx?.numFmt), x - 6, y, ts, 'end', 'middle', `axis:${valAx?.id ?? 0}`);
  }
  const cats = ser[0]!.cats;
  for (let i = 0; i < n; i++) {
    const [x, y] = cam.p([i, 0, 0]);
    ctx.label(cats[i] ?? '', x, y + 6, ts, 'middle', 'top', 'axis:cat');
  }
  ser.forEach((s, j) => {
    const [x, y] = cam.p([W, 0, j]);
    ctx.label(s.name, x + 6, y, ts, 'start', 'middle', 'axis:ser');
  });
  ctx.hit('plot', inner.x, inner.y, inner.w, inner.h);
}

function drawFacesTwoSided(ctx: Ctx, cam: ReturnType<typeof camera>, faces: Face[]) {
  const list = faces.map((f) => ({ f, sp: f.pts.map(cam.p), depth: f.pts.reduce((s, q) => s + cam.depth(q), 0) / f.pts.length }));
  list.sort((a, b) => (a.f.wall === b.f.wall ? b.depth - a.depth : a.f.wall ? -1 : 1));
  for (const { f, sp } of list) ctx.push({ t: 'path', id: f.id, d: polyD(sp), fill: f.fill ?? undefined, stroke: f.line ?? undefined });
}
