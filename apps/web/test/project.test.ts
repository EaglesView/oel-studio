import { describe, expect, it } from 'vitest';
import { createLocalProjectsBackend, ProjectsError } from '../src/project/backend';
import { can } from '../src/project/model';
import { isValid, resolveSetting, SECTIONS, SETTINGS, type SettingKey } from '../src/project/settings';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('setting resolution', () => {
  it('falls back to the OEL default', () => {
    expect(resolveSetting('appearance.pageSize', {})).toEqual({ value: 'letter', from: 'default' });
  });

  it('goes file → project → account', () => {
    const layers = { account: { 'appearance.pageSize': 'a4' as const } };
    expect(resolveSetting('appearance.pageSize', layers)).toEqual({ value: 'a4', from: 'account' });
    const withProject = { ...layers, project: { 'appearance.pageSize': 'legal' as const } };
    expect(resolveSetting('appearance.pageSize', withProject)).toEqual({ value: 'legal', from: 'project' });
    const withFile = { ...withProject, file: { 'appearance.pageSize': 'letter' as const } };
    expect(resolveSetting('appearance.pageSize', withFile)).toEqual({ value: 'letter', from: 'file' });
  });

  it('ignores layers a key does not allow', () => {
    // Sharing is a project rule: an account or file value never applies.
    const layers = { account: { 'sharing.linkExpiryDays': 7 }, file: { 'sharing.linkExpiryDays': 1 } };
    expect(resolveSetting('sharing.linkExpiryDays', layers)).toEqual({ value: 30, from: 'default' });
  });

  it('skips stale or invalid stored values', () => {
    const layers = { project: { 'appearance.pageSize': 'tabloid' } } as never;
    expect(resolveSetting('appearance.pageSize', layers).from).toBe('default');
    expect(isValid('collab.historyDays', 1)).toBe(false);
    expect(isValid('sharing.allowedDomains', ['exemple.ca'])).toBe(true);
  });

  it('gives every key a valid default and a known section', () => {
    for (const k of Object.keys(SETTINGS) as SettingKey[]) {
      expect(isValid(k, SETTINGS[k].default), k).toBe(true);
      expect(SECTIONS[SETTINGS[k].section], k).toBeTruthy();
      expect(SETTINGS[k].scopes, k).toContain('project');
    }
  });
});

describe('client role guard', () => {
  it('follows the four roles', () => {
    expect(can('owner', 'settings')).toBe(true);
    expect(can('editor', 'settings')).toBe(false);
    expect(can('editor', 'edit')).toBe(true);
    expect(can('commenter', 'edit')).toBe(false);
    expect(can('commenter', 'note')).toBe(true);
    expect(can('viewer', 'note')).toBe(false);
  });

  it('applies « Qui peut inviter »', () => {
    expect(can('editor', 'invite', 'editors')).toBe(true);
    expect(can('editor', 'invite', 'owners')).toBe(false);
    expect(can('viewer', 'invite', 'everyone')).toBe(true);
    expect(can('owner', 'invite', 'owners')).toBe(true);
  });
});

describe('local projects backend', () => {
  it('seeds the demo project and « Mon bureau »', async () => {
    const b = createLocalProjectsBackend({ storage: memoryStorage(), channel: null });
    const projects = await b.listProjects();
    expect(projects.map((p) => p.name)).toEqual(['Lancement automne 2026', 'Mon bureau']);
    const demo = await b.getProject(await b.currentProjectId());
    expect(demo?.members.find((m) => m.id === b.accountId())?.role).toBe('owner');
  });

  it('stores each layer and notifies', async () => {
    const storage = memoryStorage();
    const b = createLocalProjectsBackend({ storage, channel: null });
    let changes = 0;
    b.subscribe(() => changes++);
    await b.setSetting({ scope: 'project', projectId: 'demo' }, 'import.ocr', false);
    await b.setSetting({ scope: 'file', projectId: 'demo', fileId: 'p1' }, 'appearance.theme', 'sobre');
    await b.setSetting({ scope: 'account' }, 'appearance.pageSize', 'a4');
    expect(changes).toBe(3);
    // A second instance on the same storage (another tab) sees the same values.
    const again = createLocalProjectsBackend({ storage, channel: null });
    const p = await again.getProject('demo');
    expect(p?.settings['import.ocr']).toBe(false);
    expect(p?.fileSettings.p1?.['appearance.theme']).toBe('sobre');
    expect((await again.accountSettings())['appearance.pageSize']).toBe('a4');
    await b.setSetting({ scope: 'project', projectId: 'demo' }, 'import.ocr', undefined);
    expect((await b.getProject('demo'))?.settings).not.toHaveProperty('import.ocr');
  });

  it('refuses a scope or value the schema does not allow', async () => {
    const b = createLocalProjectsBackend({ storage: memoryStorage(), channel: null });
    await expect(b.setSetting({ scope: 'file', projectId: 'demo', fileId: 'p1' }, 'sharing.link', 'off')).rejects.toBeInstanceOf(ProjectsError);
    await expect(b.setSetting({ scope: 'project', projectId: 'demo' }, 'collab.historyDays', 1)).rejects.toBeInstanceOf(ProjectsError);
  });
});

describe('single-user edition (plan solo MVP, S-5)', () => {
  it('has one project, « Mon bureau », and you alone in it, apart from the team demo', async () => {
    const storage = memoryStorage();
    const solo = createLocalProjectsBackend({ storage, channel: null, solo: true });
    expect(await solo.currentProjectId()).toBe('mon-bureau');
    const projects = await solo.listProjects();
    expect(projects.map((p) => p.name)).toEqual(['Mon bureau']);
    expect(projects[0]!.members).toEqual([expect.objectContaining({ id: solo.accountId(), name: 'Vous', role: 'owner' })]);
    const team = createLocalProjectsBackend({ storage, channel: null });
    expect((await team.listProjects()).length).toBeGreaterThan(1);
  });
});
