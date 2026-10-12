/** Revisions, states, cycles and the words for them (Figma G1, G3, G6, G7). */
import type { Carries, CellStyleEdit, LinkDef, LinkedTable, LinkMode, LinkState, LinkTheme, LocalEdit, Overflow, SourceRef } from './types';
import { locale, messages } from '@oel/i18n';

// ---------------------------------------------------------------------------
// Revision: a hash of the source content a copy shows
// ---------------------------------------------------------------------------

/** JSON with sorted keys, so equal content gives equal text whatever the key order. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const keys = Object.keys(v as object)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/**
 * Revision of a value: two clients computing an update from the same source
 * get the same `rev`, which is what makes concurrent updates write once (G7).
 */
export function revOf(value: unknown): string {
  const s = stableJson(value);
  // FNV-1a, two lanes (64 bits as two 32-bit halves).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SourceInfo {
  /** Revision of the source now; `null` when the source is gone, `undefined` when not read yet. */
  rev?: string | null;
  /** A live update is being written. */
  updating?: boolean;
}

export function linkState(def: LinkDef, src: SourceInfo): LinkState {
  if (def.mode === 'frozen') return 'frozen';
  if (def.broken || src.rev === null) return 'broken';
  if (src.updating) return 'updating';
  if (src.rev === undefined) return 'waiting';
  if (src.rev !== def.snapshot.rev) return def.mode === 'live' ? 'updating' : 'stale';
  return 'fresh';
}

/** Same object, same place in the source. */
export function sameRef(a: SourceRef, b: SourceRef): boolean {
  return stableJson(a) === stableJson(b);
}

// ---------------------------------------------------------------------------
// Cycles: links between files form a DAG (G7 « ne peut pas dépendre de lui-même »)
// ---------------------------------------------------------------------------

/**
 * Would a new link from file `from` into file `to` close a loop? Edges are
 * existing links, source file → target file. Linking a file into itself is a loop.
 */
export function createsCycle(edges: Iterable<{ from: string; to: string }>, from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  // A path to → … → from already exists?
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Words (fr-CA or English, @oel/i18n)
// ---------------------------------------------------------------------------

const t = messages(
  {
    mode: { live: 'En direct', manual: 'Manuel', frozen: 'Figé' } as Record<LinkMode, string>,
    modeHint: {
      live: 'Suit chaque changement de la source, en moins d’une seconde.',
      manual: 'Signale les changements, puis met à jour sur demande.',
      frozen: 'Ne change plus jamais (une photo de la source).',
    } as Record<LinkMode, string>,
    carries: { chart: 'Graphique et style', 'chart-data': 'Données seulement', picture: 'Image', table: 'Tableau', value: 'Valeur' } as Record<Carries, string>,
    theme: { source: 'Thème du tableur', target: 'Thème du document' } as Record<LinkTheme, string>,
    overflow: { truncate: 'Tronquer', all: 'Tout afficher', rows: 'Choisir les lignes…' } as Record<Overflow, string>,
    state: { fresh: 'À jour', stale: 'En retard', updating: 'Mise à jour…', frozen: 'Figé', broken: 'Rompu', waiting: 'En attente' } as Record<LinkState, string>,
    what: { chart: 'graphique', range: 'tableau', cell: 'valeur', image: 'image' } as Record<SourceRef['kind'], string>,
    accessRemoved: 'Accès retiré',
    sourceDeleted: 'Source supprimée',
    frozenOn: (date: string) => `Figé · ${date}`,
    waiting: 'En attente de la source',
    justNow: 'à l’instant',
    minutes: (m: number) => `il y a ${m} min`,
    hours: (h: number) => `il y a ${h} h`,
    on: (date: string) => `le ${date}`,
    prop: { fill: 'Fond', bold: 'Gras', italic: 'Italique', color: 'Couleur du texte' } as Record<CellStyleEdit['prop'], string>,
    removed: (prop: string) => `${prop} retiré`,
  },
  {
    mode: { live: 'Live', manual: 'Manual', frozen: 'Frozen' },
    modeHint: {
      live: 'Follows every change of the source, in under a second.',
      manual: 'Flags changes, then updates on request.',
      frozen: 'Never changes again (a snapshot of the source).',
    },
    carries: { chart: 'Chart and style', 'chart-data': 'Data only', picture: 'Image', table: 'Table', value: 'Value' },
    theme: { source: 'Spreadsheet theme', target: 'Document theme' },
    overflow: { truncate: 'Truncate', all: 'Show all', rows: 'Choose rows…' },
    state: { fresh: 'Up to date', stale: 'Out of date', updating: 'Updating…', frozen: 'Frozen', broken: 'Broken', waiting: 'Waiting' },
    what: { chart: 'chart', range: 'table', cell: 'value', image: 'image' },
    accessRemoved: 'Access removed',
    sourceDeleted: 'Source deleted',
    frozenOn: (date) => `Frozen · ${date}`,
    waiting: 'Waiting for the source',
    justNow: 'just now',
    minutes: (m) => `${m} min ago`,
    hours: (h) => `${h} h ago`,
    on: (date) => `on ${date}`,
    prop: { fill: 'Fill', bold: 'Bold', italic: 'Italic', color: 'Text colour' },
    removed: (prop) => `${prop} removed`,
  },
);

export const MODE_LABEL: Record<LinkMode, string> = t.mode;

export const MODE_HINT: Record<LinkMode, string> = t.modeHint;

export const CARRIES_LABEL: Record<Carries, string> = t.carries;

export const THEME_LABEL: Record<LinkTheme, string> = t.theme;

export const OVERFLOW_LABEL: Record<Overflow, string> = t.overflow;

/** What a source kind carries when nothing else is said. */
export function defaultCarries(ref: SourceRef): Carries {
  return ref.kind === 'chart' ? 'chart' : ref.kind === 'image' ? 'picture' : ref.kind === 'cell' ? 'value' : 'table';
}

export const STATE_LABEL: Record<LinkState, string> = t.state;

const WHAT: Record<SourceRef['kind'], string> = t.what;

export const shortDate = (at: number) => new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** The chip on a thread (Figma G1): « À jour · graphique », « Figé · 3 oct. », « Source supprimée ». */
export function chipLabel(def: LinkDef, state: LinkState): string {
  if (state === 'broken') return def.broken?.reason === 'access' ? t.accessRemoved : t.sourceDeleted;
  if (state === 'updating') return STATE_LABEL.updating;
  if (state === 'frozen') return t.frozenOn(shortDate(def.snapshot.at));
  if (state === 'waiting') return t.waiting;
  return `${STATE_LABEL[state]} · ${WHAT[def.source.ref.kind]}`;
}

/** The full name of a thread (hover, focus, lists): « Budget 2027 › Dépenses par mois → Lancement · diapo 5 ». */
export function fullLabel(def: LinkDef, targetTitle: string): string {
  return `${def.source.title} › ${def.source.label} → ${targetTitle} · ${def.target.label}`;
}

/** « il y a 2 min », « il y a 3 h », « le 3 oct. ». */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return t.justNow;
  const m = Math.round(s / 60);
  if (m < 60) return t.minutes(m);
  const h = Math.round(m / 60);
  if (h < 24) return t.hours(h);
  return t.on(shortDate(at));
}

// ---------------------------------------------------------------------------
// Local edits (Figma I6 §1)
// ---------------------------------------------------------------------------

/** The link's edits with one more (an edit with the same id replaces the old one: dragging a crop is one edit). */
export function withEdit(edits: LocalEdit[] | undefined, edit: LocalEdit): LocalEdit[] {
  return [...(edits ?? []).filter((e) => e.id !== edit.id), edit];
}

/** The link's edits without this one (undone, or applied to the source). */
export function withoutEdit(edits: LocalEdit[] | undefined, id: string): LocalEdit[] {
  return (edits ?? []).filter((e) => e.id !== id);
}

const isCellEdit = (p: unknown): p is CellStyleEdit => !!p && (p as CellStyleEdit).kind === 'cell-style';

/** The table with the copy's own cell styles over the source's (rows and columns found by id). */
export function applyCellEdits(table: LinkedTable, edits: LocalEdit[] | undefined): LinkedTable {
  const list = (edits ?? []).map((e) => e.patch).filter(isCellEdit);
  if (!list.length || !table.rowIds || !table.colIds) return table;
  const rows = table.rows.map((r) => r.map((c) => ({ ...c })));
  for (const e of list) {
    const ri = table.rowIds.indexOf(e.row);
    const ci = table.colIds.indexOf(e.col);
    const cell = rows[ri]?.[ci];
    if (!cell) continue;
    if (e.prop === 'bold' || e.prop === 'italic') cell[e.prop] = !!e.value;
    else {
      if (e.value) cell[e.prop] = e.value as string;
      else delete cell[e.prop];
      cell.local = true;
    }
  }
  return { ...table, rows };
}

const PROP_LABEL: Record<CellStyleEdit['prop'], string> = t.prop;

/** « Fond #FFF4D6 · Total, T2 », « Gras retiré · Salaires, T1 ». */
export function cellEditLabel(e: CellStyleEdit, where: string): string {
  const what = e.prop === 'bold' || e.prop === 'italic' ? (e.value ? PROP_LABEL[e.prop] : t.removed(PROP_LABEL[e.prop])) : e.value ? `${PROP_LABEL[e.prop]} ${e.value}` : t.removed(PROP_LABEL[e.prop]);
  return `${what} · ${where}`;
}
