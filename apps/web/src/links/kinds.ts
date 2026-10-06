/**
 * What the resolver needs from each kind of file (plan I-2): a **source**
 * reads what a link points at, a **target** holds the copies. The resolver
 * core (links, states, threads, backlinks) never looks inside a file; new
 * kinds (images, tables, values) plug in here. Later this moves onto the
 * Phase-3 `KindModule` registry.
 */
import type * as Y from 'yjs';
import { revOf, type LinkDef, type LinkedValue, type SourceRef } from '@oel/links';

/** A file some copies read from, opened and watched. */
export interface LinkSource {
  docId: string;
  /** Where backlinks live (« Utilisé dans… »); none for sources without a document (desk images). */
  ydoc: Y.Doc | null;
  /** What a copy of `ref` shows now: `null` when the object is gone, `undefined` when it could not be read yet. */
  read(ref: SourceRef): Promise<LinkedValue | null | undefined>;
  /** « Appliquer à la source » (Figma I6 §1): write a copy's local edit into the source. False when this source can't. */
  applyEdit?(ref: SourceRef, patch: unknown): boolean;
  /** Called on any change that may change what `read` returns. */
  onChange(fn: () => void): () => void;
  dispose(): void;
}

/** A file that holds copies. */
export interface LinkTarget {
  kind: 'slides' | 'document';
  ydoc: Y.Doc;
  /** Whether the copy is still in the file (deleted copies sleep until undo brings them back). */
  exists(objectId: string): boolean;
  /** The copy's current value, as the link carries it. */
  current(objectId: string): LinkedValue | null;
  /**
   * Get ready to write `value` into the copy `objectId` (async work that can't
   * happen inside a transaction: copying a picture's bytes into the file's
   * media, rendering a copy's own retouch over them). False when the value
   * can't be written yet.
   */
  prepare?(value: LinkedValue, objectId: string): Promise<boolean>;
  /** Write a new value into the copy (inside the caller's transaction), as `link` says (theme…). False when the copy is gone. */
  write(objectId: string, value: LinkedValue, link: LinkDef): boolean;
  /** Remove the copy (« Annuler » right after « Lier »). */
  remove(objectId: string): void;
}

/**
 * Revision of a value. Charts keep the revision of their bare spec, which is
 * what links made before plan I stored, so they don't all turn stale.
 */
export function valueRev(v: LinkedValue): string {
  return v.kind === 'chart' ? revOf(v.spec) : revOf(v);
}

/**
 * Pictures already copied into a target file, by hash → package path, so
 * each picture's bytes are added to a file's media once.
 */
export const linkMedia = (ydoc: Y.Doc): Y.Map<string> => ydoc.getMap('oel-link-media');

/** Copy a picture's bytes into a file's media (once). */
export async function preparePicture(ydoc: Y.Doc, value: LinkedValue, add: (blob: Blob) => Promise<string>, bytes: (hash: string) => Blob | undefined): Promise<boolean> {
  if (value.kind !== 'picture') return true;
  const media = linkMedia(ydoc);
  if (media.has(value.media.hash)) return true;
  const blob = bytes(value.media.hash);
  if (!blob) return false;
  const path = await add(blob);
  media.set(value.media.hash, path);
  return true;
}

/** A copy's own retouch rendered over new source pixels (L-8), ready for `write`. */
export interface LocalRetouch {
  /** The copy's rendering, in the file's media. */
  path: string;
  mime: string;
  /** Width / height of the rendering. */
  aspect: number;
  /** The source pixels it was made from (the copy's « original »), in the file's media. */
  orig: string;
  recipe: Record<string, unknown>;
}

/**
 * Re-render a copy's own retouch (`recipe`) over the source's new pixels and store the result
 * in the file's media; `null` when the copy has no retouch of its own.
 */
export async function prepareLocalRetouch(
  ydoc: Y.Doc,
  value: LinkedValue,
  recipe: Record<string, unknown> | null | undefined,
  add: (blob: Blob) => Promise<string>,
  bytes: (hash: string) => Blob | undefined,
  render: (blob: Blob, recipe: Record<string, unknown>) => Promise<Blob>,
): Promise<LocalRetouch | null> {
  if (value.kind !== 'picture' || !recipe || !Object.keys(recipe).length) return null;
  const orig = linkMedia(ydoc).get(value.media.hash);
  const source = bytes(value.media.hash);
  if (!orig || !source) return null;
  const out = await render(source, recipe);
  const bmp = await createImageBitmap(out);
  const aspect = bmp.width / Math.max(1, bmp.height);
  bmp.close();
  return { path: await add(out), mime: out.type, aspect, orig, recipe };
}
