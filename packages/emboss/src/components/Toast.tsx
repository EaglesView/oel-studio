import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import {
  Button as RACButton,
  Dialog as RACDialog,
  DialogTrigger,
  Heading,
  Text,
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as RACToastRegion,
  type QueuedToast,
} from 'react-aria-components';
import { Icon } from '../icons/Icon';
import { cx } from '../utils';
import { Button } from './Button';
import { Popover } from './Overlays';
import { locale, messages, plural } from '@oel/i18n';

const t = messages(
  {
    close: 'Fermer',
    notifications: 'Notifications',
    justNow: 'à l’instant',
    unread: (n: number) => `Notifications, ${n} ${plural(n, 'non lue', 'non lues')}`,
    clear: 'Tout effacer',
    empty: 'Aucune notification pour l’instant.',
  },
  {
    close: 'Close',
    notifications: 'Notifications',
    justNow: 'just now',
    unread: (n) => `Notifications, ${n} unread`,
    clear: 'Clear all',
    empty: 'No notifications yet.',
  },
);

/* ── Toast (kit 67:568) ────────────────────────────────────────────── */

export interface ToastData {
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  action?: { label: string; onAction: () => void };
}

/** Up to five slips in the pile; three peek out while it is collapsed. */
const MAX_VISIBLE = 5;
const PEEK = 3;
const PEEK_OFFSET = 10;
const PEEK_SCALE = 0.05;
const GAP = 8;
const EXIT_MS = 280;
const FALLBACK_HEIGHT = 66;

/**
 * App-wide toast queue. A paper slip that rises from the bottom, with a
 * tone-coloured edge and seal. Every toast auto-dismisses; timers pause while
 * the pile is hovered or focused.
 */
export const toastQueue = new ToastQueue<ToastData>({ maxVisibleToasts: MAX_VISIBLE });

/** Toasts with an action stay a little longer so there is time to reach it. */
export function toast(content: ToastData, timeout = content.action ? 8000 : 5000) {
  toastHistory.push(content);
  return toastQueue.add(content, { timeout });
}

/* ── History: every toast this session, so a dismissed one can be read again ── */

export interface ToastRecord extends Omit<ToastData, 'action'> {
  id: number;
  at: number;
}

interface HistorySnapshot {
  items: readonly ToastRecord[];
  unread: number;
}

class ToastHistory {
  private snapshot: HistorySnapshot = { items: [], unread: 0 };
  private subs = new Set<() => void>();
  private nextId = 1;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  get = () => this.snapshot;

  /** Actions are dropped: an « Annuler » read minutes later would undo something else. */
  push({ title, description, tone }: ToastData) {
    const item: ToastRecord = { id: this.nextId++, at: Date.now(), title, description, tone };
    this.set({ items: [item, ...this.snapshot.items].slice(0, 50), unread: this.snapshot.unread + 1 });
  }
  markRead() {
    if (this.snapshot.unread) this.set({ ...this.snapshot, unread: 0 });
  }
  clear() {
    this.set({ items: [], unread: 0 });
  }
  private set(next: HistorySnapshot) {
    this.snapshot = next;
    for (const fn of this.subs) fn();
  }
}

export const toastHistory = new ToastHistory();

export function useToastHistory() {
  return useSyncExternalStore(toastHistory.subscribe, toastHistory.get, toastHistory.get);
}

/* ── Pile geometry ─────────────────────────────────────────────────── */

interface Slot {
  /** Collapsed: tucked behind the front slip. */
  yc: number;
  sc: number;
  hc: number;
  /** Expanded: a list, newest at the bottom. */
  ye: number;
  he: number;
  hidden: boolean;
}

function layout(keys: string[], heights: Record<string, number>) {
  const h = (k: string) => heights[k] ?? FALLBACK_HEIGHT;
  const front = keys[0] ? h(keys[0]) : 0;
  let y = 0;
  const slots: Record<string, Slot> = {};
  keys.forEach((k, i) => {
    slots[k] = { yc: -i * PEEK_OFFSET, sc: 1 - i * PEEK_SCALE, hc: i ? front : h(k), ye: -y, he: h(k), hidden: i >= PEEK };
    y += h(k) + GAP;
  });
  return {
    slots,
    collapsed: front + Math.min(keys.length - 1, PEEK - 1) * PEEK_OFFSET,
    expanded: Math.max(0, y - GAP),
  };
}

function slotStyle(s: Slot | undefined, i: number, n: number): CSSProperties {
  if (!s) return {};
  return {
    zIndex: n - i,
    ['--yc' as string]: `${s.yc}px`,
    ['--sc' as string]: s.sc,
    ['--hc' as string]: `${s.hc}px`,
    ['--ye' as string]: `${s.ye}px`,
    ['--he' as string]: `${s.he}px`,
    ['--peek' as string]: s.hidden ? 0 : 1,
  };
}

/* ── Slip face ─────────────────────────────────────────────────────── */

type Tone = NonNullable<ToastData['tone']>;

function Seal({ size = 40 }: { size?: number }) {
  return (
    <span className="emb-toast__seal" style={{ width: size, height: size }} aria-hidden>
      <Icon name="alert" size={size >= 40 ? 20 : 16} />
    </span>
  );
}

/** Same paper for live slips and the ghosts that fade out after them. */
function Face({ data, live, onAction }: { data: ToastData; live: boolean; onAction?: () => void }) {
  const title = live ? (
    <Text slot="title" className="emb-toast__title">{data.title}</Text>
  ) : (
    <span className="emb-toast__title">{data.title}</span>
  );
  const desc = data.description
    ? live
      ? <Text slot="description" className="emb-toast__desc">{data.description}</Text>
      : <span className="emb-toast__desc">{data.description}</span>
    : null;
  const action = data.action && (
    <RACButton className="emb-button emb-button--ghost emb-button--sm emb-toast__action" onPress={onAction} isDisabled={!live}>
      {data.action.label}
    </RACButton>
  );
  const body = (
    <>
      {title}
      {desc}
      {action}
    </>
  );
  return (
    <>
      <span className="emb-toast__edge" aria-hidden />
      <Seal />
      {live ? <ToastContent className="emb-toast__content">{body}</ToastContent> : <div className="emb-toast__content">{body}</div>}
      {live ? (
        <RACButton slot="close" className="emb-button emb-button--ghost emb-button--icon-sm emb-toast__close" aria-label={t.close}>
          <Icon name="close" size={20} />
        </RACButton>
      ) : (
        <span className="emb-button emb-button--ghost emb-button--icon-sm emb-toast__close" aria-hidden>
          <Icon name="close" size={20} />
        </span>
      )}
    </>
  );
}

/** Reports the slip's natural height (the body, not the clipped paper) before paint. */
function useMeasure(key: string, onHeight: (key: string, h: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(key, el.offsetHeight + 2);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, onHeight]);
  return ref;
}

function LiveToast({
  toast: t,
  back,
  style,
  onHeight,
}: {
  toast: QueuedToast<ToastData>;
  /** Behind the front slip while the pile is collapsed. */
  back: boolean;
  style: CSSProperties;
  onHeight: (key: string, h: number) => void;
}) {
  const bodyRef = useMeasure(t.key, onHeight);
  const tone: Tone = t.content.tone ?? 'info';
  return (
    <RACToast toast={t} className={cx('emb-toast', `emb-toast--${tone}`, back && 'emb-toast--back')} style={style}>
      <div ref={bodyRef} className="emb-toast__body">
        <Face
          data={t.content}
          live
          onAction={() => {
            t.content.action?.onAction();
            toastQueue.close(t.key);
          }}
        />
      </div>
    </RACToast>
  );
}

interface Ghost {
  key: string;
  data: ToastData;
  style: CSSProperties;
  open: boolean;
}

const OPEN = ':hover, :focus-within';

/**
 * Mount once near the root. Landmark region (F6 to reach it), polite
 * announcements. Slips pile up, newest in front; hovering or focusing the
 * pile fans it out into a list and pauses the timers.
 */
export function ToastRegion() {
  const visible = useSyncExternalStore(
    useCallback((fn: () => void) => toastQueue.subscribe(fn), []),
    () => toastQueue.visibleToasts,
    () => toastQueue.visibleToasts,
  );
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeight = useCallback((key: string, h: number) => {
    setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }));
  }, []);

  const keys = visible.map((t) => t.key);
  const { slots, collapsed, expanded } = layout(keys, heights);
  const styleOf = (key: string) => slotStyle(slots[key], keys.indexOf(key), keys.length);

  // A closed toast leaves at once; keep a paper ghost where it stood so it can fade out.
  const regionRef = useRef<HTMLDivElement>(null);
  const prev = useRef<{ toasts: readonly QueuedToast<ToastData>[]; styles: Record<string, CSSProperties>; open: boolean }>({
    toasts: [],
    styles: {},
    open: false,
  });
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  useLayoutEffect(() => {
    const gone = prev.current.toasts.filter((t) => !keys.includes(t.key));
    if (gone.length) {
      const open = regionRef.current?.matches(OPEN) ?? prev.current.open;
      setGhosts((g) => [...g, ...gone.map((t) => ({ key: t.key, data: t.content, style: prev.current.styles[t.key] ?? {}, open }))]);
      const ids = gone.map((t) => t.key);
      setTimeout(() => setGhosts((g) => g.filter((x) => !ids.includes(x.key))), EXIT_MS);
    }
    setHeights((h) => {
      const kept = Object.fromEntries(Object.entries(h).filter(([k]) => keys.includes(k)));
      return Object.keys(kept).length === Object.keys(h).length ? h : kept;
    });
    prev.current = {
      toasts: visible,
      styles: Object.fromEntries(keys.map((k) => [k, styleOf(k)])),
      open: !!regionRef.current?.matches(OPEN),
    };
  });
  // The last slip unmounts the region with it, so remember whether the pile was fanned out.
  useEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    const sync = () => (prev.current.open = el.matches(OPEN));
    const events = ['pointerover', 'pointerleave', 'focusin', 'focusout'] as const;
    for (const e of events) el.addEventListener(e, sync);
    return () => {
      for (const e of events) el.removeEventListener(e, sync);
    };
  }, [keys.length > 0]);

  const regionVars = { ['--region-c' as string]: `${collapsed}px`, ['--region-e' as string]: `${expanded}px` };

  return (
    <>
      <RACToastRegion ref={regionRef} queue={toastQueue} className="emb-toast-region" style={regionVars} aria-label={t.notifications}>
        {({ toast: item }) => <LiveToast toast={item} back={keys.indexOf(item.key) > 0} style={styleOf(item.key)} onHeight={onHeight} />}
      </RACToastRegion>
      {ghosts.length > 0 && (
        <div className="emb-toast-ghosts" aria-hidden>
          {ghosts.map((g) => (
            <div key={g.key} className={cx('emb-toast', 'emb-toast--ghost', g.open && 'emb-toast--open', `emb-toast--${g.data.tone ?? 'info'}`)} style={g.style}>
              <div className="emb-toast__body">
                <Face data={g.data} live={false} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Notifications: the list of past toasts ───────────────────────── */

const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });

function ago(at: number, now: number) {
  const s = Math.round((at - now) / 1000);
  if (s > -45) return t.justNow;
  const m = Math.round(s / 60);
  if (m > -60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (h > -24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}

/** Bell with an unread dot; opens the list of this session's toasts, newest first. */
export function NotificationsButton() {
  const { items, unread } = useToastHistory();
  const [now, setNow] = useState(() => Date.now());
  return (
    <DialogTrigger
      onOpenChange={(open) => {
        if (open) {
          setNow(Date.now());
          toastHistory.markRead();
        }
      }}
    >
      <span className="emb-notif-trigger">
        <Button
          variant="ghost"
          size="icon-sm"
          leadingIcon={unread ? 'bell-dot' : 'bell'}
          aria-label={unread ? t.unread(unread) : t.notifications}
        />
        {unread > 0 && (
          <span className="emb-notif-trigger__count" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </span>
      <Popover placement="bottom end" showArrow={false} className="emb-notif-popover">
        <RACDialog className="emb-notif" aria-label={t.notifications}>
          <header className="emb-notif__header">
            <Heading slot="title" className="emb-notif__title">
              {t.notifications}
            </Heading>
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onPress={() => toastHistory.clear()}>
                {t.clear}
              </Button>
            )}
          </header>
          {items.length === 0 ? (
            <p className="emb-notif__empty">{t.empty}</p>
          ) : (
            <ol className="emb-notif__list">
              {items.map((n) => (
                <li key={n.id} className={cx('emb-notif__item', `emb-toast--${n.tone ?? 'info'}`)}>
                  <Seal size={28} />
                  <div className="emb-notif__text">
                    <span className="emb-toast__title">{n.title}</span>
                    {n.description && <span className="emb-notif__desc">{n.description}</span>}
                  </div>
                  <time className="emb-notif__time" dateTime={new Date(n.at).toISOString()}>
                    {ago(n.at, now)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </RACDialog>
      </Popover>
    </DialogTrigger>
  );
}
