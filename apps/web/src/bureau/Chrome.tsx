import { FileTrigger } from 'react-aria-components';
import { useDeskState } from '@oel/desk/react';
import { worldToScreen } from '@oel/desk';
import { ACCEPTED_EXTENSIONS } from '@oel/engine';
import {
  AvatarStack,
  Badge,
  Button,
  DialogTrigger,
  Icon,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  Popover,
  Switch,
  Toolbar,
  ToolbarSeparator,
  ToolButton,
  toast,
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

/* ── B1 · 7 Dock de création ────────────────────────────────────────── */

export interface ArrivalRules {
  sortByType: boolean;
  ocr: boolean;
  linkTables: boolean;
}

export function Dock({
  onCreate,
  onImport,
  showLinks,
  onToggleLinks,
  rules,
  onRulesChange,
}: {
  onCreate: (kind: PaperKind) => void;
  onImport: (files: File[]) => void;
  showLinks: boolean;
  onToggleLinks: () => void;
  rules: ArrivalRules;
  onRulesChange: (r: ArrivalRules) => void;
}) {
  return (
    <div className="dock" data-desk-ui>
      <Toolbar appearance="pill" aria-label="Créer et importer">
        <ToolButton icon="file" label="Document" showLabel description="Nouveau document au centre de la vue." onPress={() => onCreate('document')} />
        <ToolButton icon="slide" label="Diapo" showLabel description="Nouvelle présentation 16:9." onPress={() => onCreate('slides')} />
        <ToolButton icon="table" label="Tableur" showLabel description="Nouvelle grille." onPress={() => onCreate('spreadsheet')} />
        <ToolButton icon="note" label="Note" showLabel shortcut={['N']} description="Pense-bête, assignable à quelqu’un." onPress={() => onCreate('note')} />
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED_EXTENSIONS} onSelect={(list) => list && onImport([...list])}>
          <ToolButton icon="upload" label="Importer" showLabel shortcut={['Ctrl', 'O']} description="PDF, Word, PowerPoint, Excel, images · 100 Mo max." />
        </FileTrigger>
        <ToolbarSeparator />
        <DialogTrigger>
          <ToolButton icon="settings" label="À l’arrivée" description="Règles appliquées aux fichiers déposés." />
          <Popover placement="top">
            <div className="rules">
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
        </DialogTrigger>
        <ToolButton
          icon="link"
          label={showLinks ? 'Masquer les fils' : 'Afficher les fils'}
          description="Fils de liaison entre fichiers qui partagent des données."
          onPress={onToggleLinks}
        />
        <ToolbarSeparator />
        <MenuTrigger>
          <Button variant="primary" size="sm" leadingIcon="plus">
            Nouveau
          </Button>
          <MenuPopover placement="top">
            <Menu
              aria-label="Nouveau"
              onAction={(key) => {
                if (key === 'import') document.querySelector<HTMLInputElement>('.dock input[type=file]')?.click();
                else onCreate(key as PaperKind);
              }}
            >
              <MenuItem id="document" icon="file">Document</MenuItem>
              <MenuItem id="slides" icon="slide">Présentation</MenuItem>
              <MenuItem id="spreadsheet" icon="table">Tableur</MenuItem>
              <MenuItem id="note" icon="note" shortcut="N">Note</MenuItem>
              <MenuSeparator />
              <MenuItem id="import" icon="upload" shortcut="Ctrl+O">Importer des fichiers…</MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
      </Toolbar>
    </div>
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
