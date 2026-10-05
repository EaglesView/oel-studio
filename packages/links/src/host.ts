/**
 * What editors need from the app about links: the state of a copy, and a way
 * to manage it (the app shows the thread popover, Figma G3/G4). Editors don't
 * know about the desk or other files; the app installs a host, and without one
 * copies show their mode only.
 */
import type { LinkState } from './types';

export interface LinkHost {
  /** State of a link by id (`waiting` when unknown). */
  state(linkId: string): LinkState;
  /** Open the link popover next to a rectangle on screen (the copy's badge). */
  manage(linkId: string, anchor: { x: number; y: number; width: number; height: number }): void;
  /** Update a manual link now. */
  update(linkId: string): void;
  /** « Délier »: the copy stays as it is, with no link. */
  unlink(linkId: string): void;
  /** Called on any state change. */
  subscribe(fn: () => void): () => void;
  /** The link whose copy is this object (ids are unique across files), with its state; for editors without the Y.Doc at hand. */
  copyOf(objectId: string): { linkId: string; source: string; state: LinkState; frozen: boolean } | null;
}

const NONE: LinkHost = {
  state: () => 'waiting',
  manage: () => {},
  update: () => {},
  unlink: () => {},
  copyOf: () => null,
  subscribe: () => () => {},
};

let current: LinkHost = NONE;
const listeners = new Set<() => void>();

export function setLinkHost(host: LinkHost | null) {
  current = host ?? NONE;
  listeners.forEach((f) => f());
}

export function linkHost(): LinkHost {
  return current;
}

/** Called when the host itself changes (install/uninstall). */
export function onLinkHost(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
