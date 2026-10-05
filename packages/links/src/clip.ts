/**
 * The desk clipboard for links (Figma I1 d, I6 §5): a picture copied in a
 * desk file remembers where it comes from, so pasting it in another file
 * makes a linked copy. Pictures from outside (system clipboard files) are
 * inserted as before. One entry; copying anything else clears it.
 */
import type { LinkDef, LinkedValue } from './types';

export interface LinkClip {
  source: LinkDef['source'];
  value: Extract<LinkedValue, { kind: 'picture' }>;
  at: number;
}

let clip: LinkClip | null = null;
/** Older entries are not offered (the person has surely copied something else since). */
const MAX_AGE = 30 * 60_000;

export function setLinkClip(c: LinkClip | null) {
  clip = c;
}

/** The picture to paste linked, unless it comes from `docId` itself (a paste in the same file is a plain duplicate). */
export function linkClip(docId: string): LinkClip | null {
  if (!clip || Date.now() - clip.at > MAX_AGE || clip.source.docId === docId) return null;
  return clip;
}
