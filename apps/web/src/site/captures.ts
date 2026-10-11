/**
 * Screenshots of the demo Bureau shown on the site (Figma direction D: « vraies captures »).
 * Files go in `apps/web/public/captures/<lang>/<id>.webp` (or `.png`), or `captures/<id>.webp` for
 * both languages: 2400 × 1500 px (16:10), light theme, demo desk after « Réinitialiser la démo ».
 * Until a file exists, the page shows a plain placeholder (build-time check, `findCapture`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from './i18n';

export const CAPTURES = {
  desk: 'Le bureau de démo entier, zoom ~70 % : tableur, présentation, logo, document, la note, les deux fils visibles.',
  document: '« À propos du Bureau » en plein écran (Ctrl+Maj+Entrée), plan ouvert.',
  sheet: '« Chronos — tours de piste » en plein écran, onglet Résultats, une cellule MINIFS sélectionnée (barre de formule visible).',
  chart: 'Même tableur, le graphique sélectionné avec son panneau de réglages ouvert.',
  slides: '« Bienvenue dans le Bureau » en plein écran, diapo 3 sélectionnée dans la pellicule.',
  image: 'Le logo ouvert dans l’atelier d’image (Retoucher), un style appliqué.',
  links: 'Le bureau zoomé sur le tableur et la présentation : le fil violet et son étiquette « À jour ».',
} as const;
export type CaptureId = keyof typeof CAPTURES;

const PUBLIC = [path.join(process.cwd(), 'public'), path.join(process.cwd(), 'apps/web/public')].find((p) => fs.existsSync(p)) ?? '';

/** The public URL of a capture for this language, or null when there is none yet. */
export function findCapture(lang: Lang, id: CaptureId): string | null {
  for (const rel of [`captures/${lang}/${id}.webp`, `captures/${lang}/${id}.png`, `captures/${id}.webp`, `captures/${id}.png`]) {
    if (PUBLIC && fs.existsSync(path.join(PUBLIC, rel))) return `/${rel}`;
  }
  return null;
}
