import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Checkbox, Icon, ProgressBar, TextField, cx } from '@oel/emboss';
import { FormsError, type FormsBackend, type PublishedForm } from '../api/backend';
import { draftStore, editLinks } from '../api/draft';
import { questionsOf } from '../model/create';
import { cellText, resolveChoices } from '../model/sheet';
import { closedReason, estimateMinutes, formatDate, icsFor, stepsOf } from '../model/steps';
import type { AnswerValue, Answers, Question, UploadedFile } from '../model/types';
import { emailProblem, validateAnswer, type FieldError } from '../model/validate';
import { CodeInput } from './CodeInput';
import { FileQuestion } from './FileQuestion';
import { FormCover, FormFooter, OTHER, QuestionField, formStyle } from './FormView';
import { download } from './qr';
import { messages, tr } from '@oel/i18n';

type Phase = 'welcome' | 'email' | 'steps' | 'review' | 'done';

export interface FormFillerProps {
  /** null in the builder preview. */
  backend: FormsBackend | null;
  slug: string;
  published: PublishedForm;
  /** Aperçu = vue du répondant: nothing is sent, no draft is kept. */
  preview?: boolean;
  /** « Modifier ma réponse » through the personal link. */
  editing?: { responseId: string; editKey: string; answers: Answers; email: string | null };
  /** Builder: start on a given step (Paramètres preview). */
  compact?: boolean;
}

const otherKey = (id: string) => `${id}__autre`;
const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtWait = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/**
 * E3/E4 · the respondent page. No account, no editor: welcome, (verified
 * email), steps with progress, errors at the top and at the field, review,
 * send, confirmation. Every answer is kept on this device until it is sent.
 */
export function FormFiller({ backend, slug, published, preview, editing, compact }: FormFillerProps) {
  const form = useMemo(() => resolveChoices(published.form, published.ranges, published.taken), [published]);
  const steps = useMemo(() => stepsOf(form), [form]);
  const questions = useMemo(() => questionsOf(form), [form]);
  const s = form.settings;
  const closed = !editing && !preview ? closedReason(form, published.acceptedCount) : null;
  const draft = useMemo(() => (preview || editing ? null : draftStore.load(slug)), [preview, editing, slug]);

  const [phase, setPhase] = useState<Phase>(editing ? 'review' : 'welcome');
  const [step, setStep] = useState(draft?.step ?? 0);
  const [answers, setAnswers] = useState<Answers>(editing?.answers ?? draft?.answers ?? {});
  const [email, setEmail] = useState<string>(editing?.email ?? draft?.email ?? '');
  const [emailToken, setEmailToken] = useState<string | null>(draft?.emailToken ?? null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<FieldError[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [sendCopy, setSendCopy] = useState(true);
  const [saved, setSaved] = useState<boolean>(!!draft);
  const [result, setResult] = useState<{ responseId: string; editKey: string } | null>(null);
  const openedAt = useRef(Date.now());
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Draft on the device (E3 · 5).
  useEffect(() => {
    if (preview || editing || phase === 'done') return;
    const t = setTimeout(() => setSaved(draftStore.save(slug, { answers, step, email: email || null, emailToken })), 300);
    return () => clearTimeout(t);
  }, [answers, step, email, emailToken, preview, editing, phase, slug]);

  // Move focus to the new screen's heading so screen readers start there.
  // Not on first render: the page (or the builder around a preview) keeps its own focus.
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: compact }));
    if (!compact) window.scrollTo?.({ top: 0 });
  }, [phase, step, compact]);

  const setAnswer = (id: string, v: AnswerValue) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    // Fixing a field removes it from the summary at once.
    if (summary.some((e) => e.questionId === id)) setSummary((list) => list.filter((e) => e.questionId !== id));
  };

  const errorFor = (q: Question): FieldError | null => {
    const base = validateAnswer(q, answers[q.id]);
    if (base) return base;
    const v = answers[q.id];
    const pickedOther = v === OTHER || (Array.isArray(v) && (v as string[]).includes(OTHER));
    if (q.allowOther && pickedOther && !String(answers[otherKey(q.id)] ?? '').trim()) {
      return { questionId: q.id, summary: tr(`${q.title} : précisez « Autre »`, `${q.title}: specify “Other”`), message: tr('Écrivez votre réponse « Autre » pour continuer.', 'Write your “Other” answer to continue.') };
    }
    return null;
  };
  const shown = (q: Question) => (touched.has(q.id) || summary.some((e) => e.questionId === q.id) ? errorFor(q)?.message : undefined);

  const emailError = s.identity === 'optional-email' && email ? emailProblem(email) : null;

  const goToQuestion = (id: string) => {
    const at = steps.findIndex((st) => st.questions.some((q) => q.id === id));
    if (at >= 0) {
      setPhase('steps');
      setStep(at);
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-question="${CSS.escape(id)}"]`);
        const target = el?.matches('input,textarea,button,[tabindex]') ? el : el?.querySelector<HTMLElement>('input,textarea,button,[role=radio],[tabindex="0"]');
        (target ?? el)?.focus();
        el?.scrollIntoView({ block: 'center' });
      }),
    );
  };

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    const st = steps[step];
    const errs = (st?.questions ?? []).map(errorFor).filter((x): x is FieldError => !!x);
    if (step === 0 && emailError) errs.unshift({ questionId: '__email', summary: tr('Courriel : l’adresse n’est pas complète', 'Email: the address is incomplete'), message: emailError });
    if (errs.length) {
      setSummary(errs);
      setTouched((t) => new Set([...t, ...errs.map((x) => x.questionId)]));
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setSummary([]);
    if (step < steps.length - 1) setStep(step + 1);
    else setPhase('review');
  };

  const back = () => {
    setSummary([]);
    if (phase === 'review') return setPhase('steps');
    if (step > 0) setStep(step - 1);
    else setPhase('welcome');
  };

  const onPendingChange = useCallback((qid: string, n: number) => setPending((p) => (p[qid] === n ? p : { ...p, [qid]: n })), []);
  const sending = Object.values(pending).reduce((a, b) => a + b, 0);

  // The email used for the copy: verified/optional email, else an email question.
  const contactEmail = (email || (questions.find((q) => q.type === 'email') && (answers[questions.find((q) => q.type === 'email')!.id] as string)) || '').trim();
  const firstName = (() => {
    const q = questions.find((x) => x.type === 'short' && /nom|name/i.test(x.title));
    const v = q ? String(answers[q.id] ?? '').trim() : '';
    return v.split(/\s+/)[0] ?? '';
  })();

  const finalAnswers = (): Answers => {
    const out: Answers = {};
    for (const q of questions) {
      let v = answers[q.id] ?? null;
      const other = String(answers[otherKey(q.id)] ?? '').trim();
      if (v === OTHER) v = tr(`Autre : ${other}`, `Other: ${other}`);
      else if (Array.isArray(v) && (v as string[]).includes(OTHER)) v = (v as string[]).map((x) => (x === OTHER ? tr(`Autre : ${other}`, `Other: ${other}`) : x));
      out[q.id] = v;
    }
    return out;
  };

  // ── Rendering ──────────────────────────────────────────────────────
  const total = steps.length + 1; // + Vérifier
  const stepTitle = phase === 'review' ? tr('Vérifier', 'Check') : steps[step]?.title;
  const overline = phase === 'review' || phase === 'steps' ? `${tr(`Étape ${phase === 'review' ? total : step + 1} sur ${total}`, `Step ${phase === 'review' ? total : step + 1} of ${total}`)}${stepTitle ? ` · ${stepTitle}` : ''}` : null;
  const progress = phase === 'review' ? total : step + 1;

  let body;
  if (closed && phase !== 'done') {
    body = (
      <section className="form-screen form-screen--center" aria-labelledby="form-screen-title">
        <Icon name="lock" size={32} />
        <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="form-screen__title">
          {tr('Formulaire fermé', 'Form closed')}
        </h2>
        <p>{closed}</p>
      </section>
    );
  } else if (phase === 'welcome') {
    body = (
      <section className="form-screen" aria-labelledby="form-screen-title">
        <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="emb-visually-hidden">
          {tr('Accueil', 'Welcome')}
        </h2>
        <ul className="form-facts" aria-label={tr('En bref', 'In brief')}>
          <li>
            <Badge tone="neutral" dot={false}>≈ {estimateMinutes(form)} minute{estimateMinutes(form) > 1 ? 's' : ''}</Badge>
          </li>
          <li>
            <Badge tone="neutral" dot={false}>{questions.length} question{questions.length > 1 ? 's' : ''}</Badge>
          </li>
          {s.closesOn && (
            <li>
              <Badge tone="neutral" dot={false}>Ferme le {formatDate(s.closesOn)}</Badge>
            </li>
          )}
        </ul>
        {form.appearance.welcome && <p className="form-screen__lead">{form.appearance.welcome}</p>}
        <p className="form-screen__note">
          {tr('Vos réponses sont envoyées', 'Your answers are sent')} {form.organiser ? <>{tr('à', 'to')} <strong>{form.organiser}</strong></> : tr('à l’organisateur', 'to the organizer')}.
          {!preview && ' Vous pouvez quitter et reprendre plus tard : le brouillon reste sur cet appareil.'}
        </p>
        <div className="form-nav form-nav--end">
          <Button variant="primary" trailingIcon="arrow-right" onPress={() => (s.identity === 'verified-email' && !emailToken && !preview ? setPhase('email') : setPhase('steps'))}>
            {draft && Object.keys(draft.answers).length ? tr('Reprendre où vous étiez', 'Pick up where you left off') : tr('Commencer', 'Start')}
          </Button>
        </div>
      </section>
    );
  } else if (phase === 'email') {
    body = (
      <EmailGate
        backend={backend}
        slug={slug}
        email={email}
        onEmail={setEmail}
        headingRef={headingRef}
        organiser={form.organiser}
        onVerified={(token) => {
          setEmailToken(token);
          setPhase('steps');
        }}
        onBack={() => setPhase('welcome')}
      />
    );
  } else if (phase === 'steps') {
    const st = steps[step];
    body = (
      <form className="form-screen" onSubmit={next} noValidate aria-labelledby="form-screen-title">
        <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="form-step__heading">
          {stepTitle || tr(`Étape ${step + 1}`, `Step ${step + 1}`)}
        </h2>
        {summary.length > 0 && <ErrorSummary errors={summary} refEl={summaryRef} onGo={(id) => (id === '__email' ? document.getElementById('form-email')?.focus() : goToQuestion(id))} />}
        {step === 0 && s.identity === 'optional-email' && (
          <TextField
            id="form-email"
            label={tr('Courriel (facultatif)', 'Email (optional)')}
            description={tr('Pour recevoir une copie de vos réponses.', 'To get a copy of your answers.')}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="nom@exemple.ca"
            value={email}
            onChange={setEmail}
            onBlur={() => setTouched((t) => new Set(t).add('__email'))}
            isInvalid={touched.has('__email') && !!emailError}
            errorMessage={emailError ?? undefined}
            validationBehavior="aria"
            className="form-q"
          />
        )}
        {st?.items.map((item) =>
          item.kind === 'question' ? (
            <QuestionField
              key={item.id}
              question={item}
              value={answers[item.id]}
              onChange={(v) => setAnswer(item.id, v)}
              onBlur={() => setTouched((t) => new Set(t).add(item.id))}
              error={shown(item)}
              other={String(answers[otherKey(item.id)] ?? '')}
              onOtherChange={(v) => setAnswer(otherKey(item.id), v)}
              renderFile={(q) => (
                <FileQuestion
                  question={q}
                  value={(answers[q.id] as UploadedFile[] | undefined) ?? []}
                  onChange={(files) => setAnswer(q.id, files)}
                  onPendingChange={onPendingChange}
                  backend={backend}
                  slug={slug}
                  error={shown(q)}
                  preview={preview}
                />
              )}
            />
          ) : item.kind === 'text' ? (
            <div key={item.id} className="form-text-block">
              {item.title && <h3>{item.title}</h3>}
              {item.text && <p>{item.text}</p>}
            </div>
          ) : null,
        )}
        <div className="form-nav">
          <Button variant="ghost" leadingIcon="chevron-left" onPress={back}>
            {tr('Précédent', 'Previous')}
          </Button>
          <span className="form-nav__saved" role="status">
            {preview ? tr('Aperçu : rien n’est enregistré', 'Preview: nothing is saved') : saved ? tr('Brouillon enregistré sur cet appareil', 'Draft saved on this device') : ''}
          </span>
          <Button variant="primary" type="submit" trailingIcon="arrow-right">
            {tr('Suivant', 'Next')}
          </Button>
        </div>
      </form>
    );
  } else if (phase === 'review') {
    body = (
      <Review
        form={form}
        questions={questions}
        answers={finalAnswers()}
        headingRef={headingRef}
        onEdit={goToQuestion}
        onBack={editing ? undefined : back}
        canCopy={s.sendCopy && !!contactEmail && !editing}
        contactEmail={contactEmail}
        sendCopy={sendCopy}
        onSendCopy={setSendCopy}
        sending={sending}
        preview={!!preview}
        editing={!!editing}
        backend={backend}
        slug={slug}
        openedAt={openedAt.current}
        submit={async (humanToken) => {
          if (preview || !backend) return { responseId: 'apercu', editKey: '' };
          const r = await backend.submit(slug, {
            answers: finalAnswers(),
            email: contactEmail || null,
            emailToken,
            humanToken,
            openedAt: openedAt.current,
            sendCopy: sendCopy && !!contactEmail,
            edit: editing ? { responseId: editing.responseId, editKey: editing.editKey } : undefined,
          });
          draftStore.clear(slug);
          if (s.allowEdit) editLinks.save(slug, r.responseId, r.editKey);
          return r;
        }}
        onDone={(r) => {
          setResult(r);
          setPhase('done');
        }}
      />
    );
  } else {
    const dateQ = questions.find((q) => q.type === 'date' && typeof answers[q.id] === 'string' && answers[q.id]);
    const editUrl = result && s.allowEdit && !preview ? `${location.origin}${location.pathname}?s=${encodeURIComponent(slug)}&r=${encodeURIComponent(result.responseId)}#k=${encodeURIComponent(result.editKey)}` : null;
    body = (
      <section className="form-screen form-screen--center" aria-labelledby="form-screen-title">
        <span className="form-done__seal" aria-hidden>
          <Icon name="check" size={28} />
        </span>
        <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="form-screen__title">
          {editing ? tr('Réponse modifiée', 'Response edited') : firstName ? tr(`Merci, ${firstName} !`, `Thank you, ${firstName}!`) : tr('Merci !', 'Thank you!')}
        </h2>
        {preview ? (
          <p>{tr('Aperçu : rien n’a été envoyé.', 'Preview: nothing was sent.')}</p>
        ) : (
          <>
            <p>{form.appearance.thanks}</p>
            {sendCopy && contactEmail && s.sendCopy && !editing && <p>{tr(`Une copie de vos réponses arrive à ${contactEmail}.`, `A copy of your answers is on its way to ${contactEmail}.`)}</p>}
            {form.appearance.signature && <p className="form-done__signature">— {form.appearance.signature}</p>}
          </>
        )}
        <div className="form-done__actions">
          {editUrl && (
            <Button leadingIcon="highlight" onPress={() => location.assign(editUrl)}>
              {tr('Modifier ma réponse', 'Edit my response')}
            </Button>
          )}
          {dateQ && (
            <Button
              leadingIcon="calendar"
              onPress={() => download(`${form.title}.ics`, icsFor(form.title, answers[dateQ.id] as string, `${dateQ.title} · ${form.organiser}`), 'text/calendar')}
            >
              {tr('Ajouter au calendrier', 'Add to calendar')}
            </Button>
          )}
          {form.appearance.redirectUrl && !preview && (
            <Button variant="primary" trailingIcon="arrow-right" onPress={() => location.assign(form.appearance.redirectUrl!)}>
              {tr('Continuer', 'Continue')}
            </Button>
          )}
        </div>
        {editUrl && <p className="form-done__hint">{tr('Gardez ce lien pour modifier votre réponse plus tard : il est aussi mémorisé sur cet appareil.', 'Keep this link to edit your response later: it is also remembered on this device.')}</p>}
      </section>
    );
  }

  return (
    <div className={cx('form-page', compact && 'is-compact')} style={formStyle(form.appearance)}>
      {preview && !compact && (
        <p className="form-preview-banner" role="note">
          <Icon name="eye" size={16} /> {tr('Aperçu : c’est ce que verront les répondants. Rien n’est envoyé.', 'Preview: this is what respondents will see. Nothing is sent.')}
        </p>
      )}
      <article className="form-sheet" aria-label={form.title}>
        <FormCover form={form} subtitle={phase === 'welcome' ? form.organiser : undefined} />
        <div className="form-sheet__body">
          {overline && (
            <div className="form-progress">
              <p className="emb-t-overline">{overline}</p>
              {form.appearance.showProgress && <ProgressBar aria-label={tr('Progression', 'Progress')} value={(progress / total) * 100} />}
            </div>
          )}
          {body}
        </div>
      </article>
      <FormFooter organiser={form.organiser} />
    </div>
  );
}

/* ── Error summary (E4 · 3, like GOV.UK / DSFR) ─────────────────────── */

function ErrorSummary({ errors, refEl, onGo }: { errors: FieldError[]; refEl: React.RefObject<HTMLDivElement | null>; onGo: (id: string) => void }) {
  return (
    <div className="form-errors" role="alert" tabIndex={-1} ref={refEl} aria-labelledby="form-errors-title">
      <p id="form-errors-title" className="form-errors__title">
        <Icon name="alert" size={18} />
        {tr(`${errors.length} réponse${errors.length > 1 ? 's' : ''} à corriger avant de continuer`, `${errors.length} answer${errors.length > 1 ? 's' : ''} to fix before continuing`)}
      </p>
      <ul>
        {errors.map((e) => (
          <li key={e.questionId}>
            <a
              href={`#q-${e.questionId}`}
              onClick={(ev) => {
                ev.preventDefault();
                onGo(e.questionId);
              }}
            >
              {e.summary}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Email gate (E6 · 4–5) ──────────────────────────────────────────── */

function EmailGate({
  backend,
  slug,
  email,
  onEmail,
  onVerified,
  onBack,
  headingRef,
  organiser,
}: {
  backend: FormsBackend | null;
  slug: string;
  email: string;
  onEmail: (v: string) => void;
  onVerified: (token: string) => void;
  onBack: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  organiser: string;
}) {
  const [sent, setSent] = useState<{ resendAt: number; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(!!sent);

  const request = async () => {
    const p = emailProblem(email);
    if (!email.trim() || p) return setError(p ?? tr('Entrez votre courriel. Exemple : nom@exemple.ca', 'Enter your email. Example: name@example.ca'));
    if (!backend) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backend.requestEmailCode(slug, email);
      setSent(r);
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (v = code) => {
    if (!backend) return;
    setBusy(true);
    setError(null);
    try {
      onVerified(await backend.verifyEmailCode(slug, email, v));
    } catch (e) {
      setError(e instanceof FormsError ? e.message : tr('La vérification a échoué. Réessayez.', 'Verification failed. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form
        className="form-screen"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void request();
        }}
        aria-labelledby="form-screen-title"
      >
        <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="form-screen__title">
          {tr('Ce formulaire demande votre courriel', 'This form asks for your email')}
        </h2>
        <p>
          {organiser || tr('L’organisateur', 'The organizer')}{' '}
          {tr('l’utilise pour vous identifier. Un code de 6 chiffres vous sera envoyé ; pas de compte à créer.', 'uses it to identify you. A 6-digit code will be sent to you; no account to create.')}
        </p>
        <TextField
          label={tr('Courriel', 'Email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="nom@exemple.ca"
          value={email}
          onChange={onEmail}
          isInvalid={!!error}
          errorMessage={error ?? undefined}
          validationBehavior="aria"
          autoFocus
        />
        <div className="form-nav">
          <Button variant="ghost" leadingIcon="chevron-left" onPress={onBack}>
            {tr('Précédent', 'Previous')}
          </Button>
          <span />
          <Button variant="primary" type="submit" isDisabled={busy}>
            {tr('Recevoir le code', 'Get the code')}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="form-screen"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
      aria-labelledby="form-screen-title"
    >
      <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="form-screen__title">
        {tr('Entrez le code reçu', 'Enter the code you received')}
      </h2>
      <p id="code-help">{tr(`Envoyé à ${email}. Collez le code ou tapez-le : le curseur passe seul à la case suivante.`, `Sent to ${email}. Paste the code or type it: the cursor moves to the next box on its own.`)}</p>
      {sent.devCode && (
        // TODO(backend): remove — the local stub shows the code the email would contain.
        <p className="form-dev-note">{tr(`Mode local : le code envoyé serait ${sent.devCode}.`, `Local mode: the code sent would be ${sent.devCode}.`)}</p>
      )}
      <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} invalid={!!error} describedBy={`code-help${error ? ' code-err' : ''}`} />
      {error && (
        <p id="code-err" className="emb-field__error" role="alert">
          {error}
        </p>
      )}
      <div className="form-nav">
        <Button variant="ghost" onPress={() => setSent(null)}>
          {tr('Changer d’adresse', 'Change the address')}
        </Button>
        <Button variant="ghost" isDisabled={now < sent.resendAt || busy} onPress={() => void request()}>
          {now < sent.resendAt ? tr(`Renvoyer le code (${fmtClock(sent.resendAt - now)})`, `Send the code again (${fmtClock(sent.resendAt - now)})`) : tr('Renvoyer le code', 'Send the code again')}
        </Button>
        <Button variant="primary" type="submit" isDisabled={busy || code.replace(/\D/g, '').length < 6}>
          {tr('Continuer', 'Continue')}
        </Button>
      </div>
    </form>
  );
}

/* ── Review + send (E4 · 4, E8 · 1–3) ───────────────────────────────── */

function Review({
  form,
  questions,
  answers,
  headingRef,
  onEdit,
  onBack,
  canCopy,
  contactEmail,
  sendCopy,
  onSendCopy,
  sending,
  preview,
  editing,
  backend,
  slug,
  openedAt,
  submit,
  onDone,
}: {
  form: PublishedForm['form'];
  questions: Question[];
  answers: Answers;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onEdit: (id: string) => void;
  onBack?: () => void;
  canCopy: boolean;
  contactEmail: string;
  sendCopy: boolean;
  onSendCopy: (v: boolean) => void;
  sending: number;
  preview: boolean;
  editing: boolean;
  backend: FormsBackend | null;
  slug: string;
  openedAt: number;
  submit: (humanToken: string | null) => Promise<{ responseId: string; editKey: string }>;
  onDone: (r: { responseId: string; editKey: string }) => void;
}) {
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'challenge' | 'sending' } | { kind: 'limited'; retryAt: number } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [fallback, setFallback] = useState<{ email: string; sent: boolean; code: string; error: string | null }>({ email: contactEmail, sent: false, code: '', error: null });
  const now = useNow(state.kind === 'limited');
  const limited = state.kind === 'limited' && now < state.retryAt;
  useEffect(() => {
    if (state.kind === 'limited' && now >= state.retryAt) setState({ kind: 'idle' });
  }, [now, state]);

  const send = async (humanToken?: string) => {
    try {
      let token = humanToken ?? null;
      if (!token && backend && !preview && !editing) {
        setState({ kind: 'checking' });
        const check = await backend.checkHuman(slug, openedAt);
        if (check.state === 'challenge') return setState({ kind: 'challenge' });
        if (check.state === 'rate-limited') return setState({ kind: 'limited', retryAt: check.retryAt });
        token = check.token;
      }
      setState({ kind: 'sending' });
      onDone(await submit(token));
    } catch (e) {
      if (e instanceof FormsError && e.code === 'rate-limited' && e.retryAt) return setState({ kind: 'limited', retryAt: e.retryAt });
      setState({ kind: 'error', message: e instanceof FormsError ? e.message : tr('L’envoi a échoué. Vos réponses restent enregistrées sur cet appareil ; réessayez.', 'Sending failed. Your answers stay saved on this device; try again.') });
    }
  };

  return (
    <section className="form-screen" aria-labelledby="form-screen-title">
      <h2 id="form-screen-title" ref={headingRef} tabIndex={-1} className="form-step__heading">
        {editing ? tr('Modifier votre réponse', 'Edit your response') : tr('Vérifiez vos réponses', 'Check your answers')}
      </h2>
      <dl className="form-review">
        {questions.map((q) => {
          const v = cellText(q, answers[q.id]);
          const files = Array.isArray(answers[q.id]) && typeof (answers[q.id] as unknown[])[0] === 'object' ? (answers[q.id] as UploadedFile[]) : null;
          return (
            <div key={q.id} className="form-review__row">
              <dt>{q.title || tr('Question sans titre', 'Untitled question')}</dt>
              <dd>{files ? files.map((f) => f.name).join(', ') : q.type === 'date' && v ? formatDate(v) : v || '—'}</dd>
              <Button variant="ghost" size="sm" onPress={() => onEdit(q.id)} aria-label={tr(`Modifier : ${q.title}`, `Edit: ${q.title}`)}>
                {tr('Modifier', 'Edit')}
              </Button>
            </div>
          );
        })}
      </dl>

      {canCopy && (
        <Checkbox isSelected={sendCopy} onChange={onSendCopy}>
          {tr(`Recevoir une copie de mes réponses par courriel (${contactEmail})`, `Get a copy of my answers by email (${contactEmail})`)}
        </Checkbox>
      )}

      {state.kind === 'challenge' && (
        <div className="form-panel" role="region" aria-labelledby="challenge-title">
          <p id="challenge-title" className="form-panel__title">
            <Icon name="shield" size={18} /> {tr('Une vérification de plus', 'One more check')}
          </p>
          <p>{tr('Notre système a besoin de confirmer que l’envoi vient d’une personne.', 'Our system needs to confirm the submission comes from a person.')}</p>
          {/* TODO(anti-abuse): mount the interactive challenge widget (Turnstile) here; on success call send(token). */}
          <div className="form-panel__slot emb-well">{tr('Zone de vérification (service anti-robot) · à brancher', 'Verification area (anti-bot service) · to be connected')}</div>
          {!fallback.sent ? (
            <div className="form-panel__row">
              <TextField aria-label={tr('Courriel pour recevoir un code', 'Email to receive a code')} type="email" placeholder="nom@exemple.ca" value={fallback.email} onChange={(v) => setFallback((f) => ({ ...f, email: v }))} />
              <Button
                onPress={async () => {
                  if (!backend || emailProblem(fallback.email) || !fallback.email) return setFallback((f) => ({ ...f, error: tr('Entrez un courriel complet. Exemple : nom@exemple.ca', 'Enter a complete email. Example: name@example.ca') }));
                  await backend.requestEmailCode(slug, fallback.email);
                  setFallback((f) => ({ ...f, sent: true, error: null }));
                }}
              >
                {tr('Recevoir plutôt un code par courriel', 'Get a code by email instead')}
              </Button>
            </div>
          ) : (
            <div className="form-panel__row">
              <CodeInput
                value={fallback.code}
                onChange={(v) => setFallback((f) => ({ ...f, code: v }))}
                invalid={!!fallback.error}
                onComplete={async (v) => {
                  try {
                    const token = await backend!.passChallengeWithEmail(slug, fallback.email, v);
                    void send(token);
                  } catch (e) {
                    setFallback((f) => ({ ...f, error: (e as Error).message }));
                  }
                }}
              />
            </div>
          )}
          {fallback.error && <p className="emb-field__error">{fallback.error}</p>}
        </div>
      )}

      {limited && state.kind === 'limited' && (
        <div className="form-panel form-panel--warning" role="status">
          <p className="form-panel__title">
            <Icon name="clock" size={18} /> {tr('Trop d’envois depuis cet appareil', 'Too many submissions from this device')}
          </p>
          <p>{tr(`Réessayez dans ${fmtWait(state.retryAt - now)}. Vos réponses restent enregistrées sur cet appareil ; rien n’est perdu.`, `Try again in ${fmtWait(state.retryAt - now)}. Your answers stay saved on this device; nothing is lost.`)}</p>
        </div>
      )}

      {state.kind === 'error' && (
        <p className="form-errors form-errors--inline" role="alert">
          {state.message}
        </p>
      )}

      <div className="form-nav">
        {onBack ? (
          <Button variant="ghost" leadingIcon="chevron-left" onPress={onBack}>
            {tr('Précédent', 'Previous')}
          </Button>
        ) : (
          <span />
        )}
        <span className="form-nav__saved" role="status">
          {sending > 0
            ? tr(`Envoi de ${sending} fichier${sending > 1 ? 's' : ''} en cours…`, `Sending ${sending} file${sending > 1 ? 's' : ''}…`)
            : !preview && !editing && state.kind !== 'challenge' && (
                <>
                  <Icon name="shield" size={14} /> {tr('Vérification automatique : rien à faire.', 'Automatic check: nothing to do.')}
                </>
              )}
        </span>
        <Button
          variant="primary"
          trailingIcon="send"
          isDisabled={sending > 0 || limited || state.kind === 'checking' || state.kind === 'sending' || state.kind === 'challenge'}
          onPress={() => void send()}
        >
          {limited && state.kind === 'limited' ? tr(`Possible dans ${fmtClock(state.retryAt - now)}`, `Possible in ${fmtClock(state.retryAt - now)}`) : state.kind === 'sending' || state.kind === 'checking' ? tr('Envoi…', 'Sending…') : editing ? tr('Enregistrer', 'Save') : tr('Envoyer', 'Send')}
        </Button>
      </div>
    </section>
  );
}
