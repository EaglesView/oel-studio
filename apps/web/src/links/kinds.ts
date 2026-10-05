/**
 * What the resolver needs from each kind of file (plan I-2): a **source**
 * reads what a link points at, a **target** holds the copies. The resolver
 * core (links, states, threads, backlinks) never looks inside a file; new
 * kinds (images, tables, values) plug in here. Later this moves onto the
 * Phase-3 `KindModule` registry.
 */
import type * as Y from 'yjs';
import { revOf, type LinkedValue, type SourceRef } from '@oel/links';

/** A file some copies read from, opened and watched. */
export interface LinkSource {
  docId: string;
  /** Where backlinks live (« Utilisé dans… »); none for sources without a document (desk images). */
  ydoc: Y.Doc | null;
  /** What a copy of `ref` shows now: `null` when the object is gone, `undefined` when it could not be read yet. */
  read(ref: SourceRef): Promise<LinkedValue | null | undefined>;
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
  /** Write a new value into the copy (inside the caller's transaction). False when the copy is gone. */
  write(objectId: string, value: LinkedValue): boolean;
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
