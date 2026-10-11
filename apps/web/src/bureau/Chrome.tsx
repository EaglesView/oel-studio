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
      {badge && <Badge tone="accent">Projet</Badge>}
      <span className="project-pill__count">
        {count} fichier{count > 1 ? 's' : ''}
      </span>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={view === 'desk' ? 'list' : 'grid'}
        onPress={onToggleView}
        aria-pressed={view === 'list'}
      >
        {view === 'desk' ? 'Vue liste' : 'Vue bureau'}
      </Button>
    </header>
  );
}

/* ── B1 · 2 Présence ────────────────────────────────────────────────── */

/** Theme and shortcuts moved to the menu (Affichage, Raccourcis clavier); `?` still opens the shortcuts. */
export function SharePill() {
  const { me, members } = useProject();
  const names = members.map((m) => (m.id === me.id ? 'vous' : m.name));
  const label = `${members.length} personne${members.length > 1 ? 's' : ''} sur le bureau : ${new Intl.ListFormat('fr-CA').format(names)}`;
  return (
    <div className="chrome-pill share-pill" data-desk-ui>
      <AvatarStack people={members} label={label} />
      <Button
        size="sm"
        leadingIcon="mail"
        onPress={() => toast({ title: 'Lien de partage copié', description: 'Les invités verront ce bureau en lecture.', tone: 'success' })}
      >
        Partager
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
  { kind: 'document', label: 'Document', icon: 'file' },
  { kind: 'slides', label: 'Présentation', icon: 'slide' },
  { kind: 'spreadsheet', label: 'Tableur', icon: 'table' },
  // Single-user edition: no forms (plan solo MVP, S-6).
  ...(features.forms ? [{ kind: 'form' as const, label: 'Formulaire', icon: 'form' as const }] : []),
];

export const SOON = 'Bientôt.';

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
}) {
  const late = lateLinks > 0 ? `${lateLinks} fil${lateLinks > 1 ? 's' : ''} en retard` : null;
  return (
    <div className="bottom-bar" data-desk-ui>
      <Toolbar appearance="pill" aria-label="Bureau">
        <WithTooltip label="Menu" description={late ? `Accueil, nouveau, projets, paramètres… ${late}.` : 'Accueil, nouveau, projets, paramètres, affichage, aide.'}>
          <RACButton
            className="bottom-bar__logo"
            aria-label={late ? `Menu, ${late}` : 'Menu'}
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
        <ToolButton icon="note" label="Note" showLabel shortcut={['N']} description="Pense-bête posé au centre de la vue." onPress={() => onCreate('note')} />
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED_EXTENSIONS} onSelect={(list) => list && onImport([...list])}>
          <ToolButton icon="upload" label="Importer" showLabel shortcut={['Ctrl', 'O']} description="PDF, Word, PowerPoint, Excel, images · 100 Mo max." />
        </FileTrigger>
        <ToolbarSeparator />
        <ToolButton icon="sort" label="Ranger" showLabel description="Poser les fichiers en rangées : par type, date, nom, personne ou fils." unavailableReason={SOON} />
        <ToolButton icon="grid" label="Étaler" showLabel shortcut={['E']} description="Voir tout le projet en grille, sans rien déplacer." unavailableReason={SOON} />
        <ToolbarSeparator />
        <MenuTrigger isOpen={newMenuOpen} onOpenChange={onNewMenuOpenChange}>
          <WithTooltip label="Nouveau" shortcut={['Alt', 'N']} description={`Document, présentation, tableur${features.forms ? ' ou formulaire' : ''}, au centre de la vue.`}>
            <RACButton className="bottom-bar__new" aria-label="Nouveau" aria-keyshortcuts="Alt+N">
              <Icon name="plus" size={20} />
            </RACButton>
          </WithTooltip>
          <MenuPopover placement="top end">
            <Menu aria-label="Nouveau" onAction={(key) => onCreate(key as PaperKind)}>
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
      <h2 id="empty-desk-title" className="empty-desk__title">Ce bureau est vide</h2>
      <p className="empty-desk__lead">Créez un premier fichier ou déposez-en ici.</p>
      <div className="empty-desk__cards">
        {NEW_KINDS.map((k) => (
          <ChoiceCard key={k.kind} icon={k.icon} label={k.label} iconColor={`var(--kind-${k.kind})`} onPress={() => onCreate(k.kind)} />
        ))}
        <ChoiceCard icon="note" label="Note" onPress={() => onCreate('note')} />
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED_EXTENSIONS} onSelect={(list) => list && onImport([...list])}>
          <ChoiceCard icon="upload" label="Importer" />
        </FileTrigger>
      </div>
      <WithTooltip label="Modèles" unavailableReason={SOON}>
        <RACButton className="empty-desk__templates" aria-disabled="true">
          Ou partir d’un modèle →
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
      <Toolbar appearance="pill" aria-label="Zoom du bureau">
        <ToolButton
          icon="minus"
          label="Zoom arrière"
          shortcut={['−']}
          unavailableReason={atMin ? 'Zoom arrière maximal atteint.' : undefined}
          onPress={() => store.zoomBy(1 / 1.2)}
        />
        <ToolButton icon="search" label="Revenir à 100 %" shortcut={['0']} value={`${Math.round(zoom * 100)} %`} onPress={() => store.zoomReset()} />
        <ToolButton
          icon="plus"
          label="Zoom avant"
          shortcut={['+']}
          unavailableReason={atMax ? 'Zoom avant maximal atteint.' : undefined}
          onPress={() => store.zoomBy(1.2)}
        />
      </Toolbar>
    </div>
  );
}
