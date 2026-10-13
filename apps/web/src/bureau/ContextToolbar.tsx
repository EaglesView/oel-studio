import { useEffect, useRef, useState } from 'react';
import { useDesk, useDeskState, useSelectionScreenRect } from '@oel/desk/react';
import {
  Button,
  DialogTrigger,
  Icon,
  Popover,
  TextField,
  Toolbar,
  ToolbarSeparator,
  ToolButton,
  toast,
} from '@oel/emboss';
import { Dialog, Radio, RadioGroup } from 'react-aria-components';
import { copyLink } from '@oel/forms';
import { NOTE_COLORS, kindLabel, uid, type Bureau, type NoteColor, type Paper } from './model';
import { downloadSlides, requestPresent } from './slides';
import { activeLinks } from '../links/resolver';
import { exportGallery, layoutGallery } from './images';
import { features } from '../edition';
import { useHand } from './hand';
import { messages, plural } from '@oel/i18n';

const t = messages(
  {
    engineLater: 'Arrive avec le moteur de documents (WASM).',
    imageEngineLater: 'Arrive avec le moteur d’images oelimg-rs (WASM).',
    pdfEngineLater: 'Arrive avec le moteur PDF : pour l’instant, le bureau garde le PDF et son nombre de pages.',
    toolsFor: (kind: string, title: string) => `Outils : ${kind} « ${title} »`,
    toolsForMany: (n: number) => `Outils pour ${n} fichiers`,
    delete: 'Supprimer',
    deleteNote: 'Retire la note du bureau.',
    open: 'Ouvrir',
    openDesc: 'Ouvre le fichier sur place, le bureau reste visible.',
    share: 'Partager',
    shareReady: (n: number) => `${n} fichiers prêts à partager`,
    importing: 'Import en cours',
    importingWait: 'Patientez : le fichier est en cours de lecture.',
    bold: 'Gras',
    boldDesc: 'Ouvrez le document pour mettre du texte en gras.',
    boldWhy: 'Ouvrez le document (Entrée) pour sélectionner du texte.',
    styles: 'Styles',
    stylesDesc: 'Titres, paragraphes, listes.',
    exportPdf: 'Exporter en PDF',
    edit: 'Modifier',
    editSlides: 'Ouvre la présentation sur place (Entrée).',
    theme: 'Thème',
    themeWhy: 'Le thème du fichier est conservé ; il ne se change pas encore ici.',
    present: 'Présenter',
    presentDesc: 'Plein écran, une diapo à la fois.',
    downloadPptx: 'Télécharger (.pptx)',
    downloadFailed: 'Téléchargement impossible',
    editSheet: 'Ouvre le tableur sur place (Entrée).',
    chart: 'Graphique',
    chartWhy: 'Ouvrez le tableur (Entrée), sélectionnez des données, puis Alt + F1.',
    linkInto: 'Lier dans…',
    linkIntoWhy: 'Ouvrez le tableur et sélectionnez un graphique ou une plage : « Lier dans… » les met dans une présentation ou un document.',
    createForm: 'Créer un formulaire',
    createFormDesc: 'Une question par colonne ; les réponses arrivent dans ce tableur.',
    copyLink: 'Copier le lien',
    copyLinkDesc: 'Lien public du formulaire.',
    publishFirst: 'Publiez d’abord le formulaire (ouvrez-le, puis « Publier »).',
    asRespondent: 'Voir comme un répondant',
    asRespondentDesc: 'Ouvre la page publique dans un nouvel onglet.',
    notPublished: 'Pas encore publié : utilisez « Aperçu » dans le formulaire.',
    responses: 'Réponses',
    responsesDesc: 'Résumé et réponses une par une (plein écran).',
    linkImageDesc: 'Mettre une copie liée dans une présentation ou un document du bureau',
    noImageFile: 'Cette image n’a pas encore de fichier (exemple du bureau).',
    retouch: 'Retoucher',
    retouchDesc: 'Ouvrir l’atelier d’image : styles, lumière, couleur, recadrage (plein écran)',
    cutOut: 'Détourer',
    ocr: 'Reconnaître le texte (OCR)',
    retouchGallery: 'Régler le style de la galerie et ses images (plein écran)',
    spreadImages: 'Étaler les images',
    spreadImagesDesc: 'Ranger les images en grille dans la planche',
    export: 'Exporter',
    exportDesc: 'Toutes les images retouchées, en JPEG pleine résolution, dans un .zip',
    exportFailed: 'Exportation impossible',
    convertToEdit: 'Convertir pour modifier',
    highlight: 'Surligner',
    sign: 'Signer',
    convert: 'Convertir',
    unsupported: 'Format non pris en charge pour l’instant.',
    colour: 'Couleur',
    grip: 'Glisser pour déplacer (au clavier : les flèches)',
    noteColour: 'Couleur de la note',
    unstick: 'Décoller',
    stuckTo: (title: string) => `Collée à « ${title} ». La note reste où elle est.`,
    stick: 'Coller',
    stickDesc: 'Colle la note au fichier qu’elle recouvre, là où elle est. Sinon, choisissez-le.',
    stickTo: 'Coller à…',
    stickToDesc: 'Désignez le fichier : clic, ou Tab puis Entrée.',
    count: (n: number, kinds: number) => `${n} fichiers · ${kinds} ${plural(kinds, 'type', 'types')}`,
    alignLeft: 'Aligner à gauche',
    alignTop: 'Aligner en haut',
    arrange: 'Ranger en ligne',
    arrangeDesc: 'Aligne et espace les fichiers sélectionnés.',
    onePdf: 'Un seul PDF',
    onePdfDesc: 'Dans l’ordre du bureau.',
    oneDeck: 'Une présentation',
    oneDeckDesc: 'Une diapo par fichier.',
  },
  {
    engineLater: 'Comes with the document engine (WASM).',
    imageEngineLater: 'Comes with the oelimg-rs image engine (WASM).',
    pdfEngineLater: 'Comes with the PDF engine: for now, the desk keeps the PDF and its page count.',
    toolsFor: (kind, title) => `Tools: ${kind} “${title}”`,
    toolsForMany: (n) => `Tools for ${n} files`,
    delete: 'Delete',
    deleteNote: 'Removes the note from the desk.',
    open: 'Open',
    openDesc: 'Opens the file in place; the desk stays visible.',
    share: 'Share',
    shareReady: (n) => `${n} files ready to share`,
    importing: 'Importing',
    importingWait: 'Please wait: the file is being read.',
    bold: 'Bold',
    boldDesc: 'Open the document to make text bold.',
    boldWhy: 'Open the document (Enter) to select text.',
    styles: 'Styles',
    stylesDesc: 'Headings, paragraphs, lists.',
    exportPdf: 'Export as PDF',
    edit: 'Edit',
    editSlides: 'Opens the presentation in place (Enter).',
    theme: 'Theme',
    themeWhy: 'The file’s theme is kept; it can’t be changed here yet.',
    present: 'Present',
    presentDesc: 'Full screen, one slide at a time.',
    downloadPptx: 'Download (.pptx)',
    downloadFailed: 'Download failed',
    editSheet: 'Opens the spreadsheet in place (Enter).',
    chart: 'Chart',
    chartWhy: 'Open the spreadsheet (Enter), select data, then Alt + F1.',
    linkInto: 'Link into…',
    linkIntoWhy: 'Open the spreadsheet and select a chart or a range: “Link into…” puts them in a presentation or a document.',
    createForm: 'Create a form',
    createFormDesc: 'One question per column; responses arrive in this spreadsheet.',
    copyLink: 'Copy the link',
    copyLinkDesc: 'The form’s public link.',
    publishFirst: 'Publish the form first (open it, then “Publish”).',
    asRespondent: 'View as a respondent',
    asRespondentDesc: 'Opens the public page in a new tab.',
    notPublished: 'Not published yet: use “Preview” in the form.',
    responses: 'Responses',
    responsesDesc: 'Summary and responses one by one (full screen).',
    linkImageDesc: 'Put a linked copy in a presentation or a document on the desk',
    noImageFile: 'This image has no file yet (desk example).',
    retouch: 'Retouch',
    retouchDesc: 'Open the image workshop: styles, light, colour, crop (full screen)',
    cutOut: 'Remove background',
    ocr: 'Recognize text (OCR)',
    retouchGallery: 'Set the style of the gallery and its images (full screen)',
    spreadImages: 'Spread out the images',
    spreadImagesDesc: 'Lay the images out in a grid on the board',
    export: 'Export',
    exportDesc: 'Every retouched image, as full-resolution JPEG, in a .zip',
    exportFailed: 'Export failed',
    convertToEdit: 'Convert to edit',
    highlight: 'Highlight',
    sign: 'Sign',
    convert: 'Convert',
    unsupported: 'Format not supported yet.',
    colour: 'Colour',
    grip: 'Drag to move (keyboard: the arrow keys)',
    noteColour: 'Note colour',
    unstick: 'Unstick',
    stuckTo: (title) => `Stuck to “${title}”. The note stays where it is.`,
    stick: 'Stick',
    stickDesc: 'Sticks the note to the file it covers, where it is. Otherwise, pick it.',
    stickTo: 'Stick to…',
    stickToDesc: 'Point at the file: click, or Tab then Enter.',
    count: (n, kinds) => `${n} files · ${kinds} ${plural(kinds, 'type', 'types')}`,
    alignLeft: 'Align left',
    alignTop: 'Align top',
    arrange: 'Line up',
    arrangeDesc: 'Aligns and spaces the selected files.',
    onePdf: 'One PDF',
    onePdfDesc: 'In desk order.',
    oneDeck: 'One presentation',
    oneDeckDesc: 'One slide per file.',
  },
);

const ENGINE_LATER = t.engineLater;
const IMAGE_ENGINE_LATER = t.imageEngineLater;
/** PDFs show their page count only, until a PDF engine draws, annotates and converts them. */
const PDF_ENGINE_LATER = t.pdfEngineLater;

interface Props {
  store: Bureau;
  onOpen: (id: string) => void;
  /** E2 · 1 « Créer un formulaire » from a selected spreadsheet. */
  onCreateForm: (sheetId: string) => void;
  /** Open a paper straight in full screen (form → Réponses lives there). */
  onOpenFull: (id: string) => void;
  /** K1 · « Coller » (main part), « Coller à… » (arrow), « Décoller ». */
  notes: NoteActions;
  onRemove: (ids: string[]) => void;
  /** Ref so "/" can move focus into the toolbar (B3: keyboard first). */
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}

export interface NoteActions {
  stick: (id: string) => void;
  stickTo: (id: string) => void;
  unstick: (id: string) => void;
}

/**
 * B2 · One floating bar with two halves. Left: the tool group for the selected
 * type. Right, always the same: Open. (Comments will be a canvas-wide feature.)
 * B7 · several types selected:
 * only actions every type supports (arrange, produce, share).
 */
export function ContextToolbar({ store, onOpen, onCreateForm, onOpenFull, notes, onRemove, toolbarRef }: Props) {
  const { announce } = useDesk();
  const rect = useSelectionScreenRect(store);
  const selection = useDeskState(store, (s) => s.selection);
  const nodes = useDeskState(store, (s) => s.nodes);
  const screen = useDeskState(store, (s) => s.screen);
  const openId = useDeskState(store, (s) => s.openId);
  const [size, setSize] = useState({ w: 0, h: 48 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const hand = useHand();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const selected = selection.map((id) => nodes[id] as Paper | undefined).filter((n): n is Paper => !!n);
  if (!rect || selected.length === 0 || openId) return null;

  // Above the selection if there is room, else below, else pinned under the top chrome.
  const gap = 18;
  const above = rect.y - size.h - gap;
  const below = rect.y + rect.h + gap;
  const top = above >= 76 ? above : below + size.h <= screen.h - 100 ? below : 76;
  const left = Math.max(84, Math.min(rect.x + rect.w / 2 - size.w / 2, screen.w - size.w - 16));

  const single = selected.length === 1 ? selected[0]! : null;
  const kinds = new Set(selected.map((n) => n.kind));

  return (
    <div
      ref={wrapRef}
      className="context-bar"
      data-hand={hand}
      style={{ left, top }}
      data-desk-ui
      onKeyDown={(e) => {
        // Escape hands focus back to the paper the tools belong to.
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          const id = store.getState().focusedId;
          if (id) (document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
        }
      }}
    >
      <Toolbar
        ref={toolbarRef}
        appearance="pill"
        aria-label={single ? t.toolsFor(kindLabel(single.kind), single.title) : t.toolsForMany(selected.length)}
      >
        {single?.kind === 'note' ? (
          <NoteTools node={single} store={store} notes={notes} />
        ) : single ? (
          <TypeTools node={single} store={store} onCreateForm={onCreateForm} onOpenFull={onOpenFull} />
        ) : (
          <MultiTools store={store} ids={selection} kinds={kinds.size} />
        )}
        {(single || features.collab) && <ToolbarSeparator />}
        {single?.kind === 'note' ? (
          <ToolButton icon="trash" label={t.delete} shortcut={['Suppr']} description={t.deleteNote} onPress={() => onRemove([single.id])} />
        ) : single ? (
          <ToolButton
            icon="expand"
            label={t.open}
            showLabel
            shortcut={['Entrée']}
            description={t.openDesc}
            onPress={() => onOpen(single.id)}
          />
        ) : features.collab ? (
          <ToolButton icon="share" label={t.share} showLabel onPress={() => toast({ title: t.shareReady(selected.length), tone: 'success' })} />
        ) : null}
      </Toolbar>
      {/* A pad to grab: the papers already drag, but not everyone guesses it. Pointer only; keyboard moves with arrows. */}
      <div className="context-bar__grip" data-desk-grip aria-hidden title={t.grip} />
    </div>
  );
}

function TypeTools({
  node,
  store,
  onCreateForm,
  onOpenFull,
}: {
  node: Paper;
  store: Bureau;
  onCreateForm: (sheetId: string) => void;
  onOpenFull: (id: string) => void;
}) {
  const importing = node.data.status.state === 'importing';
  if (importing) {
    return <ToolButton icon="sparkle" label={t.importing} unavailableReason={t.importingWait} />;
  }
  switch (node.kind) {
    case 'document':
      return (
        <>
          <ToolButton icon="bold" label={t.bold} shortcut={['Ctrl', 'B']} description={t.boldDesc} unavailableReason={t.boldWhy} />
          <ToolButton icon="align-left" label={t.styles} description={t.stylesDesc} onPress={() => store.open(node.id)} />
          <ToolButton icon="download" label={t.exportPdf} unavailableReason={ENGINE_LATER} />
        </>
      );
    case 'slides':
      return (
        <>
          <ToolButton icon="layout" label={t.edit} description={t.editSlides} onPress={() => store.open(node.id)} />
          <ToolButton icon="sparkle" label={t.theme} unavailableReason={t.themeWhy} />
          <ToolButton
            icon="play"
            label={t.present}
            shortcut={['F5']}
            description={t.presentDesc}
            onPress={() => {
              requestPresent(node.id);
              onOpenFull(node.id);
            }}
          />
          <ToolButton
            icon="download"
            label={t.downloadPptx}
            onPress={() =>
              void downloadSlides(node, (docId) => store.update(node.id, { data: { ...node.data, docId } }, { history: false })).catch((e: Error) =>
                toast({ title: t.downloadFailed, description: e.message, tone: 'danger' }),
              )
            }
          />
        </>
      );
    case 'spreadsheet':
      return (
        <>
          <ToolButton icon="table" label={t.edit} description={t.editSheet} onPress={() => store.open(node.id)} />
          <ToolButton icon="chart" label={t.chart} unavailableReason={t.chartWhy} />
          <ToolButton icon="link" label={t.linkInto} unavailableReason={t.linkIntoWhy} />
          {features.forms && <ToolButton icon="form" label={t.createForm} description={t.createFormDesc} onPress={() => onCreateForm(node.id)} />}
        </>
      );
    case 'form': {
      const pub = node.data.form?.publication;
      return (
        <>
          <ToolButton
            icon="copy"
            label={t.copyLink}
            description={t.copyLinkDesc}
            unavailableReason={pub ? undefined : t.publishFirst}
            onPress={() => pub && void copyLink(pub.url)}
          />
          <ToolButton
            icon="eye"
            label={t.asRespondent}
            description={t.asRespondentDesc}
            unavailableReason={pub ? undefined : t.notPublished}
            onPress={() => pub && window.open(pub.url, '_blank', 'noopener')}
          />
          <ToolButton icon="chart" label={t.responses} value={String(node.data.formStats?.accepted ?? 0)} description={t.responsesDesc} onPress={() => onOpenFull(node.id)} />
        </>
      );
    }
    case 'image':
      return (
        <>
          <ToolButton
            icon="link"
            label={t.linkInto}
            showLabel
            description={t.linkImageDesc}
            unavailableReason={node.data.imageUrl ? undefined : t.noImageFile}
            onPress={() => activeLinks()?.setUi({ dialog: { kind: 'image', sourcePaperId: node.id, name: node.data.fileName ?? node.title } })}
          />
          <ToolButton
            icon="magic-wand"
            label={t.retouch}
            showLabel
            description={t.retouchDesc}
            onPress={() => onOpenFull(node.id)}
          />
          <ToolButton icon="sparkle" label={t.cutOut} unavailableReason={IMAGE_ENGINE_LATER} />
          <ToolButton icon="search" label={t.ocr} unavailableReason={IMAGE_ENGINE_LATER} />
        </>
      );
    case 'gallery':
      // L2 · the gallery planche: one object to move; its pictures share a style.
      return (
        <>
          <ToolButton icon="palette" label={t.retouch} showLabel description={t.retouchGallery} onPress={() => onOpenFull(node.id)} />
          <ToolButton icon="expand" label={t.spreadImages} showLabel description={t.spreadImagesDesc} onPress={() => layoutGallery(store, node.id)} />
          <ToolButton
            icon="download"
            label={t.export}
            showLabel
            description={t.exportDesc}
            onPress={() =>
              void exportGallery(store, node.id, { mime: 'image/jpeg', quality: 0.9 }, 'jpg').catch((e: Error) =>
                toast({ title: t.exportFailed, description: e.message, tone: 'danger' }),
              )
            }
          />
        </>
      );
    case 'pdf':
      return (
        <>
          <ToolButton icon="sparkle" label={t.convertToEdit} unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="highlight" label={t.highlight} unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="pen" label={t.sign} unavailableReason={PDF_ENGINE_LATER} />
        </>
      );
    case 'note':
      return null;
    default:
      return <ToolButton icon="sparkle" label={t.convert} unavailableReason={t.unsupported} />;
  }
}

/** K1 · Couleur · « Coller ▾ » (or « Décoller » once stuck). Writing: Entrée, a double-click or just typing. */
function NoteTools({ node, store, notes }: { node: Paper; store: Bureau; notes: NoteActions }) {
  const color = node.data.noteColor ?? 'jaune';
  const target = node.attach ? (store.node(node.attach.to) as Paper | undefined) : undefined;
  return (
    <>
      <NoteColourPicker
        color={color}
        onPick={(c) => store.update(node.id, { data: { ...node.data, noteColor: c } }, { label: t.noteColour })}
      />
      {target ? (
        <ToolButton
          icon="pin-slash"
          label={t.unstick}
          showLabel
          shortcut={['P']}
          description={t.stuckTo(target.title)}
          onPress={() => notes.unstick(node.id)}
        />
      ) : (
        <span className="context-bar__split" role="group" aria-label={t.stick}>
          <ToolButton
            icon="pin"
            label={t.stick}
            showLabel
            shortcut={['P']}
            description={t.stickDesc}
            onPress={() => notes.stick(node.id)}
          />
          <ToolButton icon="chevron-down" label={t.stickTo} shortcut={['Maj', 'P']} description={t.stickToDesc} onPress={() => notes.stickTo(node.id)} />
        </span>
      )}
    </>
  );
}

/** K1 · Couleur: the note's paper colours as swatches; the picked one is checked and named under the grid. */
function NoteColourPicker({ color, onPick }: { color: NoteColor; onPick: (c: NoteColor) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <ToolButton icon="palette" label={t.colour} description={NOTE_COLORS[color]} value={<span className="note-swatch note-swatch--dot" data-color={color} />} />
      <Popover placement="bottom start">
        <Dialog className="note-colours" aria-label={t.noteColour}>
          <RadioGroup
            aria-label={t.noteColour}
            orientation="horizontal"
            value={color}
            onChange={(v) => {
              onPick(v as NoteColor);
              setOpen(false);
            }}
            className="note-colours__grid"
          >
            {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
              <Radio key={c} value={c} aria-label={NOTE_COLORS[c]} className="note-colours__item">
                <span className="note-swatch" data-color={c}>
                  {c === color && <Icon name="check" size={16} />}
                </span>
              </Radio>
            ))}
          </RadioGroup>
          <p className="note-colours__name" aria-hidden>
            {NOTE_COLORS[color]}
          </p>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function MultiTools({ store, ids, kinds }: { store: Bureau; ids: string[]; kinds: number }) {
  return (
    <>
      <span className="context-bar__count" aria-hidden>
        {t.count(ids.length, kinds)}
      </span>
      <ToolButton icon="align-left" label={t.alignLeft} onPress={() => store.align(ids, 'left')} />
      <ToolButton icon="layout" label={t.alignTop} onPress={() => store.align(ids, 'top')} />
      <ToolButton icon="grid" label={t.arrange} description={t.arrangeDesc} onPress={() => store.distribute(ids)} />
      <ToolbarSeparator />
      <ToolButton icon="pdf" label={t.onePdf} description={t.onePdfDesc} unavailableReason={ENGINE_LATER} />
      <ToolButton icon="slide" label={t.oneDeck} description={t.oneDeckDesc} unavailableReason={ENGINE_LATER} />
    </>
  );
}
