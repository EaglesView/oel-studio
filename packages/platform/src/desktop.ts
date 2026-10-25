/**
 * The desktop app's platform (apps/desktop, Tauri 2). Loaded only inside the app (the app checks
 * `isTauri()` and imports this module dynamically), so the web build never runs the Tauri API.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { tr } from '@oel/i18n';
import { runBeforeClose, type Platform } from './index';

/** The extension of `name`, without the dot, for the save dialog's filter. */
const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];

export const desktopPlatform: Platform = {
  kind: 'desktop',
  async saveFile(blob, name) {
    const ext = extensionOf(name);
    // The dialog adds the chosen path to the app's file system scope, so `writeFile` may write it.
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
    if (!path) return false;
    try {
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      return true;
    } catch (e) {
      // Plugin errors are plain strings; callers show this message as is.
      throw new Error(tr(`« ${name} » n’a pas pu être enregistré : ${String(e)}`, `“${name}” could not be saved: ${String(e)}`));
    }
  },
};

/** How long a close waits for pending writes before the window goes anyway. */
const CLOSE_WAIT_MS = 4000;

/** A link that leaves the app (another site, an email), or null for the app's own pages. */
function outside(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return null;
  }
  if (!/^(https?|mailto):$/.test(url.protocol) || url.origin === location.origin) return null;
  return url;
}

let started = false;

/**
 * What the app's window does that a browser tab doesn't (plan 2026-10-desktop, D-2). Called when
 * the platform is installed; later calls do nothing.
 */
export function startDesktopShell() {
  if (started) return;
  started = true;
  // Closing waits for what is pending to be written (the desk saves 400 ms after a change, and a
  // native close fires no `pagehide`). Once the handler resolves, Tauri destroys the window.
  void getCurrentWindow().onCloseRequested(async () => {
    await Promise.race([runBeforeClose(), new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]);
  });

  // Other sites open in the system browser. The app's own pages (the docs are bundled) stay in
  // its single window, including those linked with target=_blank.
  window.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || !(e.target instanceof Element)) return;
    const a = e.target.closest('a[href]');
    if (!(a instanceof HTMLAnchorElement)) return;
    const url = outside(a.href);
    if (url) {
      e.preventDefault();
      void openUrl(url.href);
    } else if (a.target === '_blank') {
      e.preventDefault();
      location.assign(a.href);
    }
  });
  const open = window.open.bind(window);
  window.open = (url, target, features) => {
    const out = url ? outside(String(url)) : null;
    if (!out) return open(url, target, features);
    void openUrl(out.href);
    return null;
  };
}
