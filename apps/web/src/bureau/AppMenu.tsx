import type { CSSProperties, ReactNode } from 'react';
import { Button as RACButton, Dialog, FileTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useDeskState } from '@oel/desk/react';
import { ACCEPTED_EXTENSIONS } from '@oel/engine';
import {
  Avatar,
  Button,
  ChoiceCard,
  Icon,
  Radio,
  RadioGroup,
  RailItem,
  RailNav,
  RailSeparator,
  Switch,
  WithTooltip,
  toast,
  type IconName,
} from '@oel/emboss';
import { NEW_KINDS, SOON, type ArrivalRules } from './Chrome';
import { KIND_ICON, kindLabel, type Bureau, type Paper, type PaperKind } from './model';
import { ShortcutsList } from './ShortcutsDialog';
import { useProject } from '../project/ProjectContext';
import { can, firstName, type ProjectContextValue } from '../project/model';
import { ROLE_LABEL } from '../project/settings';
import { useThemeChoice, type ThemeChoice } from './ThemeToggle';
import { DeskBackup, type DeskActions } from './DeskBackup';
import { features } from '../edition';

/** Panes of the full-screen menu (Figma M2). */
export type MenuPane = 'home' | 'new' | 'open' | 'projects' | 'share' | 'settings' | 'display' | 'shortcuts' | 'help' | 'account';

/** « Paramètres du projet », or just « Paramètres » with a single desk. */
const SETTINGS_LABEL = features.projects ? 'Paramètres du projet' : 'Paramètres';

/** Single-user edition: no projects to switch, no one to invite, no account (plan solo MVP, S-5). */
const HIDDEN: ReadonlySet<MenuPane> = new Set([
  ...(features.projects ? [] : (['projects'] as const)),
  ...(features.collab ? [] : (['share', 'account'] as const)),
]);

type RailEntry = { pane: MenuPane; icon: IconName; label: string } | 'links';

const RAIL: RailEntry[][] = (
  [
    [
      { pane: 'home', icon: 'home', label: 'Accueil' },
      { pane: 'new', icon: 'plus', label: 'Nouveau' },
      { pane: 'open', icon: 'upload', label: 'Ouvrir et importer' },
      { pane: 'projects', icon: 'folder', label: 'Projets' },
    ],
    [{ pane: 'share', icon: 'share', label: 'Partager et inviter' }, { pane: 'settings', icon: 'settings', label: SETTINGS_LABEL }, 'links'],
    [
      { pane: 'display', icon: 'eye', label: 'Affichage' },
      { pane: 'shortcuts', icon: 'keyboard', label: 'Raccourcis clavier' },
      { pane: 'help', icon: 'info', label: 'Aide' },
      { pane: 'account', icon: 'user', label: 'Compte' },
    ],
  ] satisfies RailEntry[][]
).map((group) => group.filter((item) => item === 'links' || !HIDDEN.has(item.pane)));

export interface AppMenuProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pane: MenuPane;
  onPaneChange: (pane: MenuPane) => void;
  /** Centre of the logo button, in viewport pixels: the menu grows from there. */
  origin: { x: number; y: number } | null;
  project: string;
  store: Bureau;
  onCreate: (kind: PaperKind) => void;
  onImport: (files: File[]) => void;
  /** Close the menu and show this file on the desk. */
  onReveal: (id: string) => void;
  /** Open the G6 « Fils du bureau » panel. */
  onLinksPanel: () => void;
  /** Late threads on the desk (dot on the logo and on « Fils du bureau »). */
  lateLinks: number;
  rules: ArrivalRules;
  onRulesChange: (r: ArrivalRules) => void;
  view: 'desk' | 'list';
  onViewChange: (v: 'desk' | 'list') => void;
  minimap: boolean;
  onMinimapChange: (v: boolean) => void;
  /** The desk saved on this device: export, import, reset (« Ce bureau »). */
  desk: DeskActions;
}

/**
 * Figma M2 · the logo's full-screen menu, like « Fichier » in Office: a rail
 * on the left, the chosen pane on the right. It grows from the logo (240 ms);
 * Échap, the logo or « Retour au bureau » close it, and the desk stays as it was.
 */
export function AppMenu(props: AppMenuProps) {
  const { isOpen, onOpenChange, pane, onPaneChange, origin, lateLinks } = props;
  const close = () => onOpenChange(false);
  const late = lateLinks > 0 ? `${lateLinks} fil${lateLinks > 1 ? 's' : ''} en retard` : undefined;
  const style = origin ? ({ '--menu-x': `${origin.x}px`, '--menu-y': `${origin.y}px` } as CSSProperties) : undefined;
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="app-menu-overlay">
      <Modal className="app-menu" style={style}>
        <Dialog className="app-menu__dialog" aria-label="Menu">
          <RailNav
            label="Menu"
            onBrandPress={close}
            brandLabel="Fermer le menu"
            footer={<RailItem icon="close" label="Retour au bureau" shortcut="Échap" onPress={close} />}
          >
            {RAIL.map((group, i) => [
              i > 0 && <RailSeparator key={`sep-${i}`} />,
              ...group.map((item) =>
                item === 'links' ? (
                  <RailItem
                    key="links"
                    icon="link"
                    label="Fils du bureau"
                    shortcut="Ctrl+Maj+L"
                    dot={late}
                    onPress={() => {
                      close();
                      props.onLinksPanel();
                    }}
                  />
                ) : (
                  <RailItem
                    key={item.pane}
                    icon={item.icon}
                    label={item.label}
                    current={pane === item.pane}
                    autoFocus={pane === item.pane}
                    onPress={() => onPaneChange(item.pane)}
                  />
                ),
              ),
            ])}
          </RailNav>
          <div className="app-menu__content">
            <Pane {...props} />
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function Pane(props: AppMenuProps) {
  const { me, members, role } = useProject();
  const canSet = can(role, 'settings');
  switch (props.pane) {
    case 'home':
      return (
        <>
          <Heading slot="title" level={2} className="app-menu__hello">
            {features.projects ? `Bonjour, ${firstName(me)}` : 'Bonjour'}
          </Heading>
          <NewRow {...props} title={`Nouveau dans « ${props.project} »`} />
          <div className="app-menu__columns">
            <section className="app-menu__section" aria-labelledby="menu-recent">
              <h3 id="menu-recent" className="app-menu__h3">Récents dans ce projet</h3>
              <FileList {...props} limit={4} />
            </section>
            {features.projects && <ProjectsSection {...props} />}
          </div>
        </>
      );
    case 'new':
      return (
        <>
          <PaneTitle>Nouveau</PaneTitle>
          <NewRow {...props} title={`Dans « ${props.project} »`} />
        </>
      );
    case 'open':
      return (
        <>
          <PaneTitle>Ouvrir et importer</PaneTitle>
          <FileTrigger
            allowsMultiple
            acceptedFileTypes={ACCEPTED_EXTENSIONS}
            onSelect={(list) => {
              if (!list) return;
              props.onOpenChange(false);
              props.onImport([...list]);
            }}
          >
            <Button variant="primary" leadingIcon="upload">
              Importer des fichiers…
            </Button>
          </FileTrigger>
          <p className="app-menu__note">PDF, Word, PowerPoint, Excel, images · 100 Mo max. Ctrl + O depuis le bureau.</p>
          <DeskBackup store={props.store} desk={props.desk} />
          <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-files">
            <h3 id="menu-files" className="app-menu__h3">Tous les fichiers du projet</h3>
            <FileList {...props} />
          </section>
        </>
      );
    case 'projects':
      return (
        <>
          <PaneTitle>Projets</PaneTitle>
          <ProjectsSection {...props} />
        </>
      );
    case 'share':
      return (
        <>
          <PaneTitle>Partager et inviter</PaneTitle>
          <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-members">
            <h3 id="menu-members" className="app-menu__h3">Personnes du projet</h3>
            <ul className="app-menu__list">
              {members.map((p) => (
                <li key={p.id} className="app-menu__row app-menu__row--static">
                  <Avatar person={p} size={24} />
                  <span className="app-menu__row-title">{p.name}</span>
                  <span className="app-menu__row-meta">{ROLE_LABEL[p.role]}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="app-menu__actions">
            <Button
              leadingIcon="link"
              onPress={() => toast({ title: 'Lien de partage copié', description: 'Les invités verront ce bureau en lecture.', tone: 'success' })}
            >
              Copier le lien
            </Button>
            <Soon label="Inviter par courriel">
              <Button leadingIcon="mail" aria-disabled>
                Inviter par courriel
              </Button>
            </Soon>
          </div>
        </>
      );
    case 'settings':
      return (
        <>
          <PaneTitle>{SETTINGS_LABEL}</PaneTitle>
          <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-import">
            <h3 id="menu-import" className="app-menu__h3">Import</h3>
            <div className="app-menu__switches">
              <Switch isDisabled={!canSet} isSelected={props.rules.sortByType} onChange={(v) => props.onRulesChange({ ...props.rules, sortByType: v })}>
                Ranger aussi les fichiers qui arrivent (par type)
              </Switch>
              <Switch isDisabled={!canSet} isSelected={props.rules.ocr} onChange={(v) => props.onRulesChange({ ...props.rules, ocr: v })}>
                Convertir les PDF numérisés (OCR)
              </Switch>
              <Switch isDisabled={!canSet} isSelected={props.rules.linkTables} onChange={(v) => props.onRulesChange({ ...props.rules, linkTables: v })}>
                Lier les tableaux importés
              </Switch>
            </div>
            <p className="app-menu__note">
              Les fichiers se posent là où on les lâche, en éventail, puis glissent vers leur pile si le rangement est actif.
            </p>
            {!canSet && <p className="app-menu__note">Seuls les propriétaires du projet modifient ces réglages.</p>}
          </section>
        </>
      );
    case 'display':
      return <DisplayPane {...props} />;
    case 'shortcuts':
      return (
        <>
          <PaneTitle>Raccourcis clavier</PaneTitle>
          <div className="app-menu__shortcuts">
            <ShortcutsList />
          </div>
        </>
      );
    case 'help':
      return (
        <>
          <PaneTitle>Aide</PaneTitle>
          <div className="app-menu__prose">
            <p>
              Chaque fichier du projet est posé sur le bureau comme du papier. Double-cliquez ou appuyez sur Entrée pour l’ouvrir sur
              place ; Échap le repose.
            </p>
            <p>
              Touche <kbd>?</kbd> : tous les raccourcis clavier. Touche <kbd>N</kbd> : une note. <kbd>Alt</kbd> + <kbd>N</kbd> : un
              nouveau fichier.
            </p>
            <p>
              <a href="/docs" target="_blank" rel="noopener">
                Documentation du Bureau
              </a>{' '}
              (nouvel onglet) : le bureau, les éditeurs, les fils de liaison, les formats.
            </p>
            {import.meta.env.DEV && (
              <p>
                <a href="/composants">Composants du kit</a> (en développement seulement)
              </p>
            )}
          </div>
        </>
      );
    case 'account':
      return (
        <>
          <PaneTitle>Compte</PaneTitle>
          <div className="app-menu__account">
            <Avatar person={me} size={48} />
            <span className="app-menu__row-title">{me.name}</span>
          </div>
          <div className="app-menu__actions">
            <a className="emb-button emb-button--secondary emb-button--md" href="/connexion">
              <span className="emb-button__label">Connexion</span>
            </a>
          </div>
        </>
      );
  }
}

function PaneTitle({ children }: { children: ReactNode }) {
  return (
    <Heading slot="title" level={2} className="app-menu__hello">
      {children}
    </Heading>
  );
}

function Soon({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <WithTooltip label={label} unavailableReason={SOON}>
      {children}
    </WithTooltip>
  );
}

/** Blank page shapes above the « Nouveau » cards. */
const MEDIA: Record<string, 'portrait' | 'landscape'> = { slides: 'landscape' };

function NewRow({ title, onCreate, onOpenChange }: AppMenuProps & { title: string }) {
  const create = (kind: PaperKind) => {
    onOpenChange(false);
    onCreate(kind);
  };
  const page = (kind: string) => <span className={`app-menu__page app-menu__page--${MEDIA[kind] ?? 'portrait'}`} />;
  return (
    <section className="app-menu__section" aria-labelledby="menu-new">
      <h3 id="menu-new" className="app-menu__h3">{title}</h3>
      <div className="app-menu__cards">
        {NEW_KINDS.map((k) => (
          <ChoiceCard key={k.kind} icon={k.icon} label={k.label} media={page(k.kind)} iconColor={`var(--kind-${k.kind})`} onPress={() => create(k.kind)} />
        ))}
        <ChoiceCard icon="note" label="Note" media={page('note')} onPress={() => create('note')} />
        <ChoiceCard icon="gallery" label="Galerie vide" media={page('gallery')} unavailableReason={SOON} />
      </div>
      <Soon label="Modèles">
        <RACButton className="app-menu__more" aria-disabled="true">
          Tous les modèles →
        </RACButton>
      </Soon>
    </section>
  );
}

const relative = new Intl.RelativeTimeFormat('fr-CA', { numeric: 'auto' });

/** « il y a 12 minutes », « hier », « lundi dernier »… */
function ago(t: number): string {
  const min = Math.round((t - Date.now()) / 60_000);
  if (min > -1) return 'à l’instant';
  if (min > -60) return relative.format(min, 'minute');
  const h = Math.round(min / 60);
  if (h > -24) return relative.format(h, 'hour');
  return relative.format(Math.round(h / 24), 'day');
}

function byWhom(initials: string | undefined, { me, members }: Pick<ProjectContextValue, 'me' | 'members'>): string | null {
  // Single user: it is always you.
  if (!initials || !features.projects) return null;
  if (initials === me.initials) return 'vous';
  return members.find((p) => p.initials === initials)?.name ?? initials;
}

/** Project files, latest change first (`limit`), or all by name. */
function FileList({ store, onReveal, onOpenChange, limit }: AppMenuProps & { limit?: number }) {
  const nodes = useDeskState(store, (s) => s.nodes);
  const order = useDeskState(store, (s) => s.order);
  const project = useProject();
  const papers = order.map((id) => nodes[id] as Paper | undefined).filter((p): p is Paper => !!p);
  const list = limit
    ? [...papers].sort((a, b) => (b.data.updatedAt ?? 0) - (a.data.updatedAt ?? 0)).slice(0, limit)
    : [...papers].sort((a, b) => a.title.localeCompare(b.title, 'fr-CA'));
  if (!list.length) return <p className="app-menu__note">Aucun fichier pour l’instant.</p>;
  return (
    <ul className="app-menu__list">
      {list.map((p) => {
        const who = byWhom(p.data.editor, project);
        const meta = p.data.updatedAt
          ? `Modifié${who ? ` par ${who}` : ''} · ${ago(p.data.updatedAt)}`
          : kindLabel(p.kind);
        return (
          <li key={p.id}>
            <RACButton
              className="app-menu__row"
              data-kind={p.kind}
              onPress={() => {
                onOpenChange(false);
                onReveal(p.id);
              }}
            >
              <Icon name={KIND_ICON[p.kind] ?? 'file'} size={14} />
              <span className="app-menu__row-title">{p.title}</span>
              <span className="app-menu__row-meta">{meta}</span>
            </RACButton>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectsSection({ project, store, onOpenChange }: AppMenuProps) {
  const count = useDeskState(store, (s) => s.order.length);
  return (
    <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-projects">
      <h3 id="menu-projects" className="app-menu__h3">Vos projets</h3>
      <ul className="app-menu__list">
        <li>
          <RACButton className="app-menu__row is-current" aria-current="page" onPress={() => onOpenChange(false)}>
            <Icon name="folder" size={14} />
            <span className="app-menu__row-title">{project}</span>
            <span className="app-menu__row-meta">
              Projet ouvert · {count} fichier{count > 1 ? 's' : ''}
            </span>
          </RACButton>
        </li>
        <li>
          <Soon label="Nouveau projet">
            <RACButton className="app-menu__row app-menu__row--new" aria-disabled="true">
              <Icon name="plus" size={14} />
              <span className="app-menu__row-title">Nouveau projet</span>
            </RACButton>
          </Soon>
        </li>
      </ul>
    </section>
  );
}

function DisplayPane({ store, view, onViewChange, minimap, onMinimapChange }: AppMenuProps) {
  const [theme, setTheme] = useThemeChoice();
  const threads = useDeskState(store, (s) => s.showLinks);
  return (
    <>
      <PaneTitle>Affichage</PaneTitle>
      <div className="app-menu__settings">
        <RadioGroup label="Thème" value={theme} onChange={(v) => setTheme(v as ThemeChoice)}>
          <Radio value="light">Clair</Radio>
          <Radio value="dark">Sombre</Radio>
          <Radio value="system">Comme le système</Radio>
        </RadioGroup>
        <RadioGroup label="Vue du projet" value={view} onChange={(v) => onViewChange(v as 'desk' | 'list')}>
          <Radio value="desk">Bureau</Radio>
          <Radio value="list">Liste</Radio>
        </RadioGroup>
        <div className="app-menu__switches">
          <Switch isSelected={minimap} onChange={onMinimapChange}>
            Mini-carte du bureau
          </Switch>
          <Switch isSelected={threads} onChange={(v) => store.toggleLinks(v)}>
            Fils visibles sur le bureau
          </Switch>
        </div>
      </div>
    </>
  );
}
