/**
 * What the desktop app's title bar shows and asks of the page (plan 2026-10-desktop, D-2). No Tauri
 * here: the Bureau writes to it in the browser too, where nothing reads it.
 */

/** The title bar's logo asks the Bureau to open its menu (M2) with this window event. */
export const APP_MENU_EVENT = 'oel:app-menu';

let openFile: string | null = null;
const subs = new Set<() => void>();

/** The file open in the Bureau (its name), or null on the desk. */
export function setOpenFile(name: string | null) {
  if (name === openFile) return;
  openFile = name;
  subs.forEach((fn) => fn());
}

export const getOpenFile = () => openFile;

export function subscribeOpenFile(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
