/**
 * Recipes (`oel-img-recipe@1`) on the TypeScript side: the generated types, the field table, and
 * the same layering as `crates/oel-img/src/recipe.rs` (a leaf set in an upper layer wins).
 */
import { RECIPE_FIELDS, RECIPE_FORMAT, type FieldSpec, type Recipe } from '@oel/engine/generated/oelimg';

export type { FieldSpec, Recipe } from '@oel/engine/generated/oelimg';
export { RECIPE_FIELDS, RECIPE_FORMAT };

type Tree = { [k: string]: unknown };

const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v);

function over(top: Tree, base: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(top)) {
    if (v === undefined) continue;
    out[k] = isTree(v) && isTree(base[k]) ? over(v, base[k] as Tree) : v;
  }
  return out;
}

/** Effective layer for a stack ordered from most specific (image overrides) to most general (gallery style). */
export function stackRecipes(layers: readonly (Recipe | null | undefined)[]): Recipe {
  return layers.reduceRight<Tree>((acc, l) => (l ? over(l as Tree, acc) : acc), {}) as Recipe;
}

/** A leaf by its path (`presence.clarity`), or `undefined` when unset. */
export function getLeaf(r: Recipe, path: string): unknown {
  let v: unknown = r;
  for (const k of path.split('.')) {
    if (!isTree(v)) return undefined;
    v = v[k];
  }
  return v;
}

/** A copy of `r` with one leaf set (`undefined` removes it and empty groups). */
export function setLeaf(r: Recipe, path: string, value: unknown): Recipe {
  const [k, ...rest] = path.split('.') as [string, ...string[]];
  const tree = { ...(r as Tree) };
  if (rest.length === 0) {
    if (value === undefined) delete tree[k];
    else tree[k] = value;
  } else {
    const child = setLeaf((isTree(tree[k]) ? tree[k] : {}) as Recipe, rest.join('.'), value) as Tree;
    if (Object.keys(child).length) tree[k] = child;
    else delete tree[k];
  }
  return tree as Recipe;
}

const FIELDS = new Map<string, FieldSpec>(RECIPE_FIELDS.map((f) => [f.path, f]));

const OTHER_DEFAULTS: Record<string, unknown> = {
  'toneCurve.rgb': [[0, 0], [1, 1]],
  'toneCurve.r': [[0, 0], [1, 1]],
  'toneCurve.g': [[0, 0], [1, 1]],
  'toneCurve.b': [[0, 0], [1, 1]],
  'geometry.crop': [0, 0, 1, 1],
  'geometry.flipH': false,
  'geometry.flipV': false,
  'geometry.aspect': 'original',
};

export const fieldSpec = (path: string): FieldSpec | undefined => FIELDS.get(path);

/** Effective value of a leaf: set, else its default. */
export function leafValue(r: Recipe, path: string): unknown {
  const v = getLeaf(r, path);
  if (v !== undefined) return v;
  return OTHER_DEFAULTS[path] ?? FIELDS.get(path)?.default;
}

/** The frame the crop is normalised to: the source after its quarter turns. */
export function frameSize(r: Recipe, w: number, h: number): { width: number; height: number } {
  return (Number(leafValue(r, 'geometry.rotate')) || 0) % 2 === 1 ? { width: h, height: w } : { width: w, height: h };
}

/** Output size of a `w × h` source (the crop of the turned frame), as the renderer computes it. */
export function outputSize(r: Recipe, w: number, h: number): { width: number; height: number } {
  const f = frameSize(r, w, h);
  const [x0, y0, x1, y1] = leafValue(r, 'geometry.crop') as [number, number, number, number];
  return { width: Math.max(1, Math.round(Math.abs(x1 - x0) * f.width)), height: Math.max(1, Math.round(Math.abs(y1 - y0) * f.height)) };
}

/** No leaf set: the image looks like its original. */
export const isEmptyRecipe = (r: Recipe | null | undefined): boolean => !r || JSON.stringify(stackRecipes([r])) === '{}';
