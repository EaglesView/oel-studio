import type { Member, Project, Role } from './model';
import { isValid, SETTINGS, type Scope, type SettingKey, type SettingValue, type SettingValues } from './settings';

/**
 * What the app needs from the projects service (Figma N). The UI depends only
 * on this interface; `createLocalProjectsBackend` stands in for the server.
 */
export interface ProjectsBackend {
  /** The signed-in account (its id is a member id in each project). */
  accountId(): string;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  /** The project to open on `/bureau` (last opened). */
  currentProjectId(): Promise<string>;
  accountSettings(): Promise<Partial<SettingValues>>;
  /** `value: undefined` clears the layer's value (falls back to the next layer). */
  setSetting<K extends SettingKey>(target: SettingTarget, key: K, value: SettingValue<K> | undefined): Promise<void>;
  /** Called after any change, from this tab or another one. */
  subscribe(listener: () => void): () => void;
}

export type SettingTarget = { scope: 'account' } | { scope: 'project'; projectId: string } | { scope: 'file'; projectId: string; fileId: string };

export class ProjectsError extends Error {}

export interface LocalProjectsOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Other tabs' changes; omit outside the browser. */
  channel?: Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener'> | null;
}

const KEY = 'oel-projects:v1';
const ME = 'jb';

/** The demo project the Bureau has always shown (seed papers); « Mon bureau » is the account's own. */
const DEMO_MEMBERS: Member[] = [
  { id: 'jb', name: 'J. Bouchard (vous)', initials: 'JB', color: 'var(--emboss-fill-primary)', role: 'owner' },
  { id: 'mc', name: 'Marie-Claude', initials: 'MC', color: 'var(--emboss-success)', role: 'editor' },
  { id: 'al', name: 'Alex', initials: 'AL', color: 'var(--emboss-warning)', role: 'commenter' },
];

interface Stored {
  projects: Project[];
  current: string;
  account: Partial<SettingValues>;
}

function seed(): Stored {
  const project = (id: string, slug: string, name: string, members: Member[]): Project => ({
    id,
    slug,
    name,
    spaceId: null,
    members,
    settings: {},
    fileSettings: {},
  });
  return {
    projects: [
      project('demo', 'lancement-automne-2026', 'Lancement automne 2026', DEMO_MEMBERS),
      project('mon-bureau', 'mon-bureau', 'Mon bureau', [DEMO_MEMBERS[0]!]),
    ],
    current: 'demo',
    account: {},
  };
}

/**
 * In-browser stand-in for the projects server: everything in localStorage,
 * changes broadcast to other tabs. Nothing here is checked —
 * TODO(backend): projects, members and settings come from `domains/accounts`
 * (restructure Phase 5) and every write is checked against the member's role (N-3).
 */
export function createLocalProjectsBackend(opts: LocalProjectsOptions = {}): ProjectsBackend {
  const storage = opts.storage ?? globalThis.localStorage;
  const channel = opts.channel === undefined && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('oel-projects') : (opts.channel ?? null);
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  channel?.addEventListener('message', emit);

  const load = (): Stored => {
    try {
      const raw = storage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Stored;
    } catch {
      // Corrupt or blocked storage: start again from the seed.
    }
    const s = seed();
    save(s);
    return s;
  };
  function save(s: Stored) {
    try {
      storage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Private window or full storage: keep working for this page.
    }
  }
  const role = (p: Project): Role | null => p.members.find((m) => m.id === ME)?.role ?? null;

  return {
    accountId: () => ME,
    async listProjects() {
      return load().projects.filter((p) => role(p));
    },
    async getProject(id) {
      return load().projects.find((p) => p.id === id && role(p)) ?? null;
    },
    async currentProjectId() {
      return load().current;
    },
    async accountSettings() {
      return load().account;
    },
    async setSetting(target, key, value) {
      const scopes: readonly Scope[] = SETTINGS[key].scopes;
      if (!scopes.includes(target.scope)) throw new ProjectsError(`« ${SETTINGS[key].label} » ne se règle pas à ce niveau.`);
      if (value !== undefined && !isValid(key, value)) throw new ProjectsError(`Valeur invalide pour « ${SETTINGS[key].label} ».`);
      const s = load();
      let layer: Partial<SettingValues>;
      if (target.scope === 'account') layer = s.account;
      else {
        const p = s.projects.find((x) => x.id === target.projectId);
        if (!p) throw new ProjectsError('Projet introuvable.');
        // TODO(backend): the server refuses this for non-owners (N-3); the client guard only hides the controls.
        if (role(p) !== 'owner' && target.scope === 'project') throw new ProjectsError('Seuls les propriétaires règlent le projet.');
        layer = target.scope === 'project' ? p.settings : (p.fileSettings[target.fileId] ??= {});
      }
      if (value === undefined) delete layer[key];
      else (layer as Record<string, unknown>)[key] = value;
      save(s);
      channel?.postMessage('changed');
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
