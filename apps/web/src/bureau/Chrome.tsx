import { Button as RACButton, FileTrigger } from 'react-aria-components';
import { useDeskState } from '@oel/desk/react';
import { worldToScreen } from '@oel/desk';
import { ACCEPTED_EXTENSIONS } from '@oel/engine';
import {
  AvatarStack,
  Badge,
  Button,
  ChoiceCard,
  Icon,
  Logo,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  NotificationsButton,
  Toolbar,
  ToolbarSeparator,
  ToolButton,
  WithTooltip,
  toast,
  type IconName,
} from '@oel/emboss';
import { useProject } from '../project/ProjectContext';
import { type Bureau, type PaperKind } from './model';
import { features } from '../edition';
import { locale, messages, plural } from '@oel/i18n';

const t = messages(
  {
    project: 'Projet',
    files: (n: number) => `${n} ${plural(n, 'fichier', 'fichiers')}`,
    listView: 'Vue liste',
    deskView: 'Vue bureau',
    hint: 'Double-cliquez sur un papier pour l’ouvrir (ou Entrée) ; Échap le repose.',
    hintKeys: ': tous les raccourcis.',
    closeHint: 'Fermer l’astuce',
    you: 'vous',
    onDesk: (n: number, names: string) => `${n} ${plural(n, 'personne', 'personnes')} sur le bureau : ${names}`,
    linkCopied: 'Lien de partage copié',
    linkCopiedBody: 'Les invités verront ce bureau en lecture.',
    share: 'Partager',
    document: 'Document',
    slides: 'Présentation',
    spreadsheet: 'Tableur',
    form: 'Formulaire',
    soon: 'Bientôt.',
    late: (n: number) => `${n} ${plural(n, 'fil en retard', 'fils en retard')}`,
    bureau: 'Bureau',
    menu: 'Menu',
    menuLate: (late: string) => `Accueil, nouveau, projets, paramètres… ${late}.`,
    menuDesc: 'Accueil, nouveau, projets, paramètres, affichage, aide.',
    note: 'Note',
    noteDesc: 'Pense-bête posé au centre de la vue.',
    import: 'Importer',
    importDesc: 'PDF, Word, PowerPoint, Excel, images · 100 Mo max.',
    select: 'Sélection',
    selectDesc: 'Chaque toucher ou clic ajoute ou retire un fichier, sans le déplacer.',
    selectingBar: 'Sélection en cours',
    selected: (n: number) => `${n} ${plural(n, 'fichier', 'fichiers')}`,
    arrangeSelected: 'Ranger en ligne',
    arrangeWhy: 'Choisissez au moins deux fichiers.',
    deleteSelected: 'Supprimer',
    deleteWhy: 'Choisissez au moins un fichier.',
    doneSelecting: 'OK',
    doneSelectingDesc: 'Quitte le mode Sélection ; les fichiers restent sélectionnés.',
    sort: 'Ranger',
    sortDesc: 'Poser les fichiers en rangées : par type, date, nom, personne ou fils.',
    spread: 'Étaler',
    spreadDesc: 'Voir tout le projet en grille, sans rien déplacer.',
    new: 'Nouveau',
    newDesc: (forms: boolean) => `Document, présentation, tableur${forms ? ' ou formulaire' : ''}, au centre de la vue.`,
    empty: 'Ce bureau est vide',
    emptyLead: 'Créez un premier fichier ou déposez-en ici.',
    templates: 'Modèles',
    fromTemplate: 'Ou partir d’un modèle →',
    deskZoom: 'Zoom du bureau',
    zoomOut: 'Zoom arrière',
    zoomOutMax: 'Zoom arrière maximal atteint.',
    zoomReset: 'Revenir à 100 %',
    zoomIn: 'Zoom avant',
    zoomInMax: 'Zoom avant maximal atteint.',
  },
  {
    project: 'Project',
    files: (n) => `${n} ${plural(n, 'file', 'files')}`,
    listView: 'List view',
    deskView: 'Desk view',
    hint: 'Double-click a paper to open it (or Enter); Esc puts it back.',
    hintKeys: ': every shortcut.',
    closeHint: 'Close the tip',
    you: 'you',
    onDesk: (n, names) => `${n} ${plural(n, 'person', 'people')} on the desk: ${names}`,
    linkCopied: 'Share link copied',
    linkCopiedBody: 'Guests will see this desk read-only.',
    share: 'Share',
    document: 'Document',
    slides: 'Presentation',
    spreadsheet: 'Spreadsheet',
    form: 'Form',
    soon: 'Coming soon.',
    late: (n) => `${n} ${plural(n, 'late thread', 'late threads')}`,
    bureau: 'Bureau',
    menu: 'Menu',
    menuLate: (late) => `Home, new, projects, settings… ${late}.`,
    menuDesc: 'Home, new, projects, settings, display, help.',
    note: 'Note',
    noteDesc: 'A sticky note in the middle of the view.',
    import: 'Import',
    importDesc: 'PDF, Word, PowerPoint, Excel, images · 100 MB max.',
    select: 'Select',
    selectDesc: 'Each tap or click adds or removes a file, without moving it.',
    selectingBar: 'Selecting',
    selected: (n) => `${n} ${plural(n, 'file', 'files')}`,
    arrangeSelected: 'Arrange in a row',
    arrangeWhy: 'Pick at least two files.',
    deleteSelected: 'Delete',
    deleteWhy: 'Pick at least one file.',
    doneSelecting: 'Done',
    doneSelectingDesc: 'Leaves Select mode; the files stay selected.',
    sort: 'Sort',
    sortDesc: 'Lay the files out in rows: by type, date, name, person or thread.',
    spread: 'Spread out',
    spreadDesc: 'See the whole project as a grid, without moving anything.',
    new: 'New',
    newDesc: (forms) => `Document, presentation, spreadsheet${forms ? ' or form' : ''}, in the middle of the view.`,
    empty: 'This desk is empty',
    emptyLead: 'Create a first file or drop some here.',
    templates: 'Templates',
    fromTemplate: 'Or start from a template →',
    deskZoom: 'Desk zoom',
    zoomOut: 'Zoom out',
    zoomOutMax: 'Furthest zoom out reached.',
    zoomReset: 'Back to 100 %',
    zoomIn: 'Zoom in',
    zoomInMax: 'Closest zoom in reached.',
  },
);

/* ── B1 · 1 Projet ──────────────────────────────────────────────────── */

export function ProjectPill({
  title,
  count,
  view,
  onToggleView,
  onProjects,
  badge = true,
}: {
  title: string;
  count: number;
  view: 'desk' | 'list';
  onToggleView: () => void;
  /** M3: the pill opens the menu on « Projets ». */
  onProjects: () => void;
  /** The « Projet » badge (single-user edition: one desk, no projects to tell apart). */
  badge?: boolean;
}) {
  return (
    <header className="chrome-pill project-pill" data-desk-ui>
      <h1 className="project-pill__title">
        <RACButton className="project-pill__open" onPress={onProjects} aria-haspopup="dialog">
          <Icon name="folder" size={20} className="project-pill__icon" />
          {title}
        </RACButton>
      </h1>
      {badge && <Badge tone="accent">{t.project}</Badge>}
      <span className="project-pill__count">{t.files(count)}</span>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={view === 'desk' ? 'list' : 'grid'}
        onPress={onToggleView}
        aria-pressed={view === 'list'}
      >
        {view === 'desk' ? t.listView : t.deskView}
      </Button>
    </header>
  );
}

/* ── First visit ─────────────────────────────────────────────────────── */

const HINT_KEY = 'oel-first-run-hint';

/** Whether the first-run hint is still to show (until a paper is opened or it is closed). */
export function firstRunHintPending(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== 'vu';
  } catch {
    return false;
  }
}

export function dismissFirstRunHint() {
  try {
    localStorage.setItem(HINT_KEY, 'vu');
  } catch {
    /* private window: it shows again next time */
  }
}

/** The one thing to know on a first visit (plan solo MVP, R3), above the bottom bar. */
export function FirstRunHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="chrome-pill first-run-hint" role="note" data-desk-ui>
      <Icon name="info" size={16} />
      <span>
        {t.hint} <kbd>?</kbd> {t.hintKeys}
      </span>
      <Button variant="ghost" size="sm" leadingIcon="close" aria-label={t.closeHint} onPress={onDismiss} />
    </div>
  );
}

/* ── B1 · 2 Présence ────────────────────────────────────────────────── */

/** Theme and shortcuts moved to the menu (Affichage, Raccourcis clavier); `?` still opens the shortcuts. */
export function SharePill() {
  const { me, members } = useProject();
  const names = members.map((m) => (m.id === me.id ? t.you : m.name));
  const label = t.onDesk(members.length, new Intl.ListFormat(locale()).format(names));
  return (
    <div className="chrome-pill share-pill" data-desk-ui>
      <AvatarStack people={members} label={label} />
      <Button
        size="sm"
        leadingIcon="mail"
        onPress={() => toast({ title: t.linkCopied, description: t.linkCopiedBody, tone: 'success' })}
      >
        {t.share}
      </Button>
      <NotificationsButton />
    </div>
  );
}

/** Named cursors of the people on the desk (static demo positions, world units). */
export function PresenceCursors({ store }: { store: Bureau }) {
  const viewport = useDeskState(store, (s) => s.viewport);
  const cursors = [
    { name: 'Marie-Claude', color: 'var(--emboss-success)', at: { x: 1010, y: 330 } },
    { name: 'Alex', color: 'var(--emboss-warning)', at: { x: 1520, y: 470 } },
  ];
  return (
    <div className="presence" aria-hidden>
      {cursors.map((c) => {
        const p = worldToScreen(c.at, viewport);
        return (
          <span key={c.name} className="presence__cursor" style={{ left: p.x, top: p.y, ['--c' as string]: c.color }}>
            <svg width="16" height="18" viewBox="0 0 16 18">
              <path d="M1 1L14 8L8 9.5L5 16L1 1Z" fill="currentColor" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="presence__name">{c.name}</span>
          </span>
        );
      })}
    </div>
  );
}

/* ── M1 · Barre du bas ───────────────────────────────────────────────── */

export interface ArrivalRules {
  sortByType: boolean;
  ocr: boolean;
  linkTables: boolean;
}

/** Kinds offered by the round « + » (Figma M1): Note has its own button. */
export const NEW_KINDS: { kind: PaperKind; label: string; icon: IconName }[] = [
  { kind: 'document', label: t.document, icon: 'file' },
  { kind: 'slides', label: t.slides, icon: 'slide' },
  { kind: 'spreadsheet', label: t.spreadsheet, icon: 'table' },
  // Single-user edition: no forms (plan solo MVP, S-6).
  ...(features.forms ? [{ kind: 'form' as const, label: t.form, icon: 'form' as const }] : []),
];

export const SOON = t.soon;

/**
 * Figma M1: logo on the left opens the full-screen menu (M2), then Note ·
 * Importer · Ranger · Étaler, and a round « + » on the right that creates the
 * other kinds. A late thread puts a dot on the logo.
 */
export function BottomBar({
  onCreate,
  onImport,
  newMenuOpen,
  onNewMenuOpenChange,
  menuOpen,
  onMenu,
  lateLinks,
  selecting,
  onSelectingChange,
  onArrange,
  onRemoveSelected,
}: {
  onCreate: (kind: PaperKind) => void;
  onImport: (files: File[]) => void;
  /** The « + » menu, controlled so Alt + N can open it. */
  newMenuOpen: boolean;
  onNewMenuOpenChange: (open: boolean) => void;
  menuOpen: boolean;
  /** Open the full-screen menu, growing from the logo's centre. */
  onMenu: (origin: { x: number; y: number }) => void;
  lateLinks: number;
  /** Figma O2 · 3: the « Sélection » mode on the desk; null where it doesn't apply (list view, an open file). */
  selecting: { on: boolean; count: number } | null;
  onSelectingChange: (on: boolean) => void;
  onArrange: () => void;
  onRemoveSelected: () => void;
}) {
  const late = lateLinks > 0 ? t.late(lateLinks) : null;
  if (selecting?.on) {
    const n = selecting.count;
    return (
      <div className="bottom-bar" data-desk-ui>
        <Toolbar appearance="pill" aria-label={t.selectingBar}>
          <ToolButton icon="checklist" label={t.select} showLabel description={t.doneSelectingDesc} className="is-latched" onPress={() => onSelectingChange(false)} />
          <span className="bottom-bar__count" role="status">
            {t.selected(n)}
          </span>
          <ToolbarSeparator />
          <ToolButton icon="grid" label={t.arrangeSelected} unavailableReason={n < 2 ? t.arrangeWhy : undefined} onPress={onArrange} />
          <ToolButton icon="trash" label={t.deleteSelected} shortcut={['Suppr']} unavailableReason={n < 1 ? t.deleteWhy : undefined} onPress={onRemoveSelected} />
          <ToolbarSeparator />
          <WithTooltip label={t.doneSelecting} description={t.doneSelectingDesc}>
            <Button variant="primary" size="sm" leadingIcon="check" onPress={() => onSelectingChange(false)}>
              {t.doneSelecting}
            </Button>
          </WithTooltip>
        </Toolbar>
      </div>
    );
  }
  return (
    <div className="bottom-bar" data-desk-ui>
      <Toolbar appearance="pill" aria-label={t.bureau}>
        <WithTooltip label={t.menu} description={late ? t.menuLate(late) : t.menuDesc}>
          <RACButton
            className="bottom-bar__logo"
            aria-label={late ? `${t.menu}, ${late}` : t.menu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onPress={(e) => {
              const r = (e.target as HTMLElement).getBoundingClientRect();
              onMenu({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
          >
            <Logo size={22} aria-hidden />
            {late && <span className="bottom-bar__late" aria-hidden />}
          </RACButton>
        </WithTooltip>
        <ToolbarSeparator />
        <ToolButton icon="note" label={t.note} showLabel shortcut={['N']} description={t.noteDesc} onPress={() => onCreate('note')} />
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED_EXTENSIONS} onSelect={(list) => list && onImport([...list])}>
          <ToolButton icon="upload" label={t.import} showLabel shortcut={['Ctrl', 'O']} description={t.importDesc} />
        </FileTrigger>
        {selecting && <ToolButton icon="checklist" label={t.select} showLabel description={t.selectDesc} onPress={() => onSelectingChange(true)} />}
        <ToolbarSeparator className="bottom-bar__later" />
        <ToolButton icon="sort" label={t.sort} showLabel description={t.sortDesc} unavailableReason={SOON} className="bottom-bar__later" />
        <ToolButton icon="grid" label={t.spread} showLabel shortcut={['E']} description={t.spreadDesc} unavailableReason={SOON} className="bottom-bar__later" />
        <ToolbarSeparator />
        <MenuTrigger isOpen={newMenuOpen} onOpenChange={onNewMenuOpenChange}>
          <WithTooltip label={t.new} shortcut={['Alt', 'N']} description={t.newDesc(features.forms)}>
            <RACButton className="bottom-bar__new" aria-label={t.new} aria-keyshortcuts="Alt+N">
              <Icon name="plus" size={20} />
            </RACButton>
          </WithTooltip>
          <MenuPopover placement="top end">
            <Menu aria-label={t.new} onAction={(key) => onCreate(key as PaperKind)}>
              {NEW_KINDS.map((k) => (
                <MenuItem key={k.kind} id={k.kind} icon={k.icon} className={`bottom-bar__kind bottom-bar__kind--${k.kind}`}>
                  {k.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuPopover>
        </MenuTrigger>
      </Toolbar>
    </div>
  );
}

/* ── M1 · 4 Bureau vide ──────────────────────────────────────────────── */

/**
 * Figma M1 · 4: while the project has no file, six big cards in the centre of
 * the desk (the four kinds, Note, Importer). They go with the first file;
 * dropping files on the desk still works.
 */
export function EmptyDesk({ onCreate, onImport }: { onCreate: (kind: PaperKind) => void; onImport: (files: File[]) => void }) {
  return (
    <section className="empty-desk" aria-labelledby="empty-desk-title">
      <h2 id="empty-desk-title" className="empty-desk__title">{t.empty}</h2>
      <p className="empty-desk__lead">{t.emptyLead}</p>
      <div className="empty-desk__cards">
        {NEW_KINDS.map((k) => (
          <ChoiceCard key={k.kind} icon={k.icon} label={k.label} iconColor={`var(--kind-${k.kind})`} onPress={() => onCreate(k.kind)} />
        ))}
        <ChoiceCard icon="note" label={t.note} onPress={() => onCreate('note')} />
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED_EXTENSIONS} onSelect={(list) => list && onImport([...list])}>
          <ChoiceCard icon="upload" label={t.import} />
        </FileTrigger>
      </div>
      <WithTooltip label={t.templates} unavailableReason={SOON}>
        <RACButton className="empty-desk__templates" aria-disabled="true">
          {t.fromTemplate}
        </RACButton>
      </WithTooltip>
    </section>
  );
}

/* ── Zoom ───────────────────────────────────────────────────────────── */

/** Zoom out / level / zoom in. The level resets to 100 %; zooming out stops at the store's limit. */
export function ZoomControl({ store }: { store: Bureau }) {
  const zoom = useDeskState(store, (s) => s.viewport.zoom);
  const atMin = zoom <= store.zoomLimits.min + 1e-6;
  const atMax = zoom >= store.zoomLimits.max - 1e-6;
  return (
    <div className="zoom-control" data-desk-ui>
      <Toolbar appearance="pill" aria-label={t.deskZoom}>
        <ToolButton
          icon="minus"
          label={t.zoomOut}
          shortcut={['−']}
          unavailableReason={atMin ? t.zoomOutMax : undefined}
          onPress={() => store.zoomBy(1 / 1.2)}
        />
        <ToolButton icon="search" label={t.zoomReset} shortcut={['0']} value={`${Math.round(zoom * 100)} %`} onPress={() => store.zoomReset()} />
        <ToolButton
          icon="plus"
          label={t.zoomIn}
          shortcut={['+']}
          unavailableReason={atMax ? t.zoomInMax : undefined}
          onPress={() => store.zoomBy(1.2)}
        />
      </Toolbar>
    </div>
  );
}
