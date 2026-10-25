/**
 * Which platform the page runs on: the browser, or the desktop app (apps/desktop, Tauri 2), which
 * marks its webview with `isTauri`. One build serves both; the desktop module is only loaded inside
 * the app. Imported for its effect by `LocaleRoot`, so it runs before any island renders.
 * Plan `docs/plans/2026-10-desktop.md`, D-1 and D-2.
 */
import { installPlatform, onBeforeClose } from '@oel/platform';

export const inDesktopApp = Boolean((globalThis as { isTauri?: boolean }).isTauri);

if (inDesktopApp) {
  installPlatform(
    import('@oel/platform/desktop').then((m) => {
      m.startDesktopShell();
      return m.desktopPlatform;
    }),
  );
  void import('./desktop/mount').then((m) => m.mountTitleBar());
  // Before the window closes, wait until the writes the other handlers start (the desk's) are
  // stored. Loaded on demand: the site's pages load this module too, and don't need Yjs.
  onBeforeClose(() => import('@oel/collab-client').then((m) => m.settleDeviceWrites()));
}
