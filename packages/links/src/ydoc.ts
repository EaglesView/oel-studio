/**
 * Links inside a file's Y.Doc.
 *
 *   oel-links       Y.Map  link id → Y.Map { source, target, carries, mode, snapshot, broken,
 *                                              theme, view, edits }
 *                   (in the target file: the links its copies follow)
 *   oel-backlinks   Y.Map  link id → Backlink
 *                   (in the source file: where its content is used)
 *
 * Each link is a Y.Map of fields, so one person changing the mode while
 * another's client writes an update both win. Updates written by a resolver
 * use `LINK_ORIGIN`, which editors leave out of their undo stacks.
 */
import * as Y from 'yjs';
import type { Backlink, LinkDef } from './types';

/** Origin of writes made by link resolution (not by a person): never undone with Ctrl+Z. */
export const LINK_ORIGIN = Symbol('oel-link');

const FIELDS = ['source', 'target', 'carries', 'mode', 'snapshot', 'broken', 'theme', 'view', 'edits'] as const;

export class LinksDoc {
  readonly links: Y.Map<Y.Map<unknown>>;
  readonly backlinks: Y.Map<Backlink>;

  constructor(readonly doc: Y.Doc) {
    this.links = doc.getMap('oel-links');
    this.backlinks = doc.getMap('oel-backlinks');
  }

  // ----- links (target side) ----------------------------------------------

  list(): LinkDef[] {
    return [...this.links.keys()].map((id) => this.get(id)).filter((l): l is LinkDef => !!l);
  }

  get(id: string): LinkDef | null {
    const m = this.links.get(id);
    if (!m) return null;
    const out: Record<string, unknown> = { id };
    for (const f of FIELDS) {
      const v = m.get(f);
      if (v != null) out[f] = v;
    }
    return out.source && out.target && out.snapshot ? (out as unknown as LinkDef) : null;
  }

  /** The link whose copy is this object (slide element, document node). */
  byObject(objectId: string): LinkDef | null {
    for (const id of this.links.keys()) {
      const l = this.get(id);
      if (l?.target.objectId === objectId) return l;
    }
    return null;
  }

  put(def: LinkDef, origin: unknown = LINK_ORIGIN) {
    this.doc.transact(() => {
      const m = new Y.Map<unknown>();
      for (const f of FIELDS) if (def[f] != null) m.set(f, def[f]);
      this.links.set(def.id, m);
    }, origin);
  }

  /** Change some fields of a link; `null` removes a field (e.g. `broken`). */
  patch(id: string, patch: { [K in (typeof FIELDS)[number]]?: LinkDef[K] | null }, origin: unknown = LINK_ORIGIN) {
    const m = this.links.get(id);
    if (!m) return;
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) m.delete(k);
        else if (JSON.stringify(m.get(k)) !== JSON.stringify(v)) m.set(k, v);
      }
    }, origin);
  }

  remove(id: string, origin: unknown = LINK_ORIGIN) {
    if (this.links.has(id)) this.doc.transact(() => this.links.delete(id), origin);
  }

  // ----- backlinks (source side) ------------------------------------------

  backlinkList(): Backlink[] {
    return [...this.backlinks.values()];
  }

  /** Copies made from one chart (or range) of this file. */
  usesOf(match: (b: Backlink) => boolean): Backlink[] {
    return this.backlinkList().filter(match);
  }

  putBacklink(b: Backlink, origin: unknown = LINK_ORIGIN) {
    const cur = this.backlinks.get(b.linkId);
    if (cur && JSON.stringify(cur) === JSON.stringify(b)) return;
    this.doc.transact(() => this.backlinks.set(b.linkId, b), origin);
  }

  removeBacklink(linkId: string, origin: unknown = LINK_ORIGIN) {
    if (this.backlinks.has(linkId)) this.doc.transact(() => this.backlinks.delete(linkId), origin);
  }

  /** Called on any change to links or backlinks. */
  observe(fn: () => void): () => void {
    const h = () => fn();
    this.links.observeDeep(h);
    this.backlinks.observe(h);
    return () => {
      this.links.unobserveDeep(h);
      this.backlinks.unobserve(h);
    };
  }
}

const cache = new WeakMap<Y.Doc, LinksDoc>();
/** The links of a Y.Doc (one wrapper per doc). */
export function linksOf(doc: Y.Doc): LinksDoc {
  let l = cache.get(doc);
  if (!l) cache.set(doc, (l = new LinksDoc(doc)));
  return l;
}
