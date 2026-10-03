/**
 * A form (Figma Editor — Behaviors · E). Everything here is plain JSON: it is
 * stored on the desk paper, sent to the backend on publish, and rendered by
 * both the builder and the respondent page.
 */

export type QuestionType =
  | 'short'
  | 'paragraph'
  | 'email'
  | 'number'
  | 'single'
  | 'multiple'
  | 'dropdown'
  | 'date'
  | 'file';

/** Blocks that are not questions: a title + text, or a section (= a new step). */
export type BlockType = 'text' | 'section';

export interface Choice {
  id: string;
  label: string;
  /** Places left, read from the linked spreadsheet (E1 · 4). `0` greys the choice out. */
  remaining?: number | null;
}

/** Choices read from a range of the linked spreadsheet (« Choix ← Ateliers!A2:A10, places ← B2:B10 »). */
export interface ChoiceSource {
  /** Spreadsheet paper id on the desk. */
  sheetId: string;
  sheetTitle: string;
  /** Column holding the labels, 0-based. */
  labelColumn: number;
  /** Column holding the number of places, 0-based; null = no quota. */
  quotaColumn: number | null;
  /** First data row (0-based, header excluded). */
  fromRow: number;
}

export type FileFamily = 'pdf' | 'image' | 'document' | 'spreadsheet';

export interface FileRules {
  families: FileFamily[];
  /** Megabytes per file. */
  maxSizeMb: number;
  /** 1 to 10. */
  maxFiles: number;
}

export interface Question {
  id: string;
  kind: 'question';
  type: QuestionType;
  title: string;
  help?: string;
  placeholder?: string;
  required: boolean;
  choices?: Choice[];
  choiceSource?: ChoiceSource | null;
  /** « Ajouter « Autre » (texte libre) ». */
  allowOther?: boolean;
  /** « Masquer les choix complets »: off = full choices stay visible but disabled, with the reason. */
  hideFull?: boolean;
  file?: FileRules;
}

export interface Block {
  id: string;
  kind: BlockType;
  title: string;
  text?: string;
}

export type FormItem = Question | Block;

export type TitleFont = 'montserrat' | 'noto-serif';

/** E5 · Personnalisable — and nothing else. */
export interface Appearance {
  /** Colour the organiser picked (#rrggbb). The applied one goes through `contrastGuard`. */
  accent: string;
  logoUrl: string | null;
  /** Cover image (cropped 5:1); replaces the plain band. */
  coverUrl: string | null;
  titleFont: TitleFont;
  showProgress: boolean;
  /** « Une question par écran » instead of steps. */
  onePerScreen: boolean;
  welcome: string;
  thanks: string;
  /** Redirect after sending (optional). */
  redirectUrl: string | null;
  signature: string;
}

export type IdentityMode = 'anonymous' | 'optional-email' | 'verified-email';

/** E2 · 5 publication rules and E6 · 3 respondent identity. */
export interface FormSettings {
  acceptResponses: boolean;
  /** ISO date (yyyy-mm-dd) after which the form closes, or null. */
  closesOn: string | null;
  /** Empty = no limit. */
  maxResponses: number | null;
  identity: IdentityMode;
  /** Only possible with `verified-email`. */
  onePerEmail: boolean;
  /** Offer « Recevoir une copie de mes réponses ». */
  sendCopy: boolean;
  /** Allow « Modifier ma réponse » via a personal link. */
  allowEdit: boolean;
}

/** One question → one column of the linked spreadsheet (E5 · Données liées). */
export interface ColumnMap {
  questionId: string;
  /** 0-based column index in the sheet. */
  column: number;
  header: string;
  /** Question deleted: the column stays, greyed and marked « archivée ». */
  archived?: boolean;
}

export interface SheetLink {
  /** Spreadsheet paper id on the desk. */
  sheetId: string;
  sheetTitle: string;
  /** Tab name shown in labels (« Inscriptions »). */
  tab: string;
  columns: ColumnMap[];
  /** Column index of « Reçu le » (added automatically). */
  receivedColumn: number;
  /** Column index of attachment links, when the form has a file question. */
  filesColumn: number | null;
  /** Folder that receives attachments (E7 · 5). */
  filesFolder: string | null;
  /**
   * Response id → row index. The link follows the response id, not the row
   * position, so the organiser can sort and colour freely.
   * TODO(backend): the spreadsheet engine should keep stable row ids itself;
   * this map breaks if rows are reordered outside OEL.
   */
  rows: Record<string, number>;
}

export interface Publication {
  slug: string;
  url: string;
  publishedAt: number;
  /** Version published; republishing keeps the same link. */
  version: number;
  /** Builder changes since the last publish. */
  dirty: boolean;
}

export interface FormDef {
  id: string;
  title: string;
  description: string;
  /** Who the answers go to (« Vos réponses sont envoyées au Salon des créateurs »). */
  organiser: string;
  items: FormItem[];
  appearance: Appearance;
  settings: FormSettings;
  link: SheetLink | null;
  publication: Publication | null;
  updatedAt: number;
}

export type AnswerValue = string | string[] | UploadedFile[] | null;

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Where the backend stored it. */
  url: string;
}

export type Answers = Record<string, AnswerValue>;

export type ResponseStatus = 'accepted' | 'held';

export interface FormResponse {
  id: string;
  formId: string;
  answers: Answers;
  email: string | null;
  submittedAt: number;
  updatedAt: number;
  status: ResponseStatus;
  /** Why it was set aside (E8 · 4), e.g. « Envoyée 2 secondes après l’ouverture ». */
  heldReason?: string;
}

export const QUESTION_TYPES: Array<{ type: QuestionType; label: string; icon: string }> = [
  { type: 'short', label: 'Texte court', icon: 'input' },
  { type: 'paragraph', label: 'Paragraphe', icon: 'align-left' },
  { type: 'email', label: 'Courriel', icon: 'mail' },
  { type: 'number', label: 'Nombre', icon: 'word-count' },
  { type: 'single', label: 'Choix unique', icon: 'radio' },
  { type: 'multiple', label: 'Cases à cocher', icon: 'checklist' },
  { type: 'dropdown', label: 'Liste déroulante', icon: 'chevron-down' },
  { type: 'date', label: 'Date', icon: 'calendar' },
  { type: 'file', label: 'Fichier', icon: 'attachment' },
];

export const FILE_FAMILIES: Array<{ id: FileFamily; label: string; short: string; mimes: string[]; extensions: string[] }> = [
  { id: 'pdf', label: 'PDF', short: 'PDF', mimes: ['application/pdf'], extensions: ['pdf'] },
  {
    id: 'image',
    label: 'Images (JPG, PNG, HEIC)',
    short: 'images',
    mimes: ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif'],
    extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'],
  },
  {
    id: 'document',
    label: 'Documents (Word, ODT)',
    short: 'documents',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.oasis.opendocument.text'],
    extensions: ['docx', 'doc', 'odt'],
  },
  {
    id: 'spreadsheet',
    label: 'Tableurs (Excel, ODS, CSV)',
    short: 'tableurs',
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv'],
    extensions: ['xlsx', 'xls', 'ods', 'csv'],
  },
];
