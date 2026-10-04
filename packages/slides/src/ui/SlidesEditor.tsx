import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from 'react-aria-components';
import { Badge, Button, DialogOverlay, Icon, Popover, SheetDialog, Checkbox, toast } from '@oel/emboss';
import { IdentityDialog, MenuBar, MoreMenu, Peers, ShareDialog, SyncStatus, VersionPanel, useSessionStatus, type Identity, type MenuSpec } from '@oel/collab-client';
import { firstFontNotice, fontNotice, loadFonts } from '@oel/fonts';
import type * as Y from 'yjs';
import type { SlideSession } from '../collab/session';
import { SlidesDoc } from '../model/ydoc';
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
  identity: Identity;
  onIdentityChange?: (identity: Identity) => void;
  /** Editor — Behaviors A1: level 2 (`sheet`), level 3 (`full`), or the /presentation page. */
  variant?: 'sheet' | 'full' | 'standalone';
  onBureau?: () => void;
  onReduce?: () => void;
  onExpand?: () => void;
  /** Start the slideshow as soon as the editor opens (« Présenter » from the desk). */
  autoPresent?: boolean;
}

const safeFileName = (t: string) => (t.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'presentation').slice(0, 120);

function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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
    const measure = () => {
      const r = node.getBoundingClientRect();
      const pad = 40;
      setFit(Math.max(0.05, Math.min((r.width - pad) / pt(width), (r.height - pad) / pt(height))));
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
  const [showNotes, setShowNotes] = useState(!compact);
  const [showVersions, setShowVersions] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'identity' | 'background' | null>(null);
  const [show, setShow] = useState<number | null>(() => (props.autoPresent ? 0 : null));
  const [presenterWin, setPresenterWin] = useState<Window | null>(null);
  const [printing, setPrinting] = useState(false);
  const [, setFontsReady] = useState(0);
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
      const notice = fontNotice(report);
      if (notice && firstFontNotice(session.status.docId)) toast({ ...notice, tone: 'warning' });
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
    () => ({ theme: info.theme, fonts: info.fonts, media: session.media.url, editing: true, editingText: ctl.editing, slideNumber: ctl.index + 1 }),
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
      download(bytes, `${safeFileName(props.title)}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    } catch (e) {
      toast({ title: 'Exportation impossible', description: (e as Error).message, tone: 'danger' });
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

  const layouts = info.layouts.map((l) => ({ id: `layout:${l.id}`, label: l.name || 'Disposition', checked: l.id === ctl.slide?.layout }));
  const local = status.connection === 'local';
  const spec: MenuSpec = [
    {
      label: 'Fichier',
      items: [
        ...(props.onNewPresentation ? [{ id: 'new', label: 'Nouvelle présentation', icon: 'plus' as const }] : []),
        ...(props.onOpenFile ? [{ id: 'open', label: 'Ouvrir un fichier .pptx…', icon: 'upload' as const }] : []),
        { id: 'dl-pptx', label: 'Télécharger en PowerPoint (.pptx)', icon: 'download', disabled: !props.exportFile },
        { id: 'print', label: 'Imprimer / PDF', icon: 'print', shortcut: 'Ctrl+P' },
        '-',
        { id: 'share', label: 'Partager…', icon: 'share' },
        { id: 'history', label: 'Historique des versions', icon: 'history', disabled: local || status.role === 'viewer' },
        { id: 'identity', label: 'Votre nom et couleur…', icon: 'user' },
      ],
    },
    {
      label: 'Édition',
      items: [
        { id: 'undo', label: 'Annuler', icon: 'undo', shortcut: 'Ctrl+Z', disabled: ro },
        { id: 'redo', label: 'Rétablir', icon: 'redo', shortcut: 'Ctrl+Y', disabled: ro },
        '-',
        { id: 'cut', label: 'Couper', icon: 'cut', shortcut: 'Ctrl+X', disabled: ro || !ctl.selection.length },
        { id: 'copy', label: 'Copier', icon: 'copy', shortcut: 'Ctrl+C', disabled: !ctl.selection.length },
        { id: 'paste', label: 'Coller', icon: 'paste', shortcut: 'Ctrl+V', disabled: ro || !ctl.canPaste },
        { id: 'duplicate', label: 'Dupliquer', shortcut: 'Ctrl+D', disabled: ro || !ctl.selection.length },
        { id: 'delete', label: 'Supprimer', icon: 'trash', shortcut: 'Suppr', disabled: ro || !ctl.selection.length },
        '-',
        { id: 'select-all', label: 'Tout sélectionner', shortcut: 'Ctrl+A' },
      ],
    },
    {
      label: 'Affichage',
      items: [
        { id: 'present', label: 'Diaporama depuis le début', icon: 'play', shortcut: 'F5' },
        { id: 'present-here', label: 'Diaporama depuis cette diapositive', shortcut: 'Maj+F5' },
        { id: 'presenter', label: 'Vue présentateur', icon: 'laptop', shortcut: 'Alt+F5' },
        '-',
        { id: 'notes', label: 'Notes de l’orateur', checked: showNotes },
        { id: 'zoom-fit', label: 'Ajuster à la fenêtre', checked: zoom === 'fit' },
      ],
    },
    {
      label: 'Insertion',
      items: [
        { id: 'new-slide', label: 'Nouvelle diapositive', icon: 'new-page', shortcut: 'Ctrl+M', disabled: ro },
        { id: 'dup-slide', label: 'Dupliquer la diapositive', icon: 'copy', disabled: ro },
        '-',
        { id: 'text', label: 'Zone de texte', icon: 'text-box', disabled: ro },
        { id: 'image', label: 'Image…', icon: 'image', disabled: ro },
        { id: 'shapes', label: 'Formes', icon: 'shape', disabled: ro, children: SHAPE_CHOICES.map((s) => ({ id: `shape:${s.prst}`, label: s.label })) },
      ],
    },
    {
      label: 'Diapositive',
      items: [
        { id: 'layouts', label: 'Disposition', icon: 'layout', disabled: ro, children: layouts },
        { id: 'background', label: 'Arrière-plan…', icon: 'fill-color', disabled: ro },
        { id: 'hide', label: ctl.slide?.hidden ? 'Afficher pendant le diaporama' : 'Masquer pendant le diaporama', icon: 'eye', disabled: ro },
        '-',
        { id: 'delete-slide', label: 'Supprimer la diapositive', icon: 'trash', disabled: ro || ctl.doc.slideIds().length < 2 },
      ],
    },
    {
      label: 'Organiser',
      items: [
        { id: 'arrange:front', label: 'Mettre au premier plan', disabled: ro || !ctl.selection.length },
        { id: 'arrange:forward', label: 'Avancer', disabled: ro || !ctl.selection.length },
        { id: 'arrange:backward', label: 'Reculer', disabled: ro || !ctl.selection.length },
        { id: 'arrange:back', label: 'Mettre à l’arrière-plan', disabled: ro || !ctl.selection.length },
        '-',
        { id: 'align:left', label: 'Aligner à gauche', disabled: ro || !ctl.selection.length },
        { id: 'align:center', label: 'Centrer horizontalement', disabled: ro || !ctl.selection.length },
        { id: 'align:right', label: 'Aligner à droite', disabled: ro || !ctl.selection.length },
        { id: 'align:top', label: 'Aligner en haut', disabled: ro || !ctl.selection.length },
        { id: 'align:middle', label: 'Centrer verticalement', disabled: ro || !ctl.selection.length },
        { id: 'align:bottom', label: 'Aligner en bas', disabled: ro || !ctl.selection.length },
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
  const shareButton = (
    <Button size="sm" variant="primary" leadingIcon="share" onPress={() => setDialog('share')}>
      Partager
    </Button>
  );
  const preserved = info.preserved;
  const preservedChip = preserved.length > 0 && <PreservedChip items={preserved} />;
  const slide = ctl.slide;
  const notes = slide ? ctl.doc.notes(slide.id) : null;
  const layoutName = info.layouts.find((l) => l.id === slide?.layout)?.name;

  return (
    <div className={`oel-slides oel-slides--${variant}`} data-slides={status.docId} onKeyDown={onKeyDown}>
      {!compact && (
        <header className="oel-slides__top">
          <nav className="oel-slides__crumbs" aria-label="Fil d’Ariane">
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
                aria-label="Titre de la présentation"
                value={titleDraft}
                readOnly={ro}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {ro && <Badge appearance="stamp" tone="neutral" dot={false}>Lecture seule</Badge>}
              <SyncStatus status={status} noun="présentation" />
            </div>
            <MenuBar spec={spec} onAction={act} label="Menus de la présentation" />
          </div>
          <div className="oel-slides__right">
            {preservedChip}
            {props.onReduce && (
              <Button size="sm" variant="ghost" leadingIcon="collapse" aria-keyshortcuts="Control+Shift+Enter" onPress={props.onReduce}>
                Réduire
              </Button>
            )}
            <Peers status={status} noun="présentation" />
            <Button size="sm" variant="ghost" leadingIcon="history" aria-label="Historique des versions" isDisabled={local || status.role === 'viewer'} onPress={() => setShowVersions((v) => !v)} />
            {exportButton}
            {shareButton}
          </div>
        </header>
      )}

      <div className="oel-slides__toolbar" onMouseDown={(e) => (e.target as HTMLElement).closest('input,select,textarea') || e.preventDefault()}>
        <SlidesToolbar ctl={ctl} ctx={ctx} zoom={zoom} setZoom={setZoom} compact={compact} onPresent={() => present(0)} more={compact ? <MoreMenu spec={spec} onAction={act} /> : undefined} />
        {compact && (
          <div className="oel-slides__sheet-actions">
            {preservedChip}
            <SyncStatus status={status} noun="présentation" />
            <Peers status={status} noun="présentation" />
            {props.onExpand && <Button size="icon-sm" variant="ghost" leadingIcon="expand" aria-label="Plein écran (Ctrl+Maj+Entrée)" onPress={props.onExpand} />}
            {exportButton}
            {shareButton}
          </div>
        )}
      </div>

      <div className="oel-slides__body">
        <Filmstrip ctl={ctl} ctx={ctx} onPresent={present} />
        <div className="oel-slides__main">
          <div ref={stageBox} className="oel-slides__stage">
            <Canvas ctl={ctl} ctx={ctx} zoom={k} label={`Diapositive ${ctl.index + 1} sur ${ctl.doc.slideIds().length}`} />
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
      </div>

      {!compact && (
        <footer className="oel-slides__status">
          <span>
            Diapositive {ctl.index + 1} sur {ctl.doc.slideIds().length}
          </span>
          {layoutName && <span className="oel-slides__status-layout">{layoutName}</span>}
          {slide?.hidden && <Badge tone="neutral" dot={false}>Masquée</Badge>}
          <span className="oel-slides__status-spacer" />
          <Button size="sm" variant="ghost" leadingIcon="note" onPress={() => setShowNotes((v) => !v)} aria-pressed={showNotes}>
            Notes
          </Button>
          <span>{zoom === 'fit' ? 'Ajusté' : `${Math.round(Number(zoom) * 100)} %`}</span>
        </footer>
      )}

      {show != null && <Slideshow ctl={ctl} ctx={ctx} start={show} presenterWindow={presenterWin} onExit={() => (setShow(null), setPresenterWin(null))} />}
      {printing && <PrintDeck ctl={ctl} ctx={ctx} onDone={() => setPrinting(false)} />}
      <BackgroundDialog ctl={ctl} isOpen={dialog === 'background'} onClose={() => setDialog(null)} />
      <ShareDialog session={session} title={props.title} origin={props.shareOrigin ?? (typeof location !== 'undefined' ? location.origin : '')} isOpen={dialog === 'share'} onClose={() => setDialog(null)} />
      <IdentityDialog identity={identity} isOpen={dialog === 'identity'} onClose={() => setDialog(null)} onSave={(i) => (session.setIdentity(i), props.onIdentityChange?.(i))} />
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
    <section className="oel-notes" aria-label="Notes de l’orateur">
      <textarea
        className="oel-notes__input"
        value={value}
        readOnly={ro}
        placeholder="Cliquez pour ajouter des notes"
        aria-label="Notes de l’orateur"
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
        <Icon name="lock" size={14} /> Conservé · {items.map((i) => i.label).join(', ')}
      </button>
      <Popover triggerRef={ref as RefObject<HTMLButtonElement>} isOpen={open} onOpenChange={setOpen} placement="bottom end">
        <Dialog className="oel-popover-dialog oel-preserved" aria-label="Éléments conservés">
          <p>Ces éléments du fichier sont gardés tels quels à l’exportation, mais ne se modifient pas ici :</p>
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
      <SheetDialog title="Arrière-plan de la diapositive" width={380}>
        <div className="oel-swatches">
          <button type="button" className="oel-swatch oel-swatch--none" onClick={() => pick(null)}>
            Celui de la disposition
          </button>
          <p className="oel-swatches__label">Couleurs du thème</p>
          <div className="oel-swatches__grid">
            {theme.map((c) => (
              <button key={c.name} type="button" className={`oel-swatch${current === c.color ? ' is-on' : ''}`} style={{ background: c.color }} aria-label={c.color} onClick={() => pick(c.color)} />
            ))}
          </div>
          <p className="oel-swatches__label">Autres</p>
          <div className="oel-swatches__grid">
            {BG_COLORS.map((c) => (
              <button key={c} type="button" className={`oel-swatch${current === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => pick(c)} />
            ))}
          </div>
          <label className="oel-swatches__custom">
            Personnalisée <input type="color" onChange={(e) => pick(e.target.value.toUpperCase())} />
          </label>
          <Checkbox isSelected={all} onChange={setAll}>
            Appliquer à toutes les diapositives
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
  if (!ids.length) return <p className="oel-panel__empty">Version vide.</p>;
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
