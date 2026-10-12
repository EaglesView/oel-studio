import type { Person } from '@oel/emboss';
import type { SettingsLayers, SettingValues } from './settings';

/** Figma N2 · four roles, given on the project. */
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface Member extends Person {
  role: Role;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  /** Always null in v1 (no « espaces » above projects); kept so the server column has a client twin. */
  spaceId: string | null;
  members: Member[];
  settings: Partial<SettingValues>;
  /** Per-file overrides (`docId` or paper id → values). */
  fileSettings: Record<string, Partial<SettingValues>>;
}

/** What the open project looks like from the current account. */
export interface ProjectContextValue {
  id: string;
  slug: string;
  name: string;
  role: Role;
  /** The current account as a member (« vous »). */
  me: Member;
  members: Member[];
  settings: SettingsLayers;
}

export type Action = 'edit' | 'comment' | 'note' | 'invite' | 'settings' | 'manage';

/**
 * Client guard: hides or disables what the role can't do. The server checks
 * the same rules on every route (N-3); this is only for the UI.
 * Commenters can write notes now (comments come later).
 */
export function can(role: Role, action: Action, whoCanInvite: SettingValues['sharing.whoCanInvite'] = 'editors'): boolean {
  switch (action) {
    case 'edit':
      return role === 'owner' || role === 'editor';
    case 'comment':
    case 'note':
      return role !== 'viewer';
    case 'invite':
      return role === 'owner' || (whoCanInvite === 'editors' && role === 'editor') || (whoCanInvite === 'everyone');
    case 'settings':
    case 'manage':
      return role === 'owner';
  }
}

/** « Bonjour, J. » / « vous »: a member's short name, without the « (vous) » suffix. */
export function firstName(m: Person): string {
  return m.name.replace(/\s*\(vous\)$/, '').split(' ')[0]!;
}
