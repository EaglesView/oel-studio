/**
 * Chart tools of the spreadsheet (Figma H1–H5): the floating « Graphique »
 * bar over a selected chart, the type gallery (insert / change type) with
 * previews of the user's own data, the elements checklist, « Sélectionner les
 * données » and « Mettre en forme ». Every change is one undo step.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Dialog } from 'react-aria-components';
import { Button, Checkbox, DialogOverlay, Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger, NumberField, Popover, Radio, RadioGroup, SheetDialog, Slider, TextField, Toolbar, ToolbarSeparator, ToolButton } from '@oel/emboss';
import { CHART_TYPES, FAMILIES, applyType, chartFamily, chartName, newChart, parseRef, recommend, type Axis, type ChartSpec, type Group, type Series } from '@oel/charts';
import { ChartView } from '@oel/charts/react';
import { STATE_LABEL, linkHost, linksOf } from '@oel/links';
import { chartFont, sheetResolver } from '../grid/charts';
import { chartBlock, deleteDrawing, duplicateDrawing, insertChart, updateChart } from './charts';
import type { SheetController } from './controller';

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

const allSeries = (s: ChartSpec) => s.groups.flatMap((g) => g.series);
const mapSeries = (s: ChartSpec, fn: (x: Series, g: Group) => Series): ChartSpec => ({ ...s, groups: s.groups.map((g) => ({ ...g, series: g.series.map((x) => fn(x, g)) })) });
const mapGroups = (s: ChartSpec, fn: (g: Group) => Group): ChartSpec => ({ ...s, groups: s.groups.map(fn) });
const mapAxes = (s: ChartSpec, fn: (a: Axis) => Axis): ChartSpec => ({ ...s, axes: (s.axes ?? []).map(fn) });
const pieLike = (s: ChartSpec) => ['pie', 'doughnut', 'ofPie'].includes(s.groups[0]?.kind ?? '');

/** Palette change: series follow the new colours (explicit fills are dropped, like Excel's « Modifier les couleurs »). */
export function withPalette(spec: ChartSpec, colors: string[]): ChartSpec {
  const strip = (sh: Series['shape']) => (sh ? { ...sh, fill: sh.fill?.kind === 'none' ? sh.fill : undefined, line: sh.line ? { ...sh.line, color: undefined } : undefined } : sh);
  return { ...mapSeries(spec, (x) => ({ ...x, shape: strip(x.shape), points: x.points?.map((p) => ({ ...p, shape: strip(p.shape) })), marker: x.marker ? { ...x.marker, shape: undefined } : x.marker })), palette: [...colors, ...colors.map((c) => c)] };
}

// ---------------------------------------------------------------------------
// Elements (« + »)
// ---------------------------------------------------------------------------

interface ElementDef {
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

function ElementsMenu({ spec, apply }: { spec: ChartSpec; apply: (fn: (s: ChartSpec) => ChartSpec) => void }) {
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

// ---------------------------------------------------------------------------
// Type gallery (insert / change type)
// ---------------------------------------------------------------------------

function TypeGallery({ ctl, spec, mode, onDone, close }: { ctl: SheetController; spec: ChartSpec; mode: 'insert' | 'change'; onDone: (typeId: string) => void; close: () => void }) {
  const current = chartFamily(spec);
  const recs = useMemo(() => recommend(spec), [spec]);
  const [tab, setTab] = useState<'rec' | 'all'>(mode === 'insert' ? 'rec' : 'all');
  const [family, setFamily] = useState(current?.family ?? 'Colonnes');
  const [chosen, setChosen] = useState(mode === 'insert' ? (recs[0]?.id ?? 'col-clustered') : (current?.id ?? 'col-clustered'));
  const resolve = useMemo(() => sheetResolver(ctl, ctl.sheetId), [ctl]);
  const preview = (id: string) => applyType(spec, id);
  const types = tab === 'rec' ? recs.map((r) => CHART_TYPES.find((t) => t.id === r.id)!).filter(Boolean) : CHART_TYPES.filter((t) => t.family === family);
  const info = CHART_TYPES.find((t) => t.id === chosen);
  const reason = recs.find((r) => r.id === chosen)?.reason;
  const unsupported = info?.ex ? 'Ce type (Office 2016+) s’affiche mais ne peut pas encore être créé : il serait perdu à l’export.' : null;
  return (
    <SheetDialog
      title={mode === 'insert' ? 'Insérer un graphique' : 'Changer de type de graphique'}
      width={1080}
      actions={(c) => (
        <>
          <Button variant="ghost" onPress={c}>
            Annuler
          </Button>
          <Button
            isDisabled={!!unsupported}
            onPress={() => {
              onDone(chosen);
              close();
            }}
          >
            {mode === 'insert' ? 'Insérer' : 'Appliquer'}
          </Button>
        </>
      )}
    >
      <div className="oel-chart-gallery">
        <nav className="oel-chart-gallery__nav" aria-label="Familles">
          <button type="button" className={tab === 'rec' ? 'is-on' : undefined} onClick={() => setTab('rec')}>
            Recommandés
          </button>
          {FAMILIES.map((f) => (
            <button key={f} type="button" className={tab === 'all' && family === f ? 'is-on' : undefined} onClick={() => (setTab('all'), setFamily(f))}>
              {f}
            </button>
          ))}
        </nav>
        <div className="oel-chart-gallery__main">
          <div className="oel-chart-gallery__variants" role="listbox" aria-label="Types">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === chosen}
                className={`oel-chart-gallery__variant${t.id === chosen ? ' is-on' : ''}`}
                onClick={() => setChosen(t.id)}
                onDoubleClick={() => !t.ex && (onDone(t.id), close())}
              >
                <span className="oel-chart-gallery__thumb">
                  <ChartView spec={stripForThumb(preview(t.id))} width={150} height={96} resolve={resolve} fontFamily={chartFont} background="#FFFFFF" />
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="oel-chart-gallery__preview">
            <div className="oel-chart-gallery__big">
              <ChartView spec={preview(chosen)} width={620} height={360} resolve={resolve} fontFamily={chartFont} background="#FFFFFF" />
            </div>
            <div className="oel-chart-gallery__about">
              <strong>{info?.label}</strong>
              {reason && <p>{reason}</p>}
              {unsupported && <p className="oel-chart-gallery__warn">{unsupported}</p>}
              <p className="oel-chart-gallery__hint">Double-clic sur une vignette : {mode === 'insert' ? 'insérer' : 'appliquer'}.</p>
            </div>
          </div>
        </div>
      </div>
    </SheetDialog>
  );
}

/** Thumbnails: no title, no legend, no labels. */
function stripForThumb(s: ChartSpec): ChartSpec {
  return { ...s, title: undefined, autoTitleDeleted: true, legend: undefined, dataTable: undefined, axes: (s.axes ?? []).map((a) => ({ ...a, title: undefined, tickLblPos: 'none' })), groups: s.groups.map((g) => ({ ...g, labels: undefined, series: g.series.map((x) => ({ ...x, labels: undefined, trendlines: [] })) })) };
}

// ---------------------------------------------------------------------------
// Select data (H3)
// ---------------------------------------------------------------------------

function DataDialog({ spec, apply, close }: { spec: ChartSpec; apply: (fn: (s: ChartSpec) => ChartSpec) => void; close: () => void }) {
  const [draft, setDraft] = useState(spec);
  const series = allSeries(draft);
  const set = (i: number, patch: (x: Series) => Series) => {
    let k = 0;
    setDraft(mapSeries(draft, (x) => (k++ === i ? patch(x) : x)));
  };
  const bad = (f?: string | null) => !!f && !parseRef(f);
  return (
    <SheetDialog
      title="Sélectionner les données"
      width={720}
      actions={(c) => (
        <>
          <Button variant="ghost" onPress={c}>
            Annuler
          </Button>
          <Button
            onPress={() => {
              apply(() => draft);
              close();
            }}
          >
            OK
          </Button>
        </>
      )}
    >
      <div className="oel-chart-data">
        <p className="oel-chart-data__help">Références au format Excel, par exemple <code>'Budget'!$B$2:$B$8</code>. Les valeurs sont relues dans la feuille.</p>
        {series.map((x, i) => (
          <fieldset key={i} className="oel-chart-data__series">
            <legend>Série {i + 1}</legend>
            <TextField label="Nom" value={x.nameRef ?? x.name ?? ''} onChange={(v) => set(i, (y) => (parseRef(v) ? { ...y, nameRef: v, name: undefined } : { ...y, nameRef: undefined, name: v }))} />
            <TextField label="Valeurs" value={x.val?.f ?? ''} isInvalid={bad(x.val?.f)} onChange={(v) => set(i, (y) => ({ ...y, val: { ...y.val, f: v, num: [], count: 0 } }))} />
            <TextField label="Catégories (axe horizontal)" value={x.cat?.f ?? ''} isInvalid={bad(x.cat?.f)} onChange={(v) => set(i, (y) => ({ ...y, cat: v ? { ...y.cat, f: v, num: [], str: [], count: 0 } : undefined }))} />
            <Button size="sm" variant="ghost" leadingIcon="trash" onPress={() => setDraft({ ...draft, groups: draft.groups.map((g) => ({ ...g, series: g.series.filter((y) => y !== x) })).filter((g) => g.series.length) })}>
              Supprimer la série
            </Button>
          </fieldset>
        ))}
        <Button
          size="sm"
          variant="secondary"
          leadingIcon="plus"
          onPress={() => {
            const g = draft.groups[0]!;
            const idx = Math.max(-1, ...series.map((x) => x.idx)) + 1;
            setDraft({ ...draft, groups: [{ ...g, series: [...g.series, { idx, order: idx, name: `Série${idx + 1}`, val: { f: '' } }] }, ...draft.groups.slice(1)] });
          }}
        >
          Ajouter une série
        </Button>
        <div className="oel-chart-data__blanks">
          <span>Cellules vides</span>
          <RadioGroup aria-label="Cellules vides" orientation="horizontal" value={draft.dispBlanksAs ?? 'gap'} onChange={(v) => setDraft({ ...draft, dispBlanksAs: v })}>
            <Radio value="gap">Intervalles</Radio>
            <Radio value="zero">Zéro</Radio>
            <Radio value="span">Relier par une ligne</Radio>
          </RadioGroup>
          <Checkbox isSelected={draft.plotVisOnly === false} onChange={(v) => setDraft({ ...draft, plotVisOnly: !v })}>
            Afficher les lignes et colonnes masquées
          </Checkbox>
        </div>
      </div>
    </SheetDialog>
  );
}

// ---------------------------------------------------------------------------
// Format (titles, colours, axes, 3-D)
// ---------------------------------------------------------------------------

function FormatDialog({ spec, apply, close }: { spec: ChartSpec; apply: (fn: (s: ChartSpec) => ChartSpec) => void; close: () => void }) {
  const [draft, setDraft] = useState(spec);
  const series = allSeries(draft);
  const valAxis = (draft.axes ?? []).find((a) => a.kind === 'val');
  const setAxis = (patch: Partial<Axis>) => setDraft(mapAxes(draft, (a) => (a === valAxis ? { ...a, ...patch } : a)));
  const v3 = draft.view3d;
  const colorOf = (x: Series, i: number) => (x.shape?.fill?.color ?? x.shape?.line?.color ?? draft.palette?.[x.idx % (draft.palette?.length || 1)] ?? PALETTES[0]!.colors[i % 6]!).slice(0, 7);
  return (
    <SheetDialog
      title="Mettre en forme le graphique"
      width={560}
      actions={(c) => (
        <>
          <Button variant="ghost" onPress={c}>
            Annuler
          </Button>
          <Button
            onPress={() => {
              apply(() => draft);
              close();
            }}
          >
            Appliquer
          </Button>
        </>
      )}
    >
      <div className="oel-chart-format">
        <TextField label="Titre du graphique" value={draft.title?.text ?? ''} onChange={(v) => setDraft({ ...draft, title: v ? { ...draft.title, text: v } : undefined, autoTitleDeleted: !v })} />
        <h3>Couleurs des séries</h3>
        {series.map((x, i) => {
          const lined = ['line', 'scatter', 'radar', 'stock'].includes(draft.groups.find((g) => g.series.includes(x))?.kind ?? '');
          return (
            <label key={i} className="oel-chart-format__color">
              <input
                type="color"
                value={colorOf(x, i)}
                onChange={(e) => {
                  const c = e.target.value.toUpperCase();
                  setDraft(mapSeries(draft, (y) => (y === x ? { ...y, shape: lined ? { ...y.shape, line: { ...y.shape?.line, color: c } } : { ...y.shape, fill: { kind: 'solid', color: c } } } : y)));
                }}
              />
              <span>{x.name ?? x.nameRef ?? `Série ${i + 1}`}</span>
            </label>
          );
        })}
        {valAxis && (
          <>
            <h3>Axe des valeurs</h3>
            <div className="oel-chart-format__row">
              <NumberField label="Minimum" value={valAxis.min ?? NaN} onChange={(v) => setAxis({ min: Number.isNaN(v) ? undefined : v })} />
              <NumberField label="Maximum" value={valAxis.max ?? NaN} onChange={(v) => setAxis({ max: Number.isNaN(v) ? undefined : v })} />
              <NumberField label="Unité principale" value={valAxis.majorUnit ?? NaN} minValue={0} onChange={(v) => setAxis({ majorUnit: Number.isNaN(v) || v <= 0 ? undefined : v })} />
            </div>
            <TextField label="Format des nombres (code Excel)" value={valAxis.numFmt ?? ''} onChange={(v) => setAxis({ numFmt: v || undefined, sourceLinked: !v })} />
            <Checkbox isSelected={!!valAxis.logBase} onChange={(v) => setAxis({ logBase: v ? 10 : undefined })}>
              Échelle logarithmique
            </Checkbox>
            <Checkbox isSelected={!!valAxis.reverse} onChange={(v) => setAxis({ reverse: v })}>
              Valeurs en ordre inverse
            </Checkbox>
          </>
        )}
        {v3 && (
          <>
            <h3>Rotation 3D</h3>
            <Slider label="Rotation X" minValue={0} maxValue={359} value={v3.rotY ?? 20} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, rotY: v as number } })} />
            <Slider label="Rotation Y" minValue={-90} maxValue={90} value={v3.rotX ?? 15} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, rotX: v as number } })} />
            <Slider label="Perspective" minValue={0} maxValue={100} value={v3.perspective ?? 30} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, perspective: v as number, rAngAx: false } })} />
            <Checkbox isSelected={v3.rAngAx ?? false} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, rAngAx: v } })}>
              Axes à angle droit
            </Checkbox>
          </>
        )}
      </div>
    </SheetDialog>
  );
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

/** Swap series between rows and columns: the chart is rebuilt from the block its references cover. */
export function switchRowsCols(ctl: SheetController, spec: ChartSpec): ChartSpec | null {
  const areas = allSeries(spec).flatMap((x) => [x.nameRef, x.cat?.f, x.val?.f].flatMap((f) => (f && parseRef(f)) || []));
  if (!areas.length || areas.some((a) => (a.sheet ?? ctl.props.name) !== ctl.props.name)) return null;
  const r0 = Math.min(...areas.map((a) => a.r0));
  const c0 = Math.min(...areas.map((a) => a.c0));
  const r1 = Math.max(...areas.map((a) => a.r1));
  const c1 = Math.max(...areas.map((a) => a.c1));
  const first = parseRef(allSeries(spec)[0]?.val?.f ?? '')?.[0];
  const inRows = !!first && first.r0 === first.r1 && first.c1 > first.c0;
  const si = ctl.sheetIndex;
  const block = {
    sheet: ctl.props.name,
    r0,
    c0,
    r1,
    c1,
    text: (r: number, c: number) => ctl.view(r, c).text,
    num: (r: number, c: number) => {
      const o = ctl.calc.get(si, r, c);
      return o?.t === 'n' && typeof o.v === 'number' ? o.v : null;
    },
  };
  const fresh = newChart(block, chartFamily(spec)?.id ?? 'col-clustered', !inRows);
  return { ...spec, groups: fresh.groups.map((g, i) => ({ ...(spec.groups[i] ?? spec.groups[0]!), series: g.series })), legend: spec.legend, palette: spec.palette };
}

/** « Utilisé dans 2 fichiers » (Figma G5): the copies made from this chart, each opening its thread. */
function ChartUses({ ctl, index }: { ctl: SheetController; index: number }) {
  const oid = ctl.doc.drawings(ctl.sheetId)[index]?.oid;
  const uses = oid ? linksOf(ctl.doc.doc).usesOf((b) => b.ref.kind === 'chart' && b.ref.chartId === oid) : [];
  if (!uses.length) return null;
  const host = linkHost();
  return (
    <MenuTrigger>
      <ToolButton icon="link" label={uses.length === 1 ? 'Utilisé dans 1 fichier' : `Utilisé dans ${uses.length} fichiers`} showLabel />
      <MenuPopover placement="bottom start">
        <Menu
          aria-label="Copies liées"
          onAction={(k) => {
            const el = document.querySelector('.oel-chart-bar');
            const r = el?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
            host.manage(String(k), { x: r.x, y: r.y, width: r.width, height: r.height });
          }}
        >
          {uses.map((u) => (
            <MenuItem key={u.linkId} id={u.linkId} icon={u.kind === 'slides' ? 'slide' : 'file'} textValue={`${u.title} · ${u.label}`}>
              {u.title} · {u.label} — {STATE_LABEL[host.state(u.linkId)]}
            </MenuItem>
          ))}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

export function ChartBar({ ctl, index, spec, style }: { ctl: SheetController; index: number; spec: ChartSpec; style: CSSProperties }) {
  const [open, setOpen] = useState<null | 'type' | 'data' | 'format'>(null);
  const apply = (fn: (s: ChartSpec) => ChartSpec) => updateChart(ctl, index, fn);
  const ro = ctl.readOnlyFlag ? 'Lecture seule' : undefined;
  const exNote = spec.ex ? 'Graphique Office 2016+ : affiché et conservé, pas encore modifiable.' : undefined;
  const lock = ro ?? exNote;
  return (
    <div className="oel-chart-bar" style={style} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Toolbar aria-label="Graphique">
        <span className="oel-chart-bar__label">Graphique</span>
        <ToolButton icon="chart" label={chartFamily(spec)?.label ?? 'Type'} showLabel description="Changer de type de graphique" unavailableReason={lock} onPress={() => setOpen('type')} />
        <MenuTrigger>
          <ToolButton icon="palette" label="Couleurs" unavailableReason={lock} />
          <MenuPopover placement="bottom start">
            <Menu aria-label="Couleurs" onAction={(k) => apply((s) => withPalette(s, PALETTES.find((p) => p.id === k)!.colors))}>
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
        {lock ? (
          <ToolButton icon="plus" label="Éléments" showLabel unavailableReason={lock} />
        ) : (
          <MenuTrigger>
            <ToolButton icon="plus" label="Éléments" showLabel description="Titre, axes, légende, étiquettes, quadrillage…" />
            <Popover placement="bottom">
              <ElementsMenu spec={spec} apply={apply} />
            </Popover>
          </MenuTrigger>
        )}
        <ToolButton icon="table" label="Données" showLabel description="Sélectionner les données" unavailableReason={lock} onPress={() => setOpen('data')} />
        <ToolButton
          icon="switch-rows"
          label="Intervertir lignes et colonnes"
          unavailableReason={lock}
          onPress={() => {
            const next = switchRowsCols(ctl, spec);
            if (next) apply(() => next);
          }}
        />
        <ToolbarSeparator />
        <ToolButton
          icon="link"
          label="Lier dans…"
          showLabel
          description="Mettre une copie liée dans une présentation ou un document du bureau"
          unavailableReason={!ctl.onLinkChart ? 'Ouvrez ce classeur depuis le bureau pour lier ses graphiques.' : exNote}
          onPress={() => {
            const chartId = ctl.doc.drawingId(ctl.sheetId, index);
            if (chartId) ctl.onLinkChart?.({ sheetId: ctl.sheetId, chartId, name: chartName(spec), spec });
          }}
        />
        <ChartUses ctl={ctl} index={index} />
        <MenuTrigger>
          <ToolButton icon="more" label="Plus" />
          <MenuPopover placement="bottom end">
            <Menu
              aria-label="Plus"
              disabledKeys={lock ? ['format', 'duplicate', 'delete'] : []}
              onAction={(k) => {
                if (k === 'format') setOpen('format');
                if (k === 'duplicate') duplicateDrawing(ctl, index);
                if (k === 'delete') deleteDrawing(ctl, index);
              }}
            >
              <MenuItem id="format" icon="pen">
                Mettre en forme…
              </MenuItem>
              <MenuItem id="duplicate" icon="copy" shortcut="Ctrl+D">
                Dupliquer
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="trash" shortcut="Suppr">
                Supprimer le graphique
              </MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
      </Toolbar>
      <DialogOverlay isOpen={open === 'type'} onOpenChange={(o) => !o && setOpen(null)}>
        <TypeGallery ctl={ctl} spec={spec} mode="change" onDone={(id) => apply((s) => applyType(s, id))} close={() => setOpen(null)} />
      </DialogOverlay>
      <DialogOverlay isOpen={open === 'data'} onOpenChange={(o) => !o && setOpen(null)}>
        <DataDialog spec={spec} apply={apply} close={() => setOpen(null)} />
      </DialogOverlay>
      <DialogOverlay isOpen={open === 'format'} onOpenChange={(o) => !o && setOpen(null)}>
        <FormatDialog spec={spec} apply={apply} close={() => setOpen(null)} />
      </DialogOverlay>
    </div>
  );
}

/** « Insertion › Graphique… »: the gallery over the selection's data (H1). */
export function InsertChartDialog({ ctl, isOpen, onClose }: { ctl: SheetController; isOpen: boolean; onClose: () => void }) {
  const spec = useMemo(() => {
    if (!isOpen) return null;
    const b = chartBlock(ctl);
    return b ? newChart(b) : null;
  }, [isOpen, ctl]);
  if (!spec) return null;
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <TypeGallery ctl={ctl} spec={spec} mode="insert" onDone={(id) => insertChart(ctl, id)} close={onClose} />
    </DialogOverlay>
  );
}

