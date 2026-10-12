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
import { ElementsMenu, PALETTES, allSeries, mapAxes, mapSeries, withPalette } from '@oel/charts/ui';
import { chartFont, sheetResolver } from '../grid/charts';
import { chartBlock, deleteDrawing, duplicateDrawing, insertChart, updateChart } from './charts';
import type { SheetController } from './controller';
import { tr } from '@oel/i18n';

// ---------------------------------------------------------------------------
// Type gallery (insert / change type)
// ---------------------------------------------------------------------------

function TypeGallery({ ctl, spec, mode, onDone, close }: { ctl: SheetController; spec: ChartSpec; mode: 'insert' | 'change'; onDone: (typeId: string) => void; close: () => void }) {
  const current = chartFamily(spec);
  const recs = useMemo(() => recommend(spec), [spec]);
  const [tab, setTab] = useState<'rec' | 'all'>(mode === 'insert' ? 'rec' : 'all');
  const [family, setFamily] = useState(current?.family ?? CHART_TYPES[0]!.family);
  const [chosen, setChosen] = useState(mode === 'insert' ? (recs[0]?.id ?? 'col-clustered') : (current?.id ?? 'col-clustered'));
  const resolve = useMemo(() => sheetResolver(ctl, ctl.sheetId), [ctl]);
  const preview = (id: string) => applyType(spec, id);
  const types = tab === 'rec' ? recs.map((r) => CHART_TYPES.find((t) => t.id === r.id)!).filter(Boolean) : CHART_TYPES.filter((t) => t.family === family);
  const info = CHART_TYPES.find((t) => t.id === chosen);
  const reason = recs.find((r) => r.id === chosen)?.reason;
  const unsupported = info?.ex ? tr('Ce type (Office 2016+) s’affiche mais ne peut pas encore être créé : il serait perdu à l’export.', 'This type (Office 2016+) is shown but can’t be created yet: it would be lost on export.') : null;
  return (
    <SheetDialog
      title={mode === 'insert' ? tr('Insérer un graphique', 'Insert a chart') : tr('Changer de type de graphique', 'Change the chart type')}
      width={1080}
      actions={(c) => (
        <>
          <Button variant="ghost" onPress={c}>
            {tr('Annuler', 'Cancel')}
          </Button>
          <Button
            isDisabled={!!unsupported}
            onPress={() => {
              onDone(chosen);
              close();
            }}
          >
            {mode === 'insert' ? tr('Insérer', 'Insert') : tr('Appliquer', 'Apply')}
          </Button>
        </>
      )}
    >
      <div className="oel-chart-gallery">
        <nav className="oel-chart-gallery__nav" aria-label={tr('Familles', 'Families')}>
          <button type="button" className={tab === 'rec' ? 'is-on' : undefined} onClick={() => setTab('rec')}>
            {tr('Recommandés', 'Recommended')}
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
              <p className="oel-chart-gallery__hint">{mode === 'insert' ? tr('Double-clic sur une vignette : insérer.', 'Double-click a thumbnail: insert.') : tr('Double-clic sur une vignette : appliquer.', 'Double-click a thumbnail: apply.')}</p>
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
      title={tr('Sélectionner les données', 'Select the data')}
      width={720}
      actions={(c) => (
        <>
          <Button variant="ghost" onPress={c}>
            {tr('Annuler', 'Cancel')}
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
        <p className="oel-chart-data__help">{tr('Références au format Excel, par exemple', 'Excel-style references, for example')} <code>'Budget'!$B$2:$B$8</code>{tr('. Les valeurs sont relues dans la feuille.', '. The values are read back from the sheet.')}</p>
        {series.map((x, i) => (
          <fieldset key={i} className="oel-chart-data__series">
            <legend>{tr(`Série ${i + 1}`, `Series ${i + 1}`)}</legend>
            <TextField label={tr('Nom', 'Name')} value={x.nameRef ?? x.name ?? ''} onChange={(v) => set(i, (y) => (parseRef(v) ? { ...y, nameRef: v, name: undefined } : { ...y, nameRef: undefined, name: v }))} />
            <TextField label={tr('Valeurs', 'Values')} value={x.val?.f ?? ''} isInvalid={bad(x.val?.f)} onChange={(v) => set(i, (y) => ({ ...y, val: { ...y.val, f: v, num: [], count: 0 } }))} />
            <TextField label={tr('Catégories (axe horizontal)', 'Categories (horizontal axis)')} value={x.cat?.f ?? ''} isInvalid={bad(x.cat?.f)} onChange={(v) => set(i, (y) => ({ ...y, cat: v ? { ...y.cat, f: v, num: [], str: [], count: 0 } : undefined }))} />
            <Button size="sm" variant="ghost" leadingIcon="trash" onPress={() => setDraft({ ...draft, groups: draft.groups.map((g) => ({ ...g, series: g.series.filter((y) => y !== x) })).filter((g) => g.series.length) })}>
              {tr('Supprimer la série', 'Delete the series')}
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
            setDraft({ ...draft, groups: [{ ...g, series: [...g.series, { idx, order: idx, name: tr(`Série${idx + 1}`, `Series${idx + 1}`), val: { f: '' } }] }, ...draft.groups.slice(1)] });
          }}
        >
          {tr('Ajouter une série', 'Add a series')}
        </Button>
        <div className="oel-chart-data__blanks">
          <span>{tr('Cellules vides', 'Empty cells')}</span>
          <RadioGroup aria-label={tr('Cellules vides', 'Empty cells')} orientation="horizontal" value={draft.dispBlanksAs ?? 'gap'} onChange={(v) => setDraft({ ...draft, dispBlanksAs: v })}>
            <Radio value="gap">{tr('Intervalles', 'Gaps')}</Radio>
            <Radio value="zero">{tr('Zéro', 'Zero')}</Radio>
            <Radio value="span">{tr('Relier par une ligne', 'Connect with a line')}</Radio>
          </RadioGroup>
          <Checkbox isSelected={draft.plotVisOnly === false} onChange={(v) => setDraft({ ...draft, plotVisOnly: !v })}>
            {tr('Afficher les lignes et colonnes masquées', 'Show hidden rows and columns')}
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
      title={tr('Mettre en forme le graphique', 'Format the chart')}
      width={560}
      actions={(c) => (
        <>
          <Button variant="ghost" onPress={c}>
            {tr('Annuler', 'Cancel')}
          </Button>
          <Button
            onPress={() => {
              apply(() => draft);
              close();
            }}
          >
            {tr('Appliquer', 'Apply')}
          </Button>
        </>
      )}
    >
      <div className="oel-chart-format">
        <TextField label={tr('Titre du graphique', 'Chart title')} value={draft.title?.text ?? ''} onChange={(v) => setDraft({ ...draft, title: v ? { ...draft.title, text: v } : undefined, autoTitleDeleted: !v })} />
        <h3>{tr('Couleurs des séries', 'Series colours')}</h3>
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
              <span>{x.name ?? x.nameRef ?? tr(`Série ${i + 1}`, `Series ${i + 1}`)}</span>
            </label>
          );
        })}
        {valAxis && (
          <>
            <h3>{tr('Axe des valeurs', 'Value axis')}</h3>
            <div className="oel-chart-format__row">
              <NumberField label="Minimum" value={valAxis.min ?? NaN} onChange={(v) => setAxis({ min: Number.isNaN(v) ? undefined : v })} />
              <NumberField label="Maximum" value={valAxis.max ?? NaN} onChange={(v) => setAxis({ max: Number.isNaN(v) ? undefined : v })} />
              <NumberField label={tr('Unité principale', 'Major unit')} value={valAxis.majorUnit ?? NaN} minValue={0} onChange={(v) => setAxis({ majorUnit: Number.isNaN(v) || v <= 0 ? undefined : v })} />
            </div>
            <TextField label={tr('Format des nombres (code Excel)', 'Number format (Excel code)')} value={valAxis.numFmt ?? ''} onChange={(v) => setAxis({ numFmt: v || undefined, sourceLinked: !v })} />
            <Checkbox isSelected={!!valAxis.logBase} onChange={(v) => setAxis({ logBase: v ? 10 : undefined })}>
              {tr('Échelle logarithmique', 'Logarithmic scale')}
            </Checkbox>
            <Checkbox isSelected={!!valAxis.reverse} onChange={(v) => setAxis({ reverse: v })}>
              {tr('Valeurs en ordre inverse', 'Values in reverse order')}
            </Checkbox>
          </>
        )}
        {v3 && (
          <>
            <h3>{tr('Rotation 3D', '3-D rotation')}</h3>
            <Slider label="Rotation X" minValue={0} maxValue={359} value={v3.rotY ?? 20} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, rotY: v as number } })} />
            <Slider label="Rotation Y" minValue={-90} maxValue={90} value={v3.rotX ?? 15} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, rotX: v as number } })} />
            <Slider label="Perspective" minValue={0} maxValue={100} value={v3.perspective ?? 30} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, perspective: v as number, rAngAx: false } })} />
            <Checkbox isSelected={v3.rAngAx ?? false} onChange={(v) => setDraft({ ...draft, view3d: { ...v3, rAngAx: v } })}>
              {tr('Axes à angle droit', 'Right-angle axes')}
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
      <ToolButton icon="link" label={uses.length === 1 ? tr('Utilisé dans 1 fichier', 'Used in 1 file') : tr(`Utilisé dans ${uses.length} fichiers`, `Used in ${uses.length} files`)} showLabel />
      <MenuPopover placement="bottom start">
        <Menu
          aria-label={tr('Copies liées', 'Linked copies')}
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
  const ro = ctl.readOnlyFlag ? tr('Lecture seule', 'Read-only') : undefined;
  const exNote = spec.ex ? tr('Graphique Office 2016+ : affiché et conservé, pas encore modifiable.', 'Office 2016+ chart: shown and kept, not editable yet.') : undefined;
  const lock = ro ?? exNote;
  return (
    <div className="oel-chart-bar" style={style} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Toolbar aria-label={tr('Graphique', 'Chart')}>
        <span className="oel-chart-bar__label">{tr('Graphique', 'Chart')}</span>
        <ToolButton icon="chart" label={chartFamily(spec)?.label ?? 'Type'} showLabel description={tr('Changer de type de graphique', 'Change the chart type')} unavailableReason={lock} onPress={() => setOpen('type')} />
        <MenuTrigger>
          <ToolButton icon="palette" label={tr('Couleurs', 'Colours')} unavailableReason={lock} />
          <MenuPopover placement="bottom start">
            <Menu aria-label={tr('Couleurs', 'Colours')} onAction={(k) => apply((s) => withPalette(s, PALETTES.find((p) => p.id === k)!.colors))}>
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
          <ToolButton icon="plus" label={tr('Éléments', 'Elements')} showLabel unavailableReason={lock} />
        ) : (
          <MenuTrigger>
            <ToolButton icon="plus" label={tr('Éléments', 'Elements')} showLabel description={tr('Titre, axes, légende, étiquettes, quadrillage…', 'Title, axes, legend, labels, gridlines…')} />
            <Popover placement="bottom">
              <ElementsMenu spec={spec} apply={apply} />
            </Popover>
          </MenuTrigger>
        )}
        <ToolButton icon="table" label={tr('Données', 'Data')} showLabel description={tr('Sélectionner les données', 'Select the data')} unavailableReason={lock} onPress={() => setOpen('data')} />
        <ToolButton
          icon="switch-rows"
          label={tr('Intervertir lignes et colonnes', 'Switch rows and columns')}
          unavailableReason={lock}
          onPress={() => {
            const next = switchRowsCols(ctl, spec);
            if (next) apply(() => next);
          }}
        />
        <ToolbarSeparator />
        <ToolButton
          icon="link"
          label={tr('Lier dans…', 'Link into…')}
          showLabel
          description={tr('Mettre une copie liée dans une présentation ou un document du bureau', 'Put a linked copy in a presentation or a document on the desk')}
          unavailableReason={!ctl.onLinkChart ? tr('Ouvrez ce classeur depuis le bureau pour lier ses graphiques.', 'Open this workbook from the desk to link its charts.') : exNote}
          onPress={() => {
            const chartId = ctl.doc.drawingId(ctl.sheetId, index);
            if (chartId) ctl.onLinkChart?.({ sheetId: ctl.sheetId, chartId, name: chartName(spec), spec });
          }}
        />
        <ChartUses ctl={ctl} index={index} />
        <MenuTrigger>
          <ToolButton icon="more" label={tr('Plus', 'More')} />
          <MenuPopover placement="bottom end">
            <Menu
              aria-label={tr('Plus', 'More')}
              disabledKeys={lock ? ['format', 'duplicate', 'delete'] : []}
              onAction={(k) => {
                if (k === 'format') setOpen('format');
                if (k === 'duplicate') duplicateDrawing(ctl, index);
                if (k === 'delete') deleteDrawing(ctl, index);
              }}
            >
              <MenuItem id="format" icon="pen">
                {tr('Mettre en forme…', 'Format…')}
              </MenuItem>
              <MenuItem id="duplicate" icon="copy" shortcut="Ctrl+D">
                {tr('Dupliquer', 'Duplicate')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="trash" shortcut="Suppr">
                {tr('Supprimer le graphique', 'Delete the chart')}
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

