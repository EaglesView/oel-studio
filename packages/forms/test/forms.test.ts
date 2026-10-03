import { describe, expect, it } from 'vitest';
import {
  applyResponses,
  choicesFromRange,
  closedReason,
  contrastGuard,
  contrastRatio,
  createLink,
  fileProblem,
  formFromColumns,
  guessType,
  headerRow,
  newQuestion,
  registrationTemplate,
  resolveChoices,
  stepsOf,
  syncLink,
  toCsv,
  validateAnswer,
  type FormDef,
  type FormResponse,
} from '../src/model';
import { createLocalBackend, slugify } from '../src/api/local';
import { FormsError } from '../src/api/backend';

const memoryStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

const response = (form: FormDef, answers: Record<string, string>, id = Math.random().toString(36).slice(2)): FormResponse => ({
  id,
  formId: form.id,
  answers,
  email: null,
  submittedAt: Date.UTC(2026, 9, 3, 14, 0),
  updatedAt: Date.UTC(2026, 9, 3, 14, 0),
  status: 'accepted',
});

describe('validation (E4 · 3)', () => {
  const email = { ...newQuestion('email', 'Courriel'), required: true };
  it('says what is missing in an email', () => {
    expect(validateAnswer(email, 'marie@')?.message).toBe('Il manque la fin de l’adresse. Exemple : nom@exemple.ca');
    expect(validateAnswer(email, 'marie@')?.summary).toBe('Courriel : l’adresse n’est pas complète');
    expect(validateAnswer(email, 'marie@exemple.ca')).toBeNull();
  });
  it('required choice asks to choose', () => {
    const q = { ...newQuestion('single', 'Atelier choisi'), required: true };
    expect(validateAnswer(q, null)?.message).toBe('Choisissez une réponse pour continuer.');
  });
  it('refuses a full choice', () => {
    const q = { ...newQuestion('single', 'Atelier'), choices: [{ id: 'a', label: 'Reliure', remaining: 0 }] };
    expect(validateAnswer(q, 'a')?.summary).toContain('complet');
  });
});

describe('files (E7)', () => {
  const rules = { families: ['pdf' as const, 'image' as const], maxSizeMb: 10, maxFiles: 3 };
  it('explains refusals and keeps the others', () => {
    expect(fileProblem({ name: 'demo.mov', size: 1000, type: 'video/quicktime' }, rules, 0)).toBe('Format non accepté : PDF ou images seulement.');
    expect(fileProblem({ name: 'plans.pdf', size: 14 * 1024 * 1024, type: 'application/pdf' }, rules, 0)).toBe('14 Mo : au-delà de 10 Mo. Réduisez-le ou envoyez une partie.');
    expect(fileProblem({ name: 'a.jpg', size: 10, type: 'image/jpeg' }, rules, 3)).toContain('3 fichiers au plus');
    expect(fileProblem({ name: 'a.jpg', size: 10, type: 'image/jpeg' }, rules, 1)).toBeNull();
  });
});

describe('contrast guard (E5)', () => {
  it('darkens a yellow that fails AA and keeps a good ink', () => {
    const g = contrastGuard('#F5C518');
    expect(g.adjusted).toBe(true);
    expect(g.pickedRatio).toBeLessThan(2);
    expect(contrastRatio(g.applied, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastGuard('#7759C5').adjusted).toBe(false);
  });
});

describe('creation (E2 · 1)', () => {
  it('guesses types from headers and values', () => {
    expect(guessType('Courriel', [])).toBe('email');
    expect(guessType('Date d’arrivée', [])).toBe('date');
    expect(guessType('Places', ['4', '9', '0'])).toBe('number');
    expect(guessType('Atelier', ['Céramique', 'Reliure', 'Céramique', 'Reliure'])).toBe('single');
  });
  it('one question per column, without « Reçu le »', () => {
    const f = formFromColumns([['Nom', 'Courriel', 'Reçu le']], 'Test');
    expect(f.items.map((i) => i.title)).toEqual(['Nom', 'Courriel']);
  });
  it('sections make steps; one question per screen splits them', () => {
    const f = registrationTemplate();
    expect(stepsOf(f).map((s) => s.title)).toEqual(['Vos coordonnées', 'Votre inscription']);
    expect(stepsOf({ ...f, appearance: { ...f.appearance, onePerScreen: true } })).toHaveLength(5);
  });
});

describe('linked spreadsheet (E5 · Données liées)', () => {
  const form = registrationTemplate();
  const [, name, email, , pick] = form.items as [unknown, { id: string }, { id: string }, unknown, { id: string; choices: Array<{ id: string }> }];

  it('one question = one column, « Reçu le » added', () => {
    const link = createLink(form, { id: 's', title: 'Budget', tab: 'Inscriptions' });
    expect(headerRow(link)).toEqual(['Nom complet', 'Courriel', 'Atelier choisi', 'Date d’arrivée', 'Besoins particuliers', 'Reçu le']);
  });

  it('reuses existing columns by header', () => {
    const link = createLink(form, { id: 's', title: 'B', tab: 'I', header: ['Courriel', 'Autre chose'] });
    expect(link.columns.find((c) => c.questionId === email.id)?.column).toBe(0);
  });

  it('one response = one row; an edit updates its row; a delete removes it', () => {
    let link = createLink(form, { id: 's', title: 'B', tab: 'I' });
    const r1 = response(form, { [name.id]: 'Marie Tremblay', [pick.id]: pick.choices[0]!.id }, 'r1');
    const r2 = response(form, { [name.id]: 'Alex' }, 'r2');
    let res = applyResponses(form, link, [], [r1, r2]);
    expect(res.added).toBe(2);
    expect(res.rows).toHaveLength(3);
    expect(res.rows[1]![0]).toBe('Marie Tremblay');
    expect(res.rows[1]![2]).toBe('Atelier A');
    link = res.link;
    res = applyResponses(form, link, res.rows, [{ ...r1, answers: { ...r1.answers, [name.id]: 'Marie T.' } }, r2]);
    expect(res.added).toBe(0);
    expect(res.rows[1]![0]).toBe('Marie T.');
    res = applyResponses(form, res.link, res.rows, [r2]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[1]![0]).toBe('Alex');
    expect(res.link.rows).toEqual({ r2: 1 });
  });

  it('held responses stay out of the sheet', () => {
    const link = createLink(form, { id: 's', title: 'B', tab: 'I' });
    const res = applyResponses(form, link, [], [{ ...response(form, {}), status: 'held' }]);
    expect(res.rows).toHaveLength(1);
  });

  it('deleting a question archives its column', () => {
    const link = createLink(form, { id: 's', title: 'B', tab: 'I' });
    const synced = syncLink({ ...form, items: form.items.filter((i) => i.id !== email.id) }, link);
    expect(headerRow(synced)[1]).toBe('Courriel (archivée)');
  });

  it('choices and places come from a range', () => {
    const rows = [['Atelier', 'Places'], ['Céramique', '4'], ['Reliure', '1']];
    const src = { sheetId: 's', sheetTitle: 'Ateliers', labelColumn: 0, quotaColumn: 1, fromRow: 1 };
    expect(choicesFromRange(src, rows, { Reliure: 1 })).toEqual([
      { label: 'Céramique', remaining: 4 },
      { label: 'Reliure', remaining: 0 },
    ]);
    const f2: FormDef = { ...form, items: form.items.map((i) => (i.id === pick.id ? { ...i, choiceSource: src } : i)) };
    const resolved = resolveChoices(f2, { s: rows }, { [pick.id]: { Reliure: 1 } });
    const q = resolved.items.find((i) => i.id === pick.id) as { choices: Array<{ label: string; remaining: number }> };
    expect(q.choices.map((c) => c.remaining)).toEqual([4, 0]);
  });

  it('exports CSV', () => {
    const csv = toCsv(form, [response(form, { [name.id]: 'Marie, T.' })]);
    expect(csv.split('\n')[1]).toMatch(/^"Marie, T\."/);
  });
});

describe('local backend (stub for the forms server)', () => {
  const setup = () => {
    let t = Date.UTC(2026, 9, 3, 12);
    const backend = createLocalBackend({ origin: 'https://outilsenligne.ca', storage: memoryStorage(), latency: 0, now: () => t });
    return { backend, tick: (ms: number) => (t += ms), now: () => t };
  };

  it('publishing needs an account and a sheet, and keeps the link on republish', async () => {
    const { backend } = setup();
    const form = { ...registrationTemplate('Salon des créateurs'), title: 'Salon 2026' };
    await expect(backend.publish(form)).rejects.toMatchObject({ code: 'not-signed-in' });
    const sent = await backend.requestMagicLink('jb@salon.ca', 'https://outilsenligne.ca/connexion');
    await backend.completeMagicLink(new URL(sent.devLink!).searchParams.get('jeton')!);
    expect(backend.account()?.email).toBe('jb@salon.ca');
    await expect(backend.publish(form)).rejects.toMatchObject({ code: 'no-sheet' });
    const linked = { ...form, link: createLink(form, { id: 's', title: 'B', tab: 'I' }) };
    const p1 = await backend.publish(linked);
    expect(p1.url).toBe('https://outilsenligne.ca/f?s=salon-2026');
    const p2 = await backend.publish({ ...linked, publication: p1 });
    expect(p2.slug).toBe(p1.slug);
    expect(p2.version).toBe(2);
  });

  it('submits, holds doubtful responses, rate-limits, enforces verified email', async () => {
    const { backend, tick, now } = setup();
    const sent = await backend.requestMagicLink('o@x.ca', 'https://x/connexion');
    await backend.completeMagicLink(new URL(sent.devLink!).searchParams.get('jeton')!);
    const form = registrationTemplate();
    const pub = await backend.publish({ ...form, link: createLink(form, { id: 's', title: 'B', tab: 'I' }) });
    const seen: FormResponse[][] = [];
    backend.watchResponses(form.id, (l) => seen.push(l));

    const opened = now();
    // Too fast after opening → set aside with the reason.
    await backend.submit(pub.slug, { answers: {}, email: null, emailToken: null, humanToken: null, openedAt: opened, sendCopy: false });
    expect(seen.at(-1)![0]!.status).toBe('held');
    expect(seen.at(-1)![0]!.heldReason).toMatch(/secondes? après l’ouverture/);

    tick(60_000);
    const r = await backend.submit(pub.slug, { answers: {}, email: null, emailToken: null, humanToken: null, openedAt: opened, sendCopy: false });
    expect(seen.at(-1)!.find((x) => x.id === r.responseId)!.status).toBe('accepted');
    const again = await backend.loadForEdit(pub.slug, r.responseId, r.editKey);
    expect(again.id).toBe(r.responseId);

    for (let i = 0; i < 3; i++) await backend.submit(pub.slug, { answers: {}, email: null, emailToken: null, humanToken: null, openedAt: opened, sendCopy: false });
    const check = await backend.checkHuman(pub.slug, opened);
    expect(check.state).toBe('rate-limited');
    await expect(backend.submit(pub.slug, { answers: {}, email: null, emailToken: null, humanToken: null, openedAt: opened, sendCopy: false })).rejects.toBeInstanceOf(FormsError);

    // Verified email + one response per email.
    const strict = { ...registrationTemplate(), settings: { ...form.settings, identity: 'verified-email' as const, onePerEmail: true } };
    const p2 = await backend.publish({ ...strict, link: createLink(strict, { id: 's', title: 'B', tab: 'I' }) });
    await expect(backend.submit(p2.slug, { answers: {}, email: 'm@x.ca', emailToken: null, humanToken: null, openedAt: opened, sendCopy: false })).rejects.toMatchObject({ code: 'bad-code' });
    const code = await backend.requestEmailCode(p2.slug, 'm@x.ca');
    await expect(backend.verifyEmailCode(p2.slug, 'm@x.ca', '000000')).rejects.toMatchObject({ code: 'bad-code' });
    const token = await backend.verifyEmailCode(p2.slug, 'm@x.ca', code.devCode!);
    await backend.submit(p2.slug, { answers: {}, email: 'm@x.ca', emailToken: token, humanToken: null, openedAt: opened, sendCopy: false });
    await expect(backend.submit(p2.slug, { answers: {}, email: 'm@x.ca', emailToken: token, humanToken: null, openedAt: opened, sendCopy: false })).rejects.toMatchObject({ code: 'duplicate-email' });
  });

  it('closed forms say why', () => {
    const f = registrationTemplate();
    expect(closedReason({ settings: { ...f.settings, acceptResponses: false } }, 0)).toBe('Ce formulaire n’accepte plus de réponses.');
    expect(closedReason({ settings: { ...f.settings, maxResponses: 2 } }, 2)).toMatch(/nombre de réponses/);
  });

  it('slugs are readable', () => {
    expect(slugify('Inscription · Salon des créateurs 2026')).toBe('inscription-salon-des-createurs-2026');
  });
});
