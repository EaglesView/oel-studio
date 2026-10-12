import { useEffect, useRef } from 'react';
import type { DeskLink } from '@oel/desk';
import { toast } from '@oel/emboss';
import { applyResponses, headerRow, type FormDef, type FormResponse, type FormsBackend, type SheetLink, type SheetRef } from '@oel/forms';
import { messages, plural } from '@oel/i18n';
import { FIRST_SHEET, PAPER_SIZE, uid, type Bureau, type Paper } from './model';
import { paperRows, setPaperRows } from './sheets';

/**
 * Forms on the desk (Editor — Behaviors · E2 · 7): a form and its spreadsheet
 * are joined by a thread « Réponses → Inscriptions »; every new response adds
 * a row, flagged for a moment. The form logic itself lives in @oel/forms; this
 * file only maps it onto desk papers. A response sheet backed by a workbook
 * (@oel/sheets) receives its rows in the workbook itself, typed as Excel would
 * read them; TODO(backend): on the server, the same mapping should write into
 * the stored workbook so responses land even when no organiser is online.
 */

const isSheet = (p: Paper | undefined): p is Paper => !!p && p.kind === 'spreadsheet' && p.data.preview.kind === 'spreadsheet';

export function sheetRefs(store: Bureau): SheetRef[] {
  return store.nodes
    .map((n) => n as Paper)
    .filter(isSheet)
    .map((p) => {
      const pv = p.data.preview as { kind: 'spreadsheet'; sheets: string[]; rows: string[][] };
      return { id: p.id, title: p.title, tab: pv.sheets[0] ?? FIRST_SHEET, rows: pv.rows };
    });
}

const t = messages(
  {
    responses: 'Réponses',
    threadRemoved: 'Fil retiré',
    threadLabel: (tab: string) => `Réponses → ${tab} · en direct`,
    threadStep: 'Fil Réponses',
    held: (n: number, title: string) => `${n} ${plural(n, 'réponse mise', 'réponses mises')} de côté · ${title}`,
    fresh: (title: string) => `Nouvelle réponse · ${title}`,
    added: (sheet: string) => `Ajoutée au tableur « ${sheet} ».`,
    toCheck: 'À vérifier dans l’onglet Réponses.',
    rows: (n: number) => `+${n} ${plural(n, 'ligne', 'lignes')}`,
  },
  {
    responses: 'Responses',
    threadRemoved: 'Thread removed',
    threadLabel: (tab) => `Responses → ${tab} · live`,
    threadStep: 'Responses thread',
    held: (n, title) => `${n} ${plural(n, 'response', 'responses')} set aside · ${title}`,
    fresh: (title) => `New response · ${title}`,
    added: (sheet) => `Added to the spreadsheet “${sheet}”.`,
    toCheck: 'To check in the Responses tab.',
    rows: (n) => `+${n} ${plural(n, 'row', 'rows')}`,
  },
);

/** « Nouveau tableur « … — réponses » », laid next to the form. */
export function createResponseSheet(store: Bureau, formPaperId: string, title: string, header: string[]): SheetRef {
  const form = store.node(formPaperId);
  const size = PAPER_SIZE.spreadsheet;
  const tab = t.responses;
  const paper: Paper = {
    id: uid('sheet'),
    kind: 'spreadsheet',
    title,
    x: form ? form.x + form.w + 80 : store.viewCenter().x,
    y: form ? form.y : store.viewCenter().y,
    w: size.w,
    h: size.h,
    rotation: 0,
    data: { editor: 'JB', status: { state: 'ready' }, preview: { kind: 'spreadsheet', sheets: [tab], rows: [header.length ? header : ['']] } },
  };
  store.add([paper], { select: false });
  return { id: paper.id, title, tab, rows: [header] };
}

const threadId = (formPaperId: string) => `form-${formPaperId}`;

/** One thread per form: form → its response sheet. */
export function ensureFormThread(store: Bureau, formPaperId: string, link: SheetLink | null) {
  const links = store.getState().links;
  const id = threadId(formPaperId);
  const existing = links.find((l) => l.id === id);
  if (!link) {
    if (existing) store.setLinks(links.filter((l) => l.id !== id), t.threadRemoved);
    return;
  }
  const label = t.threadLabel(link.tab);
  if (existing && existing.to === link.sheetId && existing.label === label) return;
  const thread: DeskLink = { id, from: formPaperId, to: link.sheetId, label, state: 'fresh' };
  store.setLinks([...links.filter((l) => l.id !== id), thread], t.threadStep);
}

/** Write the header row of a freshly linked sheet so the columns show at once. */
export function writeHeaders(store: Bureau, link: SheetLink) {
  const sheet = store.node(link.sheetId) as Paper | undefined;
  if (!isSheet(sheet)) return;
  const withHeader = (current: string[][]) => {
    const rows = current.length ? current.map((r) => r.slice()) : [[]];
    headerRow(link).forEach((h, i) => {
      if (h) rows[0]![i] = h;
    });
    for (let i = 0; i < rows[0]!.length; i++) rows[0]![i] ??= '';
    return rows;
  };
  // A sheet backed by a workbook (@oel/sheets): the header goes into the workbook itself.
  if (sheet.data.docId) {
    void paperRows(sheet).then((current) => {
      const rows = withHeader(current);
      if (JSON.stringify(rows) !== JSON.stringify(current)) return setPaperRows(store, sheet, rows);
    });
    return;
  }
  const pv = sheet.data.preview as { kind: 'spreadsheet'; sheets: string[]; rows: string[][] };
  const rows = withHeader(pv.rows);
  if (JSON.stringify(rows) !== JSON.stringify(pv.rows)) store.update(sheet.id, { data: { ...sheet.data, preview: { ...pv, rows } } }, { history: false });
}

/**
 * Keeps every published form's linked sheet in step with its responses, for
 * the whole desk (not only while the form is open), and keeps the published
 * copy's quota ranges in step with the sheets they come from. Off (`enabled` false) in the
 * single-user edition, which has no forms.
 */
export function useFormSync(store: Bureau, backend: () => FormsBackend, announce: (m: string) => void, enabled = true) {
  const watching = useRef(new Map<string, () => void>());
  const known = useRef(new Map<string, Set<string>>());
  const rangeKeys = useRef(new Map<string, string>());

  useEffect(() => {
    if (!enabled) return;
    const apply = (paperId: string, responses: FormResponse[]) => {
      const paper = store.node(paperId) as Paper | undefined;
      const form = paper?.data.form;
      if (!paper || !form) return;
      const accepted = responses.filter((r) => r.status === 'accepted');
      const held = responses.length - accepted.length;

      // New responses since we started watching: tell the organiser.
      const seen = known.current.get(paperId);
      const fresh = seen ? responses.filter((r) => !seen.has(r.id)) : [];
      known.current.set(paperId, new Set(responses.map((r) => r.id)));
      if (fresh.length) {
        const heldNew = fresh.filter((r) => r.status === 'held').length;
        const msg = heldNew === fresh.length ? t.held(heldNew, form.title) : t.fresh(form.title);
        toast({ title: msg, description: form.link && heldNew < fresh.length ? t.added(form.link.sheetTitle) : t.toCheck, tone: heldNew === fresh.length ? 'warning' : 'success' });
        announce(msg);
      }

      let nextForm: FormDef = form;
      const link = form.link;
      const sheet = link ? (store.node(link.sheetId) as Paper | undefined) : undefined;
      if (link && isSheet(sheet) && sheet.data.docId) {
        // The response sheet is a real workbook: rows are read from and written to it.
        void paperRows(sheet).then(async (rows) => {
          const res = applyResponses(form, link, rows, responses);
          if (JSON.stringify(res.rows) !== JSON.stringify(rows)) await setPaperRows(store, sheet, res.rows, res.added ? { label: t.rows(res.added), at: Date.now() } : undefined);
          if (JSON.stringify(res.link.rows) !== JSON.stringify(link.rows)) {
            const fresh = store.node(paperId) as Paper | undefined;
            if (fresh?.data.form) store.update(paperId, { data: { ...fresh.data, form: { ...fresh.data.form, link: res.link } } }, { history: false });
          }
        });
      } else if (link && isSheet(sheet)) {
        const pv = sheet.data.preview as { kind: 'spreadsheet'; sheets: string[]; rows: string[][] };
        const res = applyResponses(form, link, pv.rows, responses);
        if (JSON.stringify(res.rows) !== JSON.stringify(pv.rows)) {
          store.update(
            sheet.id,
            { data: { ...sheet.data, preview: { ...pv, rows: res.rows }, flash: res.added ? { label: t.rows(res.added), at: Date.now() } : sheet.data.flash } },
            { history: false },
          );
        }
        if (JSON.stringify(res.link.rows) !== JSON.stringify(link.rows)) nextForm = { ...form, link: res.link };
      }
      const stats = paper.data.formStats;
      if (nextForm !== form || stats?.accepted !== accepted.length || stats?.held !== held) {
        store.update(paperId, { data: { ...paper.data, form: nextForm, formStats: { accepted: accepted.length, held } } }, { history: false });
      }
    };

    let lastNodes: unknown = null;
    const reconcile = () => {
      // Pans and zooms change the state too; only paper changes matter here.
      const nodes = store.getState().nodes;
      if (nodes === lastNodes) return;
      lastNodes = nodes;
      const papers = store.nodes.map((n) => n as Paper).filter((p) => p.kind === 'form' && p.data.form?.publication);
      const ids = new Set(papers.map((p) => p.id));
      for (const [id, stop] of watching.current) {
        if (!ids.has(id)) {
          stop();
          watching.current.delete(id);
          known.current.delete(id);
        }
      }
      for (const p of papers) {
        if (!watching.current.has(p.id)) watching.current.set(p.id, backend().watchResponses(p.data.form!.id, (list) => apply(p.id, list)));
        // Quotas read from sheets: push the current rows to the published copy when they change.
        const form = p.data.form!;
        const sources = [...new Set(form.items.flatMap((i) => (i.kind === 'question' && i.choiceSource ? [i.choiceSource.sheetId] : [])))];
        if (!sources.length) continue;
        const ranges = Object.fromEntries(sources.map((id) => [id, ((store.node(id) as Paper | undefined)?.data.preview as { rows?: string[][] } | undefined)?.rows ?? []]));
        const key = `${form.publication!.version}:${JSON.stringify(ranges)}`;
        if (rangeKeys.current.get(p.id) !== key) {
          rangeKeys.current.set(p.id, key);
          void backend().updateRanges(form.id, ranges);
        }
      }
    };

    reconcile();
    const unsub = store.subscribe(reconcile);
    const map = watching.current;
    return () => {
      unsub();
      map.forEach((stop) => stop());
      map.clear();
    };
  }, [store, backend, announce, enabled]);
}
