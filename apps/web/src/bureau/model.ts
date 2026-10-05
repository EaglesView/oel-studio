import type { DeskNode, DeskStore } from '@oel/desk';
import { KIND_LABEL, type FileKind, type Preview } from '@oel/engine';
import type { IconName, Person, Tone } from '@oel/emboss';
import type { FormDef } from '@oel/forms/model';

/**
 * Desk paper kinds = engine file kinds (minus "unsupported" which shows as a generic file),
 * plus forms (Editor — Behaviors · E), which are OEL papers rather than imported files.
 */
export type PaperKind = Exclude<FileKind, 'unsupported'> | 'file' | 'form';

export type PaperStatus =
  | { state: 'ready' }
  | { state: 'importing'; progress: number | null; stage: string }
  | { state: 'readonly'; reason: string }
  | { state: 'error'; reason: string };

export interface Stamp {
  label: string;
  tone: Tone;
}

export interface PaperData {
  /** Overline on documents and slides ("COMMUNIQUÉ"). */
  eyebrow?: string;
  preview: Preview;
  /** Picture of the first page, sheet or slide (object URL), drawn by `thumbnails.tsx`; the sketch from `preview` shows until then. */
  thumbnail?: string;
  status: PaperStatus;
  stamp?: Stamp;
  editor?: string;
  /** Last change (ms since epoch), by `editor`: « Récents » in the menu (M-5), Ranger par date (M-3). */
  updatedAt?: number;
  /** Object URL for imported images. */
  imageUrl?: string;
  fileName?: string;
  /** Collaborative document (@oel/docs) or workbook (@oel/sheets) backing this paper, once created. */
  docId?: string;
  /** Sticky note colour/assignee. */
  assignee?: string;
  /** Form definition (@oel/forms) for `form` papers. */
  form?: FormDef;
  /** Live counters shown on the form paper (« 42 RÉPONSES »). */
  formStats?: { accepted: number; held: number };
  /** Spreadsheet that just received a response row: flashes « +1 ligne » for a moment. */
  flash?: { label: string; at: number };
}

export type Paper = DeskNode<PaperData> & { kind: PaperKind };
export type Bureau = DeskStore<PaperData>;

export const PEOPLE: Person[] = [
  { id: 'jb', name: 'J. Bouchard (vous)', initials: 'JB', color: 'var(--emboss-fill-primary)' },
  { id: 'mc', name: 'Marie-Claude', initials: 'MC', color: 'var(--emboss-success)' },
  { id: 'al', name: 'Alex', initials: 'AL', color: 'var(--emboss-warning)' },
];

export const KIND_ICON: Record<PaperKind, IconName> = {
  document: 'file',
  slides: 'slide',
  spreadsheet: 'table',
  pdf: 'pdf',
  image: 'image',
  note: 'note',
  file: 'file',
  form: 'form',
};

/** Kinds that carry a coloured tab on the desk (and a tinted icon elsewhere): the OEL palette, one colour per editor. */
export const KIND_TAB: Partial<Record<PaperKind, string>> = {
  document: 'Document',
  slides: 'Présentation',
  spreadsheet: 'Tableur',
  form: 'Formulaire',
};

export function kindLabel(kind: string): string {
  if (kind === 'form') return 'Formulaire';
  return kind === 'file' ? 'Fichier' : (KIND_LABEL[kind as FileKind] ?? 'Fichier');
}

/** Paper sizes per type (B1 · 3: each type has its shape). */
export const PAPER_SIZE: Record<PaperKind, { w: number; h: number }> = {
  document: { w: 420, h: 594 },
  slides: { w: 520, h: 292 },
  spreadsheet: { w: 460, h: 300 },
  pdf: { w: 340, h: 440 },
  image: { w: 300, h: 330 },
  note: { w: 200, h: 140 },
  file: { w: 260, h: 320 },
  form: { w: 340, h: 460 },
};

/**
 * A paper's size: its type's shape, except documents, which take the shape of
 * their first page (landscape papers are wide; the long side stays the same),
 * and presentations, which take the shape of their slides (4:3, portrait…).
 * `PAPER_SIZE.document` is then only the default for new blank documents.
 */
export function paperSizeFor(kind: PaperKind, preview?: Preview | null): { w: number; h: number } {
  const base = PAPER_SIZE[kind];
  const page = preview?.kind === 'document' ? preview.page : preview?.kind === 'slides' ? preview.size : undefined;
  if ((kind !== 'document' && kind !== 'slides') || !page || page.width <= 0 || page.height <= 0) return base;
  const long = Math.max(base.w, base.h);
  return page.width >= page.height ? { w: long, h: Math.round((long * page.height) / page.width) } : { w: Math.round((long * page.width) / page.height), h: long };
}

export function statusText(p: Paper): string {
  const s = p.data.status;
  if (s.state === 'importing') return `${s.stage}${s.progress != null ? ` ${Math.round(s.progress * 100)} %` : ''}`;
  if (s.state === 'readonly') return `Lecture seule. ${s.reason}`;
  if (s.state === 'error') return `Erreur. ${s.reason}`;
  return '';
}

/** Accessible label for a paper on the desk. */
export function describePaper(p: Paper): string {
  const parts = [p.title, kindLabel(p.kind)];
  if (p.data.stamp) parts.push(p.data.stamp.label);
  if (p.kind === 'form') {
    const st = p.data.formStats;
    parts.push(p.data.form?.publication ? `${st?.accepted ?? 0} réponses${st?.held ? `, ${st.held} à vérifier` : ''}` : 'brouillon');
  }
  const st = statusText(p);
  if (st) parts.push(st);
  return parts.join(', ');
}

let counter = 0;
export const uid = (prefix = 'p') => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function blankPaper(kind: PaperKind, at: { x: number; y: number }): Paper {
  const size = PAPER_SIZE[kind];
  const titles: Record<PaperKind, string> = {
    document: 'Document sans titre',
    slides: 'Présentation sans titre',
    spreadsheet: 'Tableur sans titre',
    note: 'Note',
    pdf: 'PDF',
    image: 'Image',
    file: 'Fichier',
    form: 'Formulaire sans titre',
  };
  const preview: Preview =
    kind === 'document'
      ? { kind: 'document', blocks: [{ type: 'heading', text: 'Titre' }, { type: 'paragraph', text: '' }] }
      : kind === 'slides'
        ? { kind: 'slides', slides: [] }
        : kind === 'spreadsheet'
          ? { kind: 'spreadsheet', sheets: ['Feuille 1'], rows: [['', ''], ['', '']] }
          : kind === 'note'
            ? { kind: 'note', text: '' }
            : { kind: 'unsupported' };
  return {
    id: uid(),
    kind,
    title: titles[kind],
    x: at.x - size.w / 2,
    y: at.y - size.h / 2,
    w: size.w,
    h: size.h,
    rotation: kind === 'note' ? -3 : 0,
    data: { preview, status: { state: 'ready' }, editor: 'JB', updatedAt: Date.now() },
  };
}
