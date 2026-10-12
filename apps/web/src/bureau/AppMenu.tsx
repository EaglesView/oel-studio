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
import { lang, locale, messages, plural, type Lang } from '@oel/i18n';
import { switchLang } from '../lang';
import { docHref } from '../site/i18n';

const t = messages(
  {
    settings: 'Paramètres',
    projectSettings: 'Paramètres du projet',
    home: 'Accueil',
    new: 'Nouveau',
    open: 'Ouvrir et importer',
    projects: 'Projets',
    share: 'Partager et inviter',
    display: 'Affichage',
    shortcuts: 'Raccourcis clavier',
    help: 'Aide',
    account: 'Compte',
    late: (n: number) => `${n} ${plural(n, 'fil en retard', 'fils en retard')}`,
    menu: 'Menu',
    closeMenu: 'Fermer le menu',
    backToDesk: 'Retour au bureau',
    esc: 'Échap',
    deskThreads: 'Fils du bureau',
    threadsKey: 'Ctrl+Maj+L',
    hello: 'Bonjour',
    helloName: (name: string) => `Bonjour, ${name}`,
    newIn: (project: string) => `Nouveau dans « ${project} »`,
    inProject: (project: string) => `Dans « ${project} »`,
    recent: 'Récents dans ce projet',
    importFiles: 'Importer des fichiers…',
    importNote: 'PDF, Word, PowerPoint, Excel, images · 100 Mo max. Ctrl + O depuis le bureau.',
    allFiles: 'Tous les fichiers du projet',
    people: 'Personnes du projet',
    linkCopied: 'Lien de partage copié',
    linkCopiedBody: 'Les invités verront ce bureau en lecture.',
    copyLink: 'Copier le lien',
    inviteByEmail: 'Inviter par courriel',
    language: 'Langue',
    languageNote: 'La page se recharge dans la langue choisie ; votre bureau est conservé.',
    import: 'Import',
    sortArrivals: 'Ranger aussi les fichiers qui arrivent (par type)',
    ocr: 'Convertir les PDF numérisés (OCR)',
    linkTables: 'Lier les tableaux importés',
    arrivalsNote: 'Les fichiers se posent là où on les lâche, en éventail, puis glissent vers leur pile si le rangement est actif.',
    ownersOnly: 'Seuls les propriétaires du projet modifient ces réglages.',
    help1: 'Chaque fichier du projet est posé sur le bureau comme du papier. Double-cliquez ou appuyez sur Entrée pour l’ouvrir sur place ; Échap le repose.',
    helpKey: 'Touche',
    helpAll: ': tous les raccourcis clavier.',
    helpNote: ': une note.',
    helpNew: ': un nouveau fichier.',
    docs: 'Documentation du Bureau',
    docsAfter: '(nouvel onglet) : le bureau, les éditeurs, les fils de liaison, les formats.',
    welcomeAgain: 'Revoir l’accueil',
    kit: 'Composants du kit',
    kitDev: '(en développement seulement)',
    signIn: 'Connexion',
    templates: 'Modèles',
    allTemplates: 'Tous les modèles →',
    note: 'Note',
    emptyGallery: 'Galerie vide',
    justNow: 'à l’instant',
    you: 'vous',
    none: 'Aucun fichier pour l’instant.',
    modified: (who: string | null) => (who ? `Modifié par ${who}` : 'Modifié'),
    yourProjects: 'Vos projets',
    projectOpen: (n: number) => `Projet ouvert · ${n} ${plural(n, 'fichier', 'fichiers')}`,
    newProject: 'Nouveau projet',
    theme: 'Thème',
    light: 'Clair',
    dark: 'Sombre',
    system: 'Comme le système',
    projectView: 'Vue du projet',
    viewDesk: 'Bureau',
    viewList: 'Liste',
    minimap: 'Mini-carte du bureau',
    threadsVisible: 'Fils visibles sur le bureau',
  },
  {
    settings: 'Settings',
    projectSettings: 'Project settings',
    home: 'Home',
    new: 'New',
    open: 'Open and import',
    projects: 'Projects',
    share: 'Share and invite',
    display: 'Display',
    shortcuts: 'Keyboard shortcuts',
    help: 'Help',
    account: 'Account',
    late: (n) => `${n} ${plural(n, 'late thread', 'late threads')}`,
    menu: 'Menu',
    closeMenu: 'Close the menu',
    backToDesk: 'Back to the desk',
    esc: 'Esc',
    deskThreads: 'Desk threads',
    threadsKey: 'Ctrl+Shift+L',
    hello: 'Hello',
    helloName: (name) => `Hello, ${name}`,
    newIn: (project) => `New in “${project}”`,
    inProject: (project) => `In “${project}”`,
    recent: 'Recent in this project',
    importFiles: 'Import files…',
    importNote: 'PDF, Word, PowerPoint, Excel, images · 100 MB max. Ctrl + O from the desk.',
    allFiles: 'All the project’s files',
    people: 'People in the project',
    linkCopied: 'Share link copied',
    linkCopiedBody: 'Guests will see this desk read-only.',
    copyLink: 'Copy the link',
    inviteByEmail: 'Invite by email',
    language: 'Language',
    languageNote: 'The page reloads in the chosen language; your desk is kept.',
    import: 'Import',
    sortArrivals: 'Also sort incoming files (by type)',
    ocr: 'Convert scanned PDFs (OCR)',
    linkTables: 'Link imported tables',
    arrivalsNote: 'Files land where they are dropped, fanned out, then slide to their pile if sorting is on.',
    ownersOnly: 'Only the project’s owners change these settings.',
    help1: 'Every file of the project lies on the desk like paper. Double-click or press Enter to open it in place; Esc puts it back.',
    helpKey: 'Key',
    helpAll: ': every keyboard shortcut.',
    helpNote: ': a note.',
    helpNew: ': a new file.',
    docs: 'Bureau documentation',
    docsAfter: '(new tab): the desk, the editors, linked copies, formats.',
    welcomeAgain: 'Show the welcome again',
    kit: 'Kit components',
    kitDev: '(development only)',
    signIn: 'Sign in',
    templates: 'Templates',
    allTemplates: 'All templates →',
    note: 'Note',
    emptyGallery: 'Empty gallery',
    justNow: 'just now',
    you: 'you',
    none: 'No files yet.',
    modified: (who) => (who ? `Changed by ${who}` : 'Changed'),
    yourProjects: 'Your projects',
    projectOpen: (n) => `Open project · ${n} ${plural(n, 'file', 'files')}`,
    newProject: 'New project',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'Same as the system',
    projectView: 'Project view',
    viewDesk: 'Desk',
    viewList: 'List',
    minimap: 'Desk minimap',
    threadsVisible: 'Threads visible on the desk',
  },
);

/** Panes of the full-screen menu (Figma M2). */
export type MenuPane = 'home' | 'new' | 'open' | 'projects' | 'share' | 'settings' | 'display' | 'shortcuts' | 'help' | 'account';

/** « Paramètres du projet », or just « Paramètres » with a single desk. */
const SETTINGS_LABEL = features.projects ? t.projectSettings : t.settings;

/** Single-user edition: no projects to switch, no one to invite, no account (plan solo MVP, S-5). */
const HIDDEN: ReadonlySet<MenuPane> = new Set([
  ...(features.projects ? [] : (['projects'] as const)),
  ...(features.collab ? [] : (['share', 'account'] as const)),
]);

type RailEntry = { pane: MenuPane; icon: IconName; label: string } | 'links';

const RAIL: RailEntry[][] = (
  [
    [
      { pane: 'home', icon: 'home', label: t.home },
      { pane: 'new', icon: 'plus', label: t.new },
      { pane: 'open', icon: 'upload', label: t.open },
      { pane: 'projects', icon: 'folder', label: t.projects },
    ],
    [{ pane: 'share', icon: 'share', label: t.share }, { pane: 'settings', icon: 'settings', label: SETTINGS_LABEL }, 'links'],
    [
      { pane: 'display', icon: 'eye', label: t.display },
      { pane: 'shortcuts', icon: 'keyboard', label: t.shortcuts },
      { pane: 'help', icon: 'info', label: t.help },
      { pane: 'account', icon: 'user', label: t.account },
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
  /** Close the menu and show the first-visit welcome again (Aide). */
  onWelcome: () => void;
}

/**
 * Figma M2 · the logo's full-screen menu, like « Fichier » in Office: a rail
 * on the left, the chosen pane on the right. It grows from the logo (240 ms);
 * Échap, the logo or « Retour au bureau » close it, and the desk stays as it was.
 */
export function AppMenu(props: AppMenuProps) {
  const { isOpen, onOpenChange, pane, onPaneChange, origin, lateLinks } = props;
  const close = () => onOpenChange(false);
  const late = lateLinks > 0 ? t.late(lateLinks) : undefined;
  const style = origin ? ({ '--menu-x': `${origin.x}px`, '--menu-y': `${origin.y}px` } as CSSProperties) : undefined;
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="app-menu-overlay">
      <Modal className="app-menu" style={style}>
        <Dialog className="app-menu__dialog" aria-label={t.menu}>
          <RailNav
            label={t.menu}
            onBrandPress={close}
            brandLabel={t.closeMenu}
            footer={<RailItem icon="close" label={t.backToDesk} shortcut={t.esc} onPress={close} />}
          >
            {RAIL.map((group, i) => [
              i > 0 && <RailSeparator key={`sep-${i}`} />,
              ...group.map((item) =>
                item === 'links' ? (
                  <RailItem
                    key="links"
                    icon="link"
                    label={t.deskThreads}
                    shortcut={t.threadsKey}
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
            {features.projects ? t.helloName(firstName(me)) : t.hello}
          </Heading>
          <NewRow {...props} title={t.newIn(props.project)} />
          <div className="app-menu__columns">
            <section className="app-menu__section" aria-labelledby="menu-recent">
              <h3 id="menu-recent" className="app-menu__h3">{t.recent}</h3>
              <FileList {...props} limit={4} />
            </section>
            {features.projects && <ProjectsSection {...props} />}
          </div>
        </>
      );
    case 'new':
      return (
        <>
          <PaneTitle>{t.new}</PaneTitle>
          <NewRow {...props} title={t.inProject(props.project)} />
        </>
      );
    case 'open':
      return (
        <>
          <PaneTitle>{t.open}</PaneTitle>
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
              {t.importFiles}
            </Button>
          </FileTrigger>
          <p className="app-menu__note">{t.importNote}</p>
          <DeskBackup store={props.store} desk={props.desk} />
          <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-files">
            <h3 id="menu-files" className="app-menu__h3">{t.allFiles}</h3>
            <FileList {...props} />
          </section>
        </>
      );
    case 'projects':
      return (
        <>
          <PaneTitle>{t.projects}</PaneTitle>
          <ProjectsSection {...props} />
        </>
      );
    case 'share':
      return (
        <>
          <PaneTitle>{t.share}</PaneTitle>
          <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-members">
            <h3 id="menu-members" className="app-menu__h3">{t.people}</h3>
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
              onPress={() => toast({ title: t.linkCopied, description: t.linkCopiedBody, tone: 'success' })}
            >
              {t.copyLink}
            </Button>
            <Soon label={t.inviteByEmail}>
              <Button leadingIcon="mail" aria-disabled>
                {t.inviteByEmail}
              </Button>
            </Soon>
          </div>
        </>
      );
    case 'settings':
      return (
        <>
          <PaneTitle>{SETTINGS_LABEL}</PaneTitle>
          <LanguageSection />
          <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-import">
            <h3 id="menu-import" className="app-menu__h3">{t.import}</h3>
            <div className="app-menu__switches">
              <Switch isDisabled={!canSet} isSelected={props.rules.sortByType} onChange={(v) => props.onRulesChange({ ...props.rules, sortByType: v })}>
                {t.sortArrivals}
              </Switch>
              <Switch isDisabled={!canSet} isSelected={props.rules.ocr} onChange={(v) => props.onRulesChange({ ...props.rules, ocr: v })}>
                {t.ocr}
              </Switch>
              <Switch isDisabled={!canSet} isSelected={props.rules.linkTables} onChange={(v) => props.onRulesChange({ ...props.rules, linkTables: v })}>
                {t.linkTables}
              </Switch>
            </div>
            <p className="app-menu__note">{t.arrivalsNote}</p>
            {!canSet && <p className="app-menu__note">{t.ownersOnly}</p>}
          </section>
        </>
      );
    case 'display':
      return <DisplayPane {...props} />;
    case 'shortcuts':
      return (
        <>
          <PaneTitle>{t.shortcuts}</PaneTitle>
          <div className="app-menu__shortcuts">
            <ShortcutsList />
          </div>
        </>
      );
    case 'help':
      return (
        <>
          <PaneTitle>{t.help}</PaneTitle>
          <div className="app-menu__prose">
            <p>{t.help1}</p>
            <p>
              {t.helpKey} <kbd>?</kbd> {t.helpAll} {t.helpKey} <kbd>N</kbd> {t.helpNote} <kbd>Alt</kbd> + <kbd>N</kbd> {t.helpNew}
            </p>
            <p>
              <a href={docHref(lang(), 'index')} target="_blank" rel="noopener">
                {t.docs}
              </a>{' '}
              {t.docsAfter}
            </p>
            {import.meta.env.DEV && (
              <p>
                <a href="/composants">{t.kit}</a> {t.kitDev}
              </p>
            )}
          </div>
          <div className="app-menu__actions">
            <Button variant="secondary" leadingIcon="info" onPress={props.onWelcome}>
              {t.welcomeAgain}
            </Button>
          </div>
        </>
      );
    case 'account':
      return (
        <>
          <PaneTitle>{t.account}</PaneTitle>
          <div className="app-menu__account">
            <Avatar person={me} size={48} />
            <span className="app-menu__row-title">{me.name}</span>
          </div>
          <div className="app-menu__actions">
            <a className="emb-button emb-button--secondary emb-button--md" href="/connexion">
              <span className="emb-button__label">{t.signIn}</span>
            </a>
          </div>
        </>
      );
  }
}

/** Interface language (`src/lang.ts`): saved in the `oel-lang` cookie, applied by reloading. */
function LanguageSection() {
  return (
    <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-language">
      <h3 id="menu-language" className="app-menu__h3">{t.language}</h3>
      <RadioGroup aria-labelledby="menu-language" value={lang()} onChange={(v) => switchLang(v as Lang)}>
        <Radio value="fr">
          <span lang="fr-CA">Français</span>
        </Radio>
        <Radio value="en">
          <span lang="en-CA">English</span>
        </Radio>
      </RadioGroup>
      <p className="app-menu__note">{t.languageNote}</p>
    </section>
  );
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
        <ChoiceCard icon="note" label={t.note} media={page('note')} onPress={() => create('note')} />
        <ChoiceCard icon="gallery" label={t.emptyGallery} media={page('gallery')} unavailableReason={SOON} />
      </div>
      <Soon label={t.templates}>
        <RACButton className="app-menu__more" aria-disabled="true">
          {t.allTemplates}
        </RACButton>
      </Soon>
    </section>
  );
}

const relative = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });

/** « il y a 12 minutes », « hier », « lundi dernier »… */
function ago(at: number): string {
  const min = Math.round((at - Date.now()) / 60_000);
  if (min > -1) return t.justNow;
  if (min > -60) return relative.format(min, 'minute');
  const h = Math.round(min / 60);
  if (h > -24) return relative.format(h, 'hour');
  return relative.format(Math.round(h / 24), 'day');
}

function byWhom(initials: string | undefined, { me, members }: Pick<ProjectContextValue, 'me' | 'members'>): string | null {
  // Single user: it is always you.
  if (!initials || !features.projects) return null;
  if (initials === me.initials) return t.you;
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
    : [...papers].sort((a, b) => a.title.localeCompare(b.title, locale()));
  if (!list.length) return <p className="app-menu__note">{t.none}</p>;
  return (
    <ul className="app-menu__list">
      {list.map((p) => {
        const who = byWhom(p.data.editor, project);
        const meta = p.data.updatedAt
          ? `${t.modified(who)} · ${ago(p.data.updatedAt)}`
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
      <h3 id="menu-projects" className="app-menu__h3">{t.yourProjects}</h3>
      <ul className="app-menu__list">
        <li>
          <RACButton className="app-menu__row is-current" aria-current="page" onPress={() => onOpenChange(false)}>
            <Icon name="folder" size={14} />
            <span className="app-menu__row-title">{project}</span>
            <span className="app-menu__row-meta">{t.projectOpen(count)}</span>
          </RACButton>
        </li>
        <li>
          <Soon label={t.newProject}>
            <RACButton className="app-menu__row app-menu__row--new" aria-disabled="true">
              <Icon name="plus" size={14} />
              <span className="app-menu__row-title">{t.newProject}</span>
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
      <PaneTitle>{t.display}</PaneTitle>
      <div className="app-menu__settings">
        <RadioGroup label={t.theme} value={theme} onChange={(v) => setTheme(v as ThemeChoice)}>
          <Radio value="light">{t.light}</Radio>
          <Radio value="dark">{t.dark}</Radio>
          <Radio value="system">{t.system}</Radio>
        </RadioGroup>
        <RadioGroup label={t.projectView} value={view} onChange={(v) => onViewChange(v as 'desk' | 'list')}>
          <Radio value="desk">{t.viewDesk}</Radio>
          <Radio value="list">{t.viewList}</Radio>
        </RadioGroup>
        <div className="app-menu__switches">
          <Switch isSelected={minimap} onChange={onMinimapChange}>
            {t.minimap}
          </Switch>
          <Switch isSelected={threads} onChange={(v) => store.toggleLinks(v)}>
            {t.threadsVisible}
          </Switch>
        </div>
      </div>
    </>
  );
}
