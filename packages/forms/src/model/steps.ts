import { isQuestion, questionsOf } from './create';
import { cellText } from './sheet';
import type { FormDef, FormItem, FormResponse, Question } from './types';
import { locale, tr } from '@oel/i18n';

export interface Step {
  title: string;
  items: FormItem[];
  questions: Question[];
}

/**
 * E3 · 3 « Une étape à la fois »: sections split the form into steps (three at
 * most by default, the organiser decides). « Une question par écran » makes
 * every question its own step.
 */
export function stepsOf(form: Pick<FormDef, 'items' | 'appearance'>): Step[] {
  const steps: Step[] = [];
  let cur: Step = { title: '', items: [], questions: [] };
  const push = () => {
    if (cur.items.length) steps.push(cur);
  };
  for (const item of form.items) {
    if (item.kind === 'section') {
      push();
      cur = { title: item.title, items: [], questions: [] };
      continue;
    }
    if (form.appearance.onePerScreen && isQuestion(item) && cur.questions.length) {
      push();
      cur = { title: cur.title, items: [], questions: [] };
    }
    cur.items.push(item);
    if (isQuestion(item)) cur.questions.push(item);
  }
  push();
  return steps.length ? steps : [{ title: '', items: [], questions: [] }];
}

/** « ≈ 3 minutes »: about 20 s per short answer, a minute per paragraph or file. */
export function estimateMinutes(form: Pick<FormDef, 'items'>): number {
  const secs = questionsOf(form).reduce((t, q) => t + (q.type === 'paragraph' || q.type === 'file' ? 60 : q.type === 'multiple' ? 30 : 20), 0);
  return Math.max(1, Math.round(secs / 60));
}

export interface QuestionSummary {
  question: Question;
  answered: number;
  /** For choice questions: label → count, in choice order. */
  counts: Array<{ label: string; count: number }>;
  /** For text questions: latest answers. */
  samples: string[];
}

/** Onglet Réponses: live summary per question (E2 · 6). */
export function summarize(form: FormDef, responses: FormResponse[]): QuestionSummary[] {
  const accepted = responses.filter((r) => r.status === 'accepted');
  return questionsOf(form).map((q) => {
    const vals = accepted.map((r) => r.answers[q.id]).filter((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
    const counts: QuestionSummary['counts'] = [];
    if (q.choices || q.type === 'date') {
      const tally = new Map<string, number>();
      for (const c of q.choices ?? []) tally.set(c.label, 0);
      for (const v of vals) {
        const labels = q.type === 'date' ? [formatDate(v as string)] : cellText(q, v).split(', ');
        for (const l of labels) tally.set(l, (tally.get(l) ?? 0) + 1);
      }
      for (const [label, count] of tally) counts.push({ label, count });
    }
    return {
      question: q,
      answered: vals.length,
      counts,
      samples: q.choices || q.type === 'date' ? [] : vals.slice(-5).reverse().map((v) => cellText(q, v)),
    };
  });
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export function responsesToday(responses: FormResponse[], now = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return responses.filter((r) => r.status === 'accepted' && r.submittedAt >= start.getTime()).length;
}

/** Is the form taking answers right now? Returns the reason when it is not. */
export function closedReason(form: Pick<FormDef, 'settings'>, acceptedCount: number, now = Date.now()): string | null {
  const s = form.settings;
  if (!s.acceptResponses) return tr('Ce formulaire n’accepte plus de réponses.', 'This form no longer accepts responses.');
  if (s.closesOn && now > new Date(`${s.closesOn}T23:59:59`).getTime()) return tr(`Ce formulaire a fermé le ${formatDate(s.closesOn)}.`, `This form closed on ${formatDate(s.closesOn)}.`);
  if (s.maxResponses != null && acceptedCount >= s.maxResponses) return tr('Ce formulaire a atteint le nombre de réponses prévu.', 'This form has reached its planned number of responses.');
  return null;
}

/** « Ajouter au calendrier »: a one-day .ics event from the first date answer. */
export function icsFor(title: string, isoDate: string, description: string): string {
  const d = isoDate.replace(/-/g, '');
  const next = new Date(`${isoDate}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, '');
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OutilsEnLigne//Formulaires//FR',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@outilsenligne.ca`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
