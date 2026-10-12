import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createLocalProjectsBackend, type ProjectsBackend, type SettingTarget } from './backend';
import { features } from '../edition';
import type { Project, ProjectContextValue } from './model';
import { resolveSetting, type Resolved, type SettingKey, type SettingValue, type SettingValues } from './settings';
import { tr } from '@oel/i18n';

let backend: ProjectsBackend | null = null;

/**
 * The projects backend for this app (browser only).
 * TODO(backend): swap the local stub for the accounts service (restructure Phase 5, plan N-3).
 */
export function projectsBackend(): ProjectsBackend {
  backend ??= createLocalProjectsBackend({ solo: !features.projects });
  return backend;
}

interface State {
  ctx: ProjectContextValue;
  fileSettings: Project['fileSettings'];
}

const Ctx = createContext<(State & { backend: ProjectsBackend }) | null>(null);

/**
 * Names the local backend seeds in French (`backend.ts`), shown in the interface language as long
 * as nobody renamed them: the seed is written once, before the person picks a language.
 */
const SEEDED: Record<string, string> = {
  'Mon bureau': tr('Mon bureau', 'My desk'),
  'Lancement automne 2026': tr('Lancement automne 2026', 'Fall 2026 launch'),
  Vous: tr('Vous', 'You'),
};
const shown = <T extends { name: string }>(x: T): T => (SEEDED[x.name] ? { ...x, name: SEEDED[x.name]! } : x);

async function loadState(b: ProjectsBackend, projectId?: string): Promise<State> {
  const id = projectId ?? (await b.currentProjectId());
  const [stored, account] = await Promise.all([b.getProject(id), b.accountSettings()]);
  if (!stored) throw new Error(tr(`Projet introuvable : ${id}`, `Project not found: ${id}`));
  const p = { ...shown(stored), members: stored.members.map(shown) };
  const me = p.members.find((m) => m.id === b.accountId());
  if (!me) throw new Error(tr(`Vous n’êtes pas membre de « ${p.name} ».`, `You are not a member of “${p.name}”.`));
  return {
    ctx: { id: p.id, slug: p.slug, name: p.name, role: me.role, me, members: p.members, settings: { account, project: p.settings } },
    fileSettings: p.fileSettings,
  };
}

/** Loads the open project (`projectId`, or the last opened one) and keeps it current. Renders nothing until then. */
export function ProjectProvider({ projectId, backend: b = projectsBackend(), children }: { projectId?: string; backend?: ProjectsBackend; children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    let live = true;
    const reload = () => void loadState(b, projectId).then((s) => live && setState(s));
    reload();
    const off = b.subscribe(reload);
    return () => {
      live = false;
      off();
    };
  }, [b, projectId]);
  if (!state) return null;
  return <Ctx.Provider value={{ ...state, backend: b }}>{children}</Ctx.Provider>;
}

function useCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProject() needs a <ProjectProvider> above it.');
  return c;
}

export function useProject(): ProjectContextValue {
  return useCtx().ctx;
}

/**
 * A setting resolved file → project → account → OEL default, with the layer it
 * came from, and a setter for one layer (the project's by default).
 */
export function useSetting<K extends SettingKey>(
  key: K,
  opts: { fileId?: string } = {},
): Resolved<K> & { set: (value: SettingValue<K> | undefined, scope?: SettingTarget['scope']) => Promise<void> } {
  const { ctx, fileSettings, backend: b } = useCtx();
  const file: Partial<SettingValues> | undefined = opts.fileId ? fileSettings[opts.fileId] : undefined;
  const resolved = resolveSetting(key, { ...ctx.settings, file });
  const set = useCallback(
    (value: SettingValue<K> | undefined, scope: SettingTarget['scope'] = 'project') => {
      const target: SettingTarget =
        scope === 'account' ? { scope } : scope === 'project' ? { scope, projectId: ctx.id } : { scope, projectId: ctx.id, fileId: opts.fileId ?? '' };
      if (target.scope === 'file' && !target.fileId) return Promise.reject(new Error('useSetting: a file setting needs `fileId`.'));
      return b.setSetting(target, key, value);
    },
    [b, ctx.id, key, opts.fileId],
  );
  return { ...resolved, set };
}
