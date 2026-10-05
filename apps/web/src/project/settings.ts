/**
 * Project settings (Figma N3): one typed schema, resolved through the cascade
 * OEL defaults → account → project → file (N0). The settings screen (N-5)
 * renders from `SETTINGS` and `SECTIONS`, so labels live here, in fr-CA.
 */

export type Scope = 'account' | 'project' | 'file';

/** Settings layers, most specific last in the cascade. */
export interface SettingsLayers {
  account?: Partial<SettingValues>;
  project?: Partial<SettingValues>;
  file?: Partial<SettingValues>;
}

export type SectionId = 'sharing' | 'collaboration' | 'appearance' | 'import' | 'forms' | 'notifications';

export const SECTIONS: Record<SectionId, string> = {
  sharing: 'Invitations et partage',
  collaboration: 'Collaboration',
  appearance: 'Apparence et valeurs par défaut',
  import: 'Import',
  forms: 'Formulaires',
  notifications: 'Notifications',
};

interface Base<T> {
  section: SectionId;
  label: string;
  default: T;
  /** Layers allowed to set it; every key can be set on the project. */
  scopes: readonly Scope[];
}

export interface ChoiceSetting<T extends string = string> extends Base<T> {
  type: 'choice';
  options: Record<T, string>;
}
export interface BoolSetting extends Base<boolean> {
  type: 'bool';
}
export interface NumberSetting extends Base<number> {
  type: 'number';
  min: number;
  max: number;
  unit: string;
}
export interface ListSetting extends Base<string[]> {
  type: 'list';
  placeholder: string;
}

const choice = <T extends string>(s: Omit<ChoiceSetting<T>, 'type'>): ChoiceSetting<T> => ({ type: 'choice', ...s });
const bool = (s: Omit<BoolSetting, 'type'>): BoolSetting => ({ type: 'bool', ...s });
const num = (s: Omit<NumberSetting, 'type'>): NumberSetting => ({ type: 'number', ...s });
const list = (s: Omit<ListSetting, 'type'>): ListSetting => ({ type: 'list', ...s });

const PROJECT_ONLY = ['project'] as const;
const ACCOUNT_PROJECT = ['account', 'project'] as const;
const ALL = ['account', 'project', 'file'] as const;

export const ROLE_LABEL = {
  owner: 'Propriétaire',
  editor: 'Éditeur',
  commenter: 'Commentateur',
  viewer: 'Lecteur',
} as const;

export const SETTINGS = {
  // Invitations et partage
  'sharing.whoCanInvite': choice({
    section: 'sharing',
    label: 'Qui peut inviter',
    default: 'editors',
    scopes: PROJECT_ONLY,
    options: { owners: 'Propriétaires seulement', editors: 'Propriétaires et éditeurs', everyone: 'Tous les membres' },
  }),
  'sharing.defaultRole': choice({
    section: 'sharing',
    label: 'Rôle par défaut des invités',
    default: 'editor',
    scopes: PROJECT_ONLY,
    options: { editor: ROLE_LABEL.editor, commenter: ROLE_LABEL.commenter, viewer: ROLE_LABEL.viewer },
  }),
  'sharing.link': choice({
    section: 'sharing',
    label: 'Lien de partage',
    default: 'viewer',
    scopes: PROJECT_ONLY,
    options: { off: 'Désactivé', viewer: 'Lecture', commenter: 'Commentaires', editor: 'Modification' },
  }),
  'sharing.linkExpiryDays': num({ section: 'sharing', label: 'Expiration du lien', default: 30, min: 0, max: 365, unit: 'jours (0 : jamais)', scopes: PROJECT_ONLY }),
  'sharing.allowedDomains': list({ section: 'sharing', label: 'Domaines autorisés', default: [], placeholder: 'exemple.ca', scopes: PROJECT_ONLY }),
  'sharing.accessRequests': bool({ section: 'sharing', label: 'Accepter les demandes d’accès', default: true, scopes: PROJECT_ONLY }),
  'sharing.mentionOutsiders': bool({ section: 'sharing', label: 'Mentionner des personnes hors du projet', default: false, scopes: PROJECT_ONLY }),
  // Collaboration
  'collab.presence': bool({ section: 'collaboration', label: 'Montrer qui est sur le bureau', default: true, scopes: ACCOUNT_PROJECT }),
  'collab.historyDays': num({ section: 'collaboration', label: 'Conserver l’historique des versions', default: 90, min: 7, max: 3650, unit: 'jours', scopes: PROJECT_ONLY }),
  // Apparence et valeurs par défaut
  'appearance.theme': choice({
    section: 'appearance',
    label: 'Thème des fichiers',
    default: 'oel',
    scopes: ALL,
    options: { oel: 'OutilsEnLigne', sobre: 'Sobre', contraste: 'Contrasté' },
  }),
  'appearance.accent': choice({
    section: 'appearance',
    label: 'Couleur d’accent',
    default: 'primary',
    scopes: ALL,
    options: { primary: 'Bleu', success: 'Vert', warning: 'Ambre', danger: 'Rouge' },
  }),
  'appearance.headingFont': choice({
    section: 'appearance',
    label: 'Police des titres',
    default: 'Montserrat',
    scopes: ALL,
    options: { Montserrat: 'Montserrat', Georgia: 'Georgia', Arial: 'Arial' },
  }),
  'appearance.language': choice({
    section: 'appearance',
    label: 'Langue des fichiers',
    default: 'fr-CA',
    scopes: ALL,
    options: { 'fr-CA': 'Français (Canada)', 'en-CA': 'Anglais (Canada)' },
  }),
  'appearance.numberFormat': choice({
    section: 'appearance',
    label: 'Format des nombres',
    default: 'fr-CA',
    scopes: ALL,
    options: { 'fr-CA': '1 234,56', 'en-CA': '1,234.56' },
  }),
  'appearance.dateFormat': choice({
    section: 'appearance',
    label: 'Format des dates',
    default: 'iso',
    scopes: ALL,
    options: { iso: '2026-10-05', long: '5 octobre 2026' },
  }),
  'appearance.pageSize': choice({
    section: 'appearance',
    label: 'Format de page',
    default: 'letter',
    scopes: ALL,
    options: { letter: 'Lettre (8,5 × 11 po)', legal: 'Légal (8,5 × 14 po)', a4: 'A4' },
  }),
  'appearance.slideRatio': choice({
    section: 'appearance',
    label: 'Format des présentations',
    default: '16:9',
    scopes: ALL,
    options: { '16:9': '16:9', '4:3': '4:3' },
  }),
  // Import (the old « À l’arrivée » rules)
  'import.sortByType': bool({ section: 'import', label: 'Ranger aussi les fichiers qui arrivent (par type)', default: false, scopes: ACCOUNT_PROJECT }),
  'import.ocr': bool({ section: 'import', label: 'Convertir les PDF numérisés (OCR)', default: true, scopes: ACCOUNT_PROJECT }),
  'import.linkTables': bool({ section: 'import', label: 'Lier les tableaux importés', default: true, scopes: ACCOUNT_PROJECT }),
  // Formulaires
  'forms.signIn': choice({
    section: 'forms',
    label: 'Connexion des répondants',
    default: 'optional',
    scopes: ['project', 'file'],
    options: { none: 'Aucune', optional: 'Facultative', required: 'Obligatoire' },
  }),
  // Notifications
  'notifications.mentions': choice({
    section: 'notifications',
    label: 'Mentions',
    default: 'instant',
    scopes: ACCOUNT_PROJECT,
    options: { instant: 'Tout de suite', daily: 'Résumé quotidien', off: 'Jamais' },
  }),
} satisfies Record<string, ChoiceSetting | BoolSetting | NumberSetting | ListSetting>;

export type SettingKey = keyof typeof SETTINGS;
type Def<K extends SettingKey> = (typeof SETTINGS)[K];
export type SettingValue<K extends SettingKey> =
  Def<K> extends ChoiceSetting<infer T> ? T : Def<K> extends BoolSetting ? boolean : Def<K> extends NumberSetting ? number : string[];
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export interface Resolved<K extends SettingKey> {
  value: SettingValue<K>;
  /** Which layer the value comes from (`default` = OEL). A file layer shows « … propre à ce fichier ». */
  from: Scope | 'default';
}

/** Whether `value` is a valid value for `key` (stored layers may be stale or hand-edited). */
export function isValid<K extends SettingKey>(key: K, value: unknown): value is SettingValue<K> {
  const def = SETTINGS[key] as ChoiceSetting | BoolSetting | NumberSetting | ListSetting;
  switch (def.type) {
    case 'choice':
      return typeof value === 'string' && value in def.options;
    case 'bool':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= def.min && value <= def.max;
    case 'list':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
  }
}

/** File → project → account → OEL default; a layer only counts where the key allows that scope. */
export function resolveSetting<K extends SettingKey>(key: K, layers: SettingsLayers): Resolved<K> {
  const scopes: readonly Scope[] = SETTINGS[key].scopes;
  for (const scope of ['file', 'project', 'account'] as const) {
    if (!scopes.includes(scope)) continue;
    const v = layers[scope]?.[key];
    if (v !== undefined && isValid(key, v)) return { value: v, from: scope };
  }
  return { value: SETTINGS[key].default as SettingValue<K>, from: 'default' };
}

export function settingKeys(section: SectionId): SettingKey[] {
  return (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].section === section);
}
