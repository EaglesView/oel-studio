import { tr } from '@oel/i18n';
/**
 * Project settings (Figma N3): one typed schema, resolved through the cascade
 * OEL defaults → account → project → file (N0). The settings screen (N-5)
 * renders from `SETTINGS` and `SECTIONS`, so labels live here, in French and English (`tr`).
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
  sharing: tr('Invitations et partage', 'Invitations and sharing'),
  collaboration: 'Collaboration',
  appearance: tr('Apparence et valeurs par défaut', 'Appearance and defaults'),
  import: 'Import',
  forms: tr('Formulaires', 'Forms'),
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
  owner: tr('Propriétaire', 'Owner'),
  editor: tr('Éditeur', 'Editor'),
  commenter: tr('Commentateur', 'Commenter'),
  viewer: tr('Lecteur', 'Viewer'),
} as const;

export const SETTINGS = {
  // Invitations et partage
  'sharing.whoCanInvite': choice({
    section: 'sharing',
    label: tr('Qui peut inviter', 'Who can invite'),
    default: 'editors',
    scopes: PROJECT_ONLY,
    options: { owners: tr('Propriétaires seulement', 'Owners only'), editors: tr('Propriétaires et éditeurs', 'Owners and editors'), everyone: tr('Tous les membres', 'All members') },
  }),
  'sharing.defaultRole': choice({
    section: 'sharing',
    label: tr('Rôle par défaut des invités', 'Default role for guests'),
    default: 'editor',
    scopes: PROJECT_ONLY,
    options: { editor: ROLE_LABEL.editor, commenter: ROLE_LABEL.commenter, viewer: ROLE_LABEL.viewer },
  }),
  'sharing.link': choice({
    section: 'sharing',
    label: tr('Lien de partage', 'Share link'),
    default: 'viewer',
    scopes: PROJECT_ONLY,
    options: { off: tr('Désactivé', 'Off'), viewer: tr('Lecture', 'View'), commenter: tr('Commentaires', 'Comments'), editor: tr('Modification', 'Edit') },
  }),
  'sharing.linkExpiryDays': num({ section: 'sharing', label: tr('Expiration du lien', 'Link expiry'), default: 30, min: 0, max: 365, unit: tr('jours (0 : jamais)', 'days (0: never)'), scopes: PROJECT_ONLY }),
  'sharing.allowedDomains': list({ section: 'sharing', label: tr('Domaines autorisés', 'Allowed domains'), default: [], placeholder: tr('exemple.ca', 'example.ca'), scopes: PROJECT_ONLY }),
  'sharing.accessRequests': bool({ section: 'sharing', label: tr('Accepter les demandes d’accès', 'Accept access requests'), default: true, scopes: PROJECT_ONLY }),
  'sharing.mentionOutsiders': bool({ section: 'sharing', label: tr('Mentionner des personnes hors du projet', 'Mention people outside the project'), default: false, scopes: PROJECT_ONLY }),
  // Collaboration
  'collab.presence': bool({ section: 'collaboration', label: tr('Montrer qui est sur le bureau', 'Show who is on the desk'), default: true, scopes: ACCOUNT_PROJECT }),
  'collab.historyDays': num({ section: 'collaboration', label: tr('Conserver l’historique des versions', 'Keep version history'), default: 90, min: 7, max: 3650, unit: tr('jours', 'days'), scopes: PROJECT_ONLY }),
  // Apparence et valeurs par défaut
  'appearance.theme': choice({
    section: 'appearance',
    label: tr('Thème des fichiers', 'File theme'),
    default: 'oel',
    scopes: ALL,
    options: { oel: 'OutilsEnLigne', sobre: tr('Sobre', 'Plain'), contraste: tr('Contrasté', 'High contrast') },
  }),
  'appearance.accent': choice({
    section: 'appearance',
    label: tr('Couleur d’accent', 'Accent colour'),
    default: 'primary',
    scopes: ALL,
    options: { primary: tr('Bleu', 'Blue'), success: tr('Vert', 'Green'), warning: tr('Ambre', 'Amber'), danger: tr('Rouge', 'Red') },
  }),
  'appearance.headingFont': choice({
    section: 'appearance',
    label: tr('Police des titres', 'Heading font'),
    default: 'Montserrat',
    scopes: ALL,
    options: { Montserrat: 'Montserrat', Georgia: 'Georgia', Arial: 'Arial' },
  }),
  'appearance.language': choice({
    section: 'appearance',
    label: tr('Langue des fichiers', 'File language'),
    default: 'fr-CA',
    scopes: ALL,
    options: { 'fr-CA': tr('Français (Canada)', 'French (Canada)'), 'en-CA': tr('Anglais (Canada)', 'English (Canada)') },
  }),
  'appearance.numberFormat': choice({
    section: 'appearance',
    label: tr('Format des nombres', 'Number format'),
    default: 'fr-CA',
    scopes: ALL,
    options: { 'fr-CA': '1 234,56', 'en-CA': '1,234.56' },
  }),
  'appearance.dateFormat': choice({
    section: 'appearance',
    label: tr('Format des dates', 'Date format'),
    default: 'iso',
    scopes: ALL,
    options: { iso: '2026-10-05', long: tr('5 octobre 2026', 'October 5, 2026') },
  }),
  'appearance.pageSize': choice({
    section: 'appearance',
    label: tr('Format de page', 'Page size'),
    default: 'letter',
    scopes: ALL,
    options: { letter: tr('Lettre (8,5 × 11 po)', 'Letter (8.5 × 11 in)'), legal: tr('Légal (8,5 × 14 po)', 'Legal (8.5 × 14 in)'), a4: 'A4' },
  }),
  'appearance.slideRatio': choice({
    section: 'appearance',
    label: tr('Format des présentations', 'Presentation format'),
    default: '16:9',
    scopes: ALL,
    options: { '16:9': '16:9', '4:3': '4:3' },
  }),
  // Import (the old « À l’arrivée » rules)
  'import.sortByType': bool({ section: 'import', label: tr('Ranger aussi les fichiers qui arrivent (par type)', 'Also sort incoming files (by type)'), default: false, scopes: ACCOUNT_PROJECT }),
  'import.ocr': bool({ section: 'import', label: tr('Convertir les PDF numérisés (OCR)', 'Convert scanned PDFs (OCR)'), default: true, scopes: ACCOUNT_PROJECT }),
  'import.linkTables': bool({ section: 'import', label: tr('Lier les tableaux importés', 'Link imported tables'), default: true, scopes: ACCOUNT_PROJECT }),
  // Formulaires
  'forms.signIn': choice({
    section: 'forms',
    label: tr('Connexion des répondants', 'Respondent sign-in'),
    default: 'optional',
    scopes: ['project', 'file'],
    options: { none: tr('Aucune', 'None'), optional: tr('Facultative', 'Optional'), required: tr('Obligatoire', 'Required') },
  }),
  // Notifications
  'notifications.mentions': choice({
    section: 'notifications',
    label: 'Mentions',
    default: 'instant',
    scopes: ACCOUNT_PROJECT,
    options: { instant: tr('Tout de suite', 'Right away'), daily: tr('Résumé quotidien', 'Daily summary'), off: tr('Jamais', 'Never') },
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
