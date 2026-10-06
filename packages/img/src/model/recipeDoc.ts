/**
 * A recipe as a Yjs map: one key per leaf path (`presence.clarity`, `geometry.crop`…), so two
 * people moving different sliders never conflict and each slider is last-writer-wins. Unset
 * keys fall back to the layer below (gallery style, then defaults).
 */
import * as Y from 'yjs';
import { getLeaf, RECIPE_FIELDS, setLeaf, type Recipe } from '../recipe';

/** Every leaf path a recipe may hold. */
export const LEAF_PATHS: readonly string[] = RECIPE_FIELDS.map((f) => f.path);

/** `{ path: value }` for the leaves set in `r`. */
export function flattenRecipe(r: Recipe): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of LEAF_PATHS) {
    const v = getLeaf(r, p);
    if (v !== undefined) out[p] = v;
  }
  return out;
}

export function unflattenRecipe(entries: Iterable<[string, unknown]>): Recipe {
  let r: Recipe = {};
  for (const [k, v] of entries) if (v !== undefined && LEAF_PATHS.includes(k)) r = setLeaf(r, k, v);
  return r;
}

/** Leaves the crop tool and « Pivoter » own; styles and pasted settings leave them alone. */
export const isGeometryPath = (path: string) => path.startsWith('geometry.');

export class RecipeDoc {
  readonly undo: Y.UndoManager;

  constructor(readonly map: Y.Map<unknown>) {
    this.undo = new Y.UndoManager(map, { captureTimeout: 400 });
  }

  /** A recipe in its own Y.Doc. */
  static create(initial: Recipe = {}): RecipeDoc {
    return RecipeDoc.inDoc(new Y.Doc(), 'recipe', initial);
  }

  /**
   * The recipe stored as map `key` of `ydoc`: recipes edited together (a gallery's style and
   * its images) share a doc, so one `Y.UndoManager` can cover them all.
   */
  static inDoc(ydoc: Y.Doc, key: string, initial: Recipe = {}): RecipeDoc {
    const doc = new RecipeDoc(ydoc.getMap(key));
    if (!doc.map.size) {
      ydoc.transact(() => {
        for (const [k, v] of Object.entries(flattenRecipe(initial))) doc.map.set(k, v);
      });
    }
    doc.undo.clear();
    return doc;
  }

  recipe(): Recipe {
    return unflattenRecipe(this.map.entries());
  }

  get(path: string): unknown {
    return this.map.get(path);
  }

  /** Sets leaves in one undo step; `undefined` removes a leaf (falls back to the layer below). */
  update(entries: Record<string, unknown>) {
    this.map.doc!.transact(() => {
      for (const [k, v] of Object.entries(entries)) {
        if (!LEAF_PATHS.includes(k)) continue;
        if (v === undefined) this.map.delete(k);
        else if (JSON.stringify(this.map.get(k)) !== JSON.stringify(v)) this.map.set(k, v);
      }
    });
  }

  set(path: string, value: unknown) {
    this.update({ [path]: value });
  }

  /** Replaces every leaf except those `keep` accepts (a style or pasted settings keep geometry). */
  replace(r: Recipe, keep: (path: string) => boolean = () => false) {
    const next = flattenRecipe(r);
    const entries: Record<string, unknown> = {};
    for (const k of this.map.keys()) if (!keep(k) && !(k in next)) entries[k] = undefined;
    for (const [k, v] of Object.entries(next)) if (!keep(k)) entries[k] = v;
    this.update(entries);
  }

  /** Ends the current undo step (a new slider drag starts a new one). */
  stopCapturing() {
    this.undo.stopCapturing();
  }

  onChange(fn: () => void): () => void {
    this.map.observe(fn);
    return () => this.map.unobserve(fn);
  }

  destroy() {
    this.undo.destroy();
  }
}
