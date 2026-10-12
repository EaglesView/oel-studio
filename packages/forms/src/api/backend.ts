import type { Answers, FormDef, FormResponse, Publication, UploadedFile } from '../model/types';

/**
 * Everything the forms UI needs from a server. The UI only talks to this
 * interface; `createLocalBackend` implements it in the browser (localStorage +
 * BroadcastChannel) so the whole flow works today, across tabs.
 *
 * TODO(backend): implement `createHttpBackend(baseUrl)` against a real forms
 * service (apps/collab is the natural home: it already has SQLite, HMAC tokens
 * and file storage) and swap it in `apps/web/src/forms/backend.ts`.
 */

export interface Account {
  email: string;
}

export type Provider = 'google' | 'microsoft';

export interface MagicLinkSent {
  email: string;
  expiresAt: number;
  /** Earliest time « Renvoyer » is allowed (60 s). */
  resendAt: number;
  /** Local stub only: the link the email would contain. Never returned by a real server. */
  devLink?: string;
}

/** What the respondent page loads from a public link. */
export interface PublishedForm {
  form: FormDef;
  /** Accepted responses so far (limits). */
  acceptedCount: number;
  /** Accepted answers per choice label, for quotas read from the sheet. */
  taken: Record<string, Record<string, number>>;
  /** Rows of the spreadsheet ranges the choices come from (choice sources), by sheet id. */
  ranges: Record<string, string[][]>;
}

export interface CodeSent {
  email: string;
  expiresAt: number;
  resendAt: number;
  /** Local stub only. */
  devCode?: string;
}

/** E8: result of the (invisible by default) human check before sending. */
export type HumanCheck =
  | { state: 'pass'; token: string }
  | { state: 'challenge' }
  | { state: 'rate-limited'; retryAt: number };

export interface SubmitInput {
  answers: Answers;
  email: string | null;
  /** Proof the email was verified with a code (identity = verified-email). */
  emailToken: string | null;
  humanToken: string | null;
  /** When the respondent opened the form (anti-abuse signal). */
  openedAt: number;
  sendCopy: boolean;
  /** Present when editing an earlier response through the personal link. */
  edit?: { responseId: string; editKey: string };
}

export interface SubmitResult {
  responseId: string;
  /** Secret for « Modifier ma réponse » (personal link). */
  editKey: string;
}

export interface UploadOptions {
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export type FormsErrorCode =
  | 'not-signed-in'
  | 'no-sheet'
  | 'not-found'
  | 'closed'
  | 'duplicate-email'
  | 'bad-code'
  | 'expired'
  | 'rate-limited'
  | 'not-implemented'
  | 'aborted'
  | 'network';

export class FormsError extends Error {
  constructor(
    readonly code: FormsErrorCode,
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

export interface FormsBackend {
  /* ── Account (E6 · 1–2): needed to publish, never to answer ── */
  account(): Account | null;
  onAccountChange(cb: (a: Account | null) => void): () => void;
  /** Sends a sign-in link valid 15 minutes. `returnTo` is where the link lands. */
  requestMagicLink(email: string, returnTo: string): Promise<MagicLinkSent>;
  /** Called by /connexion when the link is opened; signs in every open tab. */
  completeMagicLink(token: string): Promise<Account>;
  signInWithProvider(provider: Provider): Promise<Account>;
  signOut(): Promise<void>;

  /* ── Organiser ── */
  /** Publish or republish (same link). Requires an account and a linked sheet. */
  publish(form: FormDef): Promise<Publication>;
  /** Live list of responses (accepted and held), newest last. */
  watchResponses(formId: string, cb: (responses: FormResponse[]) => void): () => void;
  acceptHeld(formId: string, responseId: string): Promise<void>;
  deleteResponse(formId: string, responseId: string): Promise<void>;
  /** « Accepter les réponses » applies at once to the live form, without republishing other edits. */
  setAccepting(formId: string, accept: boolean): Promise<void>;
  /** Refresh the published copy's quota ranges after the linked sheet changed. */
  updateRanges(formId: string, ranges: Record<string, string[][]>): Promise<void>;

  /* ── Respondent ── */
  load(slug: string): Promise<PublishedForm>;
  requestEmailCode(slug: string, email: string): Promise<CodeSent>;
  /** Returns an email token proving the address was verified. */
  verifyEmailCode(slug: string, email: string, code: string): Promise<string>;
  upload(slug: string, questionId: string, file: File, opts: UploadOptions): Promise<UploadedFile>;
  removeUpload(slug: string, fileId: string): Promise<void>;
  checkHuman(slug: string, openedAt: number): Promise<HumanCheck>;
  /** Fallback for a challenge the respondent cannot pass: a code by email instead. */
  passChallengeWithEmail(slug: string, email: string, code: string): Promise<string>;
  submit(slug: string, input: SubmitInput): Promise<SubmitResult>;
  /** « Modifier ma réponse »: the earlier answers, if the key matches. */
  loadForEdit(slug: string, responseId: string, editKey: string): Promise<FormResponse>;
}
