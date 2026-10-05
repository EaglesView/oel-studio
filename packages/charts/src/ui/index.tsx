/**
 * Chart editing pieces shared by the hosts (Figma H2): Office palettes, the
 * « Éléments » checklist. The sheet's full chart tools build on these, and so
 * do the bars over chart copies in slides and documents.
 */
import { Dialog } from 'react-aria-components';
import { Checkbox, Radio, RadioGroup } from '@oel/emboss';
import type { Axis, ChartSpec, Group, Series } from '../types';

/** Office palettes offered by « Couleurs » (colourful, then monochrome). */
export const PALETTES: Array<{ id: string; label: string; colors: string[] }> = [
  { id: 'office', label: 'Couleurs Office', colors: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'] },
  { id: 'emboss', label: 'OutilsEnLigne', colors: ['#7759C5', '#F0AD05', '#1E8E3E', '#E5484D', '#3B82F6', '#6B6375'] },
  { id: 'colorful2', label: 'Couleurs vives', colors: ['#ED7D31', '#FFC000', '#70AD47', '#4472C4', '#5B9BD5', '#A5A5A5'] },
  { id: 'blue', label: 'Monochrome bleu', colors: ['#1F3864', '#2F5597', '#4472C4', '#8FAADC', '#B4C7E7', '#DAE3F3'] },
  { id: 'orange', label: 'Monochrome orange', colors: ['#843C0C', '#C55A11', '#ED7D31', '#F4B183', '#F8CBAD', '#FBE5D6'] },
  { id: 'green', label: 'Monochrome vert', colors: ['#385723', '#548235', '#70AD47', '#A9D18E', '#C5E0B4', '#E2F0D9'] },
  { id: 'grey', label: 'Niveaux de gris', colors: ['#262626', '#595959', '#7F7F7F', '#A6A6A6', '#BFBFBF', '#D9D9D9'] },
];

export const allSeries = (s: ChartSpec) => s.groups.flatMap((g) => g.series);
export const mapSeries = (s: ChartSpec, fn: (x: Series, g: Group) => Series): ChartSpec => ({ ...s, groups: s.groups.map((g) => ({ ...g, series: g.series.map((x) => fn(x, g)) })) });
export const mapGroups = (s: ChartSpec, fn: (g: Group) => Group): ChartSpec => ({ ...s, groups: s.groups.map(fn) });
export const mapAxes = (s: ChartSpec, fn: (a: Axis) => Axis): ChartSpec => ({ ...s, axes: (s.axes ?? []).map(fn) });
export const pieLike = (s: ChartSpec) => ['pie', 'doughnut', 'ofPie'].includes(s.groups[0]?.kind ?? '');

/** Palette change: series follow the new colours (explicit fills are dropped, like Excel's « Modifier les couleurs »). */
export function withPalette(spec: ChartSpec, colors: string[]): ChartSpec {
  const strip = (sh: Series['shape']) => (sh ? { ...sh, fill: sh.fill?.kind === 'none' ? sh.fill : undefined, line: sh.line ? { ...sh.line, color: undefined } : undefined } : sh);
  return { ...mapSeries(spec, (x) => ({ ...x, shape: strip(x.shape), points: x.points?.map((p) => ({ ...p, shape: strip(p.shape) })), marker: x.marker ? { ...x.marker, shape: undefined } : x.marker })), palette: [...colors, ...colors.map((c) => c)] };
}

// ---------------------------------------------------------------------------
// Elements (« + »)
// ---------------------------------------------------------------------------

export interface ElementDef {
  id: string;
  label: string;
  on: (s: ChartSpec) => boolean;
  toggle: (s: ChartSpec, on: boolean) => ChartSpec;
  /** Not for this chart (pies have no axes…). */
  hidden?: (s: ChartSpec) => boolean;
}

const axisTitle = (a: Axis): string => (a.kind === 'val' ? 'Titre de l’axe vertical' : 'Titre de l’axe horizontal');

export const ELEMENTS: ElementDef[] = [
  { id: 'axes', label: 'Axes', hidden: pieLike, on: (s) => (s.axes ?? []).some((a) => !a.delete), toggle: (s, on) => mapAxes(s, (a) => ({ ...a, delete: !on })) },
  { id: 'axisTitles', label: 'Titres des axes', hidden: pieLike, on: (s) => (s.axes ?? []).some((a) => !!a.title), toggle: (s, on) => mapAxes(s, (a) => ({ ...a, title: on && a.kind !== 'ser' ? (a.title ?? { text: axisTitle(a) }) : undefined })) },
  { id: 'title', label: 'Titre du graphique', on: (s) => !!s.title || (!s.autoTitleDeleted && allSeries(s).length === 1), toggle: (s, on) => (on ? { ...s, title: s.title ?? { text: allSeries(s).length === 1 ? undefined : 'Titre du graphique' }, autoTitleDeleted: false } : { ...s, title: undefined, autoTitleDeleted: true }) },
  {
    id: 'labels',
    label: 'Étiquettes de données',
    on: (s) => s.groups.some((g) => g.labels?.showVal || g.labels?.showPct || g.series.some((x) => x.labels?.showVal || x.labels?.showPct)),
    toggle: (s, on) => mapGroups(s, (g) => ({ ...g, labels: on ? { showVal: !pieLike(s), showPct: pieLike(s), pos: pieLike(s) ? 'bestFit' : undefined } : undefined, series: g.series.map((x) => ({ ...x, labels: undefined })) })),
  },
  { id: 'dataTable', label: 'Table de données', hidden: pieLike, on: (s) => !!s.dataTable, toggle: (s, on) => ({ ...s, dataTable: on ? { horz: true, vert: true, outline: true, keys: true } : undefined }) },
  {
    id: 'errBars',
    label: 'Barres d’erreur',
    hidden: (s) => pieLike(s) || !!s.groups[0]?.threeD,
    on: (s) => allSeries(s).some((x) => x.errBars?.length),
    toggle: (s, on) => mapSeries(s, (x) => ({ ...x, errBars: on ? [{ barType: 'both', valType: 'percentage', val: 5 }] : [] })),
  },
  { id: 'grid', label: 'Quadrillage', hidden: pieLike, on: (s) => (s.axes ?? []).some((a) => a.kind === 'val' && !!a.majorGrid), toggle: (s, on) => mapAxes(s, (a) => (a.kind === 'val' ? { ...a, majorGrid: on ? (a.majorGrid ?? {}) : undefined } : a)) },
  { id: 'legend', label: 'Légende', on: (s) => !!s.legend, toggle: (s, on) => ({ ...s, legend: on ? (s.legend ?? { pos: 'b' }) : undefined }) },
  {
    id: 'trend',
    label: 'Courbe de tendance',
    hidden: (s) => pieLike(s) || !!s.groups[0]?.threeD || ['radar', 'surface', 'stock'].includes(s.groups[0]?.kind ?? '') || !!s.ex,
    on: (s) => allSeries(s).some((x) => x.trendlines?.length),
    toggle: (s, on) => mapSeries(s, (x, g) => (g === s.groups[0] && x.order === Math.min(...s.groups[0]!.series.map((y) => y.order)) ? { ...x, trendlines: on ? [{ kind: 'linear' }] : [] } : x)),
  },
];

const LEGEND_POS: Array<[string, string]> = [['r', 'À droite'], ['t', 'En haut'], ['l', 'À gauche'], ['b', 'En bas']];

export function ElementsMenu({ spec, apply }: { spec: ChartSpec; apply: (fn: (s: ChartSpec) => ChartSpec) => void }) {
  return (
    <Dialog className="oel-popover-dialog oel-chart-elements" aria-label="Éléments du graphique">
      <p className="oel-chart-elements__title">Éléments du graphique</p>
      {ELEMENTS.filter((e) => !e.hidden?.(spec)).map((e) => (
        <Checkbox key={e.id} isSelected={e.on(spec)} onChange={(v) => apply((s) => e.toggle(s, v))}>
          {e.label}
        </Checkbox>
      ))}
      {spec.legend && (
        <div className="oel-chart-elements__row">
          <span>Position de la légende</span>
          <RadioGroup aria-label="Position de la légende" orientation="horizontal" value={spec.legend.pos ?? 'r'} onChange={(v) => apply((s) => ({ ...s, legend: { ...s.legend, pos: v } }))}>
            {LEGEND_POS.map(([v, l]) => (
              <Radio key={v} value={v}>
                {l}
              </Radio>
            ))}
          </RadioGroup>
        </div>
      )}
    </Dialog>
  );
}
