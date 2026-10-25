/**
 * Puts the title bar on the app's pages (plan 2026-10-desktop, D-2). Loaded only inside the desktop
 * app; the space it takes (`--emboss-inset-top`) is already reserved by `Base.astro` before first paint.
 */
import { createRoot } from 'react-dom/client';
import { TitleBar, detectOs } from './TitleBar';

export function mountTitleBar() {
  if (document.getElementById('oel-titlebar')) return;
  const os = detectOs();
  const host = document.createElement('div');
  host.id = 'oel-titlebar';
  document.body.prepend(host);
  createRoot(host).render(<TitleBar os={os} />);
}
