/**
 * Platform seam: the few things the browser and the desktop app (apps/desktop, Tauri) do
 * differently. Packages call these functions; only the app chooses the platform, once, before any
 * island renders (`installPlatform`). Until then — and in tests — the web platform answers.
 *
 * Plan `docs/plans/2026-10-desktop.md`, D-1 and D-2. Today: saving a copy of a file, and work to
 * finish before the window closes. Pickers and real paths come with D-3.
 */

export interface Platform {
  kind: 'web' | 'desktop';
  /**
   * Save a copy of a file (« Exporter », « Télécharger »): a download on the web, a save dialog on
   * the desktop. Resolves to `false` when the person cancels; rejects with a message fit to show
   * the person when the file can't be written.
   */
  saveFile(blob: Blob, name: string): Promise<boolean>;
}

/** The browser: the file goes to the downloads, named `name`. */
export const webPlatform: Platform = {
  kind: 'web',
  async saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoking at once can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  },
};

let current: Promise<Platform> = Promise.resolve(webPlatform);

/** Choose the platform (the app does, at startup). Calls made before it resolves wait for it. */
export function installPlatform(p: Platform | Promise<Platform>): void {
  current = Promise.resolve(p).catch((e: unknown) => {
    console.error('Platform could not start; using the web platform', e);
    return webPlatform;
  });
}

export function platform(): Promise<Platform> {
  return current;
}

/** Save a copy of `data` as `name` (see `Platform.saveFile`). `type` is the MIME type when `data` isn't a Blob. */
export async function saveFile(data: Blob | BlobPart, name: string, type = 'application/octet-stream'): Promise<boolean> {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  return (await current).saveFile(blob, name);
}

/* ── closing ───────────────────────────────────────────────────────────────────────────────── */

const beforeClose = new Set<() => unknown>();

/**
 * Work to finish before the desktop app's window closes (write what is pending). The page also
 * keeps its `pagehide` handlers: the browser fires those, a native close may not.
 */
export function onBeforeClose(fn: () => unknown): () => void {
  beforeClose.add(fn);
  return () => void beforeClose.delete(fn);
}

/**
 * Run every `onBeforeClose` handler. They all start in the same tick, so a handler that waits for
 * storage (`settleDeviceWrites`) also waits for the writes the others start. Never rejects.
 */
export async function runBeforeClose(): Promise<void> {
  const running = [...beforeClose].map((fn) => {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  });
  for (const r of await Promise.allSettled(running)) if (r.status === 'rejected') console.error('Before close', r.reason);
}
