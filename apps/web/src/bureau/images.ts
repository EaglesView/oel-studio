/**
 * Bureau ↔ @oel/img: the image worker, saving exports, recipes and galleries (Figma L).
 *
 * Every recipe of the tab lives in one Y.Doc (one map per paper), so a gallery's style and its
 * pictures undo together; each recipe is mirrored on its paper (`data.image.recipe`,
 * `data.gallery.style`) until the desk itself is in Yjs (plan N). A background engine keeps
 * the desk pictures of retouched images up to date (`data.image.rendered`).
 */
import * as Y from 'yjs';
import ImageWorker from '@oel/img/worker?worker';
import { writeZip } from '@oel/engine';
import { ImageEngine, RecipeDoc, isEmptyRecipe, lookOf, originals, stackRecipes, unflattenRecipe, type ExportOptions, type Raster, type Recipe } from '@oel/img';
import type { Bureau, Paper } from './model';
import { tr } from '@oel/i18n';
import { namedWorker } from '../lang';
export { GALLERY_PAD, createGallery, layoutGallery } from './galleries';

/* ── platform seams (a native app replaces these) ─────────────────────────────────────────── */

export const createImageWorker = () => namedWorker(ImageWorker, 'oel-img');

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A rendering as an object URL (desk picture of a retouched image). */
export async function rasterUrl(r: Raster): Promise<string> {
  const c = new OffscreenCanvas(r.width, r.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer, r.data.byteOffset, r.data.byteLength), r.width, r.height), 0, 0);
  return URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.9 }));
}

/* ── recipes ──────────────────────────────────────────────────────────────────────────────── */

const recipes = new Y.Doc();
const docs = new Map<string, RecipeDoc>();

/** The recipe of an image (its own settings) or a gallery (its style). */
export function recipeDocFor(paperId: string, initial?: Recipe): RecipeDoc {
  let d = docs.get(paperId);
  if (!d) {
    d = RecipeDoc.inDoc(recipes, paperId, initial ?? {});
    docs.set(paperId, d);
  }
  return d;
}

const initialRecipe = (p: Paper) => (p.kind === 'gallery' ? p.data.gallery?.style : p.data.image?.recipe);
const docOf = (p: Paper) => recipeDocFor(p.id, initialRecipe(p));

/** One undo history over a gallery's style and its pictures (the atelier's Ctrl+Z). */
export function galleryUndo(paperIds: string[]): Y.UndoManager {
  return new Y.UndoManager(
    paperIds.map((id) => recipes.getMap(id)),
    { captureTimeout: 400 },
  );
}

const galleryOf = (store: Bureau, p: Paper): Paper | undefined => {
  const g = p.parent ? (store.node(p.parent.id) as Paper | undefined) : undefined;
  return g?.kind === 'gallery' ? g : undefined;
};

/** The style's look (a style never carries geometry). */
const lookRecipe = (r: Recipe) => unflattenRecipe(Object.entries(lookOf(r)));

/** What an image looks like: its own settings over its gallery's style. */
export function effectiveRecipe(store: Bureau, id: string): Recipe {
  const p = store.node(id) as Paper | undefined;
  if (!p) return {};
  const own = docOf(p).recipe();
  const g = galleryOf(store, p);
  return g ? stackRecipes([own, lookRecipe(docOf(g).recipe())]) : own;
}

export const hasOwnSettings = (store: Bureau, id: string) => {
  const p = store.node(id) as Paper | undefined;
  return !!p && Object.keys(lookOf(docOf(p).recipe())).length > 0;
};

export async function originalOf(p: Paper): Promise<Blob | null> {
  const hash = p.data.image?.original;
  return (hash && (await originals().get(hash))) || (p.data.imageUrl ? await fetch(p.data.imageUrl).then((r) => r.blob()).catch(() => null) : null);
}

/* ── background rendering of desk pictures ───────────────────────────────────────────────── */

let engine: Promise<ImageEngine> | null = null;
let engineSource: string | null = null;
const renderEngine = () => (engine ??= ImageEngine.create({ createWorker: createImageWorker, canvas: document.createElement('canvas') }));

/** The background engine, one job at a time (desk pictures, link copies, gallery exports). */
let engineLock: Promise<unknown> = Promise.resolve();
function withEngine<T>(fn: (e: ImageEngine) => Promise<T>): Promise<T> {
  const run = engineLock.then(async () => fn(await renderEngine()));
  engineLock = run.catch(() => {});
  return run;
}

/** Longest side of the pixels a link carries (a picture in a document or a slide). */
const LINK_LONG = 2400;

/**
 * `blob` rendered with `recipe`, as a file: what a linked copy shows (L-8: an image's look, or
 * a copy's own retouch over its source). PNG and WebP stay PNG, anything else becomes JPEG.
 */
export function renderWithRecipe(blob: Blob, recipe: Recipe, maxLong = LINK_LONG): Promise<Blob> {
  return withEngine(async (e) => {
    await e.setSource(blob);
    engineSource = null;
    e.setRecipe(recipe);
    const png = blob.type === 'image/png' || blob.type === 'image/webp';
    return e.export({ mime: png ? 'image/png' : 'image/jpeg', quality: 0.92, maxLong });
  });
}

/**
 * The pixels an image paper's linked copies show (L-8): its original, or its rendering when it
 * is retouched (its own settings over its gallery's style). `key` changes with either.
 */
export async function linkPictureOf(store: Bureau, id: string): Promise<{ key: string; blob: Blob } | null> {
  const p = store.node(id) as Paper | undefined;
  const key = linkPictureKey(store, id);
  if (!p || key == null) return null;
  const r = effectiveRecipe(store, id);
  const blob = await originalOf(p);
  if (!blob) return null;
  return { key, blob: isEmptyRecipe(r) ? blob : await renderWithRecipe(blob, r) };
}

/** The key `linkPictureOf` would give now, without rendering (to notice changes). */
export function linkPictureKey(store: Bureau, id: string): string | null {
  const p = store.node(id) as Paper | undefined;
  if (!p || p.kind !== 'image') return null;
  const r = effectiveRecipe(store, id);
  return `${p.data.image?.original ?? p.data.imageUrl ?? ''}\n${isEmptyRecipe(r) ? '' : JSON.stringify(r)}`;
}

const queue = new Set<string>();
let running = false;

/** Re-render an image's desk picture soon (after edits settle). */
export function queueRender(store: Bureau, id: string) {
  queue.add(id);
  if (running) return;
  running = true;
  void (async () => {
    await new Promise((r) => setTimeout(r, 400));
    while (queue.size) {
      const next = queue.values().next().value!;
      queue.delete(next);
      await renderOne(store, next).catch((e) => console.warn('Rendu de l’image impossible', e));
    }
    running = false;
  })();
}

async function renderOne(store: Bureau, id: string) {
  const p = store.node(id) as Paper | undefined;
  if (!p || p.kind !== 'image') return;
  const r = effectiveRecipe(store, id);
  let rendered: string | undefined;
  if (!isEmptyRecipe(r)) {
    const blob = await originalOf(p);
    if (!blob) return;
    const key = p.data.image?.original ?? p.data.imageUrl ?? id;
    const raster = await withEngine(async (e) => {
      if (engineSource !== key) {
        await e.setSource(blob);
        engineSource = key;
      }
      return e.raster(640, r);
    });
    rendered = await rasterUrl(raster);
  }
  const cur = store.node(id) as Paper | undefined;
  if (!cur) return;
  const old = cur.data.image?.rendered;
  store.update(id, { data: { ...cur.data, image: { ...cur.data.image, rendered } } }, { history: false });
  if (old && old !== rendered) setTimeout(() => URL.revokeObjectURL(old), 1000);
}

/* ── keeping papers and recipes in step ───────────────────────────────────────────────────── */

let boundStore: Bureau | null = null;

/**
 * Mirrors recipes on their papers and re-renders what they change; when a picture leaves its
 * gallery, it keeps its look (the style is written into its own settings).
 */
export function bindImages(store: Bureau): () => void {
  boundStore = store;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const mirror = (id: string) => {
    const p = store.node(id) as Paper | undefined;
    const d = docs.get(id);
    if (!p || !d) return;
    const r = d.recipe();
    if (p.kind === 'gallery') {
      store.update(id, { data: { ...p.data, gallery: { ...p.data.gallery, style: r }, updatedAt: Date.now() } }, { history: false });
      for (const c of store.childrenOf(id)) if (c.kind === 'image') queueRender(store, c.id);
    } else if (p.kind === 'image') {
      store.update(id, { data: { ...p.data, image: { ...p.data.image, recipe: r }, updatedAt: Date.now() } }, { history: false });
      queueRender(store, id);
    }
  };
  const onTx = (tr: Y.Transaction) => {
    const changed = [...tr.changed.keys()] as unknown[];
    for (const [id, d] of docs) {
      if (!changed.includes(d.map)) continue;
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => mirror(id), 250));
    }
  };
  recipes.on('afterTransaction', onTx);

  // Pictures entering or leaving a gallery.
  let parents = new Map<string, string | undefined>();
  const snapshot = () => new Map(store.nodes.filter((n) => n.kind === 'image').map((n) => [n.id, n.parent?.id]));
  parents = snapshot();
  const unsub = store.subscribe(() => {
    const next = snapshot();
    for (const [id, parent] of next) {
      const before = parents.get(id);
      if (before === parent) continue;
      const left = before ? (store.node(before) as Paper | undefined) : undefined;
      if (left?.kind === 'gallery') {
        const own = recipeDocFor(id, (store.node(id) as Paper).data.image?.recipe);
        const style = lookRecipe(docOf(left).recipe());
        if (!isEmptyRecipe(style)) own.replace(stackRecipes([own.recipe(), style]));
      }
      if (before !== undefined || parent !== undefined) queueRender(store, id);
    }
    parents = next;
  });
  return () => {
    recipes.off('afterTransaction', onTx);
    unsub();
    for (const t of timers.values()) clearTimeout(t);
    if (boundStore === store) boundStore = null;
  };
}

/* ── galleries ────────────────────────────────────────────────────────────────────────────── */

/** « Exporter les N » : every picture with its effective settings, in one .zip. */
export async function exportGallery(store: Bureau, galleryId: string, o: ExportOptions, ext: string) {
  const g = store.node(galleryId) as Paper | undefined;
  if (!g) return;
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const names = new Set<string>();
  for (const k of store.childrenOf(galleryId)) {
    if (k.kind !== 'image') continue;
    const p = k as Paper;
    const blob = await originalOf(p);
    if (!blob) continue;
    const out = await withEngine(async (e) => {
      await e.setSource(blob);
      engineSource = p.data.image?.original ?? p.data.imageUrl ?? p.id;
      e.setRecipe(effectiveRecipe(store, p.id));
      return e.export(o);
    });
    const base = (p.data.fileName ?? p.title).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-') || 'image';
    let name = `${base}.${ext}`;
    for (let i = 2; names.has(name); i++) name = `${base} (${i}).${ext}`;
    names.add(name);
    files.push({ name, data: new Uint8Array(await out.arrayBuffer()) });
  }
  if (!files.length) throw new Error(tr('Aucune image de la galerie n’a de fichier à exporter.', 'No image in the gallery has a file to export.'));
  const zip = writeZip(files);
  saveFile(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${(g.title || tr('galerie', 'gallery')).replace(/[\\/:*?"<>|]+/g, '-')}.zip`);
}
