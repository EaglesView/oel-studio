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
  rectOf,
  rectToScreen,
  screenToWorld,
  threadPath,
  union,
  wheelZoomFactor,
  type Direction,
} from '../core/geometry';
import type { DeskStore } from '../core/store';
import type { DeskNode, Lod, Rect, Vec } from '../core/types';
import { DeskContext, useDeskState } from './hooks';

export interface DeskMessages {
  roleDescription: string;
  nodeRoleDescription: string;
  instructions: string;
  empty: string;
  zoom: (percent: number) => string;
  maxZoomOut: string;
  selection: (count: number) => string;
  moved: (count: number) => string;
  undone: (label: string) => string;
  redone: (label: string) => string;
  nothingToUndo: string;
  multiSelection: (count: number) => string;
  /** Description of a thread chip for screen readers. */
  linkHint: string;
  /** Pick mode started (`pickTarget`). */
  pickStart: string;
  /** Pick mode: the highlighted candidate. */
  pickCandidate: (title: string) => string;
  pickNone: string;
  pickCancelled: string;
  /** A pointer drag moved nodes (after the move's undo step closed). `altKey`: Alt held on release (Figma K « Alt + lâcher » sticks). */
  onMoveEnd?: (ids: string[], modifiers: { altKey: boolean }) => void;
  /** A stuck node was dragged off its target. */
  detached: (count: number) => string;
}

export const defaultMessages: DeskMessages = {
  roleDescription: 'bureau',
  nodeRoleDescription: 'fichier',
  instructions:
    'Flèches : passer d’un fichier à l’autre. Espace : ajouter ou retirer de la sélection. Entrée : ouvrir. ' +
    'Alt + flèches : déplacer la sélection. Maj + flèches : faire défiler le bureau. ' +
    '+ et − : zoom, 0 : zoom 100 %. Échap : désélectionner.',
  empty: 'Le bureau est vide. Déposez des fichiers ou créez-en un depuis la barre du bas.',
  zoom: (p) => `Zoom ${p} %`,
  maxZoomOut: 'Zoom arrière maximal',
  selection: (n) => (n === 0 ? 'Aucune sélection' : n === 1 ? '1 fichier sélectionné' : `${n} fichiers sélectionnés`),
  moved: (n) => (n === 1 ? 'Fichier déplacé' : `${n} fichiers déplacés`),
  undone: (l) => `Annulé : ${l}`,
  redone: (l) => `Rétabli : ${l}`,
  nothingToUndo: 'Rien à annuler',
  multiSelection: (n) => `${n} fichiers`,
  linkHint: 'Entrée : ouvrir le fil. Suppr : couper le lien. Échap : revenir au bureau.',
  pickStart: 'Choisissez un fichier. Tab : fichier suivant. Entrée : choisir. Échap : annuler.',
  pickCandidate: (t) => t,
  pickNone: 'Aucun fichier à choisir',
  pickCancelled: 'Annulé',
  detached: (n) => (n === 1 ? 'Décollé' : `${n} décollés`),
};

/**
 * Pick mode (Figma K « Coller à… »): the person points at a node, or Tabs
 * through the candidates nearest `from` first, and Entrée or a click picks it.
 */
export interface PickTarget<D = unknown> {
  /** The node the choice is for (dashed guide starts there; never a candidate). */
  from: string;
  /** Which nodes may be picked. Attached nodes never can. */
  filter?: (node: DeskNode<D>) => boolean;
  onPick: (id: string) => void;
  onCancel: () => void;
}

/** Screen pixels a stuck node must be dragged before it comes unstuck; it lags behind until then. */
const DETACH_DISTANCE = 24;
const DETACH_RESISTANCE = 0.35;

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
  /** Screen pixels a node's selection ring reaches beyond its top edge (for a tab drawn above the node). */
  selectionOverhang?: (node: DeskNode<D>, zoom: number) => number;
  /** Label of the dashed multi-selection frame. */
  renderGroupLabel?: (nodes: DeskNode<D>[]) => ReactNode;
  onOpen?: (id: string) => void;
  onDelete?: (ids: string[]) => void;
  onContextMenu?: (ids: string[], at: Vec) => void;
  onDropFiles?: (files: File[], at: Vec) => void;
  renderDropZone?: (count: number) => ReactNode;
  /** Shown centred while the desk has no node, in place of `messages.empty` (e.g. creation cards). Interactive. */
  renderEmpty?: () => ReactNode;
  /** A thread's chip was clicked, or Entrée pressed on it (Figma G1/G3). `anchor` is the chip, in desk-element pixels. */
  onLinkOpen?: (id: string, anchor: Rect) => void;
  /** Suppr on a focused thread chip (« Couper le lien ? »). */
  onLinkDelete?: (id: string) => void;
  /** The thread shown as selected (its popover is open). */
  activeLinkId?: string | null;
  /** While set, the desk is in pick mode (see `PickTarget`). */
  pickTarget?: PickTarget<D> | null;
  /** A pointer drag moved nodes (after the move's undo step closed). `altKey`: Alt held on release (Figma K « Alt + lâcher » sticks). */
  onMoveEnd?: (ids: string[], modifiers: { altKey: boolean }) => void;
  /** A stuck node was dragged off its target (`store.detach` already ran inside the drag's undo step). */
  onDetach?: (ids: string[]) => void;
  /** Wheel zoom speed (Ctrl/⌘ + wheel or pinch). Lower is gentler. Default 0.002. */
  wheelZoomSpeed?: number;
  /** Extra keys (return true when handled). Runs before the built-in map. */
  onKeyDown?: (e: ReactKeyboardEvent, store: DeskStore<D>) => boolean | void;
  messages?: Partial<DeskMessages>;
  /** Screen-space overlays (contextual toolbar, cursors). Mark interactive roots with data-desk-ui. */
  children?: ReactNode;
  className?: string;
}

type Gesture =
  | {
      kind: 'drag';
      pointerId: number;
      last: Vec;
      start: Vec;
      /** Nodes that follow the pointer exactly. */
      ids: string[];
      /** Stuck nodes dragged without their target: they lag until DETACH_DISTANCE, then come unstuck. */
      stuck: string[];
      /** World offset already applied to `stuck`. */
      stuckApplied: Vec;
      moved: boolean;
      wasSelected: boolean;
      hitId: string;
    }
  | { kind: 'pan'; pointerId: number; last: Vec }
  | { kind: 'lasso'; pointerId: number; origin: Vec; base: string[]; rect: Rect };

const NUDGE = 10;
const NUDGE_BIG = 50;
const PAN_STEP = 80;

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
    renderGroupLabel,
    selectionOverhang,
    onOpen,
    onDelete = (ids) => store.remove(ids),
    onContextMenu,
    onDropFiles,
    renderDropZone,
    renderEmpty,
    onLinkOpen,
    onLinkDelete,
    activeLinkId = null,
    pickTarget = null,
    onDetach,
    onMoveEnd,
    wheelZoomSpeed = 0.002,
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
  const chipHintId = useId();
  const listId = useId();

  const [pickHover, setPickHover] = useState<string | null>(null);
  const [pickPointer, setPickPointer] = useState<Vec | null>(null);

  const nodesMap = useDeskState(store, (s) => s.nodes);
  const order = useDeskState(store, (s) => s.order);
  const links = useDeskState(store, (s) => s.links);
  const selection = useDeskState(store, (s) => s.selection);
  const focusedId = useDeskState(store, (s) => s.focusedId);
  const viewport = useDeskState(store, (s) => s.viewport);
  const openId = useDeskState(store, (s) => s.openId);
  const showLinks = useDeskState(store, (s) => s.showLinks);

  const lod = lodForZoom(viewport.zoom);
  const nodes = useMemo(() => order.map((id) => nodesMap[id]!).filter(Boolean), [order, nodesMap]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  /* ── announcements ─────────────────────────────────────────────── */
  const announce = useCallback((msg: string) => {
    // Clear first so repeating the same message is re-announced.
    setMessage('');
    requestAnimationFrame(() => setMessage(msg));
  }, []);
  const ctx = useMemo(() => ({ store, announce }), [store, announce]);

  // Tell screen-reader users when they hit the zoom-out limit.
  const atMin = viewport.zoom <= store.zoomLimits.min + 1e-6;
  const wasAtMin = useRef(atMin);
  useEffect(() => {
    if (atMin && !wasAtMin.current) announce(m.maxZoomOut);
    wasAtMin.current = atMin;
  }, [atMin, announce, m]);

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
        store.zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode, wheelZoomSpeed), anchor);
      } else {
        store.panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store, wheelZoomSpeed]);

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

  /* ── pick mode (« Coller à… ») ─────────────────────────────────── */
  const isCandidate = useCallback(
    (id: string) => !!pickTarget && store.canAttach(pickTarget.from, id) && (pickTarget.filter?.(store.node(id)!) ?? true),
    [pickTarget, store],
  );
  /** Candidates nearest the `from` node first (Tab order). */
  const pickCandidates = useCallback((): DeskNode<D>[] => {
    if (!pickTarget) return [];
    const from = store.node(pickTarget.from);
    if (!from) return [];
    const c = center(rectOf(from));
    const dist = (n: DeskNode<D>) => Math.hypot(center(rectOf(n)).x - c.x, center(rectOf(n)).y - c.y);
    return store.nodes.filter((n) => isCandidate(n.id)).sort((a, b) => dist(a) - dist(b));
  }, [pickTarget, store, isCandidate]);

  useEffect(() => {
    setPickHover(null);
    setPickPointer(null);
    if (!pickTarget) return;
    rootRef.current?.focus({ preventScroll: true });
    announce(pickCandidates().length ? m.pickStart : m.pickNone);
  }, [pickTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickKey = (e: ReactKeyboardEvent): boolean => {
    if (!pickTarget) return false;
    if (e.key === 'Escape') {
      announce(m.pickCancelled);
      pickTarget.onCancel();
    } else if (e.key === 'Tab') {
      const list = pickCandidates();
      if (!list.length) return true;
      const i = list.findIndex((n) => n.id === pickHover);
      const next = list[(i + (e.shiftKey ? -1 : 1) + list.length + (i < 0 && e.shiftKey ? 1 : 0)) % list.length]!;
      setPickHover(next.id);
      store.reveal(next.id);
      announce(m.pickCandidate(describeNode(next)));
    } else if (e.key === 'Enter') {
      if (pickHover && isCandidate(pickHover)) pickTarget.onPick(pickHover);
    } else if (!(e.key === '+' || e.key === '-' || e.key === '=' || e.key === '_' || e.key === '0' || (e.shiftKey && e.key.startsWith('Arrow')))) {
      return true; // swallow everything else while picking; zoom and pan keys still work
    } else return false;
    return true;
  };

  /* ── pointer gestures ──────────────────────────────────────────── */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-desk-ui]') || openId) return;
    if (e.button === 2) return; // context menu handled separately
    const p = localPoint(e);
    const nodeEl = target.closest<HTMLElement>('[data-node-id]');
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (pickTarget && e.button === 0 && !spaceHeld.current) {
      const id = nodeEl?.dataset.nodeId;
      if (id && isCandidate(id)) pickTarget.onPick(id);
      else if (!id) {
        announce(m.pickCancelled);
        pickTarget.onCancel();
      }
      return;
    }

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
      const all = new Set(ids);
      const stuck = ids.filter((x) => {
        const to = store.node(x)?.attach?.to;
        return to && !all.has(to);
      });
      gesture.current = {
        kind: 'drag',
        pointerId: e.pointerId,
        last: p,
        start: p,
        ids: ids.filter((x) => !stuck.includes(x)),
        stuck,
        stuckApplied: { x: 0, y: 0 },
        moved: false,
        wasSelected,
        hitId: id,
      };
      return; // capture lazily once the drag starts, so click/dblclick keep their target
    } else {
      const base = additive ? selection : [];
      if (!additive) store.clearSelection();
      const origin = screenToWorld(p, viewport);
      gesture.current = { kind: 'lasso', pointerId: e.pointerId, origin, base, rect: { ...origin, w: 0, h: 0 } };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pickTarget && !gesture.current) {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null;
      const hover = id && isCandidate(id) ? id : null;
      if (hover !== pickHover) setPickHover(hover);
      setPickPointer(localPoint(e));
      return;
    }
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
      if (g.stuck.length) {
        const total = { x: (p.x - g.start.x) / z, y: (p.y - g.start.y) / z };
        const applied = g.stuckApplied;
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) >= DETACH_DISTANCE) {
          const freed = g.stuck;
          store.detach(freed); // inside the drag's begin/end: same undo step as the move
          store.moveBy(freed, { x: total.x - applied.x, y: total.y - applied.y });
          g.ids = [...g.ids, ...freed];
          g.stuck = [];
          onDetach?.(freed);
          announce(m.detached(freed.length));
        } else {
          // Rubber band: the stuck node lags behind the pointer and slides back if let go.
          const want = { x: total.x * DETACH_RESISTANCE, y: total.y * DETACH_RESISTANCE };
          store.moveBy(g.stuck, { x: want.x - applied.x, y: want.y - applied.y });
          g.stuckApplied = want;
        }
      }
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
      if (g.stuck.length) store.moveBy(g.stuck, { x: -g.stuckApplied.x, y: -g.stuckApplied.y });
      store.end();
      if (g.moved && g.ids.length) {
        announce(m.moved(g.ids.length));
        onMoveEnd?.(g.ids, { altKey: e.altKey });
      }
      else if (g.wasSelected && !(e.shiftKey || e.metaKey || e.ctrlKey)) store.select([g.hitId]);
    }
    if (g.kind === 'lasso') {
      setLasso(null);
      const n = store.getState().selection.length;
      if (n) announce(m.selection(n));
    }
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (pickTarget || (e.target as HTMLElement).closest('[data-desk-ui]')) return;
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = nodeEl?.dataset.nodeId;
    if (id && onOpen && nodesMap[id]) onOpen(id);
  };

  const onContext = (e: ReactMouseEvent) => {
    if (pickTarget) {
      e.preventDefault();
      return;
    }
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
    if (pickKey(e)) {
      e.preventDefault();
      return;
    }
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
      moveFocus(store.focusDirection(dir), mod);
    } else if (e.key === 'Home' || e.key === 'End') {
      const list = store.ordered();
      moveFocus((e.key === 'Home' ? list[0] : list[list.length - 1]) ?? null, mod);
    } else if (e.key === ' ' && focusedId) {
      store.select([focusedId], 'toggle');
      announce(m.selection(store.getState().selection.length));
    } else if (e.key === 'Enter') {
      if (focusedId && onOpen) onOpen(focusedId);
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
      store.zoomBy(1.2);
      announce(m.zoom(Math.round(store.getState().viewport.zoom * 100)));
    } else if (!mod && (e.key === '-' || e.key === '_')) {
      store.zoomBy(1 / 1.2);
      announce(m.zoom(Math.round(store.getState().viewport.zoom * 100)));
    } else if (!mod && e.key === '0') {
      store.zoomReset();
      announce(m.zoom(100));
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
        data-picking={pickTarget ? '' : undefined}
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
          {showLinks && (
            <svg className="desk__links" aria-hidden>
              {links.map((l) => {
                const a = nodesMap[l.from];
                const b = nodesMap[l.to];
                if (!a || !b) return null;
                const t = threadPath(rectOf(a), rectOf(b));
                return (
                  <g key={l.id} className={`desk__link desk__link--${l.state}`} data-active={activeLinkId === l.id || undefined}>
                    {activeLinkId === l.id && <path className="desk__link-halo" d={t.d} vectorEffect="non-scaling-stroke" />}
                    <path className="desk__link-line" d={t.d} vectorEffect="non-scaling-stroke" />
                    {l.label && onLinkOpen && (
                      <path
                        className="desk__link-hit"
                        d={t.d}
                        data-desk-ui
                        vectorEffect="non-scaling-stroke"
                        onClick={(e) => {
                          const r = rootRef.current!.getBoundingClientRect();
                          onLinkOpen(l.id, { x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 });
                        }}
                      />
                    )}
                    <circle cx={t.from.x} cy={t.from.y} r={4 / viewport.zoom} />
                    <circle cx={t.to.x} cy={t.to.y} r={4 / viewport.zoom} />
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
            {nodes.map((n) => {
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
                      data-attached={n.attach ? '' : undefined}
                      data-pick={pickTarget ? (n.id === pickTarget.from ? 'from' : isCandidate(n.id) ? 'candidate' : 'no') : undefined}
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

          {/* Thread chips: real buttons, reached with Tab after the papers (Figma G1). */}
          {showLinks && onLinkOpen && (
            <div className="desk__chips" data-desk-ui>
              {links.map((l) => {
                const a = nodesMap[l.from];
                const b = nodesMap[l.to];
                if (!a || !b || !l.label) return null;
                const { mid } = threadPath(rectOf(a), rectOf(b));
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`desk__chip desk__chip--${l.state}`}
                    data-link-id={l.id}
                    data-active={activeLinkId === l.id || undefined}
                    style={{ left: mid.x, top: mid.y }}
                    aria-label={`Fil : ${l.title ?? l.label}. ${l.label}.`}
                    aria-describedby={chipHintId}
                    aria-expanded={activeLinkId === l.id}
                    onClick={(e) => {
                      const root = rootRef.current!.getBoundingClientRect();
                      const r = e.currentTarget.getBoundingClientRect();
                      onLinkOpen(l.id, { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height });
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Delete' || e.key === 'Backspace') && onLinkDelete) {
                        e.preventDefault();
                        onLinkDelete(l.id);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        rootRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus({ preventScroll: true });
                      }
                    }}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selection outlines stay 2 px on screen whatever the zoom. */}
        <div className="desk__overlay" aria-hidden>
          {selection.map((id) => {
              const n = nodesMap[id];
              if (!n) return null;
              const r = rectToScreen(rectOf(n), viewport);
              const up = selectionOverhang?.(n, viewport.zoom) ?? 0;
              return (
                <div
                  key={id}
                  className="desk__selection"
                  style={{ left: r.x - 8, top: r.y - 8 - up, width: r.w + 16, height: r.h + 16 + up }}
                />
              );
            })}
          {groupRect && (
            <GroupFrame rect={rectToScreen(groupRect, viewport)}>
              {renderGroupLabel
                ? renderGroupLabel(selection.map((id) => nodesMap[id]!).filter(Boolean))
                : m.multiSelection(selection.length)}
            </GroupFrame>
          )}
          {pickTarget && <PickGuide store={store} pick={pickTarget} hover={pickHover} pointer={pickPointer} />}
          {lasso && (() => {
            const r = rectToScreen(lasso, viewport);
            return <div className="desk__lasso" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />;
          })()}
        </div>

        {nodes.length === 0 &&
          (renderEmpty ? (
            <div className="desk__empty-slot" data-desk-ui>
              {renderEmpty()}
            </div>
          ) : (
            <p className="desk__empty">{m.empty}</p>
          ))}

        {children}

        {dropCount > 0 && renderDropZone && <div className="desk__dropzone">{renderDropZone(dropCount)}</div>}

        <p id={hintId} className="desk__sr">
          {m.instructions}
        </p>
        <p id={chipHintId} className="desk__sr">
          {m.linkHint}
        </p>
        <div className="desk__sr" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </div>
      </div>
    </DeskContext.Provider>
  );
}

/** Pick mode: accent ring on the hovered candidate, dashed line from the `from` node to it (or to the pointer). */
function PickGuide<D>({ store, pick, hover, pointer }: { store: DeskStore<D>; pick: PickTarget<D>; hover: string | null; pointer: Vec | null }) {
  const viewport = useDeskState(store, (s) => s.viewport);
  const nodes = useDeskState(store, (s) => s.nodes);
  const from = nodes[pick.from];
  if (!from) return null;
  const a = center(rectToScreen(rectOf(from), viewport));
  const target = hover ? nodes[hover] : undefined;
  const ring = target ? rectToScreen(rectOf(target), viewport) : null;
  const b = ring ? center(ring) : pointer;
  return (
    <>
      {b && (
        <svg className="desk__pick-guide">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        </svg>
      )}
      {ring && <div className="desk__pick-ring" style={{ left: ring.x - 6, top: ring.y - 6, width: ring.w + 12, height: ring.h + 12 }} />}
    </>
  );
}

function GroupFrame({ rect, children }: { rect: Rect; children: ReactNode }) {
  return (
    <div className="desk__group" style={{ left: rect.x - 20, top: rect.y - 20, width: rect.w + 40, height: rect.h + 40 }}>
      <span className="desk__group-label">{children}</span>
    </div>
  );
}
