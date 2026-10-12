import { questionsOf } from './create';
import { parseNumber } from './validate';
import type { AnswerValue, ChoiceSource, ColumnMap, FormDef, FormResponse, Question, SheetLink } from './types';
import { locale, tr } from '@oel/i18n';

/**
 * E5 · Données liées au tableur: the linked spreadsheet *is* the form's
 * database. One question = one column, one response = one row (+ « Reçu le »).
 *
 * These are pure functions over the desk's spreadsheet rows (`string[][]`,
 * row 0 = headers) so the Bureau, the tests and later the server share them.
 * TODO(backend): on the server, the same mapping writes into the stored
 * spreadsheet (and the WASM spreadsheet engine) instead of the desk preview.
 */

export const RECEIVED_HEADER = tr('Reçu le', 'Received on');
export const FILES_HEADER = tr('Pièces jointes', 'Attachments');

export const colLetter = (i: number): string => {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

const headerFor = (q: Question) => q.title.trim() || tr('Question sans titre', 'Untitled question');

/**
 * Proposed mapping for « Lier à un tableur » (E2 · 3). With an existing sheet,
 * questions whose title matches a header reuse that column; the others are
 * appended after the last used column.
 */
export function proposeColumns(form: FormDef, existingHeader: string[] = []): { columns: ColumnMap[]; receivedColumn: number; filesColumn: number | null } {
  const used = new Set<number>();
  const norm = (s: string) => s.trim().toLowerCase();
  let next = existingHeader.length;
  const columns = questionsOf(form)
    .filter((q) => q.type !== 'file')
    .map((q) => {
      const found = existingHeader.findIndex((h, i) => !used.has(i) && norm(h) === norm(headerFor(q)));
      const column = found >= 0 ? found : next++;
      used.add(column);
      return { questionId: q.id, column, header: headerFor(q) };
    });
  const recvAt = existingHeader.findIndex((h) => norm(h) === norm(RECEIVED_HEADER));
  const receivedColumn = recvAt >= 0 ? recvAt : next++;
  const hasFiles = questionsOf(form).some((q) => q.type === 'file');
  const filesAt = existingHeader.findIndex((h) => norm(h) === norm(FILES_HEADER));
  const filesColumn = hasFiles ? (filesAt >= 0 ? filesAt : next++) : null;
  return { columns, receivedColumn, filesColumn };
}

export function createLink(form: FormDef, sheet: { id: string; title: string; tab: string; header?: string[] }): SheetLink {
  const p = proposeColumns(form, sheet.header ?? []);
  return {
    sheetId: sheet.id,
    sheetTitle: sheet.title,
    tab: sheet.tab,
    columns: p.columns,
    receivedColumn: p.receivedColumn,
    filesColumn: p.filesColumn,
    filesFolder: p.filesColumn != null ? tr(`Pièces jointes · ${form.title}`, `Attachments · ${form.title}`) : null,
    rows: {},
  };
}

/**
 * Keep the link in step with the builder: renaming a question renames its
 * header; a deleted question keeps its column, archived; a new question gets a
 * new column (created at the first response, here as soon as it exists).
 */
export function syncLink(form: FormDef, link: SheetLink): SheetLink {
  const qs = questionsOf(form).filter((q) => q.type !== 'file');
  const byId = new Map(qs.map((q) => [q.id, q]));
  let max = Math.max(link.receivedColumn, link.filesColumn ?? -1, ...link.columns.map((c) => c.column));
  const columns: ColumnMap[] = link.columns.map((c) => {
    const q = byId.get(c.questionId);
    return q ? { ...c, header: headerFor(q), archived: false } : { ...c, archived: true };
  });
  for (const q of qs) if (!columns.some((c) => c.questionId === q.id)) columns.push({ questionId: q.id, column: ++max, header: headerFor(q) });
  const hasFiles = questionsOf(form).some((q) => q.type === 'file');
  const filesColumn = hasFiles ? (link.filesColumn ?? ++max) : link.filesColumn;
  return {
    ...link,
    columns,
    filesColumn,
    filesFolder: filesColumn != null ? (link.filesFolder ?? tr(`Pièces jointes · ${form.title}`, `Attachments · ${form.title}`)) : null,
  };
}

export function headerRow(link: SheetLink): string[] {
  const width = 1 + Math.max(link.receivedColumn, link.filesColumn ?? -1, ...link.columns.map((c) => c.column));
  const row = Array<string>(width).fill('');
  for (const c of link.columns) row[c.column] = c.archived ? tr(`${c.header} (archivée)`, `${c.header} (archived)`) : c.header;
  row[link.receivedColumn] = RECEIVED_HEADER;
  if (link.filesColumn != null) row[link.filesColumn] = FILES_HEADER;
  return row;
}

/** The value written in a cell: choice labels, not ids; files as links. */
export function cellText(q: Question | undefined, v: AnswerValue | undefined): string {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object') return (v as Array<{ url: string }>).map((f) => f.url).join(' ');
    return (v as string[]).map((id) => q?.choices?.find((c) => c.id === id)?.label ?? id).join(', ');
  }
  if (q && (q.type === 'single' || q.type === 'dropdown')) return q.choices?.find((c) => c.id === v)?.label ?? v;
  return v;
}

const received = (ts: number) =>
  new Date(ts).toLocaleString(locale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function responseRow(form: FormDef, link: SheetLink, r: FormResponse, width: number): string[] {
  const qs = new Map(questionsOf(form).map((q) => [q.id, q]));
  const row = Array<string>(width).fill('');
  for (const c of link.columns) row[c.column] = cellText(qs.get(c.questionId), r.answers[c.questionId]);
  row[link.receivedColumn] = received(r.submittedAt);
  if (link.filesColumn != null) {
    row[link.filesColumn] = questionsOf(form)
      .filter((q) => q.type === 'file')
      .map((q) => cellText(q, r.answers[q.id]))
      .filter(Boolean)
      .join(' ');
  }
  return row;
}

/**
 * Write responses into the sheet rows. Accepted responses only (held ones stay
 * « mises de côté » outside the sheet, E8 · 4). An edited response updates its
 * own row instead of adding one. Returns the new rows and link (row map).
 */
export function applyResponses(form: FormDef, link: SheetLink, rows: string[][], responses: FormResponse[]): { rows: string[][]; link: SheetLink; added: number } {
  const header = headerRow(link);
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  const out = rows.map((r) => [...r, ...Array<string>(Math.max(0, width - r.length)).fill('')]);
  if (!out.length) out.push(Array<string>(width).fill(''));
  // Headers: only fill the mapped columns, never overwrite the organiser's other columns.
  header.forEach((h, i) => {
    if (h) out[0]![i] = h;
  });
  let map = { ...link.rows };
  // A deleted response (or one moved back aside) takes its row with it.
  const keep = new Set(responses.filter((r) => r.status === 'accepted').map((r) => r.id));
  const gone = Object.entries(map).filter(([id]) => !keep.has(id)).map(([, row]) => row).sort((x, y) => y - x);
  for (const row of gone) out.splice(row, 1);
  if (gone.length) {
    map = Object.fromEntries(
      Object.entries(map)
        .filter(([id]) => keep.has(id))
        .map(([id, row]) => [id, row - gone.filter((g) => g < row).length]),
    );
  }
  let added = 0;
  for (const r of responses) {
    if (r.status !== 'accepted') continue;
    const row = responseRow(form, link, r, width);
    const at = map[r.id];
    if (at != null && out[at]) {
      // Merge: keep cells of columns the form does not own.
      out[at] = out[at]!.map((cell, i) => (header[i] ? (row[i] ?? '') : cell));
    } else {
      out.push(row);
      map[r.id] = out.length - 1;
      added++;
    }
  }
  return { rows: out, link: { ...link, rows: map }, added };
}

/**
 * Choices read from a range (« Choix ← Ateliers!A2:A10, places ← B2:B10 »),
 * with places left = quota − accepted answers already picking that label.
 */
export function choicesFromRange(source: ChoiceSource, rows: string[][], taken: Record<string, number> = {}): Array<{ label: string; remaining: number | null }> {
  return rows
    .slice(Math.max(1, source.fromRow))
    .map((r) => {
      const label = (r[source.labelColumn] ?? '').trim();
      if (!label) return null;
      const quota = source.quotaColumn != null ? parseNumber(r[source.quotaColumn] ?? '') : null;
      return { label, remaining: quota == null ? null : Math.max(0, quota - (taken[label] ?? 0)) };
    })
    .filter((c): c is { label: string; remaining: number | null } => !!c);
}

/**
 * The form as respondents see it right now: choices that come from a range are
 * replaced by the range's labels (ids kept by label), and every choice with a
 * quota gets its places left.
 */
export function resolveChoices(form: FormDef, ranges: Record<string, string[][]>, taken: Record<string, Record<string, number>>): FormDef {
  return {
    ...form,
    items: form.items.map((item) => {
      if (item.kind !== 'question' || !item.choices) return item;
      const src = item.choiceSource;
      const rows = src ? ranges[src.sheetId] : undefined;
      if (!src || !rows) return item;
      const byLabel = new Map(item.choices.map((c) => [c.label, c.id]));
      const choices = choicesFromRange(src, rows, taken[item.id] ?? {}).map((c) => ({
        id: byLabel.get(c.label) ?? `r-${c.label.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, '-')}`,
        label: c.label,
        remaining: c.remaining,
      }));
      return { ...item, choices };
    }),
  };
}

export function rangeLabel(source: ChoiceSource, rows: string[][]): string {
  const last = Math.max(source.fromRow, rows.length - 1) + 1;
  const first = Math.max(1, source.fromRow) + 1;
  const labels = `${colLetter(source.labelColumn)}${first}:${colLetter(source.labelColumn)}${last}`;
  const quota = source.quotaColumn != null ? `, places ← ${colLetter(source.quotaColumn)}${first}:${colLetter(source.quotaColumn)}${last}` : '';
  return tr(`Choix ← ${source.sheetTitle}!${labels}${quota}`, `Choices ← ${source.sheetTitle}!${labels}${quota}`);
}

/** CSV export of the responses (onglet Réponses). */
export function toCsv(form: FormDef, responses: FormResponse[]): string {
  const qs = questionsOf(form);
  const esc = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [[...qs.map(headerFor), tr('Courriel du répondant', 'Respondent’s email'), RECEIVED_HEADER].map(esc).join(',')];
  for (const r of responses) {
    if (r.status !== 'accepted') continue;
    lines.push([...qs.map((q) => cellText(q, r.answers[q.id])), r.email ?? '', received(r.submittedAt)].map(esc).join(','));
  }
  return lines.join('\n');
}
