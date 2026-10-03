import { FILE_FAMILIES, type AnswerValue, type Answers, type FileFamily, type Question, type UploadedFile } from './types';

/**
 * E4 · 3: every error says what to do, not just « invalide ». `summary` goes in
 * the list at the top of the step, `message` under the field.
 */
export interface FieldError {
  questionId: string;
  summary: string;
  message: string;
}

const isEmpty = (v: AnswerValue | undefined) =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

export function emailProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/\s/.test(v)) return 'L’adresse ne doit pas contenir d’espace. Exemple : nom@exemple.ca';
  const at = v.indexOf('@');
  if (at < 0) return 'Il manque le « @ ». Exemple : nom@exemple.ca';
  if (at === 0) return 'Il manque le début de l’adresse, avant le « @ ». Exemple : nom@exemple.ca';
  const domain = v.slice(at + 1);
  if (!domain || !/^[^@]+\.[a-z]{2,}$/i.test(domain)) return 'Il manque la fin de l’adresse. Exemple : nom@exemple.ca';
  return null;
}

export function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return raw.trim() && Number.isFinite(n) ? n : null;
}

const label = (q: Question) => q.title.trim() || 'Question sans titre';

/** Validate one answer. Called when leaving a field (never while typing) and on « Suivant ». */
export function validateAnswer(q: Question, value: AnswerValue | undefined): FieldError | null {
  const name = label(q);
  if (isEmpty(value)) {
    if (!q.required) return null;
    const pick = q.type === 'single' || q.type === 'dropdown' || q.type === 'multiple';
    if (pick) return { questionId: q.id, summary: `${name} : choisissez une réponse`, message: 'Choisissez une réponse pour continuer.' };
    if (q.type === 'file') return { questionId: q.id, summary: `${name} : ajoutez un fichier`, message: 'Ajoutez au moins un fichier pour continuer.' };
    if (q.type === 'date') return { questionId: q.id, summary: `${name} : indiquez une date`, message: 'Indiquez une date, par exemple 14/11/2026.' };
    return { questionId: q.id, summary: `${name} : ce champ est à remplir`, message: 'Remplissez ce champ pour continuer.' };
  }
  if (q.type === 'email' && typeof value === 'string') {
    const p = emailProblem(value);
    if (p) return { questionId: q.id, summary: `${name} : l’adresse n’est pas complète`, message: p };
  }
  if (q.type === 'number' && typeof value === 'string' && parseNumber(value) == null) {
    return { questionId: q.id, summary: `${name} : entrez un nombre`, message: 'Entrez seulement des chiffres, par exemple 12 ou 3,5.' };
  }
  if (q.type === 'date' && typeof value === 'string' && Number.isNaN(Date.parse(value))) {
    return { questionId: q.id, summary: `${name} : la date n’est pas valide`, message: 'Indiquez une date réelle, par exemple 14/11/2026.' };
  }
  if ((q.type === 'single' || q.type === 'dropdown') && typeof value === 'string' && q.choices) {
    const c = q.choices.find((x) => x.id === value);
    if (c && c.remaining === 0) return { questionId: q.id, summary: `${name} : ce choix est complet`, message: `« ${c.label} » est complet. Choisissez une autre réponse.` };
  }
  return null;
}

export function validateAll(questions: Question[], answers: Answers): FieldError[] {
  return questions.map((q) => validateAnswer(q, answers[q.id])).filter((e): e is FieldError => !!e);
}

/* ── Files (E7) ─────────────────────────────────────────────────────── */

const MB = 1024 * 1024;

export function familyOf(name: string, mime: string): FileFamily | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const f of FILE_FAMILIES) if (f.mimes.includes(mime) || f.extensions.includes(ext)) return f.id;
  return null;
}

export function acceptedLabel(families: FileFamily[]): string {
  const names = FILE_FAMILIES.filter((f) => families.includes(f.id)).map((f) => f.short);
  if (!names.length) return 'aucun type';
  if (names.length === 1) return names[0]!.replace(/^./, (c) => c.toUpperCase());
  const s = `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`;
  return s.replace(/^./, (c) => c.toUpperCase());
}

export const formatSize = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

/**
 * Why a file is refused, phrased as what to do. A refused file never blocks the
 * others (E7 · 4). `alreadyCount` = files kept so far for this question.
 */
export function fileProblem(file: { name: string; size: number; type: string }, rules: NonNullable<Question['file']>, alreadyCount: number): string | null {
  if (alreadyCount >= rules.maxFiles) return `${rules.maxFiles} fichier${rules.maxFiles > 1 ? 's' : ''} au plus : retirez-en un pour ajouter celui-ci.`;
  const fam = familyOf(file.name, file.type);
  if (!fam || !rules.families.includes(fam)) return `Format non accepté : ${acceptedLabel(rules.families)} seulement.`;
  if (file.size > rules.maxSizeMb * MB) return `${formatSize(file.size)} : au-delà de ${rules.maxSizeMb} Mo. Réduisez-le ou envoyez une partie.`;
  return null;
}

export function acceptAttribute(families: FileFamily[]): string {
  return FILE_FAMILIES.filter((f) => families.includes(f.id))
    .flatMap((f) => [...f.mimes, ...f.extensions.map((e) => `.${e}`)])
    .join(',');
}

export const isUploadedList = (v: AnswerValue | undefined): v is UploadedFile[] =>
  Array.isArray(v) && (v.length === 0 || typeof v[0] === 'object');
