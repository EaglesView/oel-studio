/**
 * Every chart type the gallery offers (Figma H1 / H6), as the group settings
 * Office writes for it, plus conversions: change a chart's type keeping its
 * series, and build a new chart from a block of cells.
 */
import type { Axis, ChartSpec, Group, Series } from './types';

export interface ChartTypeInfo {
  id: string;
  family: string;
  label: string;
  /** Group settings for this type. */
  group: Partial<Group> & { kind: string };
  /** A scatter-like type (X values from the first column). */
  xy?: boolean;
  /** Needs a view3D. */
  view3d?: boolean;
  /** Types that read best with one series. */
  single?: boolean;
  /** chartEx: drawn, not yet written to files by the editor. */
  ex?: boolean;
}

const t = (id: string, family: string, label: string, group: ChartTypeInfo['group'], extra: Partial<ChartTypeInfo> = {}): ChartTypeInfo => ({ id, family, label, group, ...extra });

export const CHART_TYPES: ChartTypeInfo[] = [
  t('col-clustered', 'Colonnes', 'Colonnes groupées', { kind: 'bar', barDir: 'col', grouping: 'clustered' }),
  t('col-stacked', 'Colonnes', 'Colonnes empilées', { kind: 'bar', barDir: 'col', grouping: 'stacked', overlap: 100 }),
  t('col-percent', 'Colonnes', 'Colonnes empilées 100 %', { kind: 'bar', barDir: 'col', grouping: 'percentStacked', overlap: 100 }),
  t('col3d-clustered', 'Colonnes', 'Colonnes groupées 3D', { kind: 'bar', barDir: 'col', grouping: 'clustered', threeD: true, shape: 'box' }, { view3d: true }),
  t('col3d-stacked', 'Colonnes', 'Colonnes empilées 3D', { kind: 'bar', barDir: 'col', grouping: 'stacked', threeD: true, shape: 'box' }, { view3d: true }),
  t('col3d-percent', 'Colonnes', 'Colonnes empilées 100 % 3D', { kind: 'bar', barDir: 'col', grouping: 'percentStacked', threeD: true, shape: 'box' }, { view3d: true }),
  t('col3d', 'Colonnes', 'Colonnes 3D', { kind: 'bar', barDir: 'col', grouping: 'standard', threeD: true, shape: 'box' }, { view3d: true }),
  t('bar-clustered', 'Barres', 'Barres groupées', { kind: 'bar', barDir: 'bar', grouping: 'clustered' }),
  t('bar-stacked', 'Barres', 'Barres empilées', { kind: 'bar', barDir: 'bar', grouping: 'stacked', overlap: 100 }),
  t('bar-percent', 'Barres', 'Barres empilées 100 %', { kind: 'bar', barDir: 'bar', grouping: 'percentStacked', overlap: 100 }),
  t('bar3d-clustered', 'Barres', 'Barres groupées 3D', { kind: 'bar', barDir: 'bar', grouping: 'clustered', threeD: true, shape: 'box' }, { view3d: true }),
  t('bar3d-stacked', 'Barres', 'Barres empilées 3D', { kind: 'bar', barDir: 'bar', grouping: 'stacked', threeD: true, shape: 'box' }, { view3d: true }),
  t('bar3d-percent', 'Barres', 'Barres empilées 100 % 3D', { kind: 'bar', barDir: 'bar', grouping: 'percentStacked', threeD: true, shape: 'box' }, { view3d: true }),
  t('line', 'Courbes', 'Courbes', { kind: 'line', grouping: 'standard' }),
  t('line-stacked', 'Courbes', 'Courbes empilées', { kind: 'line', grouping: 'stacked' }),
  t('line-percent', 'Courbes', 'Courbes empilées 100 %', { kind: 'line', grouping: 'percentStacked' }),
  t('line-markers', 'Courbes', 'Courbes avec marques', { kind: 'line', grouping: 'standard', markers: true }),
  t('line-markers-stacked', 'Courbes', 'Courbes empilées avec marques', { kind: 'line', grouping: 'stacked', markers: true }),
  t('line-markers-percent', 'Courbes', 'Courbes 100 % avec marques', { kind: 'line', grouping: 'percentStacked', markers: true }),
  t('line3d', 'Courbes', 'Courbes 3D', { kind: 'line', grouping: 'standard', threeD: true }, { view3d: true }),
  t('pie', 'Secteurs', 'Secteurs', { kind: 'pie', varyColors: true }, { single: true }),
  t('pie3d', 'Secteurs', 'Secteurs 3D', { kind: 'pie', varyColors: true, threeD: true }, { single: true, view3d: true }),
  t('pie-of-pie', 'Secteurs', 'Secteurs de secteur', { kind: 'ofPie', varyColors: true, ofPieType: 'pie', gapWidth: 100, secondPieSize: 75 }, { single: true }),
  t('bar-of-pie', 'Secteurs', 'Barres de secteur', { kind: 'ofPie', varyColors: true, ofPieType: 'bar', gapWidth: 100, secondPieSize: 75 }, { single: true }),
  t('doughnut', 'Secteurs', 'Anneau', { kind: 'doughnut', varyColors: true, holeSize: 50 }),
  t('area', 'Aires', 'Aires', { kind: 'area', grouping: 'standard' }),
  t('area-stacked', 'Aires', 'Aires empilées', { kind: 'area', grouping: 'stacked' }),
  t('area-percent', 'Aires', 'Aires empilées 100 %', { kind: 'area', grouping: 'percentStacked' }),
  t('area3d', 'Aires', 'Aires 3D', { kind: 'area', grouping: 'standard', threeD: true }, { view3d: true }),
  t('area3d-stacked', 'Aires', 'Aires empilées 3D', { kind: 'area', grouping: 'stacked', threeD: true }, { view3d: true }),
  t('area3d-percent', 'Aires', 'Aires empilées 100 % 3D', { kind: 'area', grouping: 'percentStacked', threeD: true }, { view3d: true }),
  t('scatter', 'Nuages de points', 'Nuage de points', { kind: 'scatter', scatterStyle: 'lineMarker' }, { xy: true }),
  t('scatter-smooth-markers', 'Nuages de points', 'Lignes lissées et marques', { kind: 'scatter', scatterStyle: 'smoothMarker' }, { xy: true }),
  t('scatter-smooth', 'Nuages de points', 'Lignes lissées', { kind: 'scatter', scatterStyle: 'smooth' }, { xy: true }),
  t('scatter-lines-markers', 'Nuages de points', 'Lignes droites et marques', { kind: 'scatter', scatterStyle: 'lineMarker' }, { xy: true }),
  t('scatter-lines', 'Nuages de points', 'Lignes droites', { kind: 'scatter', scatterStyle: 'line' }, { xy: true }),
  t('bubble', 'Bulles', 'Bulles', { kind: 'bubble', bubbleScale: 100 }, { xy: true }),
  t('bubble3d', 'Bulles', 'Bulles avec effet 3D', { kind: 'bubble', bubbleScale: 100, threeD: true }, { xy: true }),
  t('stock-hlc', 'Boursiers', 'Haut-bas-fermeture', { kind: 'stock', hiLowLines: {} }),
  t('stock-ohlc', 'Boursiers', 'Ouverture-haut-bas-fermeture', { kind: 'stock', hiLowLines: {}, upDownBars: { gapWidth: 150 } }),
  t('surface3d', 'Surface', 'Surface 3D', { kind: 'surface', threeD: true }, { view3d: true }),
  t('surface3d-wire', 'Surface', 'Surface 3D filaire', { kind: 'surface', threeD: true, wireframe: true }, { view3d: true }),
  t('contour', 'Surface', 'Contour', { kind: 'surface' }),
  t('contour-wire', 'Surface', 'Contour filaire', { kind: 'surface', wireframe: true }),
  t('radar', 'Radar', 'Radar', { kind: 'radar', radarStyle: 'standard' }),
  t('radar-markers', 'Radar', 'Radar avec marques', { kind: 'radar', radarStyle: 'marker' }),
  t('radar-filled', 'Radar', 'Radar plein', { kind: 'radar', radarStyle: 'filled' }),
  t('treemap', 'Compartimentage', 'Compartimentage', { kind: 'treemap' }, { ex: true, single: true }),
  t('sunburst', 'Rayons de soleil', 'Rayons de soleil', { kind: 'sunburst' }, { ex: true, single: true }),
  t('histogram', 'Histogramme', 'Histogramme', { kind: 'clusteredColumn' }, { ex: true, single: true }),
  t('pareto', 'Histogramme', 'Pareto', { kind: 'clusteredColumn' }, { ex: true, single: true }),
  t('box-whisker', 'Zone et valeur', 'Zone et valeur', { kind: 'boxWhisker' }, { ex: true }),
  t('waterfall', 'Cascade', 'Cascade', { kind: 'waterfall' }, { ex: true, single: true }),
  t('funnel', 'Entonnoir', 'Entonnoir', { kind: 'funnel' }, { ex: true, single: true }),
  t('combo', 'Combiné', 'Colonnes groupées + courbe', { kind: 'bar', barDir: 'col', grouping: 'clustered' }),
  t('combo-secondary', 'Combiné', 'Colonnes + courbe sur axe secondaire', { kind: 'bar', barDir: 'col', grouping: 'clustered' }),
];

export const FAMILIES = [...new Set(CHART_TYPES.map((c) => c.family))];

/** The gallery entry that describes a spec (best match). */
export function chartFamily(spec: ChartSpec): ChartTypeInfo | undefined {
  const g = spec.groups[0];
  if (!g) return undefined;
  if (spec.groups.length > 1 && spec.groups.some((x) => x.kind === 'line')) return CHART_TYPES.find((c) => c.id === (spec.groups.some((x) => x.axisIds?.[1] !== spec.groups[0]!.axisIds?.[1]) ? 'combo-secondary' : 'combo'));
  const score = (c: ChartTypeInfo) => {
    let s = 0;
    for (const [k, v] of Object.entries(c.group)) {
      const gv = (g as Record<string, unknown>)[k];
      if (k === 'kind' ? gv === v : JSON.stringify(gv ?? null) === JSON.stringify(v ?? null)) s += k === 'kind' ? 10 : 1;
      else if (k === 'kind') return -1;
    }
    if (!!g.threeD !== !!c.group.threeD) s -= 5;
    return s;
  };
  return [...CHART_TYPES].sort((a, b) => score(b) - score(a))[0];
}

const AX_CAT = 500000001;
const AX_VAL = 500000002;
const AX_VAL2 = 500000003;
const AX_SER = 500000004;

function axesFor(info: ChartTypeInfo, prev: Axis[] = []): Axis[] {
  const keep = (id: number) => prev.find((a) => a.id === id);
  const kind = info.group.kind;
  if (['pie', 'doughnut', 'ofPie'].includes(kind) || info.ex) return [];
  const horizontal = info.group.barDir === 'bar';
  const cat: Axis = keep(AX_CAT) ?? { id: AX_CAT, kind: info.xy ? 'val' : 'cat', pos: horizontal ? 'l' : 'b', crossAx: AX_VAL, crosses: 'autoZero', majorTick: 'none', minorTick: 'none', tickLblPos: 'nextTo' };
  cat.kind = info.xy ? 'val' : 'cat';
  cat.pos = horizontal ? 'l' : 'b';
  const val: Axis = keep(AX_VAL) ?? { id: AX_VAL, kind: 'val', pos: horizontal ? 'b' : 'l', crossAx: AX_CAT, crosses: 'autoZero', crossBetween: info.xy ? 'midCat' : 'between', majorGrid: {}, majorTick: 'none', minorTick: 'none', tickLblPos: 'nextTo' };
  val.pos = horizontal ? 'b' : 'l';
  val.crossBetween = info.xy || kind === 'area' ? 'midCat' : 'between';
  const out = [cat, val];
  if ((info.group.grouping === 'standard' && info.group.threeD) || kind === 'surface') out.push(keep(AX_SER) ?? { id: AX_SER, kind: 'ser', pos: 'b', crossAx: AX_VAL, crosses: 'autoZero', majorTick: 'none', minorTick: 'none', tickLblPos: 'nextTo', delete: kind === 'surface' && !info.group.threeD });
  return out;
}

/** Change a chart's type: series, titles and formatting stay; group settings and axes follow the new type. */
export function applyType(spec: ChartSpec, typeId: string): ChartSpec {
  const info = CHART_TYPES.find((c) => c.id === typeId);
  if (!info) return spec;
  const series: Series[] = spec.groups.flatMap((g) => g.series).map((s, i) => ({ ...s, order: i }));
  const ids = info.group.kind === 'surface' || (info.group.threeD && info.group.grouping === 'standard') ? [AX_CAT, AX_VAL, AX_SER] : [AX_CAT, AX_VAL];
  const base = (extra: Partial<Group>, ser: Series[], axisIds = ids): Group => ({ ...info.group, ...extra, axisIds: ['pie', 'doughnut', 'ofPie'].includes(info.group.kind) ? [] : axisIds, series: ser });
  let groups: Group[];
  if ((typeId === 'combo' || typeId === 'combo-secondary') && series.length > 1) {
    const last = series[series.length - 1]!;
    const line: Group = { kind: 'line', grouping: 'standard', markers: true, axisIds: typeId === 'combo-secondary' ? [AX_CAT, AX_VAL2] : [AX_CAT, AX_VAL], series: [last] };
    groups = [base({}, series.slice(0, -1)), line];
  } else {
    groups = [base({}, info.single ? series.slice(0, 1).concat(series.slice(1)) : series)];
  }
  let axes = axesFor(info, spec.axes);
  if (typeId === 'combo-secondary') axes = [...axes, { id: AX_VAL2, kind: 'val', pos: 'r', crossAx: AX_CAT, crosses: 'max', crossBetween: 'between', majorTick: 'none', minorTick: 'none', tickLblPos: 'nextTo' }];
  const view3d = info.view3d ? (spec.view3d ?? (info.group.kind === 'pie' ? { rotX: 30, rotY: 0, rAngAx: false } : info.group.kind === 'surface' ? { rotX: 15, rotY: 20, rAngAx: false, perspective: 30 } : { rotX: 15, rotY: 20, rAngAx: true })) : undefined;
  const pieLike = ['pie', 'doughnut', 'ofPie'].includes(info.group.kind);
  return {
    ...spec,
    groups,
    axes,
    view3d,
    legend: spec.legend ?? { pos: pieLike ? 'r' : 'b' },
  };
}

export interface CellBlock {
  /** Sheet name as written in references (quoted when needed by the caller). */
  sheet: string;
  /** 0-based, inclusive. */
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  /** Cell text at (r, c), absolute coordinates. */
  text: (r: number, c: number) => string;
  /** Cell number at (r, c), or null. */
  num: (r: number, c: number) => number | null;
}

const colName = (c: number) => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const abs = (sheet: string, r0: number, c0: number, r1 = r0, c1 = c0) => {
  const q = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  const a = `$${colName(c0)}$${r0 + 1}`;
  return r0 === r1 && c0 === c1 ? `${q}!${a}` : `${q}!${a}:$${colName(c1)}$${r1 + 1}`;
};

/**
 * A new chart from a block of cells, the way Excel reads a selection: a text
 * first row and/or column are labels, and series run along the longer side
 * (rows when there are more columns than rows, like Excel's « Lignes/colonnes » guess).
 */
export function newChart(block: CellBlock, typeId = 'col-clustered', seriesInRows?: boolean): ChartSpec {
  const { r0, c0, r1, c1 } = block;
  const isLabel = (r: number, c: number) => block.num(r, c) == null && block.text(r, c) !== '';
  const headerRow = r1 > r0 && Array.from({ length: c1 - c0 + 1 }, (_, k) => c0 + k).some((c) => isLabel(r0, c)) && Array.from({ length: c1 - c0 }, (_, k) => c0 + 1 + k).every((c) => block.num(r0, c) == null);
  const headerCol = c1 > c0 && Array.from({ length: r1 - r0 + 1 }, (_, k) => r0 + k).every((r) => r === r0 || block.num(r, c0) == null);
  const dr0 = r0 + (headerRow ? 1 : 0);
  const dc0 = c0 + (headerCol ? 1 : 0);
  const rows = r1 - dr0 + 1;
  const cols = c1 - dc0 + 1;
  const inRows = seriesInRows ?? cols > rows;
  const series: Series[] = [];
  const count = inRows ? rows : cols;
  for (let k = 0; k < count; k++) {
    const vr0 = inRows ? dr0 + k : dr0;
    const vr1 = inRows ? dr0 + k : r1;
    const vc0 = inRows ? dc0 : dc0 + k;
    const vc1 = inRows ? c1 : dc0 + k;
    const nameAt = inRows ? (headerCol ? [dr0 + k, c0] : null) : headerRow ? [r0, dc0 + k] : null;
    const catR = inRows ? (headerRow ? [r0, dc0, r0, c1] : null) : headerCol ? [dr0, c0, r1, c0] : null;
    const nums: (number | null)[] = [];
    for (let r = vr0; r <= vr1; r++) for (let c = vc0; c <= vc1; c++) nums.push(block.num(r, c));
    const cats: (string | null)[] = [];
    if (catR) for (let r = catR[0]!; r <= catR[2]!; r++) for (let c = catR[1]!; c <= catR[3]!; c++) cats.push(block.text(r, c));
    series.push({
      idx: k,
      order: k,
      name: nameAt ? block.text(nameAt[0]!, nameAt[1]!) : `Série${k + 1}`,
      nameRef: nameAt ? abs(block.sheet, nameAt[0]!, nameAt[1]!) : undefined,
      cat: catR ? { f: abs(block.sheet, catR[0]!, catR[1]!, catR[2]!, catR[3]!), str: cats, count: cats.length } : undefined,
      val: { f: abs(block.sheet, vr0, vc0, vr1, vc1), num: nums, count: nums.length, format: 'General' },
    });
  }
  const base: ChartSpec = { groups: [{ kind: 'bar', series }], axes: [], legend: series.length > 1 ? { pos: 'b' } : undefined, title: series.length === 1 ? undefined : { text: 'Titre du graphique' }, autoTitleDeleted: false };
  return applyType(base, typeId);
}

/** Excel-style recommendations for a block, best first, with the reason shown in the gallery. */
export function recommend(spec: ChartSpec): { id: string; reason: string }[] {
  const series = spec.groups.flatMap((g) => g.series);
  const cats = series[0]?.cat?.str ?? [];
  const values = series.flatMap((s) => s.val?.num ?? []).filter((v): v is number => v != null);
  const out: { id: string; reason: string }[] = [];
  const dateLike = cats.length > 2 && cats.every((c) => !!c && (/^\d{4}([-/]\d{1,2})?$/.test(c) || /^(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc|jan|fév)/i.test(c)));
  if (dateLike) out.push({ id: 'line-markers', reason: 'Vos catégories suivent le temps' });
  out.push({ id: 'col-clustered', reason: 'Comparer des valeurs entre catégories' });
  if (series.length === 1 && values.length > 1 && values.length <= 8 && values.every((v) => v >= 0)) out.push({ id: 'pie', reason: 'Une seule série de parts d’un tout' });
  if (series.length > 1) out.push({ id: 'col-stacked', reason: 'Voir le total et la part de chaque série' });
  if (cats.some((c) => (c ?? '').length > 12)) out.push({ id: 'bar-clustered', reason: 'Vos catégories ont des noms longs' });
  if (series.length >= 2 && cats.length === 0) out.push({ id: 'scatter', reason: 'Deux colonnes de nombres' });
  if (!dateLike) out.push({ id: 'line', reason: 'Montrer une tendance' });
  const seen = new Set<string>();
  return out.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 6);
}
