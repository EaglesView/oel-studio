import type { DeskLink } from '@oel/desk';
import type { Paper } from './model';

/** The desk from Figma "B1 · Anatomie du bureau" (83:1063), in world units. */
export const SEED_PAPERS: Paper[] = [
  {
    id: 'communique',
    kind: 'document',
    title: 'OutilsEnLigne lance son éditeur multimodal',
    x: 120,
    y: 170,
    w: 420,
    h: 594,
    rotation: 0,
    data: {
      eyebrow: 'Communiqué',
      editor: 'JB',
      comments: [{ id: 'c1', author: 'Marie-Claude', text: 'On cite le chiffre de la diapo 4 ?' }],
      status: { state: 'ready' },
      preview: {
        kind: 'document',
        wordCount: 412,
        pageCount: 2,
        blocks: [
          { type: 'heading', text: 'OutilsEnLigne lance son éditeur multimodal' },
          {
            type: 'paragraph',
            text: 'Montréal, le 2 octobre 2026 — OutilsEnLigne.ca présente un bureau où chaque fichier d’un projet se pose comme du papier : documents, présentations, tableurs, images et PDF.',
          },
          {
            type: 'paragraph',
            text: 'Les outils suivent ce que vous touchez. Un tableau sélectionné propose les formats de nombre ; une image propose le recadrage et la reconnaissance de texte.',
          },
          { type: 'paragraph', text: 'Tout le traitement se fait dans le navigateur : vos fichiers ne quittent jamais votre ordinateur.' },
        ],
      },
    },
  },
  {
    id: 'lancement',
    kind: 'slides',
    title: 'Lancement',
    x: 637,
    y: 145,
    w: 520,
    h: 292,
    rotation: 1,
    data: {
      eyebrow: 'Lancement',
      editor: 'MC',
      comments: [],
      status: { state: 'ready' },
      preview: {
        kind: 'slides',
        slides: [
          { title: 'Un seul éditeur, tous vos fichiers', body: '58 · 90 · 120 · 169' },
          { title: 'Le problème', body: 'Six logiciels pour un seul projet.' },
          { title: 'Le bureau', body: 'Chaque fichier posé comme du papier.' },
          { title: 'Budget de lancement', body: 'Repris du tableur Budget!B2:B8' },
        ],
      },
    },
  },
  {
    id: 'budget',
    kind: 'spreadsheet',
    title: 'Budget de lancement',
    x: 1241,
    y: 167,
    w: 460,
    h: 300,
    rotation: -0.6,
    data: {
      editor: 'AL',
      comments: [],
      status: { state: 'ready' },
      preview: {
        kind: 'spreadsheet',
        sheets: ['Budget', 'Calendrier'],
        rows: [
          ['Poste', 'Montant'],
          ['Affiches', '1200'],
          ['Publicité web', '4500'],
          ['Vidéo', '6800'],
          ['Relations presse', '2100'],
          ['Salon', '3900'],
          ['Infolettre', '600'],
          ['Traduction', '1400'],
        ],
      },
    },
  },
  {
    id: 'affiche',
    kind: 'image',
    title: 'affiche-v3.png',
    x: 692,
    y: 526,
    w: 300,
    h: 330,
    rotation: 2.5,
    data: { editor: 'MC', comments: [], status: { state: 'ready' }, preview: { kind: 'image', width: 1080, height: 1350 }, fileName: 'affiche-v3.png' },
  },
  {
    id: 'contrat',
    kind: 'pdf',
    title: 'Contrat — Imprimerie',
    x: 1236,
    y: 563,
    w: 340,
    h: 440,
    rotation: 1,
    data: {
      editor: 'JB',
      comments: [],
      stamp: { label: 'À signer', tone: 'warning' },
      status: { state: 'readonly', reason: 'PDF : ouvert en lecture.' },
      preview: { kind: 'pdf', pageCount: 3, scanned: false, title: 'Contrat — Imprimerie' },
    },
  },
  {
    id: 'afaire',
    kind: 'note',
    title: 'À faire',
    x: 1062,
    y: 459,
    w: 200,
    h: 96,
    rotation: -4,
    data: {
      assignee: 'Alex',
      comments: [],
      status: { state: 'ready' },
      preview: { kind: 'note', text: 'Reprendre les chiffres du tableur dans la diapo 4.' },
    },
  },
];

/** B6 · Fils de liaison. */
export const SEED_LINKS: DeskLink[] = [
  { id: 'l1', from: 'budget', to: 'lancement', label: 'Budget!B2:B8 → diapo 4', state: 'fresh' },
  { id: 'l2', from: 'lancement', to: 'communique', label: 'Diapo 1 → Communiqué § 2', state: 'stale' },
];
