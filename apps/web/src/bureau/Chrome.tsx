import { useRef, useState } from 'react';
import { Button as RACButton, FileTrigger } from 'react-aria-components';
import { useDeskState } from '@oel/desk/react';
import { worldToScreen } from '@oel/desk';
import { ACCEPTED_EXTENSIONS } from '@oel/engine';
import {
  AvatarStack,
  Badge,
  Button,
  Icon,
  Logo,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  NotificationsButton,
  Popover,
  Switch,
  Toolbar,
  ToolbarSeparator,
  ToolButton,
  WithTooltip,
  toast,
  type IconName,
} from '@oel/emboss';
import { PEOPLE, type Bureau, type PaperKind } from './model';
import { ThemeToggle } from './ThemeToggle';

/* ── B1 · 1 Projet ──────────────────────────────────────────────────── */

export function ProjectPill({
  title,
  count,
  view,
  onToggleView,
}: {
  title: string;
  count: number;
  view: 'desk' | 'list';
  onToggleView: () => void;
}) {
  return (
    <header className="chrome-pill project-pill" data-desk-ui>
      <Icon name="folder" size={20} className="project-pill__icon" />
      <h1 className="project-pill__title">{title}</h1>
      <Badge tone="accent">Projet</Badge>
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

export function SharePill({ onHelp }: { onHelp: () => void }) {
  return (
    <div className="chrome-pill share-pill" data-desk-ui>
      <AvatarStack people={PEOPLE} label="3 personnes sur le bureau : vous, Marie-Claude et Alex" />
      <Button
        size="sm"
        leadingIcon="mail"
        onPress={() => toast({ title: 'Lien de partage copié', description: 'Les invités verront ce bureau en lecture.', tone: 'success' })}
      >
        Partager
      </Button>
      <NotificationsButton />
      <Button variant="ghost" size="icon-sm" leadingIcon="keyboard" aria-label="Raccourcis clavier" aria-keyshortcuts="Shift+?" onPress={onHelp} />
      <ThemeToggle />
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
const NEW_KINDS: { kind: PaperKind; label: string; icon: IconName }[] = [
  { kind: 'document', label: 'Document', icon: 'file' },
  { kind: 'slides', label: 'Présentation', icon: 'slide' },
  { kind: 'spreadsheet', label: 'Tableur', icon: 'table' },
  { kind: 'form', label: 'Formulaire', icon: 'form' },
];

const SOON = 'Bientôt.';

/**
 * Figma M1: logo menu on the left, Note · Importer · Ranger · Étaler, and a
 * round « + » on the right that creates the other kinds.
 *
 * Until the full-screen menu (plan M-5), the logo opens a short menu holding
 * what left the dock and the sidebar: home, the desk's threads, the arrival
 * rules (moving to project settings, N) and the shortcuts.
 */
export function BottomBar({
  onCreate,
  onImport,
  newMenuOpen,
  onNewMenuOpenChange,
  linksPanel,
  onLinksPanel,
  rules,
  onRulesChange,
  onHelp,
}: {
  onCreate: (kind: PaperKind) => void;
  onImport: (files: File[]) => void;
  /** The « + » menu, controlled so Alt + N can open it. */
  newMenuOpen: boolean;
  onNewMenuOpenChange: (open: boolean) => void;
  /** G6 « Fils du bureau » is open. */
  linksPanel: boolean;
  onLinksPanel: () => void;
  rules: ArrivalRules;
  onRulesChange: (r: ArrivalRules) => void;
  onHelp: () => void;
}) {
  const logoRef = useRef<HTMLButtonElement>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  return (
    <div className="bottom-bar" data-desk-ui>
      <Toolbar appearance="pill" aria-label="Bureau">
        <MenuTrigger>
          <WithTooltip label="Menu" description="Accueil, fils du bureau, règles d’import, raccourcis.">
            <RACButton ref={logoRef} className="bottom-bar__logo" aria-label="Menu">
              <Logo size={22} aria-hidden />
            </RACButton>
          </WithTooltip>
          <MenuPopover placement="top start">
            <Menu
              aria-label="Menu"
              onAction={(key) => {
                if (key === 'home') location.assign('/');
                else if (key === 'links') onLinksPanel();
                else if (key === 'rules') setRulesOpen(true);
                else if (key === 'help') onHelp();
              }}
            >
              <MenuItem id="home" icon="home">Accueil</MenuItem>
              <MenuSeparator />
              <MenuItem id="links" icon="link" shortcut="Ctrl+Maj+L">
                {linksPanel ? 'Masquer les fils du bureau' : 'Fils du bureau'}
              </MenuItem>
              <MenuItem id="rules" icon="settings">À l’arrivée…</MenuItem>
              <MenuSeparator />
              <MenuItem id="help" icon="keyboard" shortcut="?">Raccourcis clavier</MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
        <Popover triggerRef={logoRef} isOpen={rulesOpen} onOpenChange={setRulesOpen} placement="top start">
          <div className="rules" role="group" aria-label="À l’arrivée">
            <strong className="rules__title">À l’arrivée</strong>
            <Switch isSelected={rules.sortByType} onChange={(v) => onRulesChange({ ...rules, sortByType: v })}>
              Ranger automatiquement par type
            </Switch>
            <Switch isSelected={rules.ocr} onChange={(v) => onRulesChange({ ...rules, ocr: v })}>
              Convertir les PDF numérisés (OCR)
            </Switch>
            <Switch isSelected={rules.linkTables} onChange={(v) => onRulesChange({ ...rules, linkTables: v })}>
              Lier les tableaux importés
            </Switch>
            <p className="rules__help">
              Les fichiers se posent là où on les lâche, en éventail, puis glissent vers leur pile si le rangement est actif.
            </p>
          </div>
        </Popover>
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
          <WithTooltip label="Nouveau" shortcut={['Alt', 'N']} description="Document, présentation, tableur ou formulaire, au centre de la vue.">
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
          <RACButton key={k.kind} className="empty-desk__card" data-kind={k.kind} onPress={() => onCreate(k.kind)}>
            <Icon name={k.icon} size={32} />
            {k.label}
          </RACButton>
        ))}
        <RACButton className="empty-desk__card" onPress={() => onCreate('note')}>
          <Icon name="note" size={32} />
          Note
        </RACButton>
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED_EXTENSIONS} onSelect={(list) => list && onImport([...list])}>
          <RACButton className="empty-desk__card">
            <Icon name="upload" size={32} />
            Importer
          </RACButton>
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
