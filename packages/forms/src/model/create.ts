import type { Appearance, Choice, FormDef, FormItem, FormSettings, Question, QuestionType } from './types';
import { tr } from '@oel/i18n';

let counter = 0;
export const fid = (prefix = 'q') => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** OEL ink: the default accent. */
export const DEFAULT_ACCENT = '#7759c5';

export const DEFAULT_APPEARANCE: Appearance = {
  accent: DEFAULT_ACCENT,
  logoUrl: null,
  coverUrl: null,
  titleFont: 'montserrat',
  showProgress: true,
  onePerScreen: false,
  welcome: '',
  thanks: tr('Merci ! Votre réponse a bien été envoyée.', 'Thank you! Your response was sent.'),
  redirectUrl: null,
  signature: '',
};

export const DEFAULT_SETTINGS: FormSettings = {
  acceptResponses: true,
  closesOn: null,
  maxResponses: null,
  identity: 'anonymous',
  onePerEmail: false,
  sendCopy: true,
  allowEdit: true,
};

const choice = (label: string): Choice => ({ id: fid('c'), label });

export function newQuestion(type: QuestionType, title = ''): Question {
  const q: Question = { id: fid(), kind: 'question', type, title, required: false };
  if (type === 'single' || type === 'multiple' || type === 'dropdown') {
    q.choices = [choice('Option 1'), choice('Option 2')];
    q.hideFull = false;
  }
  if (type === 'file') q.file = { families: ['pdf', 'image'], maxSizeMb: 10, maxFiles: 3 };
  if (type === 'email') q.placeholder = 'nom@exemple.ca';
  return q;
}

/** Change a question's type, keeping what still makes sense (title, help, required, choices). */
export function retype(q: Question, type: QuestionType): Question {
  const fresh = newQuestion(type, q.title);
  return {
    ...fresh,
    id: q.id,
    help: q.help,
    required: q.required,
    choices: fresh.choices ? (q.choices?.length ? q.choices : fresh.choices) : undefined,
    choiceSource: fresh.choices ? q.choiceSource : undefined,
    allowOther: fresh.choices ? q.allowOther : undefined,
    hideFull: fresh.choices ? (q.hideFull ?? false) : undefined,
    file: type === 'file' ? (q.file ?? fresh.file) : undefined,
  };
}

export function duplicateItem(item: FormItem): FormItem {
  const copy = structuredClone(item);
  copy.id = fid();
  copy.title = item.title ? `${item.title} (copie)` : '';
  if (copy.kind === 'question' && copy.choices) copy.choices = copy.choices.map((c) => ({ ...c, id: fid('c') }));
  return copy;
}

export function blankForm(title = tr('Formulaire sans titre', 'Untitled form'), organiser = ''): FormDef {
  return {
    id: fid('f'),
    title,
    description: '',
    organiser,
    items: [newQuestion('short', tr('Question sans titre', 'Untitled question'))],
    appearance: { ...DEFAULT_APPEARANCE },
    settings: { ...DEFAULT_SETTINGS },
    link: null,
    publication: null,
    updatedAt: Date.now(),
  };
}

/** « Modèle · Inscription » — Nom, courriel, choix, date. */
export function registrationTemplate(organiser = ''): FormDef {
  const f = blankForm(tr('Inscription', 'Registration'), organiser);
  f.description = tr('Comptez 3 minutes ; les places sont confirmées par courriel.', 'Allow 3 minutes; places are confirmed by email.');
  const name = newQuestion('short', tr('Nom complet', 'Full name'));
  name.required = true;
  name.placeholder = 'Ex. Marie Tremblay';
  const email = newQuestion('email', tr('Courriel', 'Email'));
  email.required = true;
  email.help = tr('Pour la confirmation de votre place.', 'To confirm your place.');
  const pick = newQuestion('single', tr('Atelier choisi', 'Chosen workshop'));
  pick.required = true;
  pick.help = tr('Une place par personne.', 'One place per person.');
  pick.choices = [choice('Atelier A'), choice('Atelier B'), choice('Atelier C')];
  const date = newQuestion('date', tr('Date d’arrivée', 'Arrival date'));
  date.required = true;
  const needs = newQuestion('paragraph', tr('Besoins particuliers', 'Special needs'));
  f.items = [
    { id: fid(), kind: 'section', title: tr('Vos coordonnées', 'Your details') },
    name,
    email,
    { id: fid(), kind: 'section', title: tr('Votre inscription', 'Your registration') },
    pick,
    date,
    needs,
  ];
  return f;
}

/** Guess a question type from a column header and a few sample values (« type deviné »). */
export function guessType(header: string, samples: string[]): QuestionType {
  const h = header.toLowerCase();
  const vals = samples.map((s) => s.trim()).filter(Boolean);
  if (/courriel|e-?mail|adresse électronique/.test(h) || (vals.length && vals.every((v) => /^\S+@\S+\.\S+$/.test(v)))) return 'email';
  if (/date|jour|naissance|arrivée|départ|day|birth|arrival|departure/.test(h) || (vals.length && vals.every((v) => /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)))) return 'date';
  if (/fichier|pièce|portfolio|cv\b|document joint|file|attachment|resume/.test(h)) return 'file';
  if (/commentaire|remarque|besoin|message|description|note/.test(h)) return 'paragraph';
  if (vals.length >= 2 && vals.every((v) => Number.isFinite(Number(v.replace(/\s/g, '').replace(',', '.'))))) return 'number';
  const distinct = new Set(vals);
  if (vals.length >= 4 && distinct.size <= Math.max(2, Math.floor(vals.length / 2)) && distinct.size <= 8) return 'single';
  return 'short';
}

/**
 * « À partir d’un tableur »: one question per column, type guessed from the header and values.
 * `rows[0]` is the header row.
 */
export function formFromColumns(rows: string[][], title: string, organiser = ''): FormDef {
  const f = blankForm(title, organiser);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  f.items = header
    .map((h, col) => ({ h: h.trim(), col }))
    .filter(({ h }) => h && !/^(reçu le|received on)$/i.test(h))
    .map(({ h, col }) => {
      const samples = body.map((r) => r[col] ?? '');
      const q = newQuestion(guessType(h, samples), h);
      if (q.choices) {
        const distinct = [...new Set(samples.map((s) => s.trim()).filter(Boolean))];
        if (distinct.length) q.choices = distinct.map(choice);
      }
      return q;
    });
  if (!f.items.length) f.items = [newQuestion('short', tr('Question sans titre', 'Untitled question'))];
  return f;
}

export const isQuestion = (i: FormItem): i is Question => i.kind === 'question';
export const questionsOf = (f: Pick<FormDef, 'items'>): Question[] => f.items.filter(isQuestion);
