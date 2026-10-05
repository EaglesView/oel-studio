/** Revisions, states, cycles and the words for them (Figma G1, G3, G6, G7). */
import type { Carries, LinkDef, LinkMode, LinkState, LinkTheme, LocalEdit, Overflow, SourceRef } from './types';

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
// Words (fr-CA)
// ---------------------------------------------------------------------------

export const MODE_LABEL: Record<LinkMode, string> = { live: 'En direct', manual: 'Manuel', frozen: 'Figé' };

export const MODE_HINT: Record<LinkMode, string> = {
  live: 'Suit chaque changement de la source, en moins d’une seconde.',
  manual: 'Signale les changements, puis met à jour sur demande.',
  frozen: 'Ne change plus jamais (une photo de la source).',
};

export const CARRIES_LABEL: Record<Carries, string> = { chart: 'Graphique et style', 'chart-data': 'Données seulement', picture: 'Image', table: 'Tableau', value: 'Valeur' };

export const THEME_LABEL: Record<LinkTheme, string> = { source: 'Thème du tableur', target: 'Thème du document' };

export const OVERFLOW_LABEL: Record<Overflow, string> = { truncate: 'Tronquer', all: 'Tout afficher', rows: 'Choisir les lignes…' };

/** What a source kind carries when nothing else is said. */
export function defaultCarries(ref: SourceRef): Carries {
  return ref.kind === 'chart' ? 'chart' : ref.kind === 'image' ? 'picture' : ref.kind === 'cell' ? 'value' : 'table';
}

export const STATE_LABEL: Record<LinkState, string> = {
  fresh: 'À jour',
  stale: 'En retard',
  updating: 'Mise à jour…',
  frozen: 'Figé',
  broken: 'Rompu',
  waiting: 'En attente',
};

const WHAT: Record<SourceRef['kind'], string> = { chart: 'graphique', range: 'tableau', cell: 'valeur', image: 'image' };

export const shortDate = (at: number) => new Date(at).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });

/** The chip on a thread (Figma G1): « À jour · graphique », « Figé · 3 oct. », « Source supprimée ». */
export function chipLabel(def: LinkDef, state: LinkState): string {
  if (state === 'broken') return def.broken?.reason === 'access' ? 'Accès retiré' : 'Source supprimée';
  if (state === 'updating') return 'Mise à jour…';
  if (state === 'frozen') return `Figé · ${shortDate(def.snapshot.at)}`;
  if (state === 'waiting') return 'En attente de la source';
  return `${STATE_LABEL[state]} · ${WHAT[def.source.ref.kind]}`;
}

/** The full name of a thread (hover, focus, lists): « Budget 2027 › Dépenses par mois → Lancement · diapo 5 ». */
export function fullLabel(def: LinkDef, targetTitle: string): string {
  return `${def.source.title} › ${def.source.label} → ${targetTitle} · ${def.target.label}`;
}

/** « il y a 2 min », « il y a 3 h », « le 3 oct. ». */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${shortDate(at)}`;
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
