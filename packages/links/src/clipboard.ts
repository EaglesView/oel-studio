/**
 * Copying a linked copy copies its link (Figma G7 « Copier, déplacer ou
 * dupliquer la copie liée »: the link follows the object). Editors remember the
 * links of what they copy or cut; a paste then makes a new link, to the same
 * source, for the pasted object — in the same file or another one.
 */
import type { LinksDoc } from './ydoc';
import type { LinkDef } from './types';

/** Links of recent copies and cuts, by the object id they had (each editor has its own clipboard, so keep a few). */
const copied = new Map<string, LinkDef>();
const KEEP = 64;

export const newLinkId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Called on copy/cut with the links of the copied objects. */
export function rememberCopied(defs: Array<LinkDef | null | undefined>) {
  for (const d of defs) {
    if (!d) continue;
    copied.delete(d.target.objectId);
    copied.set(d.target.objectId, d);
  }
  while (copied.size > KEEP) copied.delete(copied.keys().next().value!);
}

/**
 * `objectId` was pasted from `fromObjectId`: give it a link of its own to the
 * same source, with the same mode and what it carries. The source is the one
 * the copy showed, so the new link starts with the same snapshot.
 */
export function adoptCopy(links: LinksDoc, fromObjectId: string, objectId: string, label: string, origin: unknown = 'person'): LinkDef | null {
  const def = links.byObject(fromObjectId) ?? copied.get(fromObjectId);
  if (!def || def.target.objectId === objectId) return null;
  const next: LinkDef = { ...def, id: newLinkId(), target: { objectId, label } };
  delete next.broken;
  links.put(next, origin);
  return next;
}
