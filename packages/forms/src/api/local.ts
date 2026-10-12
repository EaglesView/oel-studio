import { questionsOf } from '../model/create';
import { cellText } from '../model/sheet';
import { closedReason } from '../model/steps';
import type { FormDef, FormResponse, Publication, UploadedFile } from '../model/types';
import {
  FormsError,
  type Account,
  type CodeSent,
  type FormsBackend,
  type HumanCheck,
  type MagicLinkSent,
  type PublishedForm,
  type SubmitInput,
  type SubmitResult,
  type UploadOptions,
} from './backend';
import { tr } from '@oel/i18n';

/**
 * In-browser stand-in for the forms server. Data lives in localStorage and
 * changes are broadcast to the other tabs, so the organiser's Bureau sees
 * responses arrive live from a respondent tab (`/f?s=…`).
 *
 * Nothing here is secure — it is a UX scaffold. Every place a real server must
 * take over is marked TODO(backend) / TODO(anti-abuse).
 */

export interface LocalBackendOptions {
  /** Base of public links, e.g. `https://outilsenligne.ca`. */
  origin: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Simulated latency (ms) so loading states are visible. */
  latency?: number;
  now?: () => number;
}

const P = 'oel-forms:';
const MAGIC_TTL = 15 * 60_000;
const CODE_TTL = 10 * 60_000;
const RESEND = 60_000;
/** E8 · 3: per-device limit. TODO(anti-abuse): enforce per IP/device fingerprint on the server. */
const RATE_WINDOW = 10 * 60_000;
const RATE_MAX = 5;

interface Stored {
  form: FormDef;
  owner: string;
  ranges: Record<string, string[][]>;
}

type Msg = { type: 'responses'; formId: string } | { type: 'account' };

const rand = (n = 16) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, n * 1.5);
};

export function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'formulaire'
  );
}

export function createLocalBackend(opts: LocalBackendOptions): FormsBackend {
  const storage = opts.storage ?? globalThis.localStorage;
  const now = opts.now ?? Date.now;
  const latency = opts.latency ?? 250;
  const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), latency));

  const get = <T>(k: string): T | null => {
    try {
      const v = storage.getItem(P + k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  };
  const set = (k: string, v: unknown) => storage.setItem(P + k, JSON.stringify(v));
  const del = (k: string) => storage.removeItem(P + k);

  // ── Cross-tab notifications ──────────────────────────────────────────
  const listeners = new Set<(m: Msg) => void>();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('oel-forms') : null;
  channel?.addEventListener('message', (e: MessageEvent<Msg>) => listeners.forEach((l) => l(e.data)));
  const emit = (m: Msg) => {
    listeners.forEach((l) => l(m));
    channel?.postMessage(m);
  };

  const responsesOf = (formId: string) => get<FormResponse[]>(`responses:${formId}`) ?? [];
  const saveResponses = (formId: string, list: FormResponse[]) => {
    set(`responses:${formId}`, list);
    emit({ type: 'responses', formId });
  };
  const stored = (slug: string) => get<Stored>(`pub:${slug}`);

  const takenFor = (form: FormDef, list: FormResponse[]) => {
    const taken: PublishedForm['taken'] = {};
    for (const q of questionsOf(form)) {
      if (!q.choices) continue;
      const t: Record<string, number> = {};
      for (const r of list) {
        if (r.status !== 'accepted') continue;
        for (const l of cellText(q, r.answers[q.id]).split(', ').filter(Boolean)) t[l] = (t[l] ?? 0) + 1;
      }
      taken[q.id] = t;
    }
    return taken;
  };

  const backend: FormsBackend = {
    account: () => get<Account>('account'),

    onAccountChange(cb) {
      const l = (m: Msg) => m.type === 'account' && cb(get<Account>('account'));
      listeners.add(l);
      return () => listeners.delete(l);
    },

    async requestMagicLink(email, returnTo): Promise<MagicLinkSent> {
      // TODO(backend): POST /auth/magic-link — the server emails a signed, single-use
      // link (15 min) and rate-limits per address. The token never comes back to the page.
      const token = rand(24);
      const t = now();
      set(`magic:${token}`, { email: email.trim().toLowerCase(), expiresAt: t + MAGIC_TTL });
      const link = `${returnTo}${returnTo.includes('?') ? '&' : '?'}jeton=${encodeURIComponent(token)}`;
      return wait({ email, expiresAt: t + MAGIC_TTL, resendAt: t + RESEND, devLink: link });
    },

    async completeMagicLink(token) {
      // TODO(backend): GET /auth/magic-link/:token — verify signature + expiry, burn the
      // token, set an httpOnly session cookie, then notify the waiting tab (here: BroadcastChannel).
      const m = get<{ email: string; expiresAt: number }>(`magic:${token}`);
      if (!m) throw new FormsError('not-found', tr('Ce lien de connexion a déjà servi ou n’existe pas.', 'This sign-in link was already used or doesn’t exist.'));
      del(`magic:${token}`);
      if (now() > m.expiresAt) throw new FormsError('expired', tr('Ce lien a expiré. Demandez-en un nouveau.', 'This link has expired. Ask for a new one.'));
      const account = { email: m.email };
      set('account', account);
      emit({ type: 'account' });
      return wait(account);
    },

    async signInWithProvider(provider) {
      // TODO(backend): OAuth (Google / Microsoft) — redirect to the provider, then back to
      // /connexion with the session; same "publish resumes" behaviour as the magic link.
      throw new FormsError('not-implemented', tr(`La connexion avec ${provider === 'google' ? 'Google' : 'Microsoft'} n’est pas encore branchée. Utilisez le lien par courriel.`, `Signing in with ${provider === 'google' ? 'Google' : 'Microsoft'} isn’t connected yet. Use the email link.`));
    },

    async signOut() {
      // TODO(backend): POST /auth/sign-out (clear the session cookie).
      del('account');
      emit({ type: 'account' });
    },

    async publish(form): Promise<Publication> {
      const account = get<Account>('account');
      if (!account) throw new FormsError('not-signed-in', tr('Connectez-vous pour publier.', 'Sign in to publish.'));
      if (!form.link) throw new FormsError('no-sheet', tr('Liez le formulaire à un tableur avant de publier : c’est là que les réponses sont rangées.', 'Link the form to a spreadsheet before publishing: that is where the responses go.'));
      // TODO(backend): PUT /forms/:id — store the definition server-side, owner = session
      // account; slug uniqueness checked by the server. Republishing keeps the slug.
      let slug = get<string>(`slug:${form.id}`);
      if (!slug) {
        const base = slugify(form.title);
        slug = base;
        for (let i = 2; stored(slug) && stored(slug)!.form.id !== form.id; i++) slug = `${base}-${i}`;
        set(`slug:${form.id}`, slug);
      }
      const prev = stored(slug);
      const version = (form.publication?.version ?? 0) + 1;
      const publication: Publication = {
        slug,
        // TODO(backend): short link `${origin}/f/${slug}` needs a hosting rewrite /f/* → /f.
        url: `${opts.origin}/f?s=${encodeURIComponent(slug)}`,
        publishedAt: now(),
        version,
        dirty: false,
      };
      set(`pub:${slug}`, { form: { ...form, publication }, owner: account.email, ranges: prev?.ranges ?? {} } satisfies Stored);
      emit({ type: 'responses', formId: form.id });
      return wait(publication);
    },

    watchResponses(formId, cb) {
      // TODO(backend): live updates over SSE / WebSocket (GET /forms/:id/responses/stream).
      const l = (m: Msg) => m.type === 'responses' && m.formId === formId && cb(responsesOf(formId));
      listeners.add(l);
      const onStorage = (e: StorageEvent) => e.key === `${P}responses:${formId}` && cb(responsesOf(formId));
      globalThis.addEventListener?.('storage', onStorage);
      cb(responsesOf(formId));
      return () => {
        listeners.delete(l);
        globalThis.removeEventListener?.('storage', onStorage);
      };
    },

    async acceptHeld(formId, responseId) {
      // TODO(backend): POST /forms/:id/responses/:rid/accept (owner only).
      saveResponses(formId, responsesOf(formId).map((r) => (r.id === responseId ? { ...r, status: 'accepted', heldReason: undefined } : r)));
    },

    async deleteResponse(formId, responseId) {
      // TODO(backend): DELETE /forms/:id/responses/:rid — also offer to delete its files
      // in the attachments folder (E7 · 5).
      saveResponses(formId, responsesOf(formId).filter((r) => r.id !== responseId));
    },

    async setAccepting(formId, accept) {
      // TODO(backend): PATCH /forms/:id { acceptResponses } (owner only).
      const slug = get<string>(`slug:${formId}`);
      const s = slug ? stored(slug) : null;
      if (slug && s) set(`pub:${slug}`, { ...s, form: { ...s.form, settings: { ...s.form.settings, acceptResponses: accept } } });
    },

    async updateRanges(formId, ranges) {
      // TODO(backend): the server reads quota ranges from the stored spreadsheet itself.
      const slug = get<string>(`slug:${formId}`);
      const s = slug ? stored(slug) : null;
      if (slug && s) set(`pub:${slug}`, { ...s, ranges });
    },

    async load(slug) {
      // TODO(backend): GET /f/:slug (public, cacheable; strips owner-only fields).
      const s = stored(slug);
      if (!s) throw new FormsError('not-found', tr('Ce formulaire n’existe pas ou n’est plus publié.', 'This form doesn’t exist or is no longer published.'));
      const list = responsesOf(s.form.id);
      return wait({
        form: s.form,
        acceptedCount: list.filter((r) => r.status === 'accepted').length,
        taken: takenFor(s.form, list),
        ranges: s.ranges,
      });
    },

    async requestEmailCode(slug, email): Promise<CodeSent> {
      // TODO(backend): POST /f/:slug/email-code — email a 6-digit code, rate-limited per
      // address and per IP. The code is never returned to the browser.
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const t = now();
      set(`code:${slug}:${email.trim().toLowerCase()}`, { code, expiresAt: t + CODE_TTL });
      return wait({ email, expiresAt: t + CODE_TTL, resendAt: t + RESEND, devCode: code });
    },

    async verifyEmailCode(slug, email, code) {
      // TODO(backend): POST /f/:slug/email-code/verify → signed short-lived email token.
      const key = `code:${slug}:${email.trim().toLowerCase()}`;
      const c = get<{ code: string; expiresAt: number }>(key);
      if (!c || now() > c.expiresAt) throw new FormsError('expired', tr('Ce code a expiré. Demandez-en un nouveau.', 'This code has expired. Ask for a new one.'));
      if (c.code !== code.replace(/\D/g, '')) throw new FormsError('bad-code', tr('Ce code ne correspond pas. Vérifiez les 6 chiffres reçus.', 'This code doesn’t match. Check the 6 digits you received.'));
      del(key);
      return wait(`email:${email.trim().toLowerCase()}:${rand(8)}`);
    },

    upload(slug, questionId, file, { onProgress, signal }): Promise<UploadedFile> {
      // TODO(backend): resumable upload (tus or S3 multipart) to POST /f/:slug/files, stored in
      // the folder linked to the sheet, one sub-folder per response (E7 · 5). Server re-checks
      // type (magic bytes), size and count, and virus-scans. Here: simulated progress only.
      return new Promise((resolve, reject) => {
        let sent = 0;
        const total = Math.max(file.size, 1);
        const step = Math.max(total / 12, 256 * 1024);
        const timer = setInterval(() => {
          sent = Math.min(total, sent + step);
          onProgress(sent / total);
          if (sent >= total) {
            clearInterval(timer);
            const id = rand(10);
            resolve({ id, name: file.name, size: file.size, mime: file.type, url: `${opts.origin}/f/fichiers/${encodeURIComponent(slug)}/${questionId}/${id}/${encodeURIComponent(file.name)}` });
          }
        }, 180);
        signal.addEventListener('abort', () => {
          clearInterval(timer);
          reject(new FormsError('aborted', tr('Envoi annulé.', 'Sending cancelled.')));
        });
      });
    },

    async removeUpload() {
      // TODO(backend): DELETE /f/:slug/files/:id (only before the response is sent).
    },

    async checkHuman(slug, openedAt): Promise<HumanCheck> {
      // TODO(anti-abuse): Cloudflare Turnstile (or similar) in non-interactive mode; the
      // server verifies the token on submit. Only the experience is implemented (E8).
      const sends = (get<number[]>(`sends:${slug}`) ?? []).filter((t) => now() - t < RATE_WINDOW);
      if (sends.length >= RATE_MAX) return wait({ state: 'rate-limited', retryAt: sends[0]! + RATE_WINDOW });
      // Stand-in for "the service hesitates": a submission seconds after opening.
      if (now() - openedAt < 2500) return wait({ state: 'challenge' });
      return wait({ state: 'pass', token: `human:${rand(8)}` });
    },

    async passChallengeWithEmail(slug, email, code) {
      // TODO(anti-abuse): accessible fallback — an emailed code replaces the challenge.
      return backend.verifyEmailCode(slug, email, code);
    },

    async submit(slug, input): Promise<SubmitResult> {
      // TODO(backend): POST /f/:slug/responses — verify human token, email token, limits and
      // quotas atomically, append the row to the linked spreadsheet, send the copy email
      // when asked (`sendCopy`), and return the personal edit link secret.
      const s = stored(slug);
      if (!s) throw new FormsError('not-found', tr('Ce formulaire n’existe plus.', 'This form no longer exists.'));
      const list = responsesOf(s.form.id);
      const t = now();

      if (input.edit) {
        const keys = get<Record<string, string>>(`keys:${s.form.id}`) ?? {};
        if (keys[input.edit.responseId] !== input.edit.editKey) throw new FormsError('not-found', tr('Ce lien de modification n’est plus valide.', 'This edit link is no longer valid.'));
        saveResponses(
          s.form.id,
          list.map((r) => (r.id === input.edit!.responseId ? { ...r, answers: input.answers, updatedAt: t } : r)),
        );
        return wait({ responseId: input.edit.responseId, editKey: input.edit.editKey });
      }

      const reason = closedReason(s.form, list.filter((r) => r.status === 'accepted').length, t);
      if (reason) throw new FormsError('closed', reason);
      const email = input.email?.trim().toLowerCase() || null;
      if (s.form.settings.identity === 'verified-email' && !input.emailToken?.startsWith(`email:${email}:`)) {
        throw new FormsError('bad-code', tr('Votre courriel doit être vérifié avant l’envoi.', 'Your email must be verified before sending.'));
      }
      if (s.form.settings.onePerEmail && email && list.some((r) => r.email === email)) {
        throw new FormsError('duplicate-email', tr('Une réponse a déjà été envoyée avec ce courriel. Utilisez votre lien « Modifier ma réponse ».', 'A response was already sent with this email. Use your “Edit my response” link.'));
      }
      const sends = (get<number[]>(`sends:${slug}`) ?? []).filter((x) => t - x < RATE_WINDOW);
      if (sends.length >= RATE_MAX) throw new FormsError('rate-limited', tr('Trop d’envois depuis cet appareil.', 'Too many submissions from this device.'), sends[0]! + RATE_WINDOW);
      set(`sends:${slug}`, [...sends, t]);

      // E8 · 4: doubtful responses are set aside with the reason, never silently dropped.
      // TODO(anti-abuse): real scoring server-side (Turnstile verdict, IP reputation…).
      let heldReason: string | undefined;
      const secs = Math.round((t - input.openedAt) / 1000);
      if (secs < 4) heldReason = tr(`Envoyée ${secs} seconde${secs > 1 ? 's' : ''} après l’ouverture`, `Sent ${secs} second${secs > 1 ? 's' : ''} after opening`);
      else if (sends.length >= RATE_MAX - 1) heldReason = tr(`Même appareil : ${sends.length + 1} envois en 10 minutes`, `Same device: ${sends.length + 1} submissions in 10 minutes`);
      else if (email && /@(test\.test|example\.(com|org)|mailinator\.com)$/.test(email)) heldReason = tr('Courriel non vérifiable', 'Email can’t be verified');

      const response: FormResponse = {
        id: rand(12),
        formId: s.form.id,
        answers: input.answers,
        email,
        submittedAt: t,
        updatedAt: t,
        status: heldReason ? 'held' : 'accepted',
        heldReason,
      };
      const editKey = rand(16);
      set(`keys:${s.form.id}`, { ...(get<Record<string, string>>(`keys:${s.form.id}`) ?? {}), [response.id]: editKey });
      saveResponses(s.form.id, [...list, response]);
      return wait({ responseId: response.id, editKey });
    },

    async loadForEdit(slug, responseId, editKey) {
      // TODO(backend): GET /f/:slug/responses/:rid with the edit key.
      const s = stored(slug);
      const keys = s ? (get<Record<string, string>>(`keys:${s.form.id}`) ?? {}) : {};
      const r = s && keys[responseId] === editKey ? responsesOf(s.form.id).find((x) => x.id === responseId) : undefined;
      if (!r) throw new FormsError('not-found', tr('Ce lien de modification n’est plus valide.', 'This edit link is no longer valid.'));
      return wait(r);
    },
  };
  return backend;
}
