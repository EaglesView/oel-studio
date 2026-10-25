/**
 * The desktop app's platform (apps/desktop, Tauri 2). Loaded only inside the app (the app checks
 * `isTauri()` and imports this module dynamically), so the web build never runs the Tauri API.
 */
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { lang, tr } from '@oel/i18n';
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

/** Types for the files people usually drop (the engines detect kinds by name and content; this keeps a sensible MIME type on the File). */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * Linux and macOS: the window takes file drops natively (they carry the files' paths, which D-3
 * needs). They reach the page as the HTML drag events it already handles (the desk, the editors),
 * with the files read from disk. Windows keeps HTML drops (`main.rs`): its native handler would also
 * swallow drags inside the page.
 */
function bridgeFileDrops() {
  let names: string[] = [];
  let target: Element | null = null;
  const fire = (type: 'dragover' | 'dragleave' | 'drop', x: number, y: number, files: File[]) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    const at = document.elementFromPoint(x, y) ?? document.body;
    if (target && target !== at) target.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: at, dataTransfer: dt }));
    target = at;
    at.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  };
  // While hovering, the files aren't read yet: empty stand-ins give the page their count and names.
  const placeholders = () => names.map((n) => new File([], baseName(n)));
  void getCurrentWebview().onDragDropEvent(async ({ payload: e }) => {
    if (e.type === 'leave') {
      target?.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null }));
      target = null;
      return;
    }
    const x = e.position.x / devicePixelRatio;
    const y = e.position.y / devicePixelRatio;
    if (e.type === 'enter') names = e.paths;
    if (e.type !== 'drop') return fire('dragover', x, y, placeholders());
    const files: File[] = [];
    for (const path of e.paths) {
      const name = baseName(path);
      try {
        const bytes = await readFile(path);
        files.push(new File([bytes], name, { type: MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '' }));
      } catch (err) {
        // A folder, or a file that can't be read: the others still arrive.
        console.error(`Dropped “${name}” could not be read`, err);
      }
    }
    names = [];
    if (files.length) fire('drop', x, y, files);
    else fire('dragleave', x, y, []);
    target = null;
  });
}

/**
 * macOS: the app menu, in the page's language (rebuilt on each page load, so a language change
 * shows at once). Édition is required there: without it, ⌘C / ⌘V don't reach the page. Quitting and
 * closing go through the window's close, so they wait for pending saves too. Windows and Linux have
 * no menu bar: the title bar's logo opens the Bureau menu, and the page handles its shortcuts.
 * Ouvrir, Enregistrer and Exporter join Fichier with files on disk (D-3).
 */
async function installMacMenu() {
  const close = () => void getCurrentWindow().close();
  const item = (text: string, action: () => void, accelerator?: string) => MenuItem.new({ text, action, accelerator });
  const pre = (it: 'Separator' | 'Copy' | 'Cut' | 'Paste' | 'SelectAll' | 'Undo' | 'Redo' | 'Minimize' | 'Maximize' | 'Fullscreen' | 'Hide' | 'HideOthers' | 'ShowAll' | 'Services' | 'BringAllToFront', text?: string) =>
    PredefinedMenuItem.new({ item: it, text });
  const docs = lang() === 'en' ? '/en/docs' : '/docs';
  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'Bureau',
        items: [
          await PredefinedMenuItem.new({ item: { About: null }, text: tr('À propos du Bureau', 'About Bureau') }),
          await pre('Separator'),
          await pre('Services', tr('Services', 'Services')),
          await pre('Separator'),
          await pre('Hide', tr('Masquer le Bureau', 'Hide Bureau')),
          await pre('HideOthers', tr('Masquer les autres', 'Hide Others')),
          await pre('ShowAll', tr('Tout afficher', 'Show All')),
          await pre('Separator'),
          await item(tr('Quitter le Bureau', 'Quit Bureau'), close, 'Cmd+Q'),
        ],
      }),
      await Submenu.new({
        text: tr('Fichier', 'File'),
        items: [await item(tr('Fermer la fenêtre', 'Close Window'), close, 'Cmd+W')],
      }),
      await Submenu.new({
        text: tr('Édition', 'Edit'),
        items: [
          await pre('Undo', tr('Annuler', 'Undo')),
          await pre('Redo', tr('Rétablir', 'Redo')),
          await pre('Separator'),
          await pre('Cut', tr('Couper', 'Cut')),
          await pre('Copy', tr('Copier', 'Copy')),
          await pre('Paste', tr('Coller', 'Paste')),
          await pre('SelectAll', tr('Tout sélectionner', 'Select All')),
        ],
      }),
      await Submenu.new({
        text: tr('Affichage', 'View'),
        items: [await pre('Fullscreen', tr('Plein écran', 'Enter Full Screen'))],
      }),
      await Submenu.new({
        text: tr('Fenêtre', 'Window'),
        items: [await pre('Minimize', tr('Réduire', 'Minimize')), await pre('Maximize', tr('Zoom', 'Zoom')), await pre('Separator'), await pre('BringAllToFront', tr('Tout ramener au premier plan', 'Bring All to Front'))],
      }),
      await Submenu.new({
        text: tr('Aide', 'Help'),
        items: [await item(tr('Documentation du Bureau', 'Bureau documentation'), () => location.assign(docs))],
      }),
    ],
  });
  await menu.setAsAppMenu();
}

let started = false;

/**
 * What the app's window does that a browser tab doesn't (plan 2026-10-desktop, D-2). Called when
 * the platform is installed; later calls do nothing.
 */
export function startDesktopShell() {
  if (started) return;
  started = true;
  if (!/Windows/.test(navigator.userAgent)) bridgeFileDrops();
  if (/Macintosh|Mac OS X/.test(navigator.userAgent)) installMacMenu().catch((e: unknown) => console.error('App menu', e));
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

/** The app's window, for its title bar (apps/web/src/desktop). */
export { getCurrentWindow as desktopWindow } from '@tauri-apps/api/window';
