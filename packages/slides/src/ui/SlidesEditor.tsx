import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from 'react-aria-components';
import { Badge, Button, DialogOverlay, Icon, Popover, SheetDialog, Checkbox, toast, useToolbarDock } from '@oel/emboss';
import { FontsDialog, IdentityDialog, MenuBar, MoreMenu, Peers, ShareDialog, SyncStatus, VersionPanel, useSessionStatus, type Identity, type MenuSpec } from '@oel/collab-client';
import { firstFontNotice, fontNotice, loadFonts, type FontReport } from '@oel/fonts';
import type * as Y from 'yjs';
import type { SlideSession } from '../collab/session';
import { SlidesDoc } from '../model/ydoc';
import { linksOf } from '@oel/links';
import { toPreview } from '../model/preview';
import { SHAPE_CHOICES } from '../model/geometry';
import { paintColor } from '../model/ops';
import { pt, type Deck } from '../model/types';
import { SlidesController } from './controller';
import { Canvas, pickPicture } from './Canvas';
import { Filmstrip } from './Filmstrip';
import { ScaledSlide, type RenderCtx } from './render';
import { SlidesToolbar } from './SlidesToolbar';
import { Slideshow, openPresenterWindow } from './Slideshow';
import type { Recipe } from '@oel/img';
import { RetouchDock } from '@oel/img/ui';
import { tr } from '@oel/i18n';
import { saveFile } from '@oel/platform';

export interface ExportRequest {
  format: 'pptx';
  json: Deck;
  original: Uint8Array | null;
  media: Array<{ path: string; bytes: Uint8Array }>;
}

export interface SlidesEditorProps {
  session: SlideSession;
  title: string;
  onTitleChange?: (title: string) => void;
  /** Light preview for desk thumbnails, debounced. */
  onPreview?: (preview: ReturnType<typeof toPreview>) => void;
  /** Write the .pptx with the codec (usually the engine worker). */
  exportFile?: (req: ExportRequest) => Promise<Uint8Array>;
  onOpenFile?: (file: File) => void;
  onNewPresentation?: () => void;
  shareOrigin?: string;
  /** Sharing, people, server versions, identity; `false` in the single-user edition. Default `true`. */
  collab?: boolean;
  identity: Identity;
  onIdentityChange?: (identity: Identity) => void;
  /** Editor — Behaviors A1: level 2 (`sheet`), level 3 (`full`), or the /presentation page. */
  variant?: 'sheet' | 'full' | 'standalone';
  onBureau?: () => void;
  onReduce?: () => void;
  onExpand?: () => void;
  /** Start the slideshow as soon as the editor opens (« Présenter » from the desk). */
  autoPresent?: boolean;
  /** The image worker (`@oel/img`): « Retoucher » on pictures (L3). Without it, retouching is unavailable. */
  createImageWorker?: () => Worker;
}

const safeFileName = (t: string) => (t.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'presentation').slice(0, 120);

/** Apply a new plain text to a Y.Text with the smallest change (keeps concurrent edits elsewhere). */
function setYText(t: Y.Text, next: string) {
  const prev = t.toString();
  if (prev === next) return;
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  t.doc?.transact(() => {
    if (prev.length - a - b > 0) t.delete(a, prev.length - a - b);
    if (next.length - a - b > 0) t.insert(a, next.slice(a, next.length - b));
  });
}

function useController(session: SlideSession) {
  const ctl = useMemo(() => new SlidesController(session), [session]);
  useEffect(() => () => ctl.destroy(), [ctl]);
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  return ctl;
}

/** Fit the slide in its box (or a fixed zoom: 1 = 100 %, 96 dpi). */
function useZoom(box: RefObject<HTMLDivElement | null>, zoom: string, width: number, height: number) {
  const [fit, setFit] = useState(0.5);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    // Layout size, not getBoundingClientRect: the desk opens the sheet with a scale-up
    // (OpenSheet's FLIP), and a transform neither shows in the layout size nor wakes the observer.
    const measure = () => {
      const pad = 40;
      setFit(Math.max(0.05, Math.min((node.clientWidth - pad) / pt(width), (node.clientHeight - pad) / pt(height))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [box, width, height]);
  return zoom === 'fit' ? fit : Number(zoom) * (4 / 3);
}

export function SlidesEditor(props: SlidesEditorProps) {
  const { session, identity } = props;
  const variant = props.variant ?? 'standalone';
  const compact = variant === 'sheet';
  const status = useSessionStatus(session);
  const ctl = useController(session);
  const info = ctl.info;
  const ro = status.readOnly;
  const [zoom, setZoom] = useState('fit');
  // The bar folds into « Plus » and can dock at the bottom (Figma J3), remembered per editor.
  const dock = useToolbarDock(variant === 'sheet' ? 'slides-sheet' : 'slides');
  const [showNotes, setShowNotes] = useState(!compact);
  const [showVersions, setShowVersions] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'identity' | 'background' | null>(null);
  const [show, setShow] = useState<number | null>(() => (props.autoPresent ? 0 : null));
  const [presenterWin, setPresenterWin] = useState<Window | null>(null);
  const [printing, setPrinting] = useState(false);
  const [, setFontsReady] = useState(0);
  const [fontReport, setFontReport] = useState<FontReport | null>(null);
  const [fontsOpen, setFontsOpen] = useState(false);
  const stageBox = useRef<HTMLDivElement>(null);
  const k = useZoom(stageBox, zoom, info.width, info.height);
  const [titleDraft, setTitleDraft] = useState(props.title);
  useEffect(() => setTitleDraft(props.title), [props.title]);

  // The deck's embedded fonts, and open substitutes for the fonts this machine lacks;
  // the first time a deck opens here, say which fonts do not show as they are.
  useEffect(() => {
    let alive = true;
    void loadFonts(info.fonts, session.media.url).then((report) => {
      if (!alive) return;
      setFontsReady((n) => n + 1);
      setFontReport(report);
      const notice = fontNotice(report);
      // TODO(ux): once this toast is dismissed (or times out) the fonts dialog cannot be reached again;
      // decide where it lives (a font menu entry, the info panel, the toast history…).
      if (notice && firstFontNotice(session.status.docId)) toast({ ...notice, tone: 'warning', action: { label: tr('Voir plus', 'See more'), onAction: () => setFontsOpen(true) } });
    });
    return () => void (alive = false);
  }, [info.fonts, session]);

  // Desk thumbnail, debounced.
  const onPreview = props.onPreview;
  useEffect(() => {
    if (!onPreview) return;
    const t = setTimeout(() => onPreview(toPreview(ctl.doc)), 800);
    return () => clearTimeout(t);
  }, [ctl.version, ctl.doc, onPreview]);

  const ctx: RenderCtx = useMemo(
    () => ({ theme: info.theme, fonts: info.fonts, media: ctl.mediaUrl, previewing: ctl.previewing, editing: true, editingText: ctl.editing, slideNumber: ctl.index + 1, links: linksOf(session.ydoc) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, session, ctl.editing, ctl.index, ctl.version],
  );

  const present = useCallback((from: number) => {
    ctl.endText();
    setShow(from);
  }, [ctl]);

  const exportPptx = async () => {
    if (!props.exportFile) return;
    ctl.endText();
    try {
      const input = await session.exportInput();
      const bytes = await props.exportFile({ format: 'pptx', ...input });
      await saveFile(bytes as Uint8Array<ArrayBuffer>, `${safeFileName(props.title)}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    } catch (e) {
      toast({ title: tr('Exportation impossible', 'Export failed'), description: (e as Error).message, tone: 'danger' });
    }
  };

  const commitTitle = () => {
    const t = titleDraft.trim() || props.title;
    setTitleDraft(t);
    if (t !== props.title) {
      props.onTitleChange?.(t);
      ctl.doc.meta.set('title', t);
    }
  };

  const layouts = info.layouts.map((l) => ({ id: `layout:${l.id}`, label: l.name || tr('Disposition', 'Layout'), checked: l.id === ctl.slide?.layout }));
  const local = status.connection === 'local';
  const collab = props.collab ?? true;
  const spec: MenuSpec = [
    {
      label: tr('Fichier', 'File'),
      items: [
        ...(props.onNewPresentation ? [{ id: 'new', label: tr('Nouvelle présentation', 'New presentation'), icon: 'plus' as const }] : []),
        ...(props.onOpenFile ? [{ id: 'open', label: tr('Ouvrir un fichier .pptx…', 'Open a .pptx file…'), icon: 'upload' as const }] : []),
        { id: 'dl-pptx', label: tr('Télécharger en PowerPoint (.pptx)', 'Download as PowerPoint (.pptx)'), icon: 'download', disabled: !props.exportFile },
        { id: 'print', label: tr('Imprimer / PDF', 'Print / PDF'), icon: 'print', shortcut: 'Ctrl+P' },
        '-',
        { id: 'share', label: tr('Partager…', 'Share…'), icon: 'share', hidden: !collab },
        { id: 'history', label: tr('Historique des versions', 'Version history'), icon: 'history', disabled: local || status.role === 'viewer', hidden: !collab },
        { id: 'identity', label: tr('Votre nom et couleur…', 'Your name and colour…'), icon: 'user', hidden: !collab },
      ],
    },
    {
      label: tr('Édition', 'Edit'),
      items: [
        { id: 'undo', label: tr('Annuler', 'Undo'), icon: 'undo', shortcut: 'Ctrl+Z', disabled: ro },
        { id: 'redo', label: tr('Rétablir', 'Redo'), icon: 'redo', shortcut: 'Ctrl+Y', disabled: ro },
        '-',
        { id: 'cut', label: tr('Couper', 'Cut'), icon: 'cut', shortcut: 'Ctrl+X', disabled: ro || !ctl.selection.length },
        { id: 'copy', label: tr('Copier', 'Copy'), icon: 'copy', shortcut: 'Ctrl+C', disabled: !ctl.selection.length },
        { id: 'paste', label: tr('Coller', 'Paste'), icon: 'paste', shortcut: 'Ctrl+V', disabled: ro || !ctl.canPaste },
        { id: 'duplicate', label: tr('Dupliquer', 'Duplicate'), shortcut: 'Ctrl+D', disabled: ro || !ctl.selection.length },
        { id: 'delete', label: tr('Supprimer', 'Delete'), icon: 'trash', shortcut: 'Suppr', disabled: ro || !ctl.selection.length },
        '-',
        { id: 'select-all', label: tr('Tout sélectionner', 'Select all'), shortcut: 'Ctrl+A' },
      ],
    },
    {
      label: tr('Affichage', 'View'),
      items: [
        { id: 'present', label: tr('Diaporama depuis le début', 'Slideshow from the start'), icon: 'play', shortcut: 'F5' },
        { id: 'present-here', label: tr('Diaporama depuis cette diapositive', 'Slideshow from this slide'), shortcut: 'Maj+F5' },
        { id: 'presenter', label: tr('Vue présentateur', 'Presenter view'), icon: 'laptop', shortcut: 'Alt+F5' },
        '-',
        { id: 'notes', label: tr('Notes de l’orateur', 'Speaker notes'), checked: showNotes },
        { id: 'zoom-fit', label: tr('Ajuster à la fenêtre', 'Fit to the window'), checked: zoom === 'fit' },
      ],
    },
    {
      label: tr('Insertion', 'Insert'),
      items: [
        { id: 'new-slide', label: tr('Nouvelle diapositive', 'New slide'), icon: 'new-page', shortcut: 'Ctrl+M', disabled: ro },
        { id: 'dup-slide', label: tr('Dupliquer la diapositive', 'Duplicate the slide'), icon: 'copy', disabled: ro },
        '-',
        { id: 'text', label: tr('Zone de texte', 'Text box'), icon: 'text-box', disabled: ro },
        { id: 'image', label: tr('Image…', 'Image…'), icon: 'image', disabled: ro },
        { id: 'shapes', label: tr('Formes', 'Shapes'), icon: 'shape', disabled: ro, children: SHAPE_CHOICES.map((s) => ({ id: `shape:${s.prst}`, label: s.label })) },
      ],
    },
    {
      label: tr('Diapositive', 'Slide'),
      items: [
        { id: 'layouts', label: tr('Disposition', 'Layout'), icon: 'layout', disabled: ro, children: layouts },
        { id: 'background', label: tr('Arrière-plan…', 'Background…'), icon: 'fill-color', disabled: ro },
        { id: 'hide', label: ctl.slide?.hidden ? tr('Afficher pendant le diaporama', 'Show during the slideshow') : tr('Masquer pendant le diaporama', 'Hide during the slideshow'), icon: 'eye', disabled: ro },
        '-',
        { id: 'delete-slide', label: tr('Supprimer la diapositive', 'Delete the slide'), icon: 'trash', disabled: ro || ctl.doc.slideIds().length < 2 },
      ],
    },
    {
      label: tr('Organiser', 'Arrange'),
      items: [
        { id: 'arrange:front', label: tr('Mettre au premier plan', 'Bring to front'), disabled: ro || !ctl.selection.length },
        { id: 'arrange:forward', label: tr('Avancer', 'Bring forward'), disabled: ro || !ctl.selection.length },
        { id: 'arrange:backward', label: tr('Reculer', 'Send backward'), disabled: ro || !ctl.selection.length },
        { id: 'arrange:back', label: tr('Mettre à l’arrière-plan', 'Send to back'), disabled: ro || !ctl.selection.length },
        '-',
        { id: 'align:left', label: tr('Aligner à gauche', 'Align left'), disabled: ro || !ctl.selection.length },
        { id: 'align:center', label: tr('Centrer horizontalement', 'Centre horizontally'), disabled: ro || !ctl.selection.length },
        { id: 'align:right', label: tr('Aligner à droite', 'Align right'), disabled: ro || !ctl.selection.length },
        { id: 'align:top', label: tr('Aligner en haut', 'Align top'), disabled: ro || !ctl.selection.length },
        { id: 'align:middle', label: tr('Centrer verticalement', 'Centre vertically'), disabled: ro || !ctl.selection.length },
        { id: 'align:bottom', label: tr('Aligner en bas', 'Align bottom'), disabled: ro || !ctl.selection.length },
      ],
    },
  ];

  const act = (id: string) => {
    if (id.startsWith('layout:')) return ctl.setLayout(id.slice(7));
    if (id.startsWith('shape:')) return ctl.insertShape(id.slice(6));
    if (id.startsWith('arrange:')) return ctl.arrange(id.slice(8) as 'front');
    if (id.startsWith('align:')) return ctl.align(id.slice(6) as 'left');
    const map: Record<string, () => void> = {
      new: () => props.onNewPresentation?.(),
      open: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pptx,.pptm,.ppsx,.potx';
        input.onchange = () => input.files?.[0] && props.onOpenFile?.(input.files[0]);
        input.click();
      },
      'dl-pptx': () => void exportPptx(),
      print: () => (ctl.endText(), setPrinting(true)),
      share: () => setDialog('share'),
      history: () => setShowVersions((v) => !v),
      identity: () => setDialog('identity'),
      undo: () => ctl.undo.undo(),
      redo: () => ctl.undo.redo(),
      cut: () => ctl.cut(),
      copy: () => ctl.copy(),
      paste: () => ctl.paste(),
      duplicate: () => ctl.duplicateSelection(),
      delete: () => ctl.deleteSelection(),
      'select-all': () => ctl.selectAll(),
      present: () => present(0),
      'present-here': () => present(ctl.index),
      presenter: () => (setPresenterWin(openPresenterWindow()), present(ctl.index)),
      notes: () => setShowNotes((v) => !v),
      'zoom-fit': () => setZoom('fit'),
      'new-slide': () => void ctl.newSlide(),
      'dup-slide': () => ctl.duplicateSlide(),
      text: () => ctl.insertTextBox(),
      image: () => pickPicture(ctl),
      background: () => setDialog('background'),
      hide: () => ctl.toggleHidden(),
      'delete-slide': () => ctl.deleteSlide(),
    };
    map[id]?.();
  };

  const onKeyDown = (e: RKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F5' && e.altKey) {
      // Alt+F5: the « Présentateur » window on this screen, the show full screen (drag one to the other screen).
      e.preventDefault();
      setPresenterWin(openPresenterWindow());
      return present(ctl.index);
    }
    if (e.key === 'F5') {
      e.preventDefault();
      return present(e.shiftKey ? ctl.index : 0);
    }
    if (mod && e.key.toLowerCase() === 'm' && !ro) {
      e.preventDefault();
      return void ctl.newSlide();
    }
    if (mod && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      return act('print');
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !ro) {
      e.preventDefault();
      return ctl.undo.undo();
    }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !ro) {
      e.preventDefault();
      return ctl.undo.redo();
    }
  };

  const exportButton = (
    <Button size="sm" variant="secondary" leadingIcon="download" onPress={() => void exportPptx()} isDisabled={!props.exportFile}>
      .pptx
    </Button>
  );
  const shareButton = collab && (
    <Button size="sm" variant="primary" leadingIcon="share" onPress={() => setDialog('share')}>
      {tr('Partager', 'Share')}
    </Button>
  );
  const preserved = info.preserved;
  const preservedChip = preserved.length > 0 && <PreservedChip items={preserved} />;
  const slide = ctl.slide;
  const notes = slide ? ctl.doc.notes(slide.id) : null;
  const layoutName = info.layouts.find((l) => l.id === slide?.layout)?.name;

  const toolbarEl = (
    <SlidesToolbar ctl={ctl} ctx={ctx} zoom={zoom} setZoom={setZoom} compact={compact} onPresent={(m) => (m === 'presenter' ? act('presenter') : present(0))} more={compact ? <MoreMenu spec={spec} onAction={act} /> : undefined} dock={dock} storageKey={compact ? 'slides-sheet' : 'slides'} />
  );

  return (
    <div className={`oel-slides oel-slides--${variant}`} data-slides={status.docId} onKeyDown={onKeyDown}>
      {!compact && (
        <header className="oel-slides__top">
          <nav className="oel-slides__crumbs" aria-label={tr('Fil d’Ariane', 'Breadcrumb')}>
            {props.onBureau && (
              <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={props.onBureau}>
                Bureau
              </Button>
            )}
            {props.onBureau && <span className="oel-slides__crumb-sep" aria-hidden>›</span>}
            <span className="oel-slides__icon" aria-hidden>
              <Icon name="slide" size={20} />
            </span>
          </nav>
          <div className="oel-slides__titles">
            <div className="oel-slides__titlerow">
              <input
                className="oel-slides__title"
                aria-label={tr('Titre de la présentation', 'Presentation title')}
                value={titleDraft}
                readOnly={ro}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {ro && <Badge appearance="stamp" tone="neutral" dot={false}>{tr('Lecture seule', 'Read-only')}</Badge>}
              <SyncStatus status={status} noun={tr('présentation', 'presentation')} collab={collab} />
            </div>
            <MenuBar spec={spec} onAction={act} label={tr('Menus de la présentation', 'Presentation menus')} />
          </div>
          <div className="oel-slides__right">
            {preservedChip}
            {props.onReduce && (
              <Button size="sm" variant="ghost" leadingIcon="collapse" aria-keyshortcuts="Control+Shift+Enter" onPress={props.onReduce}>
                {tr('Réduire', 'Reduce')}
              </Button>
            )}
            {collab && <Peers status={status} noun={tr('présentation', 'presentation')} />}
            {collab && <Button size="sm" variant="ghost" leadingIcon="history" aria-label={tr('Historique des versions', 'Version history')} isDisabled={local || status.role === 'viewer'} onPress={() => setShowVersions((v) => !v)} />}
            {exportButton}
            {shareButton}
          </div>
        </header>
      )}

      <div className="oel-slides__toolbar" onMouseDown={(e) => (e.target as HTMLElement).closest('input,select,textarea') || e.preventDefault()}>
        {!dock.docked && toolbarEl}
        {compact && (
          <div className="oel-slides__sheet-actions">
            {preservedChip}
            <SyncStatus status={status} noun={tr('présentation', 'presentation')} collab={collab} />
            {collab && <Peers status={status} noun={tr('présentation', 'presentation')} />}
            {props.onExpand && <Button size="icon-sm" variant="ghost" leadingIcon="expand" aria-label={tr('Plein écran (Ctrl+Maj+Entrée)', 'Full screen (Ctrl+Shift+Enter)')} onPress={props.onExpand} />}
            {exportButton}
            {shareButton}
          </div>
        )}
      </div>

      <div className="oel-slides__body">
        <Filmstrip ctl={ctl} ctx={ctx} onPresent={present} />
        <div className="oel-slides__main">
          <div ref={stageBox} className="oel-slides__stage">
            <Canvas ctl={ctl} ctx={ctx} zoom={k} canRetouch={!!props.createImageWorker} label={tr(`Diapositive ${ctl.index + 1} sur ${ctl.doc.slideIds().length}`, `Slide ${ctl.index + 1} of ${ctl.doc.slideIds().length}`)} />
          </div>
          {showNotes && notes && <NotesPane key={slide!.id} text={notes} ro={ro} />}
        </div>
        {showVersions && (
          <VersionPanel
            session={session}
            onClose={() => setShowVersions(false)}
            onRestored={() => ctl.bump()}
            restore={(id) => session.restoreVersion(id)}
            renderPreview={(d: Y.Doc) => <VersionPreview doc={d} media={session.media.url} />}
          />
        )}
        {ctl.retouching && props.createImageWorker && <SlideRetouch key={`${ctl.retouching.slide}/${ctl.retouching.id}`} ctl={ctl} createWorker={props.createImageWorker} />}
      </div>

      {dock.docked && (
        <div className="oel-slides__dock" onMouseDown={(e) => (e.target as HTMLElement).closest('input,select,textarea') || e.preventDefault()}>
          {toolbarEl}
        </div>
      )}
      {!compact && (
        <footer className="oel-slides__status">
          <span>
            Diapositive {ctl.index + 1} sur {ctl.doc.slideIds().length}
          </span>
          {layoutName && <span className="oel-slides__status-layout">{layoutName}</span>}
          {slide?.hidden && <Badge tone="neutral" dot={false}>{tr('Masquée', 'Hidden')}</Badge>}
          <span className="oel-slides__status-spacer" />
          <Button size="sm" variant="ghost" leadingIcon="note" onPress={() => setShowNotes((v) => !v)} aria-pressed={showNotes}>
            Notes
          </Button>
          <span>{zoom === 'fit' ? tr('Ajusté', 'Fit') : `${Math.round(Number(zoom) * 100)} %`}</span>
        </footer>
      )}

      {show != null && <Slideshow ctl={ctl} ctx={ctx} start={show} presenterWindow={presenterWin} onExit={() => (setShow(null), setPresenterWin(null))} />}
      {printing && <PrintDeck ctl={ctl} ctx={ctx} onDone={() => setPrinting(false)} />}
      <BackgroundDialog ctl={ctl} isOpen={dialog === 'background'} onClose={() => setDialog(null)} />
      {collab && <ShareDialog session={session} title={props.title} origin={props.shareOrigin ?? (typeof location !== 'undefined' ? location.origin : '')} isOpen={dialog === 'share'} onClose={() => setDialog(null)} />}
      {fontReport && <FontsDialog fonts={info.fonts} report={fontReport} isOpen={fontsOpen} onClose={() => setFontsOpen(false)} onChange={() => setFontsReady((n) => n + 1)} />}
      {collab && <IdentityDialog identity={identity} isOpen={dialog === 'identity'} onClose={() => setDialog(null)} onSave={(i) => (session.setIdentity(i), props.onIdentityChange?.(i))} />}
    </div>
  );
}

function NotesPane({ text, ro }: { text: Y.Text; ro: boolean }) {
  const [value, setValue] = useState(() => text.toString());
  const focused = useRef(false);
  useEffect(() => {
    const on = () => !focused.current && setValue(text.toString());
    text.observe(on);
    return () => text.unobserve(on);
  }, [text]);
  return (
    <section className="oel-notes" aria-label={tr('Notes de l’orateur', 'Speaker notes')}>
      <textarea
        className="oel-notes__input"
        value={value}
        readOnly={ro}
        placeholder={tr('Cliquez pour ajouter des notes', 'Click to add notes')}
        aria-label={tr('Notes de l’orateur', 'Speaker notes')}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setValue(text.toString());
        }}
        onChange={(e) => {
          setValue(e.target.value);
          setYText(text, e.target.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </section>
  );
}

function PreservedChip({ items }: { items: Array<{ kind: string; label: string; count: number }> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" className="oel-slides__chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="lock" size={14} /> {tr('Conservé', 'Kept')} · {items.map((i) => i.label).join(', ')}
      </button>
      <Popover triggerRef={ref as RefObject<HTMLButtonElement>} isOpen={open} onOpenChange={setOpen} placement="bottom end">
        <Dialog className="oel-popover-dialog oel-preserved" aria-label={tr('Éléments conservés', 'Kept elements')}>
          <p>{tr('Ces éléments du fichier sont gardés tels quels à l’exportation, mais ne se modifient pas ici :', 'These elements of the file are kept as they are on export, but can’t be edited here:')}</p>
          <ul>
            {items.map((i) => (
              <li key={i.kind}>
                {i.label} ({i.count})
              </li>
            ))}
          </ul>
        </Dialog>
      </Popover>
    </>
  );
}

const BG_COLORS = ['#FFFFFF', '#F2F2F2', '#D9D9D9', '#262626', '#000000', '#FDF6E3', '#E7F0FA', '#E9F5EC', '#FCE4D6', '#1F3864', '#0B5345', '#5B2C6F'];

function BackgroundDialog({ ctl, isOpen, onClose }: { ctl: SlidesController; isOpen: boolean; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const theme = ctl.info.theme.colors.filter((c) => !['hlink', 'folHlink'].includes(c.name));
  const current = paintColor(ctl.slide?.background);
  const pick = (color: string | null) => {
    ctl.setBackground(color ? { type: 'solid', color } : null, all);
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Arrière-plan de la diapositive', 'Slide background')} width={380}>
        <div className="oel-swatches">
          <button type="button" className="oel-swatch oel-swatch--none" onClick={() => pick(null)}>
            {tr('Celui de la disposition', 'The layout’s')}
          </button>
          <p className="oel-swatches__label">{tr('Couleurs du thème', 'Theme colours')}</p>
          <div className="oel-swatches__grid">
            {theme.map((c) => (
              <button key={c.name} type="button" className={`oel-swatch${current === c.color ? ' is-on' : ''}`} style={{ background: c.color }} aria-label={c.color} onClick={() => pick(c.color)} />
            ))}
          </div>
          <p className="oel-swatches__label">{tr('Autres', 'Others')}</p>
          <div className="oel-swatches__grid">
            {BG_COLORS.map((c) => (
              <button key={c} type="button" className={`oel-swatch${current === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => pick(c)} />
            ))}
          </div>
          <label className="oel-swatches__custom">
            {tr('Personnalisée', 'Custom')} <input type="color" onChange={(e) => pick(e.target.value.toUpperCase())} />
          </label>
          <Checkbox isSelected={all} onChange={setAll}>
            {tr('Appliquer à toutes les diapositives', 'Apply to every slide')}
          </Checkbox>
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

/** Ctrl+P: one slide per page at the slide's size (hidden slides too, like PowerPoint's default). */
function PrintDeck({ ctl, ctx, onDone }: { ctl: SlidesController; ctx: RenderCtx; onDone: () => void }) {
  const info = ctl.info;
  const wIn = info.width / 914400;
  const hIn = info.height / 914400;
  useEffect(() => {
    document.documentElement.classList.add('oel-printing-slides');
    const after = () => onDone();
    addEventListener('afterprint', after);
    const t = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(t);
      removeEventListener('afterprint', after);
      document.documentElement.classList.remove('oel-printing-slides');
    };
  }, [onDone]);
  const pxWidth = wIn * 96;
  return createPortal(
    <div className="oel-print-slides" aria-hidden>
      <style>{`@page oel-slide { size: ${wIn}in ${hIn}in; margin: 0; }`}</style>
      {ctl.doc.slideIds().map((id, i) => {
        const s = ctl.doc.slide(id);
        return s ? (
          <div key={id} className="oel-print-slides__page">
            <ScaledSlide slide={s} info={info} ctx={{ ...ctx, editing: false, editingText: null, slideNumber: i + 1 }} width={pxWidth} />
          </div>
        ) : null;
      })}
    </div>,
    document.body,
  );
}

/** First slides of a version, read-only. */
function VersionPreview({ doc, media }: { doc: Y.Doc; media: (path: string) => string | null }) {
  const d = useMemo(() => new SlidesDoc(doc), [doc]);
  const info = d.info();
  const ids = d.slideIds().slice(0, 6);
  if (!ids.length) return <p className="oel-panel__empty">{tr('Version vide.', 'Empty version.')}</p>;
  const ctx: RenderCtx = { theme: info.theme, fonts: info.fonts, media, editing: false };
  return (
    <div className="oel-versions__slides">
      {ids.map((id, i) => {
        const s = d.slide(id);
        return s ? <ScaledSlide key={id} slide={s} info={info} ctx={{ ...ctx, slideNumber: i + 1 }} width={240} /> : null;
      })}
    </div>
  );
}

const RETOUCH_NOTE = tr('Le fichier PowerPoint garde l’image retouchée et, à part, l’original et la recette : rouvert dans OEL, tout reste modifiable.', 'The PowerPoint file keeps the retouched image and, separately, the original and the recipe: reopened in OEL, everything stays editable.');

/** L3 · the atelier docked at the right of the slide; the slide and the filmstrip show the live rendering. */
function SlideRetouch({ ctl, createWorker }: { ctl: SlidesController; createWorker: () => Worker }) {
  const { slide, id, crop } = ctl.retouching!;
  const start = useMemo(() => ctl.doc.slide(slide)?.elements.find((e) => e.id === id) ?? null, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = start?.image?.media ?? '';
  const original = start?.image?.orig ?? shown;
  const loadOriginal = useCallback(async () => {
    const url = ctl.session.media.url(original);
    return url ? (await fetch(url)).blob() : null;
  }, [ctl, original]);
  if (!start?.image) return null;
  return (
    <RetouchDock
      title={start.descr || start.name || 'Image'}
      loadOriginal={loadOriginal}
      recipe={(start.image.recipe as Recipe | undefined) ?? null}
      crop={crop}
      note={RETOUCH_NOTE}
      createWorker={createWorker}
      onPreview={(p) => ctl.previewMedia(shown, p?.url ?? null)}
      onCommit={(r) => ctl.retouchPicture(slide, id, r)}
      onClose={() => ctl.closeRetouch()}
    />
  );
}
