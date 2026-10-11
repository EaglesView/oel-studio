/**
 * Screenshots of the demo Bureau shown on the site (Figma direction D: « vraies captures »).
 * Files go in `apps/web/public/captures/<lang>/<id>.webp` (or `.png`), or `captures/<id>.png` for
 * both languages (the Bureau is in French): 16:10 (1680 × 1050 today), light theme, demo desk after
 * « Réinitialiser la démo ». Until a file exists, the page shows a plain placeholder (build-time
 * check, `findCapture`). Phone-sized captures will come with the mobile layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from './i18n';

export const CAPTURES = {
  desk: 'Le bureau de démo entier, zoom ~70 % : tableur, présentation, logo, document, la note, les deux fils visibles.',
  document: '« À propos du Bureau » en plein écran (Ctrl+Maj+Entrée), plan ouvert.',
  sheet: '« Chronos — tours de piste » en plein écran, onglet Résultats, une cellule MINIFS sélectionnée (barre de formule visible).',
  chart: 'Même tableur, le graphique sélectionné avec son panneau de réglages ouvert.',
  slides: '« Bienvenue dans le Bureau » présentée : la vue présentateur (diapo, suivante, notes, temps écoulé).',
  image: 'Le logo ouvert dans l’atelier d’image (Retoucher), mode avancé.',
  links: 'La diapo 3 et son graphique lié au tableur, badge « Lié · Chronos — tours de piste · À jour ».',
} as const;
export type CaptureId = keyof typeof CAPTURES;

const PUBLIC = [path.join(process.cwd(), 'public'), path.join(process.cwd(), 'apps/web/public')].find((p) => fs.existsSync(p)) ?? '';

/** Pixel size of a PNG (IHDR) or a lossy/lossless WebP; 16:10 when unknown. */
function imageSize(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return { width: 1680, height: 1050 };
}

/** A capture for this language (its public URL and size), or null when there is none yet. */
export function findCapture(lang: Lang, id: CaptureId): { src: string; width: number; height: number } | null {
  for (const rel of [`captures/${lang}/${id}.webp`, `captures/${lang}/${id}.png`, `captures/${id}.webp`, `captures/${id}.png`]) {
    const file = PUBLIC && path.join(PUBLIC, rel);
    if (file && fs.existsSync(file)) return { src: `/${rel}`, ...imageSize(file) };
  }
  return null;
}
