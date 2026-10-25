import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Dialog, MenuTrigger } from 'react-aria-components';
import { Badge, Button, DialogOverlay, Icon, Menu, MenuItem, MenuPopover, MenuSeparator, NumberField, Popover, SheetDialog, TextField, toast, useToolbarDock } from '@oel/emboss';
import { IdentityDialog, MenuBar, MoreMenu, Peers, ShareDialog, SyncStatus, VersionPanel, useSessionStatus, type Identity, type MenuSpec } from '@oel/collab-client';
import type * as Y from 'yjs';
import { SheetDoc } from '../model/ydoc';
import { toPreview } from '../model/preview';
import { rangeA1 } from '../model/a1';
import type { Workbook } from '../model/types';
import { CalcClient } from '../calc/client';
import type { SheetSession } from '../collab/session';
import { current } from '../grid/selection';
import { SheetController, NUMBER_FORMATS } from './controller';
import { Grid } from './Grid';
import { chartBlock, insertChart } from './charts';
import { InsertChartDialog } from './ChartTools';
import { replacePicture, retouchPicture } from './pictures';
import type { Recipe } from '@oel/img';
import { RetouchDock } from '@oel/img/ui';
import { drawingImagePaths, drawingImageUrls } from './media';
import { FormulaBar } from './FormulaBar';
import { SheetTabs } from './SheetTabs';
import { SheetsToolbar } from './SheetsToolbar';
import { CondFormatDialog, CsvDialog, FilterMenu, FindBar, FormatCellsDialog, LinkDialog, NamesDialog, PreservedNote, SortDialog, ValidationDialog, ValidationList, listChoices, validate } from './dialogs';
import { messages, tr } from '@oel/i18n';
import { saveFile } from '@oel/platform';

export interface ExportRequest {
  format: 'xlsx' | 'csv' | 'tsv';
  json: Workbook;
  original: Uint8Array | null;
  /** Pictures made in the editor (.xlsx). */
  media?: Array<{ path: string; bytes: Uint8Array }>;
  /** Sheet index (CSV/TSV write one sheet). */
  sheet?: number;
}

export interface SheetsEditorProps {
  session: SheetSession;
  /** Title in the title bar (also stored in the shared workbook). */
  title: string;
  onTitleChange?: (title: string) => void;
  /** Light preview for desk thumbnails, debounced. */
  onPreview?: (preview: { kind: 'spreadsheet'; sheets: string[]; rows: string[][] }) => void;
  /** Write a file with the codec (usually the engine worker). */
  exportFile?: (req: ExportRequest) => Promise<Uint8Array>;
  /** The calc worker (`@oel/sheets/calc-worker?worker`). */
  createCalcWorker: () => Worker;
  /** The image worker (`@oel/img`): « Retoucher » on pictures (L3). Without it, retouching is unavailable. */
  createImageWorker?: () => Worker;
  onOpenFile?: (file: File) => void;
  onNewWorkbook?: () => void;
  shareOrigin?: string;
  /** Sharing, people, server versions, identity; `false` in the single-user edition. Default `true`. */
  collab?: boolean;
  identity: Identity;
  onIdentityChange?: (identity: Identity) => void;
  /** Editor — Behaviors A1: level 2 (`sheet`), level 3 (`full`), or the /tableur page. */
  variant?: 'sheet' | 'full' | 'standalone';
  onBureau?: () => void;
  onReduce?: () => void;
  onExpand?: () => void;
  /** « Lier dans… » on a chart (Figma G2): the host offers the files that can take a linked copy. */
  onLinkChart?: SheetController['onLinkChart'];
  onLinkRange?: SheetController['onLinkRange'];
}

type DialogName = 'format-cells' | 'sort' | 'validation' | 'cf' | 'names' | 'link' | 'csv' | 'share' | 'identity' | 'col-width' | 'row-height' | 'split' | 'chart' | null;

const MIME: Record<ExportRequest['format'], string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
};

const safeFileName = (t: string) => (t.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'classeur').slice(0, 120);

/**
 * Object URLs for the images of the workbook's drawings. Imported images live
 * in the original .xlsx (kept by the session, offline too); the calc worker
 * reads them out of the package.
 */
function useDrawingMedia(session: SheetSession, ctl: SheetController, calc: CalcClient): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const paths = useMemo(() => drawingImagePaths(ctl.doc).map((p) => p.join('\n')).join('\t'), [ctl, ctl.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!paths) return;
    let alive = true;
    const made: string[] = [];
    void drawingImageUrls(session, calc, paths.split('\t').map((p) => p.split('\n') as [string, string])).then((next) => {
      if (!alive) return next.forEach((u) => URL.revokeObjectURL(u));
      made.push(...next.values());
      setUrls(next);
    });
    return () => {
      alive = false;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [session, calc, paths]);
  return urls;
}

export function SheetsEditor(props: SheetsEditorProps) {
  const { session, identity } = props;
  const variant = props.variant ?? 'standalone';
  const compact = variant === 'sheet';
  const status = useSessionStatus(session);

  // One engine and one controller per session.
  const { ctl, calc } = useMemo(() => {
    const calc = new CalcClient(session.sheet, props.createCalcWorker() as unknown as ConstructorParameters<typeof CalcClient>[1]);
    return { calc, ctl: new SheetController(session.sheet, calc) };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => (ctl.dispose(), calc.dispose()), [ctl, calc]);
  useSyncExternalStore(ctl.subscribe, ctl.getVersion, ctl.getVersion);

  ctl.readOnlyFlag = status.readOnly;
  ctl.validator = (r, c, t) => validate(ctl, r, c, t);
  ctl.onNotice = (title, description) => toast({ title, description, tone: 'warning' });
  ctl.onLinkChart = props.onLinkChart ?? null;
  ctl.onLinkRange = props.onLinkRange ?? null;
  ctl.docId = status.docId;

  const [zoom, setZoom] = useState(1);
  // The bar folds into « Plus » and can dock at the bottom (Figma J3), remembered per editor.
  const dock = useToolbarDock(variant === 'sheet' ? 'sheets-sheet' : 'sheets');
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [filterMenu, setFilterMenu] = useState<{ col: number; at: { x: number; y: number } } | null>(null);
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; kind: 'cell' | 'row' | 'col' } | null>(null);
  const [titleDraft, setTitleDraft] = useState(props.title);
  useEffect(() => setTitleDraft(props.title), [props.title]);
  const gridFocus = useCallback(() => (document.querySelector(`[data-sheets="${status.docId}"] .oel-grid`) as HTMLElement | null)?.focus({ preventScroll: true }), [status.docId]);

  const source = ctl.doc.source();
  const preserved = (ctl.doc.doc.getMap('meta').get('preserved') as Array<{ kind: string; label: string }> | undefined) ?? [];
  const local = status.connection === 'local';
  const collab = props.collab ?? true;
  const ro = status.readOnly;

  // Desk thumbnail, debounced.
  const lastPreview = useRef('');
  useEffect(() => {
    if (!props.onPreview) return;
    const t = setTimeout(() => {
      const p = toPreview(ctl.doc, (si, r, c) => calc.get(si, r, c)?.text);
      const key = JSON.stringify(p);
      if (key !== lastPreview.current) {
        lastPreview.current = key;
        props.onPreview!(p);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [ctl.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileMedia = useDrawingMedia(session, ctl, calc);
  // L3 · the picture being retouched (by its stable id) and the live rendering shown in its place.
  const [retouch, setRetouch] = useState<{ oid: string; crop: boolean } | null>(null);
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null);
  const media = useMemo(() => (preview ? new Map([...fileMedia, [preview.path, preview.url]]) : fileMedia), [fileMedia, preview]);
  ctl.pictures = {
    retouch: props.createImageWorker && !status.readOnly ? (index, crop) => {
      const oid = ctl.doc.drawingId(ctl.sheetId, index);
      if (oid) setRetouch({ oid, crop });
    } : null,
    replace: (index, file) => void replacePicture(ctl, session, index, file).catch(() => toast({ title: tr('Image non remplacée', 'Image not replaced'), tone: 'danger' })),
    open: !!retouch,
  };

  // Focus the grid when the editor opens (typing goes straight into cells).
  useEffect(() => {
    const t = setTimeout(gridFocus, 300);
    return () => clearTimeout(t);
  }, [gridFocus]);

  const commitTitle = () => {
    const t = titleDraft.trim() || props.title;
    if (t !== props.title) props.onTitleChange?.(t);
    setTitleDraft(t);
  };

  // ----- export ------------------------------------------------------------------

  const exportAs = async (format: ExportRequest['format']) => {
    if (!props.exportFile) return toast({ title: tr('Export indisponible', 'Export unavailable'), description: tr('Le moteur de fichiers n’est pas chargé.', 'The file engine is not loaded.'), tone: 'warning' });
    try {
      const input = await session.exportInput();
      if (format !== 'xlsx' && input.json.sheets.length > 1) toast({ title: tr(`Seule la feuille « ${ctl.props.name} » est enregistrée`, `Only the sheet “${ctl.props.name}” is saved`), description: tr('Le format texte ne garde qu’une feuille, sans formules ni mise en forme.', 'The text format keeps one sheet only, without formulas or formatting.'), tone: 'info' });
      const xlsx = format === 'xlsx';
      const bytes = await props.exportFile({ format, json: input.json, original: xlsx ? input.original : null, media: xlsx ? input.media : [], sheet: ctl.sheetIndex });
      await saveFile(bytes as Uint8Array<ArrayBuffer>, `${safeFileName(props.title)}.${format}`, MIME[format]);
    } catch (e) {
      toast({ title: tr('Export impossible', 'Export failed'), description: (e as Error).message, tone: 'warning' });
    }
  };

  const print = () => {
    const u = ctl.doc.usedRange(ctl.sheetId);
    if (!u) return toast({ title: tr('Feuille vide', 'Empty sheet'), tone: 'info' });
    const rg = current(ctl.sel);
    const area = rg.r0 !== rg.r1 || rg.c0 !== rg.c1 ? rg : u;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let html = '<table>';
    for (let r = area.r0; r <= Math.min(area.r1, area.r0 + 5000); r++) {
      html += '<tr>';
      for (let c = area.c0; c <= Math.min(area.c1, area.c0 + 100); c++) {
        const v = ctl.view(r, c);
        const s = v.style;
        const css = [s.font.bold && 'font-weight:700', s.font.italic && 'font-style:italic', s.fill && `background:${s.fill.css}`, s.font.color && `color:${s.font.color.css}`, (s.align.h ?? (v.kind === 'n' ? 'right' : '')) && `text-align:${s.align.h ?? 'right'}`].filter(Boolean).join(';');
        html += `<td style="${css}">${esc(v.text)}</td>`;
      }
      html += '</tr>';
    }
    html += '</table>';
    const w = window.open('', '_blank');
    if (!w) return toast({ title: tr('Fenêtre bloquée', 'Window blocked'), description: tr('Autorisez les fenêtres surgissantes pour imprimer.', 'Allow pop-up windows to print.'), tone: 'warning' });
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(props.title)} — ${esc(ctl.props.name)}</title><style>body{font:11pt Calibri,Carlito,sans-serif;margin:12mm}table{border-collapse:collapse}td{border:1px solid #ccc;padding:2px 6px;white-space:pre-wrap}</style>${html}`);
    w.document.close();
    w.focus();
    w.print();
  };

  // ----- commands ----------------------------------------------------------------------

  const act = (id: string) => {
    const sel = current(ctl.sel);
    switch (id) {
      case 'new':
        return props.onNewWorkbook?.();
      case 'open': {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.xlsx,.xlsm,.csv,.tsv';
        inp.onchange = () => inp.files?.[0] && props.onOpenFile?.(inp.files[0]);
        return inp.click();
      }
      case 'dl-xlsx':
        return void exportAs('xlsx');
      case 'dl-csv':
        return void exportAs('csv');
      case 'dl-tsv':
        return void exportAs('tsv');
      case 'print':
        return print();
      case 'save':
        return toast({ title: tr('Enregistrement automatique', 'Autosave'), description: tr('Chaque modification est enregistrée dès qu’elle est faite.', 'Every change is saved as soon as it is made.'), tone: 'info' });
      case 'history':
        return setShowVersions((v) => !v);
      case 'csv-settings':
        return setDialog('csv');
      case 'to-xlsx':
        ctl.doc.doc.getMap('meta').set('source', 'xlsx');
        toast({ title: tr('Le classeur s’enregistre maintenant en .xlsx', 'The workbook now saves as .xlsx'), description: tr('Formules, mise en forme et feuilles sont conservées.', 'Formulas, formatting and sheets are kept.'), tone: 'success' });
        return void exportAs('xlsx');
      case 'undo':
        return void ctl.undo.undo();
      case 'redo':
        return void ctl.undo.redo();
      case 'cut':
      case 'copy':
        gridFocus();
        return void document.execCommand(id);
      case 'paste':
        return void navigator.clipboard
          .readText()
          .then((text) => ctl.paste({ text }))
          .catch(() => toast({ title: tr('Collez avec Ctrl+V', 'Paste with Ctrl+V'), description: tr('Le navigateur réserve le presse-papiers au raccourci clavier.', 'The browser keeps the clipboard for the keyboard shortcut.'), tone: 'info' }));
      case 'paste-values':
      case 'paste-formats':
      case 'paste-transpose':
        return void navigator.clipboard
          .readText()
          .then((text) => ctl.paste({ text }, id === 'paste-values' ? 'values' : id === 'paste-formats' ? 'formats' : 'transpose'))
          .catch(() => toast({ title: tr('Presse-papiers inaccessible', 'Clipboard unavailable'), description: tr('Autorisez la lecture du presse-papiers pour le collage spécial.', 'Allow reading the clipboard for paste special.'), tone: 'info' }));
      case 'find':
        return setFind({ replace: false });
      case 'replace':
        return setFind({ replace: true });
      case 'clear-values':
        return ctl.clearValues();
      case 'clear-formats':
        return ctl.clearFormats();
      case 'delete-rows':
        return ctl.deleteRows();
      case 'delete-cols':
        return ctl.deleteCols();
      case 'delete-cells':
        return sel.c0 === 0 && sel.c1 >= 16383 ? ctl.deleteRows() : sel.r0 === 0 && sel.r1 >= 1048575 ? ctl.deleteCols() : ctl.deleteRows();
      case 'insert-cells':
        return sel.r0 === 0 && sel.r1 >= 1048575 ? ctl.insertCols('left') : ctl.insertRows('above');
      case 'freeze-row':
        return ctl.freeze(1, ctl.props.frozenCols);
      case 'freeze-col':
        return ctl.freeze(ctl.props.frozenRows, 1);
      case 'freeze-here':
        return ctl.freeze();
      case 'unfreeze':
        return ctl.freeze(0, 0);
      case 'grid':
        return ctl.doc.setProps(ctl.sheetId, { showGrid: !ctl.props.showGrid });
      case 'formulas':
        ctl.showFormulas = !ctl.showFormulas;
        return ctl.bump();
      case 'ins-row-above':
        return ctl.insertRows('above');
      case 'ins-row-below':
        return ctl.insertRows('below');
      case 'ins-col-left':
        return ctl.insertCols('left');
      case 'ins-col-right':
        return ctl.insertCols('right');
      case 'ins-sheet':
        return ctl.setSheet(ctl.doc.addSheet(undefined, ctl.sheetIndex + 1));
      case 'ins-date':
        return ctl.insertNow('date');
      case 'ins-checkbox': {
        ctl.doc.doc.transact(() => {
          ctl.doc.setValidations(ctl.sheetId, [...ctl.doc.validations(ctl.sheetId), { sqref: rangeOf(sel), kind: 'list', formula1: '"TRUE,FALSE"', allowBlank: true }]);
          const edits = [];
          for (let r = sel.r0; r <= Math.min(sel.r1, sel.r0 + 1000); r++) for (let c = sel.c0; c <= Math.min(sel.c1, sel.c0 + 50); c++) edits.push({ r, c, cell: { t: 'b' as const, v: false } });
          ctl.doc.setCells(ctl.sheetId, edits);
        });
        return;
      }
      case 'chart':
      case 'chart-gallery': {
        if (source === 'csv') return toast({ title: tr('Graphiques non enregistrés en CSV', 'Charts not saved in CSV'), description: tr('Un fichier CSV ne garde que les valeurs. Enregistrez en .xlsx (Fichier) pour garder vos graphiques.', 'A CSV file keeps the values only. Save as .xlsx (File) to keep your charts.'), tone: 'warning' });
        if (!chartBlock(ctl)) return act('chart-empty');
        if (id === 'chart-gallery') return setDialog('chart');
        insertChart(ctl);
        return;
      }
      case 'chart-empty':
        return toast({ title: tr('Sélectionnez des données', 'Select data'), description: tr('Placez-vous dans un tableau (ou sélectionnez une plage) avant d’insérer un graphique.', 'Go into a table (or select a range) before inserting a chart.'), tone: 'info' });
      case 'link':
        return setDialog('link');
      case 'link-range': {
        if (!ctl.onLinkRange) return toast({ title: tr('Ouvrez ce classeur depuis le bureau', 'Open this workbook from the desk'), description: tr('Les plages se lient dans les présentations et les documents du bureau.', 'Ranges link into the presentations and documents on the desk.'), tone: 'info' });
        const r = ctl.sel.ranges[ctl.sel.ranges.length - 1]!;
        return ctl.onLinkRange({ sheetId: ctl.sheetId, ids: ctl.doc.idRange(ctl.sheetId, r), label: `${ctl.doc.sheetName(ctl.sheetId) ?? ''}!${rangeA1(r)}` });
      }
      case 'format-cells':
        return setDialog('format-cells');
      case 'bold':
        return ctl.toggleFont('bold');
      case 'italic':
        return ctl.toggleFont('italic');
      case 'underline':
        return ctl.toggleUnderline();
      case 'strike':
        return ctl.toggleFont('strike');
      case 'wrap':
        return ctl.setAlign({ wrap: !ctl.activeStyle.align.wrap || undefined });
      case 'merge-center':
        return ctl.merge(true);
      case 'merge':
        return ctl.merge(false);
      case 'unmerge':
        return ctl.unmerge();
      case 'cf':
        return setDialog('cf');
      case 'row-height':
        return setDialog('row-height');
      case 'col-width':
        return setDialog('col-width');
      case 'hide-rows':
        return ctl.hideRows(true);
      case 'show-rows':
        return ctl.hideRows(false);
      case 'hide-cols':
        return ctl.hideCols(true);
      case 'show-cols':
        return ctl.hideCols(false);
      case 'sort-asc':
      case 'sort-desc':
        return ctl.sort([{ col: ctl.sel.active.c, desc: id === 'sort-desc' }], { header: guessHeader(ctl) });
      case 'sort':
        return setDialog('sort');
      case 'filter':
        return ctl.toggleFilter();
      case 'validation':
        return setDialog('validation');
      case 'names':
        return setDialog('names');
      case 'dedupe': {
        const n = ctl.removeDuplicates(guessHeader(ctl));
        return toast({ title: n ? tr(`${n} ligne${n > 1 ? 's' : ''} en double supprimée${n > 1 ? 's' : ''}`, `${n} duplicate row${n > 1 ? 's' : ''} removed`) : tr('Aucun doublon trouvé', 'No duplicates found'), tone: n ? 'success' : 'info' });
      }
      case 'split':
        return setDialog('split');
      case 'identity':
        return setDialog('identity');
      case 'share':
        return setDialog('share');
      case 'validation-list':
        return;
      default:
        if (id.startsWith('fmt:')) return ctl.setNumFmt(NUMBER_FORMATS.find((f) => f.id === id.slice(4))!.code);
        if (id.startsWith('align:')) return ctl.setAlign({ h: id === 'align:general' ? undefined : id.slice(6) });
        if (id.startsWith('fn:')) {
          ctl.editSheet = ctl.sheetId;
          return ctl.autoSum(id.slice(3));
        }
    }
  };

  const spec: MenuSpec = [
    {
      label: tr('Fichier', 'File'),
      items: [
        { id: 'new', label: tr('Nouveau classeur', 'New workbook'), icon: 'new-page', disabled: !props.onNewWorkbook },
        { id: 'open', label: tr('Ouvrir un fichier…', 'Open a file…'), icon: 'upload', disabled: !props.onOpenFile },
        '-',
        {
          id: 'download',
          label: tr('Télécharger', 'Download'),
          icon: 'download',
          children: [
            { id: 'dl-xlsx', label: tr('Classeur Excel (.xlsx)', 'Excel workbook (.xlsx)') },
            { id: 'dl-csv', label: tr('Valeurs séparées par des virgules (.csv, feuille active)', 'Comma-separated values (.csv, active sheet)') },
            { id: 'dl-tsv', label: tr('Valeurs séparées par des tabulations (.tsv, feuille active)', 'Tab-separated values (.tsv, active sheet)') },
          ],
        },
        ...(source === 'csv' ? [{ id: 'csv-settings', label: tr('Paramètres CSV…', 'CSV settings…') }, { id: 'to-xlsx', label: tr('Enregistrer en .xlsx', 'Save as .xlsx') }] : []),
        { id: 'history', label: tr('Historique des versions', 'Version history'), icon: 'history', shortcut: 'Ctrl+Alt+Maj+H', disabled: local || status.role === 'viewer', hidden: !collab },
        '-',
        { id: 'print', label: tr('Imprimer', 'Print'), icon: 'print', shortcut: 'Ctrl+P' },
      ],
    },
    {
      label: tr('Édition', 'Edit'),
      items: [
        { id: 'undo', label: tr('Annuler', 'Undo'), icon: 'undo', shortcut: 'Ctrl+Z', disabled: ro },
        { id: 'redo', label: tr('Rétablir', 'Redo'), icon: 'redo', shortcut: 'Ctrl+Y', disabled: ro },
        '-',
        { id: 'cut', label: tr('Couper', 'Cut'), icon: 'cut', shortcut: 'Ctrl+X', disabled: ro },
        { id: 'copy', label: tr('Copier', 'Copy'), icon: 'copy', shortcut: 'Ctrl+C' },
        { id: 'paste', label: tr('Coller', 'Paste'), icon: 'paste', shortcut: 'Ctrl+V', disabled: ro },
        {
          id: 'paste-special',
          label: tr('Collage spécial', 'Paste special'),
          disabled: ro,
          children: [
            { id: 'paste-values', label: tr('Valeurs uniquement', 'Values only'), shortcut: 'Ctrl+Maj+V' },
            { id: 'paste-formats', label: tr('Mise en forme uniquement', 'Formatting only') },
            { id: 'paste-transpose', label: tr('Transposé', 'Transposed') },
          ],
        },
        '-',
        { id: 'find', label: tr('Rechercher', 'Find'), icon: 'search', shortcut: 'Ctrl+F' },
        { id: 'replace', label: tr('Rechercher et remplacer', 'Find and replace'), shortcut: 'Ctrl+H', disabled: ro },
        '-',
        { id: 'clear-values', label: tr('Effacer les valeurs', 'Clear values'), shortcut: 'Suppr', disabled: ro },
        { id: 'delete-rows', label: tr('Supprimer les lignes', 'Delete rows'), icon: 'trash', disabled: ro },
        { id: 'delete-cols', label: tr('Supprimer les colonnes', 'Delete columns'), disabled: ro },
      ],
    },
    {
      label: tr('Affichage', 'View'),
      items: [
        {
          id: 'freeze',
          label: tr('Figer', 'Freeze'),
          icon: 'freeze',
          children: [
            { id: 'freeze-row', label: tr('La première ligne', 'The first row') },
            { id: 'freeze-col', label: tr('La première colonne', 'The first column') },
            { id: 'freeze-here', label: tr('Jusqu’à la cellule active', 'Up to the active cell') },
            { id: 'unfreeze', label: tr('Libérer les volets', 'Unfreeze panes') },
          ],
        },
        { id: 'grid', label: tr('Quadrillage', 'Gridlines'), checked: ctl.props.showGrid },
        { id: 'formulas', label: tr('Afficher les formules', 'Show formulas'), shortcut: 'Ctrl+`', checked: ctl.showFormulas },
      ],
    },
    {
      label: tr('Insertion', 'Insert'),
      items: [
        { id: 'ins-row-above', label: tr('Ligne au-dessus', 'Row above'), icon: 'table-rows', disabled: ro },
        { id: 'ins-row-below', label: tr('Ligne en dessous', 'Row below'), disabled: ro },
        { id: 'ins-col-left', label: tr('Colonne à gauche', 'Column left'), icon: 'insert-col', disabled: ro },
        { id: 'ins-col-right', label: tr('Colonne à droite', 'Column right'), disabled: ro },
        { id: 'ins-sheet', label: tr('Feuille', 'Sheet'), icon: 'plus', disabled: ro || source === 'csv' },
        '-',
        {
          id: 'functions',
          label: tr('Fonction', 'Function'),
          icon: 'sum',
          disabled: ro,
          children: ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'VLOOKUP', 'XLOOKUP', 'SUMIF', 'COUNTIF', 'ROUND', 'CONCAT', 'TODAY'].map((f) => ({ id: `fn:${f}`, label: f })),
        },
        { id: 'chart-gallery', label: tr('Graphique…', 'Chart…'), icon: 'chart', shortcut: 'Alt+F1', disabled: ro },
        { id: 'link', label: tr('Lien', 'Link'), icon: 'link', shortcut: 'Ctrl+K', disabled: ro },
        { id: 'ins-checkbox', label: tr('Case à cocher (VRAI/FAUX)', 'Checkbox (TRUE/FALSE)'), icon: 'checklist', disabled: ro },
        { id: 'ins-date', label: tr('Date du jour', 'Today’s date'), icon: 'calendar', shortcut: 'Ctrl+;', disabled: ro },
      ],
    },
    {
      label: 'Format',
      items: [
        { id: 'numfmt', label: tr('Nombre', 'Number'), icon: 'word-count', disabled: ro, children: NUMBER_FORMATS.map((f) => ({ id: `fmt:${f.id}`, label: `${f.label} — ${f.example}` })) },
        { id: 'format-cells', label: tr('Format des nombres…', 'Number format…'), shortcut: 'Ctrl+1', disabled: ro },
        '-',
        { id: 'bold', label: tr('Gras', 'Bold'), icon: 'bold', shortcut: 'Ctrl+B', disabled: ro },
        { id: 'italic', label: tr('Italique', 'Italic'), icon: 'italic', shortcut: 'Ctrl+I', disabled: ro },
        { id: 'underline', label: tr('Souligné', 'Underline'), icon: 'underline', shortcut: 'Ctrl+U', disabled: ro },
        { id: 'strike', label: tr('Barré', 'Strikethrough'), icon: 'strikethrough', shortcut: 'Ctrl+5', disabled: ro },
        {
          id: 'align',
          label: tr('Alignement', 'Alignment'),
          icon: 'align-left',
          disabled: ro,
          children: [
            { id: 'align:general', label: tr('Automatique', 'Automatic') },
            { id: 'align:left', label: tr('Gauche', 'Left') },
            { id: 'align:center', label: tr('Centré', 'Centre') },
            { id: 'align:right', label: tr('Droite', 'Right') },
          ],
        },
        { id: 'wrap', label: tr('Renvoyer à la ligne', 'Wrap text'), icon: 'wrap-text', checked: !!ctl.activeStyle.align.wrap, disabled: ro },
        { id: 'merge-cells', label: tr('Fusionner', 'Merge'), icon: 'merge', disabled: ro, children: [{ id: 'merge-center', label: tr('Fusionner et centrer', 'Merge and centre') }, { id: 'merge', label: tr('Fusionner', 'Merge') }, { id: 'unmerge', label: tr('Annuler la fusion', 'Unmerge') }] },
        { id: 'cf', label: tr('Mise en forme conditionnelle…', 'Conditional formatting…'), icon: 'palette', disabled: ro },
        '-',
        { id: 'row-height', label: tr('Hauteur de ligne…', 'Row height…'), disabled: ro },
        { id: 'col-width', label: tr('Largeur de colonne…', 'Column width…'), disabled: ro },
        { id: 'hide', label: tr('Masquer et afficher', 'Hide and show'), disabled: ro, children: [{ id: 'hide-rows', label: tr('Masquer les lignes', 'Hide rows') }, { id: 'show-rows', label: tr('Afficher les lignes', 'Show rows') }, { id: 'hide-cols', label: tr('Masquer les colonnes', 'Hide columns') }, { id: 'show-cols', label: tr('Afficher les colonnes', 'Show columns') }] },
        { id: 'clear-formats', label: tr('Effacer la mise en forme', 'Clear formatting'), icon: 'clear-format', shortcut: 'Ctrl+\\', disabled: ro },
      ],
    },
    {
      label: tr('Données', 'Data'),
      items: [
        { id: 'sort-asc', label: tr('Trier de A à Z', 'Sort A to Z'), icon: 'sort-asc', disabled: ro },
        { id: 'sort-desc', label: tr('Trier de Z à A', 'Sort Z to A'), icon: 'sort-desc', disabled: ro },
        { id: 'sort', label: tr('Trier la plage…', 'Sort range…'), disabled: ro },
        { id: 'filter', label: ctl.doc.filter(ctl.sheetId) ? tr('Retirer le filtre', 'Remove the filter') : tr('Créer un filtre', 'Create a filter'), icon: 'filter', shortcut: 'Ctrl+Maj+L', disabled: ro },
        '-',
        { id: 'validation', label: tr('Validation des données…', 'Data validation…'), icon: 'validation', disabled: ro },
        { id: 'names', label: tr('Plages nommées…', 'Named ranges…') },
        '-',
        { id: 'dedupe', label: tr('Supprimer les doublons', 'Remove duplicates'), disabled: ro },
        { id: 'split', label: tr('Fractionner le texte en colonnes…', 'Split text to columns…'), disabled: ro },
      ],
    },
    {
      label: tr('Outils', 'Tools'),
      items: [
        { id: 'identity', label: tr('Votre nom…', 'Your name…'), icon: 'user', hidden: !collab },
        { id: 'scripts', label: tr('Scripts (Python, Lua) — bientôt', 'Scripts (Python, Lua) — coming soon'), disabled: true },
      ],
    },
  ];

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      // Échap ends what is in progress first; the level only changes when nothing was (A2).
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (ctl.edit) {
        consume();
        ctl.cancelEdit();
      } else if (find) {
        consume();
        setFind(null);
        gridFocus();
      } else if (ctl.copyMark) {
        consume();
        ctl.clearCopyMark();
      } else if (ctl.painter) {
        consume();
        ctl.togglePainter();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && e.shiftKey && e.key.toLowerCase() === 'h' && collab) {
      e.preventDefault();
      act('history');
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'v' && !ctl.edit) {
      e.preventDefault();
      act('paste-values');
    }
    if (mod && e.key === '\\') {
      e.preventDefault();
      act('clear-formats');
    }
  };

  const exportMenu = (
    <MenuTrigger>
      <Button size="sm" variant="secondary" leadingIcon="download">
        {tr('Exporter', 'Export')}
      </Button>
      <MenuPopover placement="bottom end">
        <Menu aria-label={tr('Exporter', 'Export')} onAction={(k) => act(String(k))}>
          <MenuItem id="dl-xlsx" icon="table">Excel (.xlsx)</MenuItem>
          <MenuItem id="dl-csv">CSV (.csv)</MenuItem>
          <MenuItem id="dl-tsv">{tr('Texte tabulé (.tsv)', 'Tab-separated text (.tsv)')}</MenuItem>
          <MenuItem id="print" icon="print">{tr('Imprimer / PDF', 'Print / PDF')}</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
  const shareButton = collab && (
    <Button size="sm" variant="primary" leadingIcon="share" onPress={() => setDialog('share')}>
      {tr('Partager', 'Share')}
    </Button>
  );
  const preservedChip = preserved.length > 0 && (
    <PreservedChip items={preserved} />
  );
  const hasList = !!listChoices(ctl, ctl.sel.active.r, ctl.sel.active.c);

  const toolbarEl = <SheetsToolbar ctl={ctl} onCommand={act} more={compact ? <MoreMenu spec={spec} onAction={act} /> : undefined} dock={dock} storageKey={compact ? 'sheets-sheet' : 'sheets'} />;

  return (
    <div className={`oel-sheets oel-sheets--${variant}`} data-sheets={status.docId} onKeyDown={onKeyDown}>
      {!compact && (
        <header className="oel-sheets__top">
          <nav className="oel-sheets__crumbs" aria-label={tr('Fil d’Ariane', 'Breadcrumb')}>
            {props.onBureau && (
              <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={props.onBureau} aria-keyshortcuts={props.onReduce ? undefined : 'Escape'}>
                Bureau
              </Button>
            )}
            {props.onBureau && <span className="oel-sheets__crumb-sep" aria-hidden>›</span>}
            <span className="oel-sheets__icon" aria-hidden>
              <Icon name="table" size={20} />
            </span>
          </nav>
          <div className="oel-sheets__titles">
            <div className="oel-sheets__titlerow">
              <input
                className="oel-sheets__title"
                aria-label={tr('Titre du classeur', 'Workbook title')}
                value={titleDraft}
                readOnly={ro}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), gridFocus())}
              />
              {ro && <Badge appearance="stamp" tone="neutral" dot={false}>{tr('Lecture seule', 'Read-only')}</Badge>}
              {source === 'csv' && <Badge tone="neutral" dot={false}>CSV</Badge>}
              <SyncStatus status={status} noun={tr('classeur', 'workbook')} collab={collab} />
            </div>
            <MenuBar spec={spec} onAction={act} label={tr('Menus du classeur', 'Workbook menus')} />
          </div>
          <div className="oel-sheets__right">
            {preservedChip}
            {props.onReduce && (
              <Button size="sm" variant="ghost" leadingIcon="collapse" aria-keyshortcuts="Control+Shift+Enter" onPress={props.onReduce}>
                {tr('Réduire', 'Reduce')}
              </Button>
            )}
            {collab && <Peers status={status} noun={tr('classeur', 'workbook')} />}
            {collab && <Button size="sm" variant="ghost" leadingIcon="history" aria-label={tr('Historique des versions', 'Version history')} isDisabled={local || status.role === 'viewer'} onPress={() => setShowVersions((v) => !v)} />}
            {exportMenu}
            {shareButton}
          </div>
        </header>
      )}

      <div className="oel-sheets__toolbar" onMouseDown={(e) => (e.target as HTMLElement).closest('input,select,textarea') || e.preventDefault()}>
        {!dock.docked && toolbarEl}
        {compact && (
          <div className="oel-sheets__sheet-actions">
            {preservedChip}
            <SyncStatus status={status} noun={tr('classeur', 'workbook')} collab={collab} />
            {collab && <Peers status={status} noun={tr('classeur', 'workbook')} />}
            {props.onExpand && <Button size="icon-sm" variant="ghost" leadingIcon="expand" aria-label={tr('Plein écran (Ctrl+Maj+Entrée)', 'Full screen (Ctrl+Shift+Enter)')} onPress={props.onExpand} />}
            {exportMenu}
            {shareButton}
          </div>
        )}
      </div>

      {source === 'csv' && (
        <div className="oel-sheets__banner" role="note">
          <Icon name="info" size={16} />
          <span>{tr('Fichier CSV — les formules et la mise en forme ne sont pas enregistrées dans ce format.', 'CSV file — formulas and formatting are not saved in this format.')}</span>
          <Button size="sm" variant="ghost" onPress={() => act('csv-settings')}>
            {tr('Paramètres CSV', 'CSV settings')}
          </Button>
          <Button size="sm" variant="secondary" isDisabled={ro} onPress={() => act('to-xlsx')}>
            {tr('Enregistrer en .xlsx', 'Save as .xlsx')}
          </Button>
        </div>
      )}
      {find && <FindBar ctl={ctl} replace={find.replace} onClose={() => (setFind(null), gridFocus())} />}
      <FormulaBar ctl={ctl} onFocusGrid={gridFocus} />

      <div className="oel-sheets__body">
        <Grid
          ctl={ctl}
          zoom={zoom}
          label={tr(`${props.title}, feuille ${ctl.props.name}`, `${props.title}, sheet ${ctl.props.name}`)}
          onCommand={act}
          onFilterMenu={(col, at) => setFilterMenu({ col, at })}
          onContextMenu={(at, kind) => setCtxMenu({ ...at, kind })}
          hasList={hasList}
          onListOpen={(at) => setListMenu(at)}
          media={media}
          fitted={preview?.url ?? null}
        />
        {showVersions && (
          <VersionPanel
            session={session}
            onClose={() => setShowVersions(false)}
            onRestored={() => ctl.bump()}
            restore={(id) => session.restoreVersion(id)}
            renderPreview={(d: Y.Doc) => <VersionPreview doc={d} />}
          />
        )}
        {retouch && props.createImageWorker && (
          <SheetRetouch
            key={retouch.oid}
            ctl={ctl}
            session={session}
            calc={calc}
            oid={retouch.oid}
            crop={retouch.crop}
            createWorker={props.createImageWorker}
            onPreview={setPreview}
            onClose={() => {
              setRetouch(null);
              const at = ctl.doc.drawingById(retouch.oid);
              if (at && at.sheet === ctl.sheetId) ctl.selectDrawing(at.index);
              gridFocus();
            }}
          />
        )}
      </div>

      {dock.docked && (
        <div className="oel-sheets__dock" onMouseDown={(e) => (e.target as HTMLElement).closest('input,select,textarea') || e.preventDefault()}>
          {toolbarEl}
        </div>
      )}
      <SheetTabs ctl={ctl} zoom={zoom} setZoom={setZoom} />

      {filterMenu && <FilterMenu ctl={ctl} col={filterMenu.col} at={filterMenu.at} onClose={() => (setFilterMenu(null), gridFocus())} />}
      {listMenu && <ValidationList ctl={ctl} at={listMenu} onClose={() => (setListMenu(null), gridFocus())} />}
      {ctxMenu && <ContextMenu at={ctxMenu} kind={ctxMenu.kind} ro={ro} onAction={(id) => (setCtxMenu(null), act(id), gridFocus())} onClose={() => (setCtxMenu(null), gridFocus())} />}

      <FormatCellsDialog ctl={ctl} isOpen={dialog === 'format-cells'} onClose={() => setDialog(null)} />
      <SortDialog ctl={ctl} isOpen={dialog === 'sort'} onClose={() => setDialog(null)} />
      <ValidationDialog ctl={ctl} isOpen={dialog === 'validation'} onClose={() => setDialog(null)} />
      <CondFormatDialog ctl={ctl} isOpen={dialog === 'cf'} onClose={() => setDialog(null)} />
      <NamesDialog ctl={ctl} isOpen={dialog === 'names'} onClose={() => setDialog(null)} />
      <LinkDialog ctl={ctl} isOpen={dialog === 'link'} onClose={() => setDialog(null)} />
      <InsertChartDialog ctl={ctl} isOpen={dialog === 'chart'} onClose={() => setDialog(null)} />
      <CsvDialog ctl={ctl} isOpen={dialog === 'csv'} onClose={() => setDialog(null)} />
      <SizeDialog
        isOpen={dialog === 'col-width' || dialog === 'row-height'}
        kind={dialog === 'row-height' ? 'row' : 'col'}
        initial={dialog === 'row-height' ? (ctl.doc.rowSize(ctl.sheetId, ctl.sel.active.r)?.size ?? ctl.props.defaultRowHeight) : (ctl.doc.colSize(ctl.sheetId, ctl.sel.active.c)?.size ?? ctl.props.defaultColWidth)}
        onSave={(v) => (dialog === 'row-height' ? ctl.setRowHeight(v) : ctl.setColWidth(v))}
        onClose={() => setDialog(null)}
      />
      <SplitDialog isOpen={dialog === 'split'} onSave={(d) => ctl.splitText(d)} onClose={() => setDialog(null)} />
      {collab && <ShareDialog session={session} title={props.title} origin={props.shareOrigin ?? (typeof location !== 'undefined' ? location.origin : '')} isOpen={dialog === 'share'} onClose={() => setDialog(null)} />}
      {collab && <IdentityDialog identity={identity} isOpen={dialog === 'identity'} onClose={() => setDialog(null)} onSave={(i) => (session.setIdentity(i), props.onIdentityChange?.(i))} />}
    </div>
  );
}

const rangeOf = (r: { r0: number; c0: number; r1: number; c1: number }) => {
  const col = (c: number) => {
    let s = '';
    let n = c;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };
  return r.r0 === r.r1 && r.c0 === r.c1 ? `${col(r.c0)}${r.r0 + 1}` : `${col(r.c0)}${r.r0 + 1}:${col(r.c1)}${Math.min(r.r1, 1048575) + 1}`;
};

/** A header row: the first row is text over a non-text second row. */
function guessHeader(ctl: SheetController): boolean {
  const rg = ctl.currentRegion();
  return ctl.view(rg.r0, ctl.sel.active.c).kind === 's' && ctl.view(rg.r0 + 1, ctl.sel.active.c).kind !== 's' && ctl.sel.active.r > rg.r0;
}

function PreservedChip({ items }: { items: Array<{ kind: string; label: string }> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" className="oel-sheets__chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="lock" size={14} /> {tr('Conservé', 'Kept')} · {items.map((i) => i.label).join(', ')}
      </button>
      <Popover triggerRef={ref as RefObject<HTMLButtonElement>} isOpen={open} onOpenChange={setOpen} placement="bottom end">
        <Dialog className="oel-popover-dialog" aria-label={tr('Éléments conservés', 'Kept elements')}>
          <PreservedNote items={items} />
        </Dialog>
      </Popover>
    </>
  );
}

function ContextMenu({ at, kind, ro, onAction, onClose }: { at: { x: number; y: number }; kind: 'cell' | 'row' | 'col'; ro: boolean; onAction: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const items: Array<{ id: string; label: string } | '-'> = [
    { id: 'cut', label: tr('Couper', 'Cut') },
    { id: 'copy', label: tr('Copier', 'Copy') },
    { id: 'paste', label: tr('Coller', 'Paste') },
    { id: 'paste-values', label: tr('Coller les valeurs', 'Paste values') },
    '-',
    ...(kind !== 'col' ? [{ id: 'ins-row-above', label: tr('Insérer une ligne au-dessus', 'Insert row above') }, { id: 'ins-row-below', label: tr('Insérer une ligne en dessous', 'Insert row below') }, { id: 'delete-rows', label: tr('Supprimer les lignes', 'Delete rows') }] : []),
    ...(kind !== 'row' ? [{ id: 'ins-col-left', label: tr('Insérer une colonne à gauche', 'Insert column left') }, { id: 'ins-col-right', label: tr('Insérer une colonne à droite', 'Insert column right') }, { id: 'delete-cols', label: tr('Supprimer les colonnes', 'Delete columns') }] : []),
    ...(kind === 'row' ? [{ id: 'hide-rows', label: tr('Masquer les lignes', 'Hide rows') }, { id: 'show-rows', label: tr('Afficher les lignes', 'Show rows') }, { id: 'row-height', label: tr('Hauteur de ligne…', 'Row height…') }] : []),
    ...(kind === 'col' ? [{ id: 'hide-cols', label: tr('Masquer les colonnes', 'Hide columns') }, { id: 'show-cols', label: tr('Afficher les colonnes', 'Show columns') }, { id: 'col-width', label: tr('Largeur de colonne…', 'Column width…') }] : []),
    '-',
    { id: 'clear-values', label: tr('Effacer les valeurs', 'Clear values') },
    { id: 'sort-asc', label: tr('Trier de A à Z', 'Sort A to Z') },
    { id: 'sort-desc', label: tr('Trier de Z à A', 'Sort Z to A') },
    { id: 'filter', label: tr('Filtre', 'Filter') },
    { id: 'link', label: tr('Insérer un lien', 'Insert a link') },
    { id: 'link-range', label: tr('Lier dans un fichier du bureau…', 'Link into a file on the desk…') },
    { id: 'cf', label: tr('Mise en forme conditionnelle…', 'Conditional formatting…') },
    { id: 'validation', label: tr('Validation des données…', 'Data validation…') },
    { id: 'format-cells', label: tr('Format des nombres…', 'Number format…') },
  ];
  const readOnlySafe = new Set(['copy']);
  return (
    <>
      <span ref={ref} className="oel-anchor" style={{ left: at.x, top: at.y }} aria-hidden />
      <MenuPopover triggerRef={ref as RefObject<HTMLSpanElement>} isOpen onOpenChange={(o) => !o && onClose()} placement="bottom start">
        <Menu aria-label={tr('Actions sur la sélection', 'Selection actions')} autoFocus="first" onAction={(k) => onAction(String(k))} disabledKeys={ro ? items.filter((i): i is { id: string; label: string } => i !== '-' && !readOnlySafe.has(i.id)).map((i) => i.id) : []}>
          {items.map((it, i) => (it === '-' ? <MenuSeparator key={`s${i}`} /> : <MenuItem key={it.id} id={it.id}>{it.label}</MenuItem>))}
        </Menu>
      </MenuPopover>
    </>
  );
}

function SizeDialog({ isOpen, kind, initial, onSave, onClose }: { isOpen: boolean; kind: 'row' | 'col'; initial: number; onSave: (v: number) => void; onClose: () => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => void (isOpen && setV(Math.round(initial * 100) / 100)), [isOpen, initial]);
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={kind === 'row' ? tr('Hauteur de ligne', 'Row height') : tr('Largeur de colonne', 'Column width')} width={360} actions={() => <Button onPress={() => (onSave(v), onClose())}>{tr('Appliquer', 'Apply')}</Button>}>
        <NumberField label={kind === 'row' ? 'Hauteur (points)' : tr('Largeur (caractères)', 'Width (characters)')} value={v} onChange={setV} minValue={0} maxValue={kind === 'row' ? 409 : 255} step={kind === 'row' ? 0.75 : 0.5} autoFocus />
      </SheetDialog>
    </DialogOverlay>
  );
}

function SplitDialog({ isOpen, onSave, onClose }: { isOpen: boolean; onSave: (d: string) => void; onClose: () => void }) {
  const [d, setD] = useState(',');
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Fractionner le texte en colonnes', 'Split text to columns')} width={380} actions={() => <Button onPress={() => (onSave(d === 'Tab' ? '\t' : d), onClose())}>{tr('Fractionner', 'Split')}</Button>}>
        <TextField label={tr('Séparateur', 'Separator')} value={d} onChange={setD} description={tr('Virgule, point-virgule, espace, « Tab »… Le texte de la première colonne sélectionnée est réparti vers la droite.', 'Comma, semicolon, space, “Tab”… The text of the first selected column is spread to the right.')} autoFocus />
      </SheetDialog>
    </DialogOverlay>
  );
}

/** Read-only first rows of a version's first sheet. */
function VersionPreview({ doc }: { doc: Y.Doc }) {
  const d = useMemo(() => new SheetDoc(doc), [doc]);
  const first = d.sheetIds()[0];
  if (!first) return <p className="oel-panel__empty">{tr('Version vide.', 'Empty version.')}</p>;
  const used = d.usedRange(first);
  const rows = used ? Math.min(used.r1, 30) : 0;
  const cols = used ? Math.min(used.c1, 8) : 0;
  return (
    <div className="oel-versions__sheet">
      <p className="oel-versions__sheetname">{d.props(first).name}</p>
      <table>
        <tbody>
          {Array.from({ length: rows + 1 }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols + 1 }, (_, c) => (
                <td key={c}>{d.inputText(first, r, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RETOUCH_NOTE = tr('Le fichier Excel garde l’image retouchée et, à part, l’original et la recette : rouvert dans OEL, tout reste modifiable.', 'The Excel file keeps the retouched image and, separately, the original and the recipe: reopened in OEL, everything stays editable.');

/** L3 · the atelier docked at the right of the grid; the grid shows the live rendering. */
function SheetRetouch(p: { ctl: SheetController; session: SheetSession; calc: CalcClient; oid: string; crop: boolean; createWorker: () => Worker; onPreview: (v: { path: string; url: string } | null) => void; onClose: () => void }) {
  const { ctl, session, calc, oid } = p;
  const start = useMemo(() => ctl.doc.drawingById(oid)?.drawing ?? null, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = start?.media ?? '';
  const original = start?.orig ?? shown;
  const loadOriginal = useCallback(async () => {
    const url = session.media.url(original);
    if (url) return (await fetch(url)).blob();
    const pkg = await session.original().catch(() => null);
    const file = pkg && (await calc.media(pkg, [original]))[0];
    return file ? new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: session.media.index.get(original)?.mime ?? mimeFromPath(original) }) : null;
  }, [session, calc, original]);
  if (!start) return null;
  return (
    <RetouchDock
      title={start.descr || start.name || 'Image'}
      loadOriginal={loadOriginal}
      recipe={(start.recipe as Recipe | undefined) ?? null}
      crop={p.crop}
      note={RETOUCH_NOTE}
      createWorker={p.createWorker}
      onPreview={(v) => p.onPreview(v ? { path: shown, url: v.url } : null)}
      onCommit={(r) => retouchPicture(ctl, session, oid, r)}
      onClose={p.onClose}
    />
  );
}

const mimeFromPath = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
};
