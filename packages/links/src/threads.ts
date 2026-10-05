/**
 * Desk threads are derived from the links stored in the files: for every
 * paper whose file holds links, one thread per link from the source paper.
 * A link whose source is not on this desk draws no thread (Figma G7).
 */
import { chipLabel, fullLabel } from './model';
import type { LinkDef, LinkState } from './types';

/** Prefix of thread ids owned by links (others, like form threads, are left alone). */
export const THREAD_PREFIX = 'oel-link:';

export interface Thread {
  id: string;
  linkId: string;
  from: string;
  to: string;
  /** Chip text (« À jour · graphique »). */
  label: string;
  /** Full name, shown on hover and focus and read by screen readers. */
  title: string;
  state: LinkState;
}

export interface ResolvedLink {
  def: LinkDef;
  /** File that holds the copy. */
  targetDocId: string;
  state: LinkState;
}

export function deriveThreads(papers: Array<{ id: string; title: string; docId?: string }>, links: ResolvedLink[]): Thread[] {
  const byDoc = new Map<string, { id: string; title: string }>();
  for (const p of papers) if (p.docId && !byDoc.has(p.docId)) byDoc.set(p.docId, p);
  const out: Thread[] = [];
  for (const l of links) {
    const from = byDoc.get(l.def.source.docId);
    const to = byDoc.get(l.targetDocId);
    if (!from || !to) continue;
    out.push({
      id: THREAD_PREFIX + l.def.id,
      linkId: l.def.id,
      from: from.id,
      to: to.id,
      label: chipLabel(l.def, l.state),
      title: fullLabel(l.def, to.title),
      state: l.state,
    });
  }
  return out;
}
