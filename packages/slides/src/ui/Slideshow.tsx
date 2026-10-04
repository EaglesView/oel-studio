/**
 * Présentation (level 4 of Editor — Behaviors): the deck full screen, one
 * slide at a time, hidden slides skipped. → / Espace / clic advance, ← goes
 * back, a number then Entrée jumps, N / B blank the screen, Échap ends.
 * « Mode présentateur » opens a second window (current and next slide, notes,
 * timer) driven by the same state.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '@oel/emboss';
import { ScaledSlide, type RenderCtx } from './render';
import type { SlidesController } from './controller';

function useWindowSize(win: Window | null) {
  const [size, setSize] = useState(() => ({ w: win?.innerWidth ?? 1280, h: win?.innerHeight ?? 720 }));
  useEffect(() => {
    if (!win) return;
    const on = () => setSize({ w: win.innerWidth, h: win.innerHeight });
    on();
    win.addEventListener('resize', on);
    return () => win.removeEventListener('resize', on);
  }, [win]);
  return size;
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Slideshow({ ctl, ctx, start, onExit }: { ctl: SlidesController; ctx: RenderCtx; start: number; onExit: () => void }) {
  const all = ctl.doc.slideIds();
  const startId = all[start];
  // Hidden slides are skipped, unless the show starts on one.
  const ids = useMemo(() => all.filter((id) => id === startId || !ctl.doc.slide(id)?.hidden), [all.join('|'), startId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(() => Math.max(0, ids.indexOf(startId ?? '')));
  const [blank, setBlank] = useState<'black' | 'white' | null>(null);
  const [typed, setTyped] = useState('');
  const [presenter, setPresenter] = useState<Window | null>(null);
  const [chrome, setChrome] = useState(false);
  const [started] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const size = useWindowSize(typeof window === 'undefined' ? null : window);
  const info = ctl.info;
  const ended = i >= ids.length;

  const go = useCallback((n: number) => setI(Math.max(0, Math.min(ids.length, n))), [ids.length]);
  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    presenter?.close();
    onExit();
  }, [onExit, presenter]);

  useEffect(() => {
    root.current?.focus();
    root.current?.requestFullscreen?.().catch(() => {});
    const onFs = () => !document.fullscreenElement && exit();
    // Leaving full screen with the browser's own Échap ends the show too.
    const t = setTimeout(() => document.addEventListener('fullscreenchange', onFs), 300);
    return () => {
      clearTimeout(t);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [exit]);

  const onKey = (e: KeyboardEvent | RKeyboardEvent) => {
    const k = e.key;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (/^[0-9]$/.test(k)) return stop(), setTyped((t) => t + k);
    if (k === 'Enter' && typed) return stop(), go(Number(typed) - 1), setTyped('');
    setTyped('');
    if (blank && k !== 'Escape') return stop(), setBlank(null);
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) return stop(), go(i + 1);
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) return stop(), go(i - 1);
    if (k === 'Home') return stop(), go(0);
    if (k === 'End') return stop(), go(ids.length - 1);
    if (k === 'b' || k === 'B' || k === '.') return stop(), setBlank('black');
    if (k === 'w' || k === 'W' || k === ',') return stop(), setBlank('white');
    if (k === 'Escape') return stop(), exit();
  };
  const keyRef = useRef(onKey);
  keyRef.current = onKey;

  const openPresenter = () => {
    if (presenter && !presenter.closed) return presenter.focus();
    const w = window.open('', 'oel-presenter', 'width=1100,height=680');
    if (!w) return;
    w.document.title = 'Mode présentateur · OutilsEnLigne';
    // Same styles as here, so slides draw the same.
    for (const n of document.querySelectorAll('style, link[rel="stylesheet"]')) w.document.head.appendChild(n.cloneNode(true));
    w.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? '';
    w.document.body.className = 'oel-presenter-body';
    w.addEventListener('keydown', (e) => keyRef.current(e));
    w.addEventListener('beforeunload', () => setPresenter(null));
    setPresenter(w);
  };
  useEffect(() => () => presenter?.close(), [presenter]);

  const slideW = Math.min(size.w, (size.h * info.width) / info.height);
  const cur = ids[i] ? ctl.doc.slide(ids[i]!) : null;
  const sctx = (n: number): RenderCtx => ({ ...ctx, editing: false, editingText: null, slideNumber: all.indexOf(ids[n] ?? '') + 1 });

  let stageContent: ReactNode;
  if (blank) stageContent = <div className={`oel-show__blank oel-show__blank--${blank}`} />;
  else if (ended || !cur) stageContent = <p className="oel-show__end">Fin du diaporama. Cliquez pour quitter.</p>;
  else stageContent = <ScaledSlide key={cur.id} slide={cur} info={info} ctx={sctx(i)} width={slideW} className="oel-show__slide" />;

  return (
    <div
      ref={root}
      className="oel-show"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Diaporama, diapositive ${Math.min(i + 1, ids.length)} sur ${ids.length}`}
      onKeyDown={onKey}
      onPointerMove={() => setChrome(true)}
      onPointerLeave={() => setChrome(false)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.oel-show__bar')) return;
        if (ended) exit();
        else if (blank) setBlank(null);
        else go(i + 1);
      }}
      onContextMenu={(e) => (e.preventDefault(), go(i - 1))}
    >
      {stageContent}
      <div className={`oel-show__bar${chrome ? ' is-visible' : ''}`} aria-label="Commandes du diaporama">
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-left" aria-label="Diapositive précédente" onPress={() => go(i - 1)} />
        <span className="oel-show__count">
          {Math.min(i + 1, ids.length)} / {ids.length}
        </span>
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-right" aria-label="Diapositive suivante" onPress={() => go(i + 1)} />
        <Button size="sm" variant="ghost" leadingIcon="laptop" onPress={openPresenter}>
          Mode présentateur
        </Button>
        <Button size="sm" variant="ghost" leadingIcon="close" onPress={exit}>
          Terminer
        </Button>
      </div>
      {typed && <span className="oel-show__typed">{typed}</span>}
      {presenter &&
        createPortal(
          <Presenter ctl={ctl} ids={ids} i={i} ctx={sctx} started={started} win={presenter} onGo={go} onExit={exit} />,
          presenter.document.body,
        )}
    </div>
  );
}

function Presenter({ ctl, ids, i, ctx, started, win, onGo, onExit }: { ctl: SlidesController; ids: string[]; i: number; ctx: (n: number) => RenderCtx; started: number; win: Window; onGo: (n: number) => void; onExit: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const size = useWindowSize(win);
  const info = ctl.info;
  const cur = ids[i] ? ctl.doc.slide(ids[i]!) : null;
  const next = ids[i + 1] ? ctl.doc.slide(ids[i + 1]!) : null;
  const notes = ids[i] ? (ctl.doc.notes(ids[i]!)?.toString() ?? '') : '';
  const big = Math.max(240, size.w * 0.58);
  const small = Math.max(160, size.w * 0.3);
  return (
    <div className="oel-presenter">
      <header className="oel-presenter__top">
        <span className="oel-presenter__clock" aria-label="Temps écoulé">
          <Icon name="clock" size={18} /> {clock(now - started)}
        </span>
        <span>
          Diapositive {Math.min(i + 1, ids.length)} sur {ids.length}
        </span>
        <span>{new Date(now).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}</span>
      </header>
      <div className="oel-presenter__main">
        <section aria-label="Diapositive actuelle">
          {cur ? <ScaledSlide slide={cur} info={info} ctx={ctx(i)} width={big} /> : <p className="oel-presenter__end">Fin du diaporama</p>}
        </section>
        <aside>
          <h2>Suivante</h2>
          {next ? <ScaledSlide slide={next} info={info} ctx={ctx(i + 1)} width={small} /> : <p className="oel-presenter__end">Fin du diaporama</p>}
          <h2>Notes</h2>
          <div className="oel-presenter__notes">{notes || <em>Aucune note pour cette diapositive.</em>}</div>
        </aside>
      </div>
      <footer className="oel-presenter__bar">
        <Button size="sm" variant="secondary" leadingIcon="chevron-left" onPress={() => onGo(i - 1)}>
          Précédente
        </Button>
        <Button size="sm" variant="primary" leadingIcon="chevron-right" onPress={() => onGo(i + 1)}>
          Suivante
        </Button>
        <Button size="sm" variant="ghost" leadingIcon="close" onPress={onExit}>
          Terminer le diaporama
        </Button>
      </footer>
    </div>
  );
}
