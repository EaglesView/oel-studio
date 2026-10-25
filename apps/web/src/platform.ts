/**
 * Which platform the page runs on: the browser, or the desktop app (apps/desktop, Tauri 2), which
 * marks its webview with `isTauri`. One build serves both; the desktop module is only loaded inside
 * the app. Imported for its effect by `LocaleRoot`, so it runs before any island renders.
 * Plan `docs/plans/2026-10-desktop.md`, D-1 and D-2.
 */
import { installPlatform } from '@oel/platform';

export const inDesktopApp = Boolean((globalThis as { isTauri?: boolean }).isTauri);

if (inDesktopApp) {
  installPlatform(
    import('@oel/platform/desktop').then((m) => {
      m.startDesktopShell();
      return m.desktopPlatform;
    }),
  );
}
