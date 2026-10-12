/**
 * Chart editing pieces shared by the hosts (Figma H2): Office palettes, the
 * « Éléments » checklist, and the bar over a chart copy in slides and
 * documents. The sheet's full chart tools build on the same pieces.
 */
import type { CSSProperties } from 'react';
import { Dialog } from 'react-aria-components';
import { Checkbox, Menu, MenuItem, MenuPopover, MenuTrigger, Popover, Radio, RadioGroup, Toolbar, ToolbarSeparator, ToolButton } from '@oel/emboss';
import { applyType, chartFamily, CHART_TITLE, CHART_TYPES } from '../catalog';
import type { Axis, ChartSpec, Group, Series } from '../types';
import { messages } from '@oel/i18n';

const t = messages(
  {
    palettes: { office: 'Couleurs Office', emboss: 'OutilsEnLigne', colorful2: 'Couleurs vives', blue: 'Monochrome bleu', orange: 'Monochrome orange', green: 'Monochrome vert', grey: 'Niveaux de gris' } as Record<string, string>,
    vAxisTitle: 'Titre de l’axe vertical',
    hAxisTitle: 'Titre de l’axe horizontal',
    elements: {
      axes: 'Axes',
      axisTitles: 'Titres des axes',
      title: 'Titre du graphique',
      labels: 'Étiquettes de données',
      dataTable: 'Table de données',
      errBars: 'Barres d’erreur',
      grid: 'Quadrillage',
      legend: 'Légende',
      trend: 'Courbe de tendance',
    },
    legendPos: { r: 'À droite', t: 'En haut', l: 'À gauche', b: 'En bas' },
    chartElements: 'Éléments du graphique',
    legendPosition: 'Position de la légende',
    colours: 'Couleurs',
    exLocked: 'Graphique Office 2016+ : affiché et conservé, pas encore modifiable.',
    linkedChart: 'Graphique lié',
    chart: 'Graphique',
    type: 'Type',
    noVariant: 'Pas d’autre variante pour ce type de graphique.',
    otherVariant: (family: string) => `Autre variante : ${family.toLocaleLowerCase('fr-CA')}`,
    variant: 'Variante',
    elementsShort: 'Éléments',
    elementsDesc: 'Titre, axes, légende, étiquettes, quadrillage…',
    source: 'Voir la source',
    open: (source: string) => `Ouvrir ${source}`,
    update: 'Mettre à jour',
    link: (state: string) => `Lien · ${state}`,
    linkDesc: 'Mode, mise à jour, couper le lien',
  },
  {
    palettes: { office: 'Office colours', emboss: 'OutilsEnLigne', colorful2: 'Bright colours', blue: 'Blue monochrome', orange: 'Orange monochrome', green: 'Green monochrome', grey: 'Greyscale' },
    vAxisTitle: 'Vertical axis title',
    hAxisTitle: 'Horizontal axis title',
    elements: {
      axes: 'Axes',
      axisTitles: 'Axis titles',
      title: 'Chart title',
      labels: 'Data labels',
      dataTable: 'Data table',
      errBars: 'Error bars',
      grid: 'Gridlines',
      legend: 'Legend',
      trend: 'Trendline',
    },
    legendPos: { r: 'Right', t: 'Top', l: 'Left', b: 'Bottom' },
    chartElements: 'Chart elements',
    legendPosition: 'Legend position',
    colours: 'Colours',
    exLocked: 'Office 2016+ chart: shown and kept, not editable yet.',
    linkedChart: 'Linked chart',
    chart: 'Chart',
    type: 'Type',
    noVariant: 'No other variant for this chart type.',
    otherVariant: (family) => `Other variant: ${family.toLocaleLowerCase('en-CA')}`,
    variant: 'Variant',
    elementsShort: 'Elements',
    elementsDesc: 'Title, axes, legend, labels, gridlines…',
    source: 'See the source',
    open: (source) => `Open ${source}`,
    update: 'Update',
    link: (state) => `Link · ${state}`,
    linkDesc: 'Mode, update, cut the link',
  },
);

/** Office palettes offered by « Couleurs » (colourful, then monochrome). */
export const PALETTES: Array<{ id: string; label: string; colors: string[] }> = [
  { id: 'office', label: t.palettes.office!, colors: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'] },
  { id: 'emboss', label: t.palettes.emboss!, colors: ['#7759C5', '#F0AD05', '#1E8E3E', '#E5484D', '#3B82F6', '#6B6375'] },
  { id: 'colorful2', label: t.palettes.colorful2!, colors: ['#ED7D31', '#FFC000', '#70AD47', '#4472C4', '#5B9BD5', '#A5A5A5'] },
  { id: 'blue', label: t.palettes.blue!, colors: ['#1F3864', '#2F5597', '#4472C4', '#8FAADC', '#B4C7E7', '#DAE3F3'] },
  { id: 'orange', label: t.palettes.orange!, colors: ['#843C0C', '#C55A11', '#ED7D31', '#F4B183', '#F8CBAD', '#FBE5D6'] },
  { id: 'green', label: t.palettes.green!, colors: ['#385723', '#548235', '#70AD47', '#A9D18E', '#C5E0B4', '#E2F0D9'] },
  { id: 'grey', label: t.palettes.grey!, colors: ['#262626', '#595959', '#7F7F7F', '#A6A6A6', '#BFBFBF', '#D9D9D9'] },
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

const axisTitle = (a: Axis): string => (a.kind === 'val' ? t.vAxisTitle : t.hAxisTitle);

export const ELEMENTS: ElementDef[] = [
  { id: 'axes', label: t.elements.axes, hidden: pieLike, on: (s) => (s.axes ?? []).some((a) => !a.delete), toggle: (s, on) => mapAxes(s, (a) => ({ ...a, delete: !on })) },
  { id: 'axisTitles', label: t.elements.axisTitles, hidden: pieLike, on: (s) => (s.axes ?? []).some((a) => !!a.title), toggle: (s, on) => mapAxes(s, (a) => ({ ...a, title: on && a.kind !== 'ser' ? (a.title ?? { text: axisTitle(a) }) : undefined })) },
  { id: 'title', label: t.elements.title, on: (s) => !!s.title || (!s.autoTitleDeleted && allSeries(s).length === 1), toggle: (s, on) => (on ? { ...s, title: s.title ?? { text: allSeries(s).length === 1 ? undefined : CHART_TITLE }, autoTitleDeleted: false } : { ...s, title: undefined, autoTitleDeleted: true }) },
  {
    id: 'labels',
    label: t.elements.labels,
    on: (s) => s.groups.some((g) => g.labels?.showVal || g.labels?.showPct || g.series.some((x) => x.labels?.showVal || x.labels?.showPct)),
    toggle: (s, on) => mapGroups(s, (g) => ({ ...g, labels: on ? { showVal: !pieLike(s), showPct: pieLike(s), pos: pieLike(s) ? 'bestFit' : undefined } : undefined, series: g.series.map((x) => ({ ...x, labels: undefined })) })),
  },
  { id: 'dataTable', label: t.elements.dataTable, hidden: pieLike, on: (s) => !!s.dataTable, toggle: (s, on) => ({ ...s, dataTable: on ? { horz: true, vert: true, outline: true, keys: true } : undefined }) },
  {
    id: 'errBars',
    label: t.elements.errBars,
    hidden: (s) => pieLike(s) || !!s.groups[0]?.threeD,
    on: (s) => allSeries(s).some((x) => x.errBars?.length),
    toggle: (s, on) => mapSeries(s, (x) => ({ ...x, errBars: on ? [{ barType: 'both', valType: 'percentage', val: 5 }] : [] })),
  },
  { id: 'grid', label: t.elements.grid, hidden: pieLike, on: (s) => (s.axes ?? []).some((a) => a.kind === 'val' && !!a.majorGrid), toggle: (s, on) => mapAxes(s, (a) => (a.kind === 'val' ? { ...a, majorGrid: on ? (a.majorGrid ?? {}) : undefined } : a)) },
  { id: 'legend', label: t.elements.legend, on: (s) => !!s.legend, toggle: (s, on) => ({ ...s, legend: on ? (s.legend ?? { pos: 'b' }) : undefined }) },
  {
    id: 'trend',
    label: t.elements.trend,
    hidden: (s) => pieLike(s) || !!s.groups[0]?.threeD || ['radar', 'surface', 'stock'].includes(s.groups[0]?.kind ?? '') || !!s.ex,
    on: (s) => allSeries(s).some((x) => x.trendlines?.length),
    toggle: (s, on) => mapSeries(s, (x, g) => (g === s.groups[0] && x.order === Math.min(...s.groups[0]!.series.map((y) => y.order)) ? { ...x, trendlines: on ? [{ kind: 'linear' }] : [] } : x)),
  },
];

const LEGEND_POS: Array<[string, string]> = [['r', t.legendPos.r], ['t', t.legendPos.t], ['l', t.legendPos.l], ['b', t.legendPos.b]];

export function ElementsMenu({ spec, apply }: { spec: ChartSpec; apply: (fn: (s: ChartSpec) => ChartSpec) => void }) {
  return (
    <Dialog className="oel-popover-dialog oel-chart-elements" aria-label={t.chartElements}>
      <p className="oel-chart-elements__title">{t.chartElements}</p>
      {ELEMENTS.filter((e) => !e.hidden?.(spec)).map((e) => (
        <Checkbox key={e.id} isSelected={e.on(spec)} onChange={(v) => apply((s) => e.toggle(s, v))}>
          {e.label}
        </Checkbox>
      ))}
      {spec.legend && (
        <div className="oel-chart-elements__row">
          <span>{t.legendPosition}</span>
          <RadioGroup aria-label={t.legendPosition} orientation="horizontal" value={spec.legend.pos ?? 'r'} onChange={(v) => apply((s) => ({ ...s, legend: { ...s.legend, pos: v } }))}>
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

/** « Couleurs »: the Office palettes as a menu (series follow the new colours). */
export function PaletteMenu({ apply, unavailableReason }: { apply: (fn: (s: ChartSpec) => ChartSpec) => void; unavailableReason?: string }) {
  return (
    <MenuTrigger>
      <ToolButton icon="palette" label={t.colours} unavailableReason={unavailableReason} />
      <MenuPopover placement="bottom start">
        <Menu aria-label={t.colours} onAction={(k) => apply((s) => withPalette(s, PALETTES.find((p) => p.id === k)!.colors))}>
          {PALETTES.map((p) => (
            <MenuItem key={p.id} id={p.id} textValue={p.label}>
              <span className="oel-chart-swatches" aria-hidden>
                {p.colors.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              {p.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

/** What a chart copy's bar shows about its link (the host reads it from @oel/links). */
export interface CopyLinkInfo {
  /** Source file title (« Budget 2027 »). */
  source: string;
  /** State in words (« À jour », « En retard »…). */
  stateLabel: string;
  stale: boolean;
  frozen: boolean;
  /** Why « Voir la source » is unavailable (the source is not on the desk…). */
  sourceUnavailable?: string;
  onSource: () => void;
  onUpdate: () => void;
  onManage: (anchor: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * The bar over a chart in a slide or a document (Figma G4 + H2): the variant
 * within the chart's family, colours, elements and, for a linked copy, its
 * source, « Mettre à jour » and the link's popover. The host positions it.
 */
export function CopyChartBar({ spec, apply, lockReason, link, style, className }: { spec: ChartSpec; apply: (fn: (s: ChartSpec) => ChartSpec) => void; lockReason?: string; link?: CopyLinkInfo | null; style?: CSSProperties; className?: string }) {
  const current = chartFamily(spec);
  const lock = lockReason ?? (spec.ex ? t.exLocked : undefined);
  const variants = current ? CHART_TYPES.filter((c) => c.family === current.family && !c.ex) : [];
  return (
    <div className={`oel-chart-bar${className ? ` ${className}` : ''}`} style={style} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} onKeyDown={(e) => e.stopPropagation()}>
      <Toolbar aria-label={link ? t.linkedChart : t.chart}>
        <span className="oel-chart-bar__label">{link ? t.linkedChart : t.chart}</span>
        {lock || variants.length < 2 ? (
          <ToolButton icon="chart" label={current?.label ?? t.type} showLabel unavailableReason={lock ?? t.noVariant} />
        ) : (
          <MenuTrigger>
            <ToolButton icon="chart" label={current!.label} showLabel description={t.otherVariant(current!.family)} />
            <MenuPopover placement="bottom start">
              <Menu aria-label={t.variant} onAction={(k) => k !== current!.id && apply((s) => applyType(s, String(k)))}>
                {variants.map((v) => (
                  <MenuItem key={v.id} id={v.id} textValue={v.label}>
                    {v.id === current!.id ? `✓ ${v.label}` : `\u2003${v.label}`}
                  </MenuItem>
                ))}
              </Menu>
            </MenuPopover>
          </MenuTrigger>
        )}
        <PaletteMenu apply={apply} unavailableReason={lock} />
        {lock ? (
          <ToolButton icon="plus" label={t.elementsShort} showLabel unavailableReason={lock} />
        ) : (
          <MenuTrigger>
            <ToolButton icon="plus" label={t.elementsShort} showLabel description={t.elementsDesc} />
            <Popover placement="bottom">
              <ElementsMenu spec={spec} apply={apply} />
            </Popover>
          </MenuTrigger>
        )}
        {link && (
          <>
            <ToolbarSeparator />
            <ToolButton icon="table" label={t.source} showLabel description={t.open(link.source)} unavailableReason={link.sourceUnavailable} onPress={link.onSource} />
            {link.stale && !link.frozen && <ToolButton icon="refresh" label={t.update} showLabel onPress={link.onUpdate} />}
            <ToolButton
              icon="link"
              label={t.link(link.stateLabel)}
              description={t.linkDesc}
              onPress={() => {
                const r = document.activeElement?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
                link.onManage({ x: r.x, y: r.y, width: r.width, height: r.height });
              }}
            />
          </>
        )}
      </Toolbar>
    </div>
  );
}
