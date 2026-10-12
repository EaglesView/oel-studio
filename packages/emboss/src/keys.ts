import { lang } from '@oel/i18n';

/** French key names, as French keyboards and guides write them, and their English names. */
const KEY_EN: Record<string, string> = {
  Entrée: 'Enter',
  Échap: 'Esc',
  Maj: 'Shift',
  Espace: 'Space',
  Suppr: 'Delete',
  Retour: 'Back',
  'Retour arrière': 'Backspace',
  Inser: 'Insert',
  Début: 'Home',
  Fin: 'End',
  'Pg préc': 'PgUp',
  'Pg suiv': 'PgDn',
  Tab: 'Tab',
  molette: 'wheel',
  glisser: 'drag',
  clic: 'click',
};
const WORDS = new RegExp(
  `(^|[\\s+·])(${Object.keys(KEY_EN)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?=$|[\\s+·])`,
  'g',
);

/**
 * A shortcut's keys as the interface shows them: shortcuts are written once with French key names
 * (« Ctrl+Maj+L », « Échap »), which become « Ctrl+Shift+L », « Esc » in English.
 */
export function keyLabel(keys: string): string {
  if (lang() !== 'en') return keys;
  return keys.replace(WORDS, (_, before: string, word: string) => before + KEY_EN[word]);
}
