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
  resizeRect,
  screenToWorld,
  threadPath,
  union,
  wheelZoomFactor,
  type Direction,
  type ResizeHandle,
} from '../core/geometry';
import { MIN_NODE_SIZE } from '../core/store';
import type { DeskStore } from '../core/store';
import type { DeskNode, Lod, Rect, ResizeMode, Vec } from '../core/types';
import { DeskContext, useDeskState } from './hooks';
import { lang } from '@oel/i18n';

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
  resized: string;
  /** Working inside a container (Figma L: a gallery). */
  entered: (title: string) => string;
  left: string;
  /** Frame label around the entered container. */
  insideLabel: (title: string) => string;
  parented: (count: number, title: string) => string;
  unparented: (count: number) => string;
  /** Undo step names of the pointer gestures. */
  dragging: string;
  resizing: string;
  /** A thread chip's label. */
  thread: (title: string, label: string) => string;
}

const frMessages: DeskMessages = {
  roleDescription: 'bureau',
  nodeRoleDescription: 'fichier',
  instructions:
    'Flèches : passer d’un fichier à l’autre. Espace : ajouter ou retirer de la sélection. Entrée : ouvrir. ' +
    'Alt + flèches : déplacer la sélection. Alt + = et Alt + − : agrandir ou réduire. Maj + flèches : faire défiler le bureau. ' +
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
  resized: 'Taille modifiée',
  entered: (t) => `Dans « ${t} ». Flèches : passer d’un élément à l’autre. Échap : sortir.`,
  left: 'Sorti du dossier',
  insideLabel: (t) => `${t} · Échap pour sortir`,
  parented: (n, t) => (n === 1 ? `Rangé dans « ${t} »` : `${n} éléments rangés dans « ${t} »`),
  unparented: (n) => (n === 1 ? 'Sorti du dossier' : `${n} éléments sortis du dossier`),
  dragging: 'Déplacement',
  resizing: 'Redimensionnement',
  thread: (title, label) => `Fil : ${title}. ${label}.`,
};

const enMessages: DeskMessages = {
  roleDescription: 'desk',
  nodeRoleDescription: 'file',
  instructions:
    'Arrows: move from file to file. Space: add to or remove from the selection. Enter: open. ' +
    'Alt + arrows: move the selection. Alt + = and Alt + −: enlarge or shrink. Shift + arrows: scroll the desk. ' +
    '+ and −: zoom, 0: zoom 100 %. Esc: deselect.',
  empty: 'The desk is empty. Drop files or create one from the bottom bar.',
  zoom: (p) => `Zoom ${p} %`,
  maxZoomOut: 'Furthest zoom out',
  selection: (n) => (n === 0 ? 'Nothing selected' : n === 1 ? '1 file selected' : `${n} files selected`),
  moved: (n) => (n === 1 ? 'File moved' : `${n} files moved`),
  undone: (l) => `Undone: ${l}`,
  redone: (l) => `Redone: ${l}`,
  nothingToUndo: 'Nothing to undo',
  multiSelection: (n) => `${n} files`,
  linkHint: 'Enter: open the thread. Delete: cut the link. Esc: back to the desk.',
  pickStart: 'Choose a file. Tab: next file. Enter: choose. Esc: cancel.',
  pickCandidate: (t) => t,
  pickNone: 'No file to choose',
  pickCancelled: 'Cancelled',
  detached: (n) => (n === 1 ? 'Unstuck' : `${n} unstuck`),
  resized: 'Size changed',
  entered: (t) => `In “${t}”. Arrows: move from item to item. Esc: leave.`,
  left: 'Left the folder',
  insideLabel: (t) => `${t} · Esc to leave`,
  parented: (n, t) => (n === 1 ? `Put in “${t}”` : `${n} items put in “${t}”`),
  unparented: (n) => (n === 1 ? 'Taken out of the folder' : `${n} items taken out of the folder`),
  dragging: 'Move',
  resizing: 'Resize',
  thread: (title, label) => `Thread: ${title}. ${label}.`,
};

/** The desk's words in the interface language (`@oel/i18n`); a host overrides any of them with `messages`. */
export const defaultMessages: DeskMessages = lang() === 'en' ? enMessages : frMessages;

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
  /** How a node resizes (handles on a single selection, Alt + = / −). Default: it does not. */
  resizeMode?: (node: DeskNode<D>) => ResizeMode;
  /** Whether `node` may be dropped into `container` (on top of `store.canParent`). */
  canContain?: (container: DeskNode<D>, node: DeskNode<D>) => boolean;
  /**
   * Figma O2 « Sélection » mode: a tap (or click) adds or removes a paper, papers don't drag (the grip still does),
   * a tap on empty desk keeps the selection and the mouse lasso adds to it.
   */
  multiSelect?: boolean;
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
  /** `touch`: a finger on empty desk — a tap (no move past TAP_SLOP) clears the selection instead. */
  | { kind: 'pan'; pointerId: number; last: Vec; touch?: { start: Vec; moved: boolean } }
  /** Two fingers: pinch-zoom around them and pan with their midpoint. */
  | { kind: 'pinch'; pointers: [number, number]; last: [Vec, Vec] }
  /** A finger on a paper that isn't selected: it follows after TOUCH_HOLD_MS, a quick swipe pans instead. */
  | { kind: 'press'; pointerId: number; start: Vec; id: string; toggle?: boolean }
  | { kind: 'resize'; pointerId: number; id: string; handle: ResizeHandle; start: Vec; rect: Rect; mode: ResizeMode }
  | { kind: 'lasso'; pointerId: number; origin: Vec; base: string[]; rect: Rect };

const NUDGE = 10;
const NUDGE_BIG = 50;
const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const PAN_STEP = 80;
/** Figma O4: an unselected paper follows a finger after this hold; a selected one, or the grip, at once. */
const TOUCH_HOLD_MS = 150;
/** Finger travel (px) that turns a tap into a swipe. */
const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 350;
/** Figma O2: a finger held this long opens the paper's menu, or starts a lasso on empty desk. */
const LONG_PRESS_MS = 500;

function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* not allowed here */
  }
}

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
    resizeMode = () => 'none',
    canContain = () => true,
    wheelZoomSpeed = 0.002,
    multiSelect = false,
    onKeyDown,
    children,
    className,
  } = props;
  const m = useMemo(() => ({ ...defaultMessages, ...props.messages }), [props.messages]);

  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const keyboardMove = useRef(false);
  const spaceHeld = useRef(false);
  /** Fingers on the desk (screen px), for pinch. */
  const touches = useRef(new Map<number, Vec>());
  const holdTimer = useRef<number | null>(null);
  const longTimer = useRef<number | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const lastTouch = useRef<number | null>(null);
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  const enteredId = useDeskState(store, (s) => s.enteredId);
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

  useEffect(
    () => () => {
      if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
      if (longTimer.current != null) window.clearTimeout(longTimer.current);
    },
    [],
  );

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
  /** A drag of the current selection; nodes stuck to something outside it rubber-band until torn off. */
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, p: Vec, ids: string[], wasSelected: boolean, hitId: string) => {
    store.begin(m.dragging);
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
      hitId,
    };
  };

  const clearHold = () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
    if (longTimer.current != null) window.clearTimeout(longTimer.current);
    holdTimer.current = null;
    longTimer.current = null;
  };

  /**
   * Figma O2 · 1–2, a finger that stays put: on a paper (now grabbed, not yet moved) its menu opens and the drag gives
   * way; on empty desk a lasso starts at the finger.
   */
  const armLongPress = (pointerId: number, at: Vec, delay = LONG_PRESS_MS) => {
    if (longTimer.current != null) window.clearTimeout(longTimer.current);
    longTimer.current = window.setTimeout(() => {
      longTimer.current = null;
      const g = gesture.current;
      if (!g || !('pointerId' in g) || g.pointerId !== pointerId) return;
      if (g.kind === 'drag' && !g.moved && onContextMenu) {
        gesture.current = null;
        store.end();
        setDragging(false);
        try {
          rootRef.current?.releasePointerCapture(pointerId);
        } catch {
          /* not captured */
        }
        buzz();
        onContextMenu(store.getState().selection, at);
      } else if (g.kind === 'pan' && g.touch && !g.touch.moved) {
        const base = multiSelect ? store.getState().selection : [];
        if (!multiSelect) store.clearSelection();
        const origin = screenToWorld(at, store.getState().viewport);
        gesture.current = { kind: 'lasso', pointerId, origin, base, rect: { ...origin, w: 0, h: 0 } };
        setLasso(gesture.current.rect);
        buzz();
      }
    }, delay);
  };

  /** A second finger: whatever the first one started gives way to a pinch (except a move under way, Figma O3). */
  const startPinch = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    const g = gesture.current;
    if (g?.kind === 'drag' && g.moved) return false;
    clearHold();
    if (g?.kind === 'drag' || g?.kind === 'resize') store.end();
    if (g?.kind === 'lasso') setLasso(null);
    const [a, b] = [...touches.current.entries()];
    gesture.current = { kind: 'pinch', pointers: [a![0], b![0]], last: [a![1], b![1]] };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
    return true;
  };

  /** Double tap on a paper opens it (touch has no reliable dblclick). */
  const tapped = (id: string) => {
    const now = performance.now();
    if (lastTap.current?.id === id && now - lastTap.current.at < DOUBLE_TAP_MS) {
      lastTap.current = null;
      if (onOpen && !store.node(id)?.container) onOpen(id);
      else if (store.node(id)?.container) enterContainer(id);
      return;
    }
    lastTap.current = { id, at: now };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const touch = e.pointerType === 'touch';
    if (touch) {
      lastTouch.current = performance.now();
      if (e.isPrimary) touches.current.clear(); // a new touch sequence: forget fingers whose `up` never reached us
      touches.current.set(e.pointerId, localPoint(e));
      if (touches.current.size > 2) return;
      if (touches.current.size === 2) {
        if (!openId && !pickTarget && !target.closest('[data-desk-ui]') && startPinch(e)) return;
        if (gesture.current) return; // a move keeps going; extra fingers are ignored
      }
    }
    // A grip (`data-desk-grip`, e.g. on a floating toolbar) drags the selection from outside the papers.
    if (target.closest('[data-desk-grip]') && e.button === 0 && !openId && !pickTarget) {
      const ids = store.getState().selection;
      if (!ids.length) return;
      e.preventDefault();
      startDrag(e, localPoint(e), ids, false, ids[0]!);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (target.closest('[data-desk-ui]') || openId) return;
    if (e.button === 2) return; // context menu handled separately
    const p = localPoint(e);
    const handle = target.closest<HTMLElement>('[data-resize-handle]');
    if (handle && e.button === 0 && !pickTarget) {
      const id = handle.dataset.resizeFor!;
      const n = store.node(id);
      if (!n) return;
      store.begin(m.resizing);
      gesture.current = { kind: 'resize', pointerId: e.pointerId, id, handle: handle.dataset.resizeHandle as ResizeHandle, start: p, rect: rectOf(n), mode: resizeMode(n) };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    let nodeEl = target.closest<HTMLElement>('[data-node-id]');
    // Inside a container, its own surface is empty space; anything outside it leaves the container.
    const entered = store.getState().enteredId;
    if (entered && nodeEl) {
      const raw = nodeEl.dataset.nodeId!;
      if (raw === entered) nodeEl = null;
      else if (store.actsOn(raw) !== raw) {
        store.enter(null);
        announce(m.left);
      }
    } else if (entered && !nodeEl) {
      const w = screenToWorld(p, viewport);
      const c = store.node(entered);
      if (!c || w.x < c.x || w.y < c.y || w.x > c.x + c.w || w.y > c.y + c.h) {
        store.enter(null);
        announce(m.left);
      }
    }
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
      const id = store.actsOn(nodeEl.dataset.nodeId!);
      const wasSelected = store.getState().selection.includes(id);
      if (multiSelect) {
        gesture.current = { kind: 'press', pointerId: e.pointerId, start: p, id, toggle: true };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (touch && !wasSelected && !additive) {
        gesture.current = { kind: 'press', pointerId: e.pointerId, start: p, id };
        armLongPress(e.pointerId, p);
        const root = e.currentTarget;
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          const g = gesture.current;
          if (g?.kind !== 'press' || g.pointerId !== e.pointerId) return;
          store.select([id]);
          store.focus(id);
          startDrag(e, g.start, store.getState().selection, false, id);
          try {
            root.setPointerCapture(g.pointerId);
          } catch {
            /* the finger already lifted */
          }
        }, TOUCH_HOLD_MS);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (additive) store.select([id], 'toggle');
      else if (!wasSelected) store.select([id]);
      store.focus(id);
      const ids = store.getState().selection;
      if (!ids.includes(id)) return; // toggled off: no drag
      startDrag(e, p, ids, wasSelected, id);
      if (touch) armLongPress(e.pointerId, p);
      return; // capture lazily once the drag starts, so click/dblclick keep their target
    } else if (touch) {
      gesture.current = { kind: 'pan', pointerId: e.pointerId, last: p, touch: { start: p, moved: false } };
      armLongPress(e.pointerId, p);
    } else {
      const base = additive || multiSelect ? selection : [];
      if (!additive && !multiSelect) store.clearSelection();
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
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, localPoint(e));
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (!g.pointers.includes(e.pointerId)) return;
      const next: [Vec, Vec] = [touches.current.get(g.pointers[0]) ?? g.last[0], touches.current.get(g.pointers[1]) ?? g.last[1]];
      store.pinch(g.last, next);
      g.last = next;
      return;
    }
    if (!g || g.pointerId !== e.pointerId) return;
    const p = localPoint(e);
    if (g.kind === 'press') {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < TAP_SLOP) return;
      // A swipe before the hold: the finger was exploring, not grabbing.
      clearHold();
      gesture.current = { kind: 'pan', pointerId: g.pointerId, last: p, touch: { start: g.start, moved: true } };
      setPanning(true);
      store.panBy(p.x - g.start.x, p.y - g.start.y);
      return;
    }
    if (g.kind === 'pan') {
      if (g.touch && !g.touch.moved) {
        if (Math.hypot(p.x - g.touch.start.x, p.y - g.touch.start.y) < TAP_SLOP) return;
        g.touch.moved = true;
        clearHold();
        setPanning(true);
      }
      store.panBy(p.x - g.last.x, p.y - g.last.y);
      g.last = p;
    } else if (g.kind === 'resize') {
      const z = store.getState().viewport.zoom;
      const keepAspect = g.mode === 'scale' || g.mode === 'aspect' || e.shiftKey;
      const r = resizeRect(g.rect, g.handle, { x: (p.x - g.start.x) / z, y: (p.y - g.start.y) / z }, { keepAspect, fromCenter: e.altKey, min: MIN_NODE_SIZE });
      store.resizeTo(g.id, r, { mode: g.mode });
    } else if (g.kind === 'drag') {
      if (!g.moved) {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < (e.pointerType === 'touch' ? TAP_SLOP : 3)) return;
        clearHold();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
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
      const hits = store.reachable().filter((n) => intersects(g.rect, rectOf(n))).map((n) => n.id);
      store.select([...new Set([...g.base, ...hits])]);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (!g.pointers.includes(e.pointerId)) return;
      // One finger left: it carries on panning.
      const rest = g.pointers.find((id) => id !== e.pointerId)!;
      const at = touches.current.get(rest);
      gesture.current = at ? { kind: 'pan', pointerId: rest, last: at, touch: { start: at, moved: true } } : null;
      if (!at) setPanning(spaceHeld.current);
      return;
    }
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    clearHold();
    if (g.kind === 'press') {
      if (e.type === 'pointercancel') return;
      if (g.toggle) {
        store.select([g.id], 'toggle');
        store.focus(g.id);
        announce(m.selection(store.getState().selection.length));
        return;
      }
      store.select([g.id]);
      store.focus(g.id);
      tapped(g.id);
      return;
    }
    if (g.kind === 'pan') {
      setPanning(spaceHeld.current);
      if (g.touch && !g.touch.moved && e.type !== 'pointercancel' && !multiSelect) store.clearSelection();
    }
    if (g.kind === 'resize') {
      store.end();
      announce(m.resized);
    }
    if (g.kind === 'drag') {
      setDragging(false);
      if (g.stuck.length) store.moveBy(g.stuck, { x: -g.stuckApplied.x, y: -g.stuckApplied.y });
      if (g.moved && g.ids.length) dropInContainers(g.ids, screenToWorld(localPoint(e), store.getState().viewport));
      store.end();
      if (g.moved && g.ids.length) {
        announce(m.moved(g.ids.length));
        onMoveEnd?.(g.ids, { altKey: e.altKey });
      }
      else if (g.wasSelected && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
        store.select([g.hitId]);
        if (e.pointerType === 'touch') tapped(g.hitId);
      }
    }
    if (g.kind === 'lasso') {
      setLasso(null);
      const n = store.getState().selection.length;
      if (n) announce(m.selection(n));
    }
  };

  /**
   * After a drag (inside its undo step): nodes released over a container go in; nodes dragged
   * out of their container come out (or into the container they were dropped on).
   */
  const dropInContainers = (ids: string[], at: Vec) => {
    const movable = ids.filter((id) => !store.node(id)?.attach);
    const target = store.containerAt(at, movable);
    const accepted = target ? movable.filter((id) => canContain(target, store.node(id)!)) : [];
    if (target && accepted.length) {
      const moved = store.setParent(accepted, target.id);
      if (moved.length) announce(m.parented(moved.length, target.title));
    }
    const out = movable.filter((id) => {
      const parent = store.node(id)?.parent?.id;
      const c = parent && store.node(parent);
      return c && (at.x < c.x || at.y < c.y || at.x > c.x + c.w || at.y > c.y + c.h);
    });
    if (out.length) {
      store.setParent(out, null);
      announce(m.unparented(out.length));
    }
  };

  const enterContainer = (id: string) => {
    store.enter(id);
    keyboardMove.current = true;
    const first = store.ordered()[0];
    if (first) store.focus(first.id);
    announce(m.entered(store.node(id)?.title ?? ''));
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (lastTouch.current && performance.now() - lastTouch.current < 600) return; // touch: `tapped` opened it
    if (pickTarget || (e.target as HTMLElement).closest('[data-desk-ui]')) return;
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const raw = nodeEl?.dataset.nodeId;
    if (!raw || raw === store.getState().enteredId) return;
    const id = store.actsOn(raw);
    // Double-click a container: work inside it (its children are selectable).
    if (nodesMap[id]?.container) return enterContainer(id);
    if (onOpen && nodesMap[id]) onOpen(id);
  };

  const onContext = (e: ReactMouseEvent) => {
    if (pickTarget) {
      e.preventDefault();
      return;
    }
    if (!onContextMenu || (e.target as HTMLElement).closest('[data-desk-ui]')) return;
    if (lastTouch.current && performance.now() - lastTouch.current < 1500) {
      e.preventDefault(); // a finger: the long-press timer (armLongPress) owns the menu
      return;
    }
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    e.preventDefault();
    if (nodeEl) {
      const id = store.actsOn(nodeEl.dataset.nodeId!);
      if (!store.getState().selection.includes(id)) store.select([id]);
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

    const grow = e.altKey && !mod ? ({ Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 } as Record<string, number>)[e.code] : undefined;
    if (grow) {
      // Alt + = / − : 10 % bigger or smaller (Maj: 25 %), shape kept, around the centre.
      const id = selection.length === 1 ? selection[0]! : null;
      const n = id ? store.node(id) : undefined;
      const mode = n ? resizeMode(n) : 'none';
      if (n && mode !== 'none') {
        const k = 1 + grow * (e.shiftKey ? 0.25 : 0.1);
        const w = n.w * k;
        const h = n.h * k;
        store.resize(n.id, { x: n.x + (n.w - w) / 2, y: n.y + (n.h - h) / 2, w, h }, { mode });
        announce(m.resized);
      }
    } else if (dir && e.altKey) {
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
      if (focusedId && nodesMap[focusedId]?.container && focusedId !== enteredId) enterContainer(focusedId);
      else if (focusedId && onOpen) onOpen(focusedId);
    } else if (e.key === 'Escape') {
      if (enteredId) {
        const id = enteredId;
        store.enter(null);
        keyboardMove.current = true;
        store.focus(id);
        announce(m.left);
      } else if (selection.length) {
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
        data-dragging={dragging || undefined}
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
                      data-container={n.container ? '' : undefined}
                      data-entered={enteredId === n.id || undefined}
                      data-outside={enteredId && enteredId !== n.id && store.actsOn(n.id) === enteredId ? '' : undefined}
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
                      {n.base && resizeMode(n) === 'scale' ? (
                        // Content keeps its natural size and is drawn scaled (documents, slides).
                        <div className="desk__scaled" style={{ width: n.base.w, height: n.base.h, transform: `scale(${n.w / n.base.w}, ${n.h / n.base.h})` }}>
                          {renderNode(n, { lod, zoom: viewport.zoom, isSelected, isFocused, isOpen: openId === n.id })}
                        </div>
                      ) : (
                        renderNode(n, { lod, zoom: viewport.zoom, isSelected, isFocused, isOpen: openId === n.id })
                      )}
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
                    aria-label={m.thread(l.title ?? l.label, l.label)}
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
          {(() => {
            const id = selection.length === 1 ? selection[0]! : null;
            const n = id ? nodesMap[id] : undefined;
            if (!n || n.locked || openId || pickTarget || resizeMode(n) === 'none') return null;
            const r = rectToScreen(rectOf(n), viewport);
            return HANDLES.map((h) => (
              <span
                key={h}
                className={`desk__handle desk__handle--${h}`}
                data-resize-handle={h}
                data-resize-for={n.id}
                style={{
                  left: r.x + (h.includes('w') ? 0 : h.includes('e') ? r.w : r.w / 2),
                  top: r.y + (h.includes('n') ? 0 : h.includes('s') ? r.h : r.h / 2),
                }}
              />
            ));
          })()}
          {enteredId && nodesMap[enteredId] && (() => {
            const r = rectToScreen(rectOf(nodesMap[enteredId]!), viewport);
            return (
              <div className="desk__inside" style={{ left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12 }}>
                <span className="desk__inside-label">{m.insideLabel(nodesMap[enteredId]!.title)}</span>
              </div>
            );
          })()}
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
