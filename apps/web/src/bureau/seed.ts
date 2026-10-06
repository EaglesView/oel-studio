import type { Paper } from './model';

/** Seed « last change » times, minutes before the page loads. */
const ago = (min: number) => Date.now() - min * 60_000;

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
      updatedAt: ago(1440),
      eyebrow: 'Communiqué',
      editor: 'JB',
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
      updatedAt: ago(4320),
      eyebrow: 'Lancement',
      editor: 'MC',
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
      updatedAt: ago(12),
      editor: 'AL',
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
    data: { updatedAt: ago(300), editor: 'MC', status: { state: 'ready' }, preview: { kind: 'image', width: 1080, height: 1350 }, fileName: 'affiche-v3.png' },
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
      updatedAt: ago(8640),
      editor: 'JB',
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
      updatedAt: ago(40),
      status: { state: 'ready' },
      preview: { kind: 'note', text: '@Alex Reprendre les chiffres du tableur dans la diapo 4.' },
    },
  },
];
