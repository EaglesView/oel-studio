/**
 * AdaptiveToolbar · a toolbar that folds whole groups into « Plus » instead of
 * scrolling (Figma J0–J3). « Plus » pushes the page and opens the folded groups
 * as a grid of named sections; « Ancrer en bas » docks the whole bar at the
 * bottom of the editor (the host places it), a ✕ brings it back. Row and grid
 * share one toolbar, so arrows move across both with one Tab stop.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button as RACButton } from 'react-aria-components';
import { Icon } from '../icons/Icon';
import { cx } from '../utils';
import { Toolbar, ToolbarSeparator } from './Toolbar';
import { WithTooltip } from './Tooltip';
import { messages, plural } from '@oel/i18n';

const t = messages(
  {
    less: 'Moins',
    moreTools: 'Plus d’outils',
    more: (n: number) => `Plus +${n}`,
    undock: 'Remettre la barre en haut',
    dock: 'Ancrer la barre en bas',
    dockDesc: 'Toute la barre au bas de la fenêtre, sous le pouce sur tablette.',
    shown: (n: number) => `${n} ${plural(n, 'section affichée', 'sections affichées')}`,
  },
  {
    less: 'Less',
    moreTools: 'More tools',
    more: (n) => `More +${n}`,
    undock: 'Put the bar back at the top',
    dock: 'Dock the bar at the bottom',
    dockDesc: 'The whole bar at the bottom of the window, under your thumb on a tablet.',
    shown: (n) => `${n} ${plural(n, 'section', 'sections')} shown`,
  },
);

export interface ToolGroup {
  id: string;
  /** Named in the grid and for screen readers (« Police », « Paragraphe »). */
  label: string;
  /** 1 never folds; higher numbers fold first (J1). */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Takes two columns in the grid (Paragraphe). */
  wide?: boolean;
  content: ReactNode;
}

/**
 * Which groups fold so the rest fits in `available` pixels: highest priority
 * number first, the rightmost first among equals; priority 1 never folds.
 * `gap` is what each group costs besides its width (separator, spacing).
 */
export function foldGroups(groups: Array<{ id: string; priority: number; width: number }>, available: number, gap = 0): string[] {
  const cost = (list: typeof groups) => list.reduce((a, g) => a + g.width, 0) + Math.max(0, list.length - 1) * gap;
  let shown = [...groups];
  const folded: string[] = [];
  const order = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.priority > 1)
    .sort((a, b) => b.g.priority - a.g.priority || b.i - a.i);
  for (const { g } of order) {
    if (cost(shown) <= available) break;
    shown = shown.filter((x) => x.id !== g.id);
    folded.push(g.id);
  }
  return folded;
}

interface Saved {
  expanded?: boolean;
  docked?: boolean;
}
const read = (key: string): Saved => {
  try {
    return JSON.parse(localStorage.getItem(`oel-toolbar:${key}`) ?? '{}') as Saved;
  } catch {
    return {};
  }
};
const write = (key: string, patch: Saved) => {
  try {
    localStorage.setItem(`oel-toolbar:${key}`, JSON.stringify({ ...read(key), ...patch }));
  } catch {
    // Private window, blocked storage: the bar just won't remember.
  }
};

const NARROW = '(max-width: 600px), (hover: none) and (pointer: coarse)';

/**
 * Where the bar lives (J3): remembered per editor; on narrow or touch-only
 * screens it is docked at the bottom and can't be moved back (`forced`).
 */
export function useToolbarDock(storageKey: string): { docked: boolean; forced: boolean; setDocked: (d: boolean) => void } {
  const [saved, setSaved] = useState(() => !!read(storageKey).docked);
  const [forced, setForced] = useState(() => typeof matchMedia === 'function' && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(NARROW);
    const on = () => setForced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const setDocked = useCallback(
    (d: boolean) => {
      setSaved(d);
      write(storageKey, { docked: d, ...(d ? {} : { expanded: false }) });
    },
    [storageKey],
  );
  return { docked: forced || saved, forced, setDocked };
}

export interface AdaptiveToolbarProps {
  label: string;
  groups: ToolGroup[];
  /** Outside the folding, at the end of the row (« Présenter »). */
  trailing?: ReactNode;
  storageKey: string;
  docked?: boolean;
  /** Docked by the screen (narrow, touch): no ✕. */
  forced?: boolean;
  onDockedChange?: (docked: boolean) => void;
  className?: string;
}

/** Room taken at the row's end by « Plus » and the dock button. */
const CONTROLS = 132;
/** Separator + spacing between two groups. */
const GAP = 14;

export function AdaptiveToolbar({ label, groups, trailing, storageKey, docked = false, forced = false, onDockedChange, className }: AdaptiveToolbarProps) {
  const row = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [folded, setFolded] = useState<string[]>([]);
  const [expanded, setExpandedState] = useState(() => !!read(storageKey).expanded);
  const [cols, setCols] = useState(3);
  const setExpanded = (v: boolean) => {
    setExpandedState(v);
    write(storageKey, { expanded: v });
  };

  // Groups are rebuilt on every render by the host (tool states): read them from a ref, so the
  // observer is only rebuilt when what is shown changes.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const ids = groups.map((g) => `${g.id}:${g.priority}`).join('|');
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    for (const g of el.querySelectorAll<HTMLElement>('[data-group]')) widths.current.set(g.dataset.group!, g.offsetWidth);
    const available = el.clientWidth - (tail.current?.offsetWidth ?? 0) - CONTROLS;
    const next = foldGroups(
      groupsRef.current.map((g) => ({ id: g.id, priority: g.priority, width: widths.current.get(g.id) ?? 120 })),
      available,
      GAP,
    );
    setFolded((cur) => (cur.join('|') === next.join('|') ? cur : next));
    setCols(el.clientWidth >= 560 ? 3 : 1);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = row.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    for (const g of el.querySelectorAll('[data-group]')) ro.observe(g);
    return () => ro.disconnect();
  }, [measure, folded, ids]);

  const open = folded.length > 0 && (expanded || docked);
  // Alt+Maj+↓ unfolds/folds, Alt+Maj+B docks/undocks — while focus is in this editor.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      const scope = row.current?.closest('.oel-docs, .oel-sheets, .oel-slides') ?? document.body;
      if (!scope.contains(document.activeElement)) return;
      if (e.key === 'ArrowDown' && folded.length && !docked) {
        e.preventDefault();
        setExpanded(!expanded);
      } else if (e.code === 'KeyB' && onDockedChange && !forced) {
        e.preventDefault();
        onDockedChange(!docked);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const shown = groups.filter((g) => !folded.includes(g.id));
  const hidden = groups.filter((g) => folded.includes(g.id));
  return (
    <Toolbar aria-label={label} appearance="ribbon" className={cx('emb-adaptive', docked && 'is-docked', open && 'is-open', className)}>
      <div className="emb-adaptive__row" ref={row}>
        {shown.map((g, i) => (
          <Fragment key={g.id}>
            {i > 0 && <ToolbarSeparator />}
            <div className="emb-adaptive__group" data-group={g.id} role="group" aria-label={g.label}>
              {g.content}
            </div>
          </Fragment>
        ))}
        <span className="emb-adaptive__spacer" />
        {folded.length > 0 && !docked && (
          <WithTooltip label={expanded ? t.less : t.moreTools} shortcut={['Alt', 'Maj', '↓']} description={expanded ? undefined : `${hidden.map((g) => g.label).join(', ')}`}>
            <RACButton className="emb-adaptive__more" aria-expanded={expanded} onPress={() => setExpanded(!expanded)}>
              {expanded ? t.less : t.more(folded.length)}
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
            </RACButton>
          </WithTooltip>
        )}
        {onDockedChange &&
          (docked ? (
            !forced && (
              <WithTooltip label={t.undock} shortcut={['Alt', 'Maj', 'B']}>
                <RACButton className="emb-tool" aria-label={t.undock} onPress={() => onDockedChange(false)}>
                  <Icon name="close" size={18} />
                </RACButton>
              </WithTooltip>
            )
          ) : (
            <WithTooltip label={t.dock} shortcut={['Alt', 'Maj', 'B']} description={t.dockDesc}>
              <RACButton className="emb-tool" aria-label={t.dock} onPress={() => onDockedChange(true)}>
                <Icon name="dock-bottom" size={18} />
              </RACButton>
            </WithTooltip>
          ))}
        {trailing && (
          <div className="emb-adaptive__trailing" ref={tail}>
            {trailing}
          </div>
        )}
      </div>
      <div className="emb-adaptive__drawer" data-open={open || undefined} inert={!open || undefined}>
        <div className="emb-adaptive__grid" style={{ ['--emb-adaptive-cols' as string]: cols }}>
          {hidden.map((g) => (
            <section key={g.id} className="emb-adaptive__section" data-wide={(g.wide && cols > 1) || undefined} role="group" aria-label={g.label}>
              <span className="emb-adaptive__label">{g.label}</span>
              <div className="emb-adaptive__tools">{g.content}</div>
            </section>
          ))}
        </div>
      </div>
      <span className="emb-adaptive__live" aria-live="polite">
        {open ? t.shown(hidden.length) : ''}
      </span>
    </Toolbar>
  );
}
