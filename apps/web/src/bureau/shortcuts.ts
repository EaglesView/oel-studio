/**
 * Every shortcut, grouped (B3 · « Clavier d’abord »): the Bureau's « ? » dialog and the menu's
 * « Raccourcis clavier » in French, the site's keyboard page (/docs/clavier, /en/docs/keyboard) in
 * both languages. One list, so they never drift apart.
 */
export type Lang = 'fr' | 'en';

interface Row {
  keys: string[];
  fr: string;
  en: string;
}

const GROUPS: Array<{ fr: string; en: string; rows: Row[] }> = [
  {
    fr: 'Sur le bureau',
    en: 'On the desk',
    rows: [
      { keys: ['←', '↑', '→', '↓'], fr: 'Passer au fichier voisin', en: 'Move to the next file' },
      { keys: ['Espace'], fr: 'Ajouter ou retirer de la sélection', en: 'Add to or remove from the selection' },
      { keys: ['Ctrl', 'A'], fr: 'Tout sélectionner', en: 'Select all' },
      { keys: ['Entrée'], fr: 'Ouvrir sur place', en: 'Open in place' },
      { keys: ['Échap'], fr: 'Désélectionner · reposer le fichier ouvert', en: 'Deselect · put the open file back' },
      { keys: ['Alt', '← ↑ → ↓'], fr: 'Déplacer la sélection (Maj : plus loin)', en: 'Move the selection (Shift: further)' },
      { keys: ['Alt', '= · −'], fr: 'Agrandir · réduire la sélection (Maj : plus) — ou tirer ses poignées', en: 'Enlarge · shrink the selection (Shift: more) — or drag its handles' },
      { keys: ['Maj', '← ↑ → ↓'], fr: 'Faire défiler le bureau', en: 'Scroll the desk' },
      { keys: ['Suppr'], fr: 'Retirer du bureau (annulable)', en: 'Remove from the desk (can be undone)' },
      { keys: ['Ctrl', 'Z'], fr: 'Annuler · Ctrl+Maj+Z rétablir', en: 'Undo · Ctrl+Shift+Z redo' },
    ],
  },
  {
    fr: 'Vue',
    en: 'View',
    rows: [
      { keys: ['+', '−'], fr: 'Zoom avant · arrière (arrière : jusqu’à 25 %)', en: 'Zoom in · out (out: down to 25 %)' },
      { keys: ['0'], fr: 'Revenir à 100 %', en: 'Back to 100 %' },
      { keys: ['Ctrl', 'molette'], fr: 'Zoom au pointeur · molette seule : défiler', en: 'Zoom at the pointer · wheel alone: scroll' },
      { keys: ['Espace', 'glisser'], fr: 'Déplacer la vue à la souris', en: 'Move the view with the mouse' },
    ],
  },
  {
    fr: 'Outils',
    en: 'Tools',
    rows: [
      { keys: ['/'], fr: 'Aller aux outils de la sélection', en: 'Go to the selection’s tools' },
      { keys: ['N'], fr: 'Nouvelle note', en: 'New note' },
      { keys: ['P'], fr: 'Note : coller au fichier dessous · décoller', en: 'Note: stick to the file underneath · unstick' },
      { keys: ['Maj', 'P'], fr: 'Note : « Coller à… » (Tab, Entrée, Échap)', en: 'Note: “Stick to…” (Tab, Enter, Esc)' },
      { keys: ['Alt', 'glisser'], fr: 'Lâcher une note sur un fichier pour l’y coller', en: 'Drop a note on a file to stick it there' },
      { keys: ['Ctrl', 'O'], fr: 'Importer des fichiers', en: 'Import files' },
      { keys: ['Alt', 'N'], fr: 'Nouveau fichier (menu « + »)', en: 'New file (“+” menu)' },
      { keys: ['Ctrl', 'Maj', 'L'], fr: 'Fils du bureau', en: 'Desk threads' },
      { keys: ['Maj', 'F10'], fr: 'Menu contextuel', en: 'Context menu' },
      { keys: ['Ctrl', 'Maj', 'Entrée'], fr: 'Ouvrir la sélection en plein écran', en: 'Open the selection full screen' },
      { keys: ['?'], fr: 'Afficher cette aide', en: 'Show this help' },
    ],
  },
  {
    fr: 'Fichier ouvert',
    en: 'Open file',
    rows: [
      { keys: ['Échap'], fr: 'Un niveau à la fois : termine l’action en cours, puis plein écran → sur place → bureau', en: 'One level at a time: ends what is in progress, then full screen → in place → desk' },
      { keys: ['Ctrl', 'Maj', 'Entrée'], fr: 'Agrandir en plein écran · réduire', en: 'Expand to full screen · reduce' },
      { keys: ['Retour'], fr: 'Le bouton Retour du navigateur fait comme Échap', en: 'The browser’s Back button does what Esc does' },
      { keys: ['Ctrl', 'Maj', 'F'], fr: 'Mode concentration (Alt ou bouger la souris : outils visibles)', en: 'Focus mode (Alt or moving the mouse shows the tools)' },
      { keys: ['Ctrl', 'Maj', 'P'], fr: 'Plan du document', en: 'Document outline' },
    ],
  },
  {
    fr: 'Document',
    en: 'Document',
    rows: [
      { keys: ['Ctrl', 'B · I · U'], fr: 'Gras · italique · souligné', en: 'Bold · italic · underline' },
      { keys: ['Ctrl', 'Alt', '1–6'], fr: 'Titres · Ctrl+Alt+0 texte normal', en: 'Headings · Ctrl+Alt+0 normal text' },
      { keys: ['Ctrl', 'Maj', '7 · 8 · 9'], fr: 'Liste numérotée · à puces · de contrôle', en: 'Numbered · bulleted · check list' },
      { keys: ['Ctrl', 'K'], fr: 'Lien', en: 'Link' },
      { keys: ['Ctrl', 'Entrée'], fr: 'Saut de page', en: 'Page break' },
      { keys: ['Ctrl', 'Alt', 'F'], fr: 'Note de bas de page', en: 'Footnote' },
      { keys: ['Ctrl', 'F · H'], fr: 'Rechercher · remplacer', en: 'Find · replace' },
      { keys: ['Ctrl', '\\'], fr: 'Effacer la mise en forme', en: 'Clear formatting' },
      { keys: ['Ctrl', 'Maj', 'C'], fr: 'Nombre de mots', en: 'Word count' },
    ],
  },
];

/** Key names in English (the French list writes them as French keyboards and guides do). */
const KEY_EN: Record<string, string> = {
  Entrée: 'Enter',
  Échap: 'Esc',
  Maj: 'Shift',
  Espace: 'Space',
  Suppr: 'Delete',
  molette: 'wheel',
  glisser: 'drag',
  Retour: 'Back',
};

export interface ShortcutGroup {
  title: string;
  rows: Array<{ keys: string[]; what: string }>;
}

export function shortcutGroups(lang: Lang = 'fr'): ShortcutGroup[] {
  return GROUPS.map((g) => ({
    title: g[lang],
    rows: g.rows.map((r) => ({ keys: lang === 'fr' ? r.keys : r.keys.map((k) => KEY_EN[k] ?? k), what: r[lang] })),
  }));
}
