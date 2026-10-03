import { useEffect, useRef, useState } from 'react';
import { useDesk, useDeskState, useSelectionScreenRect } from '@oel/desk/react';
import {
  Button,
  DialogTrigger,
  Popover,
  TextField,
  Toolbar,
  ToolbarSeparator,
  ToolButton,
  toast,
} from '@oel/emboss';
import { copyLink } from '@oel/forms';
import { kindLabel, uid, type Bureau, type Paper } from './model';
import { sheetTotal } from './Paper';

const nf = new Intl.NumberFormat('fr-CA');
const ENGINE_LATER = 'Arrive avec le moteur de documents (WASM).';
const IMAGE_ENGINE_LATER = 'Arrive avec le moteur d’images oelimg-rs (WASM).';

interface Props {
  store: Bureau;
  onOpen: (id: string) => void;
  onConvert: (id: string) => void;
  /** E2 · 1 « Créer un formulaire » from a selected spreadsheet. */
  onCreateForm: (sheetId: string) => void;
  /** Open a paper straight in full screen (form → Réponses lives there). */
  onOpenFull: (id: string) => void;
  /** Ref so "/" can move focus into the toolbar (B3: keyboard first). */
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * B2 · One floating bar with two halves. Left: the tool group for the selected
 * type. Right, always the same: Open. (Comments will be a canvas-wide feature.)
 * B7 · several types selected:
 * only actions every type supports (arrange, produce, share).
 */
export function ContextToolbar({ store, onOpen, onConvert, onCreateForm, onOpenFull, toolbarRef }: Props) {
  const { announce } = useDesk();
  const rect = useSelectionScreenRect(store);
  const selection = useDeskState(store, (s) => s.selection);
  const nodes = useDeskState(store, (s) => s.nodes);
  const screen = useDeskState(store, (s) => s.screen);
  const openId = useDeskState(store, (s) => s.openId);
  const [size, setSize] = useState({ w: 0, h: 48 });
  const wrapRef = useRef<HTMLDivElement>(null);

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
        aria-label={single ? `Outils : ${kindLabel(single.kind)} « ${single.title} »` : `Outils pour ${selected.length} fichiers`}
      >
        {single ? <TypeTools node={single} store={store} onConvert={onConvert} onCreateForm={onCreateForm} onOpenFull={onOpenFull} /> : <MultiTools store={store} ids={selection} kinds={kinds.size} />}
        <ToolbarSeparator />
        {single ? (
          <ToolButton
            icon="expand"
            label="Ouvrir"
            showLabel
            shortcut={['Entrée']}
            description="Ouvre le fichier sur place, le bureau reste visible."
            onPress={() => onOpen(single.id)}
          />
        ) : (
          <ToolButton icon="share" label="Partager" showLabel onPress={() => toast({ title: `${selected.length} fichiers prêts à partager`, tone: 'success' })} />
        )}
      </Toolbar>
    </div>
  );
}

function TypeTools({
  node,
  store,
  onConvert,
  onCreateForm,
  onOpenFull,
}: {
  node: Paper;
  store: Bureau;
  onConvert: (id: string) => void;
  onCreateForm: (sheetId: string) => void;
  onOpenFull: (id: string) => void;
}) {
  const readOnly = node.data.status.state === 'readonly';
  const importing = node.data.status.state === 'importing';
  if (importing) {
    return <ToolButton icon="sparkle" label="Import en cours" unavailableReason="Patientez : le fichier est en cours de lecture." />;
  }
  switch (node.kind) {
    case 'document':
      return (
        <>
          <ToolButton icon="bold" label="Gras" shortcut={['Ctrl', 'B']} description="Ouvrez le document pour mettre du texte en gras." unavailableReason="Ouvrez le document (Entrée) pour sélectionner du texte." />
          <ToolButton icon="align-left" label="Styles" description="Titres, paragraphes, listes." onPress={() => store.open(node.id)} />
          <ToolButton icon="download" label="Exporter en PDF" unavailableReason={ENGINE_LATER} />
        </>
      );
    case 'slides':
      return (
        <>
          <ToolButton icon="layout" label="Disposition" description="Change la mise en page de la diapo." onPress={() => store.open(node.id)} />
          <ToolButton icon="sparkle" label="Thème" unavailableReason={ENGINE_LATER} />
          <ToolButton icon="slide" label="Présenter" shortcut={['F5']} description="Plein écran, une diapo à la fois." onPress={() => document.documentElement.requestFullscreen?.()} />
        </>
      );
    case 'spreadsheet': {
      const rows = node.data.preview.kind === 'spreadsheet' ? node.data.preview.rows : [];
      const total = sheetTotal(rows);
      return (
        <>
          <ToolButton icon="sum" label="Somme" description="Somme de la colonne Montant." value={total != null ? `${nf.format(total)} $` : '—'} />
          <ToolButton icon="chart" label="Graphique" description="Crée un graphique lié sur une diapo." onPress={() => toast({ title: 'Graphique lié créé', description: 'Le fil de liaison apparaît sur le bureau.', tone: 'success' })} />
          <ToolButton icon="table" label="Format nombre" unavailableReason="Sélectionnez une plage de cellules (ouvrez le tableur)." />
          <ToolButton icon="form" label="Créer un formulaire" description="Une question par colonne ; les réponses arrivent dans ce tableur." onPress={() => onCreateForm(node.id)} />
        </>
      );
    }
    case 'form': {
      const pub = node.data.form?.publication;
      return (
        <>
          <ToolButton
            icon="copy"
            label="Copier le lien"
            description="Lien public du formulaire."
            unavailableReason={pub ? undefined : 'Publiez d’abord le formulaire (ouvrez-le, puis « Publier »).'}
            onPress={() => pub && void copyLink(pub.url)}
          />
          <ToolButton
            icon="eye"
            label="Voir comme un répondant"
            description="Ouvre la page publique dans un nouvel onglet."
            unavailableReason={pub ? undefined : 'Pas encore publié : utilisez « Aperçu » dans le formulaire.'}
            onPress={() => pub && window.open(pub.url, '_blank', 'noopener')}
          />
          <ToolButton icon="chart" label="Réponses" value={String(node.data.formStats?.accepted ?? 0)} description="Résumé et réponses une par une (plein écran)." onPress={() => onOpenFull(node.id)} />
        </>
      );
    }
    case 'image':
      return (
        <>
          <ToolButton icon="crop" label="Rogner" unavailableReason={IMAGE_ENGINE_LATER} />
          <ToolButton icon="sparkle" label="Détourer" unavailableReason={IMAGE_ENGINE_LATER} />
          <ToolButton icon="search" label="Reconnaître le texte (OCR)" unavailableReason={IMAGE_ENGINE_LATER} />
        </>
      );
    case 'pdf':
      return (
        <>
          {readOnly && (
            <ToolButton
              icon="sparkle"
              label="Convertir pour modifier"
              showLabel
              description="Crée une version modifiable à côté de l’original."
              onPress={() => onConvert(node.id)}
            />
          )}
          <ToolButton icon="highlight" label="Surligner" description="Ouvre le PDF en annotation." onPress={() => store.open(node.id)} />
          <ToolButton icon="pen" label="Signer" description="Ajoute votre signature." onPress={() => store.update(node.id, { data: { ...node.data, stamp: { label: 'Signé', tone: 'success' } } }, { label: 'Signature' })} />
        </>
      );
    case 'note':
      return (
        <>
          <ToolButton icon="user" label="Assigner" value={node.data.assignee ?? '—'} description="Assigne la note à quelqu’un." onPress={() => store.update(node.id, { data: { ...node.data, assignee: node.data.assignee === 'Alex' ? 'Marie-Claude' : 'Alex' } }, { label: 'Assignation' })} />
        </>
      );
    default:
      return <ToolButton icon="sparkle" label="Convertir" unavailableReason="Format non pris en charge pour l’instant." />;
  }
}

function MultiTools({ store, ids, kinds }: { store: Bureau; ids: string[]; kinds: number }) {
  return (
    <>
      <span className="context-bar__count" aria-hidden>
        {ids.length} fichiers · {kinds} type{kinds > 1 ? 's' : ''}
      </span>
      <ToolButton icon="align-left" label="Aligner à gauche" onPress={() => store.align(ids, 'left')} />
      <ToolButton icon="layout" label="Aligner en haut" onPress={() => store.align(ids, 'top')} />
      <ToolButton icon="grid" label="Ranger en ligne" description="Aligne et espace les fichiers sélectionnés." onPress={() => store.distribute(ids)} />
      <ToolbarSeparator />
      <ToolButton icon="pdf" label="Un seul PDF" description="Dans l’ordre du bureau." unavailableReason={ENGINE_LATER} />
      <ToolButton icon="slide" label="Une présentation" description="Une diapo par fichier." unavailableReason={ENGINE_LATER} />
    </>
  );
}
