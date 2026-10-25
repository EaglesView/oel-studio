/**
 * The desktop app's title bar (Figma « Editor — Behaviors », section P, components `Desktop/Title bar`
 * and `Desktop/Window button`; plan 2026-10-desktop, D-2). 40 px in kit colours on every OS:
 * - macOS: the native traffic lights sit in it (the window is `Overlay`); the title is centred.
 * - Windows and Linux: the window has no system frame. Logo (opens the Bureau menu), title, and the
 *   Windows 10 buttons on the right, drawn in the kit's emboss. Their glyphs mimic Windows on
 *   purpose (decided 24 Oct 2026), so they aren't Iconoir icons. Linux also gets resize edges.
 * Empty areas drag the window; double-clicking them maximises it.
 */
import { useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { Icon, Logo } from '@oel/emboss';
import { messages } from '@oel/i18n';
import { desktopWindow } from '@oel/platform/desktop';
import { APP_MENU_EVENT, getOpenFile, subscribeOpenFile } from './shell';
import './titlebar.css';

export type Os = 'mac' | 'windows' | 'linux';

export function detectOs(): Os {
  const ua = navigator.userAgent;
  return /Macintosh|Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'linux';
}

const t = messages(
  {
    bureau: 'Bureau',
    menu: 'Menu du Bureau',
    minimize: 'Réduire',
    maximize: 'Agrandir',
    restore: 'Restaurer',
    close: 'Fermer',
  },
  {
    bureau: 'Bureau',
    menu: 'Bureau menu',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore down',
    close: 'Close',
  },
);

const onBureau = () => /^\/bureau\/?$/.test(location.pathname);

/** What follows « Bureau › »: the open file on the Bureau, the page's name elsewhere (docs…). */
function useSubtitle(): string | null {
  const file = useSyncExternalStore(subscribeOpenFile, getOpenFile);
  return onBureau() ? file : document.title.split(' · ')[0] || null;
}

/** Whether the window is maximised and focused, kept in step with the system. */
function useWindowState() {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const win = desktopWindow();
    let live = true;
    const offs: Array<() => void> = [];
    const keep = (p: Promise<() => void>) => void p.then((off) => (live ? offs.push(off) : off()));
    const sync = () => void win.isMaximized().then((m) => live && setMaximized(m));
    sync();
    keep(win.onResized(sync));
    keep(win.onFocusChanged(({ payload }) => setFocused(payload)));
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, []);
  return { maximized, focused };
}

/* Glyphs drawn like Windows' caption buttons (10 px, 1 px strokes). */
const GLYPHS = {
  minimize: <path d="M0 5.5h10" />,
  maximize: <rect x="0.5" y="0.5" width="9" height="9" />,
  restore: (
    <>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
    </>
  ),
  close: <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />,
};

function WindowButton({ kind, onPress }: { kind: keyof typeof GLYPHS; onPress: () => void }) {
  return (
    <button type="button" className={`window-button window-button--${kind}`} aria-label={t[kind]} title={t[kind]} onClick={onPress}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true" focusable="false">
        {GLYPHS[kind]}
      </svg>
    </button>
  );
}

const EDGES = [
  ['North', 'n'],
  ['South', 's'],
  ['East', 'e'],
  ['West', 'w'],
  ['NorthEast', 'ne'],
  ['NorthWest', 'nw'],
  ['SouthEast', 'se'],
  ['SouthWest', 'sw'],
] as const;

/** Linux: a window without a system frame has no borders to resize from, so the page provides them. */
function ResizeEdges() {
  const start = (direction: (typeof EDGES)[number][0]) => (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    void desktopWindow().startResizeDragging(direction);
  };
  return (
    <>
      {EDGES.map(([direction, edge]) => (
        <div key={edge} className={`window-edge window-edge--${edge}`} onMouseDown={start(direction)} aria-hidden="true" />
      ))}
    </>
  );
}

export function TitleBar({ os }: { os: Os }) {
  const subtitle = useSubtitle();
  const { maximized, focused } = useWindowState();
  const win = desktopWindow();
  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!onBureau()) return location.assign('/bureau/');
    const r = e.currentTarget.getBoundingClientRect();
    // The menu sits below the bar: its origin is in the menu's own coordinates.
    window.dispatchEvent(new CustomEvent(APP_MENU_EVENT, { detail: { x: r.left + r.width / 2, y: 0 } }));
  };
  return (
    <>
      <header className="titlebar" data-os={os} data-focused={focused || undefined} data-tauri-drag-region>
        {os !== 'mac' && (
          <button type="button" className="titlebar__logo" aria-label={t.menu} title={t.menu} onClick={openMenu}>
            <Logo size={16} aria-hidden />
          </button>
        )}
        <p className="titlebar__title">
          <span className="titlebar__app">{t.bureau}</span>
          {subtitle && (
            <>
              <Icon name="chevron-right" size={12} className="titlebar__chevron" />
              <span className="titlebar__file">{subtitle}</span>
            </>
          )}
        </p>
        {os !== 'mac' && (
          <div className="titlebar__buttons">
            <WindowButton kind="minimize" onPress={() => void win.minimize()} />
            <WindowButton kind={maximized ? 'restore' : 'maximize'} onPress={() => void win.toggleMaximize()} />
            <WindowButton kind="close" onPress={() => void win.close()} />
          </div>
        )}
      </header>
      {os === 'linux' && !maximized && <ResizeEdges />}
    </>
  );
}
