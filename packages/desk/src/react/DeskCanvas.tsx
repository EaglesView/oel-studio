import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  center,
  intersects,
  lodForZoom,
  normalizeRect,
  pilesBy,
  rectOf,
  rectToScreen,
  screenToWorld,
  union,
  type Direction,
  type Pile,
} from '../core/geometry';
import type { DeskStore } from '../core/store';
import type { DeskNode, Lod, Rect, Vec } from '../core/types';
import { DeskContext, useDeskState } from './hooks';

export interface DeskMessages {
  roleDescription: string;
  nodeRoleDescription: string;
  instructions: string;
  empty: string;
  lodNames: Record<Lod, string>;
  zoom: (percent: number, lod: string) => string;
  selection: (count: number) => string;
  moved: (count: number) => string;
  undone: (label: string) => string;
  redone: (label: string) => string;
  nothingToUndo: string;
  pile: (label: string, count: number) => string;
  multiSelection: (count: number) => string;
}

export const defaultMessages: DeskMessages = {
  roleDescription: 'bureau',
  nodeRoleDescription: 'fichier',
  instructions:
    'Flèches : passer d’un fichier à l’autre. Espace : ajouter ou retirer de la sélection. Entrée : ouvrir. ' +
    'Alt + flèches : déplacer la sélection. Maj + flèches : faire défiler le bureau. ' +
    '+ et − : zoom, 0 : tout voir, 1 2 3 : niveaux de détail. Échap : désélectionner.',
  empty: 'Le bureau est vide. Déposez des fichiers ou créez-en un depuis le dock.',
  lodNames: { far: 'Vue d’ensemble', mid: 'Repérage', near: 'Travail' },
  zoom: (p, lod) => `Zoom ${p} %, ${lod}`,
  selection: (n) => (n === 0 ? 'Aucune sélection' : n === 1 ? '1 fichier sélectionné' : `${n} fichiers sélectionnés`),
  moved: (n) => (n === 1 ? 'Fichier déplacé' : `${n} fichiers déplacés`),
  undone: (l) => `Annulé : ${l}`,
  redone: (l) => `Rétabli : ${l}`,
  nothingToUndo: 'Rien à annuler',
  pile: (label, n) => `Pile ${label}, ${n} ${n > 1 ? 'fichiers' : 'fichier'}. Entrée pour s’en approcher.`,
  multiSelection: (n) => `${n} fichiers`,
};

export interface NodeRenderContext {
  lod: Lod;
  zoom: number;
  isSelected: boolean;
  isFocused: boolean;
  isOpen: boolean;
}

export interface DeskCanvasProps<D> {
  store: DeskStore<D>;
  /** Accessible name of the desk, e.g. the project title. */
  label: string;
  renderNode: (node: DeskNode<D>, ctx: NodeRenderContext) => ReactNode;
  /** Accessible label for a node (title, type, state). Defaults to `title`. */
  describeNode?: (node: DeskNode<D>) => string;
  /** Far-zoom grouping key; defaults to `kind`. */
  pileKey?: (node: DeskNode<D>) => string;
  pileLabel?: (key: string) => string;
  renderPile?: (pile: Pile, nodes: DeskNode<D>[], zoom: number) => ReactNode;
  /** Label next to a link thread. */
  renderGroupLabel?: (nodes: DeskNode<D>[]) => ReactNode;
  onOpen?: (id: string) => void;
  onDelete?: (ids: string[]) => void;
  onContextMenu?: (ids: string[], at: Vec) => void;
  onDropFiles?: (files: File[], at: Vec) => void;
  renderDropZone?: (count: number) => ReactNode;
  /** Extra keys (return true when handled). Runs before the built-in map. */
  onKeyDown?: (e: ReactKeyboardEvent, store: DeskStore<D>) => boolean | void;
  messages?: Partial<DeskMessages>;
  /** Screen-space overlays (contextual toolbar, cursors). Mark interactive roots with data-desk-ui. */
  children?: ReactNode;
  className?: string;
}

type Gesture =
  | { kind: 'drag'; pointerId: number; last: Vec; start: Vec; ids: string[]; moved: boolean; wasSelected: boolean; hitId: string }
  | { kind: 'pan'; pointerId: number; last: Vec }
  | { kind: 'lasso'; pointerId: number; origin: Vec; base: string[]; rect: Rect };

const NUDGE = 10;
const NUDGE_BIG = 50;
const PAN_STEP = 80;
const PILE_SIZE = { w: 240, h: 170 };

/**
 * The infinite desk. DOM-rendered so every paper is a real focusable element:
 * a multi-select listbox of options with roving focus, live announcements and a
 * keyboard equivalent for every pointer gesture (WCAG 2.1.1, 2.5.7).
 */
export function DeskCanvas<D>(props: DeskCanvasProps<D>) {
  const {
    store,
    label,
    renderNode,
    describeNode = (n) => n.title,
    pileKey = (n) => n.kind,
    pileLabel = (k) => k,
    renderPile,
    renderGroupLabel,
    onOpen,
    onDelete = (ids) => store.remove(ids),
    onContextMenu,
    onDropFiles,
    renderDropZone,
    onKeyDown,
    children,
    className,
  } = props;
  const m = useMemo(() => ({ ...defaultMessages, ...props.messages }), [props.messages]);

  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const keyboardMove = useRef(false);
  const spaceHeld = useRef(false);
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [dropCount, setDropCount] = useState(0);
  const [message, setMessage] = useState('');
  const hintId = useId();
  const listId = useId();

  const nodesMap = useDeskState(store, (s) => s.nodes);
  const order = useDeskState(store, (s) => s.order);
  const links = useDeskState(store, (s) => s.links);
  const selection = useDeskState(store, (s) => s.selection);
  const focusedId = useDeskState(store, (s) => s.focusedId);
  const viewport = useDeskState(store, (s) => s.viewport);
  const openId = useDeskState(store, (s) => s.openId);
  const showLinks = useDeskState(store, (s) => s.showLinks);
  const screen = useDeskState(store, (s) => s.screen);

  const lod = lodForZoom(viewport.zoom);
  const nodes = useMemo(() => order.map((id) => nodesMap[id]!).filter(Boolean), [order, nodesMap]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const piles = useMemo(
    () => (lod === 'far' ? pilesBy(nodes, pileKey) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lod, nodes],
  );

  /* ── announcements ─────────────────────────────────────────────── */
  const announce = useCallback((msg: string) => {
    // Clear first so repeating the same message is re-announced.
    setMessage('');
    requestAnimationFrame(() => setMessage(msg));
  }, []);
  const ctx = useMemo(() => ({ store, announce }), [store, announce]);

  const lastLod = useRef(lod);
  useEffect(() => {
    if (lastLod.current !== lod) {
      lastLod.current = lod;
      announce(m.zoom(Math.round(viewport.zoom * 100), m.lodNames[lod]));
    }
  }, [lod, viewport.zoom, announce, m]);

  // Swapping papers for piles (and back) removes the focused element; hand focus
  // over so keyboard users keep their place instead of landing on <body>.
  useEffect(() => {
    const active = document.activeElement;
    const lostFocus = !active || active === document.body || active === rootRef.current;
    if (!lostFocus || openId) return;
    if (lod === 'far') {
      rootRef.current?.querySelector<HTMLElement>('[data-pile-key]')?.focus({ preventScroll: true });
    } else {
      const id = store.getState().focusedId ?? store.ordered()[0]?.id;
      if (id) rootRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    }
  }, [lod, openId, store]);

  /* ── screen size ───────────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) store.setScreen(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [store]);

  /* ── keyboard focus follows store.focusedId ────────────────────── */
  useEffect(() => {
    if (!keyboardMove.current || !focusedId) return;
    keyboardMove.current = false;
    store.reveal(focusedId);
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(focusedId)}"]`);
    el?.focus({ preventScroll: true });
  }, [focusedId, store]);

  /* ── wheel: pan, ctrl/⌘ + wheel or pinch: zoom at cursor ───────── */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('[data-desk-ui]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.ctrlKey || e.metaKey) {
        store.zoomBy(Math.exp(-e.deltaY * 0.01), anchor);
      } else {
        store.panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store]);

  /* ── space-to-pan ──────────────────────────────────────────────── */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (!rootRef.current?.matches(':hover')) return;
      if (t.closest('[role="option"]')) return; // Space selects when a paper has focus
      spaceHeld.current = true;
      setPanning(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const localPoint = (e: { clientX: number; clientY: number }): Vec => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /* ── pointer gestures ──────────────────────────────────────────── */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-desk-ui]') || openId) return;
    if (e.button === 2) return; // context menu handled separately
    const p = localPoint(e);
    const nodeEl = target.closest<HTMLElement>('[data-node-id]');
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (e.button === 1 || spaceHeld.current) {
      gesture.current = { kind: 'pan', pointerId: e.pointerId, last: p };
      setPanning(true);
    } else if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
      const wasSelected = selectedSet.has(id);
      if (additive) store.select([id], 'toggle');
      else if (!wasSelected) store.select([id]);
      store.focus(id);
      const ids = store.getState().selection;
      if (!ids.includes(id)) return; // toggled off: no drag
      store.begin('Déplacement');
      gesture.current = { kind: 'drag', pointerId: e.pointerId, last: p, start: p, ids, moved: false, wasSelected, hitId: id };
      return; // capture lazily once the drag starts, so click/dblclick keep their target
    } else if (target.closest('[data-pile-key]')) {
      return; // piles react on click
    } else {
      const base = additive ? selection : [];
      if (!additive) store.clearSelection();
      const origin = screenToWorld(p, viewport);
      gesture.current = { kind: 'lasso', pointerId: e.pointerId, origin, base, rect: { ...origin, w: 0, h: 0 } };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const p = localPoint(e);
    if (g.kind === 'pan') {
      store.panBy(p.x - g.last.x, p.y - g.last.y);
      g.last = p;
    } else if (g.kind === 'drag') {
      if (!g.moved) {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 3) return;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const z = store.getState().viewport.zoom;
      store.moveBy(g.ids, { x: (p.x - g.last.x) / z, y: (p.y - g.last.y) / z });
      g.last = p;
      g.moved = true;
    } else {
      const w = screenToWorld(p, store.getState().viewport);
      g.rect = normalizeRect(g.origin, w);
      setLasso(g.rect);
      const hits = store.nodes.filter((n) => intersects(g.rect, rectOf(n))).map((n) => n.id);
      store.select([...new Set([...g.base, ...hits])]);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.kind === 'pan') setPanning(spaceHeld.current);
    if (g.kind === 'drag') {
      store.end();
      if (g.moved) announce(m.moved(g.ids.length));
      else if (g.wasSelected && !(e.shiftKey || e.metaKey || e.ctrlKey)) store.select([g.hitId]);
    }
    if (g.kind === 'lasso') {
      setLasso(null);
      const n = store.getState().selection.length;
      if (n) announce(m.selection(n));
    }
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-desk-ui]')) return;
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = nodeEl?.dataset.nodeId;
    if (id && onOpen && nodesMap[id]) onOpen(id);
  };

  const onContext = (e: ReactMouseEvent) => {
    if (!onContextMenu || (e.target as HTMLElement).closest('[data-desk-ui]')) return;
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    e.preventDefault();
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
      if (!selectedSet.has(id)) store.select([id]);
    }
    onContextMenu(store.getState().selection, localPoint(e));
  };

  /* ── keyboard ──────────────────────────────────────────────────── */
  const moveFocus = (node: DeskNode<D> | null, extend: boolean) => {
    if (!node) return;
    keyboardMove.current = true;
    if (extend) store.focus(node.id);
    else store.select([node.id]);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.closest('[data-desk-ui]')) return;
    if (onKeyDown?.(e, store)) {
      e.preventDefault();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const dirs: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = dirs[e.key];
    let handled = true;

    if (dir && e.altKey) {
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      const d = { x: dir === 'left' ? -step : dir === 'right' ? step : 0, y: dir === 'up' ? -step : dir === 'down' ? step : 0 };
      store.nudge(selection, d);
      if (focusedId) store.reveal(focusedId);
    } else if (dir && e.shiftKey) {
      store.panBy(dir === 'left' ? PAN_STEP : dir === 'right' ? -PAN_STEP : 0, dir === 'up' ? PAN_STEP : dir === 'down' ? -PAN_STEP : 0);
    } else if (dir) {
      if (lod === 'far') {
        focusPile(dir);
      } else {
        moveFocus(store.focusDirection(dir), mod);
      }
    } else if (e.key === 'Home' || e.key === 'End') {
      const list = store.ordered();
      moveFocus((e.key === 'Home' ? list[0] : list[list.length - 1]) ?? null, mod);
    } else if (e.key === ' ' && focusedId && lod !== 'far') {
      store.select([focusedId], 'toggle');
      announce(m.selection(store.getState().selection.length));
    } else if (e.key === 'Enter') {
      const pileEl = t.closest<HTMLElement>('[data-pile-key]');
      if (pileEl) enterPile(pileEl.dataset.pileKey!);
      else if (focusedId && onOpen) onOpen(focusedId);
    } else if (e.key === 'Escape') {
      if (selection.length) {
        store.clearSelection();
        announce(m.selection(0));
      } else handled = false;
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
      onDelete(selection);
    } else if (mod && e.key.toLowerCase() === 'a') {
      store.selectAll();
      announce(m.selection(store.getState().selection.length));
    } else if (mod && e.key.toLowerCase() === 'z') {
      const l = e.shiftKey ? store.redo() : store.undo();
      announce(l ? (e.shiftKey ? m.redone(l) : m.undone(l)) : m.nothingToUndo);
    } else if (mod && e.key.toLowerCase() === 'y') {
      const l = store.redo();
      if (l) announce(m.redone(l));
    } else if (!mod && (e.key === '+' || e.key === '=')) {
      store.zoomBy(1.25);
    } else if (!mod && (e.key === '-' || e.key === '_')) {
      store.zoomBy(0.8);
    } else if (!mod && e.key === '0') {
      store.zoomToFit();
    } else if (!mod && (e.key === '1' || e.key === '2' || e.key === '3')) {
      store.zoomPreset((Number(e.key) - 1) as 0 | 1 | 2);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (onContextMenu && focusedId) {
        const n = store.node(focusedId)!;
        const r = rectToScreen(rectOf(n), viewport);
        onContextMenu(selection.length ? selection : [focusedId], { x: r.x + 24, y: r.y + 24 });
      }
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  };

  /* ── piles (far LOD) ───────────────────────────────────────────── */
  // Piles are laid out tidily around the centre of the desk (B5: the desk tidies itself),
  // at a constant on-screen size, in the left-to-right order of their groups.
  const pileRects = useMemo(() => {
    const map = new Map<string, Rect>();
    if (lod !== 'far' || piles.length === 0) return map;
    const all = union(nodes.map(rectOf))!;
    const c = center(all);
    const gap = 40;
    const sorted = [...piles].sort((a, b) => center(a.bounds).x - center(b.bounds).x);
    const cols = Math.max(1, Math.min(sorted.length, Math.floor((screen.w - 160 + gap) / (PILE_SIZE.w + gap)) || 1));
    const rows = Math.ceil(sorted.length / cols);
    const totalW = cols * PILE_SIZE.w + (cols - 1) * gap;
    const totalH = rows * PILE_SIZE.h + (rows - 1) * gap;
    const z = viewport.zoom;
    sorted.forEach((p, i) => {
      const sx = -totalW / 2 + (i % cols) * (PILE_SIZE.w + gap);
      const sy = -totalH / 2 + Math.floor(i / cols) * (PILE_SIZE.h + gap);
      map.set(p.key, { x: c.x + sx / z, y: c.y + sy / z, w: PILE_SIZE.w / z, h: PILE_SIZE.h / z });
    });
    return map;
  }, [lod, piles, nodes, screen.w, viewport.zoom]);
  const pileRect = (p: Pile): Rect => pileRects.get(p.key) ?? p.bounds;

  const enterPile = (key: string) => {
    const p = piles.find((x) => x.key === key);
    if (!p) return;
    store.zoomToFit(p.ids, 1);
    if (store.getState().viewport.zoom < 0.45) store.zoomPreset(1);
    const first = store.node(p.ids[0]!);
    if (first) moveFocus(first, false);
  };
  const focusPile = (dir: Direction) => {
    const current = (document.activeElement as HTMLElement | null)?.dataset.pileKey;
    const items = piles.map((p) => ({ id: p.key, ...pileRect(p) }));
    const from = items.find((i) => i.id === current) ?? items[0];
    if (!from) return;
    const pool = items.map((i) => ({ ...i }));
    const next = current
      ? (pool
          .filter((i) => i.id !== from.id)
          .sort((a, b) => score(a) - score(b))
          .find((i) => score(i) < Infinity) ?? null)
      : from;
    function score(i: Rect & { id: string }) {
      const a = center(from!);
      const b = center(i);
      const along = dir === 'left' ? a.x - b.x : dir === 'right' ? b.x - a.x : dir === 'up' ? a.y - b.y : b.y - a.y;
      const across = dir === 'left' || dir === 'right' ? Math.abs(a.y - b.y) : Math.abs(a.x - b.x);
      return along <= 1 ? Infinity : along + across * 2;
    }
    if (next) rootRef.current?.querySelector<HTMLElement>(`[data-pile-key="${CSS.escape(next.id)}"]`)?.focus();
  };

  /* ── file drop (B8) ────────────────────────────────────────────── */
  const dropProps = onDropFiles
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropCount(e.dataTransfer.items.length || 1);
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!rootRef.current?.contains(e.relatedTarget as Node)) setDropCount(0);
        },
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropCount(0);
          onDropFiles([...e.dataTransfer.files], screenToWorld(localPoint(e), viewport));
        },
      }
    : {};

  /* ── render ────────────────────────────────────────────────────── */
  const rovingId =
    focusedId && nodesMap[focusedId] ? focusedId : (store.ordered()[0]?.id ?? null);
  const groupRect = selection.length > 1 ? union(selection.map((id) => nodesMap[id]).filter(Boolean).map((n) => rectOf(n!))) : null;
  const zoomCss = { '--desk-zoom': viewport.zoom } as React.CSSProperties;

  return (
    <DeskContext.Provider value={ctx}>
      <div
        ref={rootRef}
        tabIndex={-1}
        className={['desk', className].filter(Boolean).join(' ')}
        data-lod={lod}
        data-panning={panning || undefined}
        data-open={openId ? '' : undefined}
        data-drop-active={dropCount > 0 || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContext}
        onKeyDown={handleKeyDown}
        style={zoomCss}
        {...dropProps}
      >
        <div
          className="desk__world"
          style={{
            transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          }}
        >
          {showLinks && lod !== 'far' && (
            <svg className="desk__links" aria-hidden>
              {links.map((l) => {
                const a = nodesMap[l.from];
                const b = nodesMap[l.to];
                if (!a || !b) return null;
                const p = center(rectOf(a));
                const q = center(rectOf(b));
                return (
                  <g key={l.id} className={`desk__link desk__link--${l.state}`}>
                    <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} vectorEffect="non-scaling-stroke" />
                    <circle cx={p.x} cy={p.y} r={4 / viewport.zoom} />
                    <circle cx={q.x} cy={q.y} r={4 / viewport.zoom} />
                  </g>
                );
              })}
            </svg>
          )}

          <div
            id={listId}
            role="listbox"
            aria-label={label}
            aria-roledescription={m.roleDescription}
            aria-multiselectable="true"
            aria-describedby={hintId}
            tabIndex={nodes.length === 0 ? 0 : undefined}
            className="desk__list"
          >
            {lod === 'far'
              ? piles.map((p, i) => {
                  const r = pileRect(p);
                  const list = p.ids.map((id) => nodesMap[id]!).filter(Boolean);
                  return (
                    <div
                      key={p.key}
                      role="option"
                      aria-selected={false}
                      aria-roledescription="pile"
                      aria-label={m.pile(pileLabel(p.key), p.ids.length)}
                      data-pile-key={p.key}
                      tabIndex={i === 0 ? 0 : -1}
                      className="desk__pile"
                      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                      onClick={() => enterPile(p.key)}
                    >
                      <div className="desk__pile-inner" style={{ width: PILE_SIZE.w, height: PILE_SIZE.h, scale: `${1 / viewport.zoom}` }}>
                        {renderPile ? renderPile(p, list, viewport.zoom) : `${pileLabel(p.key)} · ${p.ids.length}`}
                      </div>
                    </div>
                  );
                })
              : nodes.map((n) => {
                  const isSelected = selectedSet.has(n.id);
                  const isFocused = focusedId === n.id;
                  return (
                    <div
                      key={n.id}
                      role="option"
                      id={`${listId}-${n.id}`}
                      data-node-id={n.id}
                      data-kind={n.kind}
                      aria-selected={isSelected}
                      aria-roledescription={m.nodeRoleDescription}
                      aria-label={describeNode(n)}
                      tabIndex={rovingId === n.id ? 0 : -1}
                      className="desk__node"
                      data-selected={isSelected || undefined}
                      data-dimmed={openId && openId !== n.id ? '' : undefined}
                      data-opened={openId === n.id || undefined}
                      onFocus={() => store.getState().focusedId !== n.id && store.focus(n.id)}
                      style={{
                        left: n.x,
                        top: n.y,
                        width: n.w,
                        height: n.h,
                        rotate: n.rotation ? `${n.rotation}deg` : undefined,
                      }}
                    >
                      {renderNode(n, { lod, zoom: viewport.zoom, isSelected, isFocused, isOpen: openId === n.id })}
                    </div>
                  );
                })}
          </div>
        </div>

        {/* Selection outlines stay 2 px on screen whatever the zoom. */}
        <div className="desk__overlay" aria-hidden>
          {lod !== 'far' &&
            selection.map((id) => {
              const n = nodesMap[id];
              if (!n) return null;
              const r = rectToScreen(rectOf(n), viewport);
              return (
                <div
                  key={id}
                  className="desk__selection"
                  style={{ left: r.x - 8, top: r.y - 8, width: r.w + 16, height: r.h + 16 }}
                />
              );
            })}
          {groupRect && lod !== 'far' && (
            <GroupFrame rect={rectToScreen(groupRect, viewport)}>
              {renderGroupLabel
                ? renderGroupLabel(selection.map((id) => nodesMap[id]!).filter(Boolean))
                : m.multiSelection(selection.length)}
            </GroupFrame>
          )}
          {lasso && (() => {
            const r = rectToScreen(lasso, viewport);
            return <div className="desk__lasso" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />;
          })()}
        </div>

        {nodes.length === 0 && <p className="desk__empty">{m.empty}</p>}

        {children}

        {dropCount > 0 && renderDropZone && <div className="desk__dropzone">{renderDropZone(dropCount)}</div>}

        <p id={hintId} className="desk__sr">
          {m.instructions}
        </p>
        <div className="desk__sr" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </div>
      </div>
    </DeskContext.Provider>
  );
}

function GroupFrame({ rect, children }: { rect: Rect; children: ReactNode }) {
  return (
    <div className="desk__group" style={{ left: rect.x - 20, top: rect.y - 20, width: rect.w + 40, height: rect.h + 40 }}>
      <span className="desk__group-label">{children}</span>
    </div>
  );
}
