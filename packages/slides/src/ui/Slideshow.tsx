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
import { locale, tr } from '@oel/i18n';

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

/** Elapsed time: `12:48`, `1:02:03` past an hour. */
const elapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/** Time of day the fr-CA way: « 14 h 32 ». */
const timeOfDay = (d: Date) => `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Open the « Présentateur » window (call it from the click or key that asks,
 * or the browser blocks it). It gets this page's styles so slides draw alike.
 */
export function openPresenterWindow(): Window | null {
  const w = window.open('', 'oel-presenter', 'width=1180,height=720');
  if (!w) return null;
  w.document.title = tr('Présentateur · OutilsEnLigne', 'Presenter · OutilsEnLigne');
  w.document.head.replaceChildren(...[...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.cloneNode(true)));
  w.document.documentElement.lang = locale();
  w.document.body.className = 'oel-presenter-body';
  w.document.body.replaceChildren();
  return w;
}

export function Slideshow({ ctl, ctx, start, onExit, presenterWindow = null }: { ctl: SlidesController; ctx: RenderCtx; start: number; onExit: () => void; presenterWindow?: Window | null }) {
  const all = ctl.doc.slideIds();
  const startId = all[start];
  // Hidden slides are skipped, unless the show starts on one.
  const ids = useMemo(() => all.filter((id) => id === startId || !ctl.doc.slide(id)?.hidden), [all.join('|'), startId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(() => Math.max(0, ids.indexOf(startId ?? '')));
  const [blank, setBlank] = useState<'black' | 'white' | null>(null);
  const [typed, setTyped] = useState('');
  const [presenter, setPresenter] = useState<Window | null>(presenterWindow);
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
    if (k === 'F5' && e.altKey) return stop(), openPresenter();
  };
  const keyRef = useRef(onKey);
  keyRef.current = onKey;

  const openPresenter = () => {
    if (presenter && !presenter.closed) return presenter.focus();
    setPresenter(openPresenterWindow());
  };
  // Keys pressed in the presenter window drive the show too; closing it just closes it.
  useEffect(() => {
    if (!presenter) return;
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    const onClose = () => setPresenter(null);
    presenter.addEventListener('keydown', onKey);
    presenter.addEventListener('beforeunload', onClose);
    return () => {
      presenter.removeEventListener('keydown', onKey);
      presenter.removeEventListener('beforeunload', onClose);
    };
  }, [presenter]);
  useEffect(() => () => presenter?.close(), [presenter]);

  const slideW = Math.min(size.w, (size.h * info.width) / info.height);
  const cur = ids[i] ? ctl.doc.slide(ids[i]!) : null;
  const sctx = (n: number): RenderCtx => ({ ...ctx, editing: false, editingText: null, slideNumber: all.indexOf(ids[n] ?? '') + 1 });

  let stageContent: ReactNode;
  if (blank) stageContent = <div className={`oel-show__blank oel-show__blank--${blank}`} />;
  else if (ended || !cur) stageContent = <p className="oel-show__end">{tr('Fin du diaporama. Cliquez pour quitter.', 'End of the slideshow. Click to leave.')}</p>;
  else stageContent = <ScaledSlide key={cur.id} slide={cur} info={info} ctx={sctx(i)} width={slideW} className="oel-show__slide" />;

  return (
    <div
      ref={root}
      className="oel-show"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={tr(`Diaporama, diapositive ${Math.min(i + 1, ids.length)} sur ${ids.length}`, `Slideshow, slide ${Math.min(i + 1, ids.length)} of ${ids.length}`)}
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
      <div className={`oel-show__bar${chrome ? ' is-visible' : ''}`} aria-label={tr('Commandes du diaporama', 'Slideshow controls')}>
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-left" aria-label={tr('Diapositive précédente', 'Previous slide')} onPress={() => go(i - 1)} />
        <span className="oel-show__count">
          {Math.min(i + 1, ids.length)} / {ids.length}
        </span>
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-right" aria-label={tr('Diapositive suivante', 'Next slide')} onPress={() => go(i + 1)} />
        <Button size="sm" variant="ghost" leadingIcon="laptop" aria-keyshortcuts="Alt+F5" onPress={openPresenter}>
          {tr('Présentateur', 'Presenter')}
        </Button>
        <Button size="sm" variant="ghost" leadingIcon="close" onPress={exit}>
          {tr('Terminer', 'End')}
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

/** The « Présentateur » window (Editor — Behaviors · vue présentateur). */
function Presenter({ ctl, ids, i, ctx, started, win, onGo, onExit }: { ctl: SlidesController; ids: string[]; i: number; ctx: (n: number) => RenderCtx; started: number; win: Window; onGo: (n: number) => void; onExit: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const size = useWindowSize(win);
  const info = ctl.info;
  const n = ids.length;
  const cur = ids[i] ? ctl.doc.slide(ids[i]!) : null;
  const next = ids[i + 1] ? ctl.doc.slide(ids[i + 1]!) : null;
  const notes = ids[i] ? (ctl.doc.notes(ids[i]!)?.toString() ?? '') : '';
  // Current slide on the left (~60 %), the rest of the width for the next slide and notes.
  const pad = 32;
  const gap = 40;
  const ratio = info.height / info.width;
  const big = Math.max(240, Math.min((size.w - pad * 2 - gap) * 0.62, (size.h - 150) / ratio));
  const small = Math.max(160, size.w - pad * 2 - gap - big);
  const end = <div className="oel-presenter__end" style={{ width: small, height: small * ratio }}>{tr('Fin du diaporama', 'End of the slideshow')}</div>;
  return (
    <div className="oel-presenter" style={{ gridTemplateColumns: `${big}px minmax(0, 1fr)`, columnGap: gap, padding: pad }}>
      <section className="oel-presenter__current" aria-label={tr(`Diapositive ${Math.min(i + 1, n)} sur ${n}`, `Slide ${Math.min(i + 1, n)} of ${n}`)}>
        <p className="oel-presenter__label">
          Diapo {Math.min(i + 1, n)} sur {n}
        </p>
        {cur ? (
          <ScaledSlide slide={cur} info={info} ctx={ctx(i)} width={big} className="oel-presenter__slide" />
        ) : (
          <div className="oel-presenter__end oel-presenter__slide" style={{ width: big, height: big * ratio }}>
            {tr('Fin du diaporama', 'End of the slideshow')}
          </div>
        )}
      </section>
      <aside className="oel-presenter__side">
        <p className="oel-presenter__label">{tr('Suivante', 'Next')}</p>
        {next ? <ScaledSlide slide={next} info={info} ctx={ctx(i + 1)} width={small} className="oel-presenter__next" /> : end}
        <p className="oel-presenter__label oel-presenter__label--notes">{tr('Notes de l’orateur', 'Speaker notes')}</p>
        <div className="oel-presenter__notes" tabIndex={0} aria-label={tr('Notes de l’orateur', 'Speaker notes')}>
          {notes || <span className="oel-presenter__muted">{tr('Aucune note pour cette diapositive.', 'No notes for this slide.')}</span>}
        </div>
        <div className="oel-presenter__time" role="timer" aria-live="off">
          <span className="oel-presenter__clock">{elapsed(now - started)}</span>
          <span className="oel-presenter__muted">{tr(`Écoulé · il est ${timeOfDay(new Date(now))}`, `Elapsed · it is ${timeOfDay(new Date(now))}`)}</span>
        </div>
      </aside>
      <nav className="oel-presenter__pill" aria-label={tr('Commandes du diaporama', 'Slideshow controls')}>
        <button type="button" className="oel-presenter__step" aria-label={tr('Diapositive précédente', 'Previous slide')} disabled={i <= 0} onClick={() => onGo(i - 1)}>
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="oel-presenter__count">
          {Math.min(i + 1, n)} / {n}
        </span>
        <button type="button" className="oel-presenter__step" aria-label={tr('Diapositive suivante', 'Next slide')} disabled={i >= n} onClick={() => onGo(i + 1)}>
          <Icon name="chevron-right" size={16} />
        </button>
        <button type="button" className="oel-presenter__stop" onClick={onExit}>
          {tr('Terminer', 'End')}
        </button>
      </nav>
    </div>
  );
}
