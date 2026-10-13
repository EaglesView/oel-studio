import {
  DEFAULT_ZOOM_LIMITS,
  clamp,
  fitRect,
  rectOf,
  union,
  zoomAt,
  zoomTo,
  center,
  type Direction,
  nearestInDirection,
  overlapArea,
  readingOrder,
  pinchViewport,
} from './geometry';
import type { DeskLink, DeskNode, DeskState, HistoryEntry, Rect, ResizeMode, Vec, Viewport, ZoomLimits } from './types';
import { messages } from '@oel/i18n';

/** Undo step names (« Annulé : Déplacement »), in the interface language. */
const t = messages(
  {
    attach: 'Collage',
    detach: 'Décollage',
    parent: 'Rangement dans un dossier',
    unparent: 'Sortie du dossier',
    resize: 'Redimensionnement',
    add: (title: string) => `Ajout de ${title}`,
    addMany: (n: number) => `Ajout de ${n} fichiers`,
    edit: 'Modification',
    remove: 'Suppression',
    removeMany: (n: number) => `Suppression de ${n} fichiers`,
    move: 'Déplacement',
    align: 'Alignement',
    arrange: 'Rangement',
    links: 'Liens',
  },
  {
    attach: 'Stick',
    detach: 'Unstick',
    parent: 'Put in a folder',
    unparent: 'Take out of the folder',
    resize: 'Resize',
    add: (title) => `Add ${title}`,
    addMany: (n) => `Add ${n} files`,
    edit: 'Edit',
    remove: 'Delete',
    removeMany: (n) => `Delete ${n} files`,
    move: 'Move',
    align: 'Align',
    arrange: 'Arrange',
    links: 'Links',
  },
);

/** Smallest side a resize leaves (world px). */
export const MIN_NODE_SIZE = 48;

type Listener = () => void;

export interface DeskStoreOptions<D> {
  nodes?: DeskNode<D>[];
  links?: DeskLink[];
  viewport?: Viewport;
  historyLimit?: number;
  /** Max zoom-out / zoom-in. Default 25 % – 400 %. */
  zoom?: Partial<ZoomLimits>;
}

/**
 * The desk model. Plain TypeScript, no framework: React subscribes with
 * useSyncExternalStore, and a WASM engine or a collaboration layer could drive
 * the same API. Every mutation that should be undoable goes through `commit`.
 */
export class DeskStore<D = unknown> {
  private state: DeskState<D>;
  private listeners = new Set<Listener>();
  private past: HistoryEntry<D>[] = [];
  private future: HistoryEntry<D>[] = [];
  private pending: HistoryEntry<D> | null = null;
  private readonly historyLimit: number;
  readonly zoomLimits: ZoomLimits;

  constructor(opts: DeskStoreOptions<D> = {}) {
    const nodes = opts.nodes ?? [];
    this.state = {
      nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
      order: nodes.map((n) => n.id),
      links: opts.links ?? [],
      selection: [],
      focusedId: null,
      viewport: opts.viewport ?? { x: 0, y: 0, zoom: 1 },
      screen: { w: 0, h: 0 },
      openId: null,
      enteredId: null,
      showLinks: true,
    };
    this.state.nodes = settle(this.state.nodes);
    this.state.order = withChildrenAbove(this.state.order, this.state.nodes);
    this.historyLimit = opts.historyLimit ?? 100;
    this.zoomLimits = { ...DEFAULT_ZOOM_LIMITS, ...opts.zoom };
    const v = this.state.viewport;
    this.state.viewport = { ...v, zoom: clamp(v.zoom, this.zoomLimits.min, this.zoomLimits.max) };
  }

  /* ── subscription ─────────────────────────────────────────────── */

  getState = (): DeskState<D> => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<DeskState<D>>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /* ── queries ──────────────────────────────────────────────────── */

  get nodes(): DeskNode<D>[] {
    return this.state.order.map((id) => this.state.nodes[id]!).filter(Boolean);
  }

  node(id: string): DeskNode<D> | undefined {
    return this.state.nodes[id];
  }

  selectedNodes(): DeskNode<D>[] {
    return this.state.selection.map((id) => this.state.nodes[id]!).filter(Boolean);
  }

  bounds(ids?: string[]): Rect | null {
    const list = ids ? ids.map((id) => this.state.nodes[id]).filter((n): n is DeskNode<D> => !!n) : this.nodes;
    return union(list.map(rectOf));
  }

  /**
   * Nodes in keyboard reading order; attached nodes come right after their target. Inside an
   * entered container: its children only; outside: nodes that are not inside a container.
   */
  ordered(): DeskNode<D>[] {
    const scope = this.state.enteredId;
    const all = this.nodes.filter((n) => (scope ? n.parent?.id === scope || (n.attach && this.state.nodes[n.attach.to]?.parent?.id === scope) : !n.parent && !(n.attach && this.state.nodes[n.attach.to]?.parent)));
    const out: DeskNode<D>[] = [];
    for (const n of readingOrder(all.filter((n) => !n.attach))) out.push(n, ...all.filter((a) => a.attach?.to === n.id));
    return out;
  }

  /** Nodes the keyboard and the lasso can reach now (see `ordered`). */
  reachable(): DeskNode<D>[] {
    return this.ordered();
  }

  /* ── attachments (Figma K) ────────────────────────────────────── */

  /** Nodes stuck to `id`, in paint order. */
  attachedTo(id: string): DeskNode<D>[] {
    return this.nodes.filter((n) => n.attach?.to === id);
  }

  /** Whether `id` may be stuck to `to`: both exist, differ, and neither breaks the one-level rule. */
  canAttach(id: string, to: string): boolean {
    const { nodes } = this.state;
    const n = nodes[id];
    const t = nodes[to];
    if (!n || !t || id === to || t.attach || n.parent || n.container) return false;
    return !Object.values(nodes).some((c) => c.attach?.to === id);
  }

  /**
   * The node that `id` overlaps most (the target of « Coller »), or null.
   * Attached nodes and `id`'s own children are never targets.
   */
  overlapping(id: string, filter: (n: DeskNode<D>) => boolean = () => true): DeskNode<D> | null {
    const n = this.state.nodes[id];
    if (!n) return null;
    let best: DeskNode<D> | null = null;
    let area = 0;
    for (const c of this.nodes) {
      if (!this.canAttach(id, c.id) || !filter(c)) continue;
      const a = overlapArea(rectOf(n), rectOf(c));
      if (a > area) {
        area = a;
        best = c;
      }
    }
    return best;
  }

  /**
   * Stick `id` to `to`, at `at` (world top-left; default: where it is). Drawn
   * just above its target. Returns false when not allowed (see `canAttach`).
   */
  attach(id: string, to: string, at?: Vec, { label = t.attach } = {}): boolean {
    if (!this.canAttach(id, to)) return false;
    this.commit(label, () => {
      const n = this.state.nodes[id]!;
      const t = this.state.nodes[to]!;
      const p = at ?? { x: n.x, y: n.y };
      const nodes = { ...this.state.nodes, [id]: { ...n, x: p.x, y: p.y, attach: { to, dx: p.x - t.x, dy: p.y - t.y } } };
      // Newest note on top of its siblings.
      const order = withChildrenAbove([...this.state.order.filter((x) => x !== id), id], nodes);
      this.set({ nodes, order });
    });
    return true;
  }

  /** Unstick nodes where they are. Returns the ids that were attached. */
  detach(ids: string[], { label = t.detach, history = true } = {}): string[] {
    const hit = ids.filter((id) => this.state.nodes[id]?.attach);
    if (!hit.length) return [];
    const run = () => {
      const nodes = { ...this.state.nodes };
      for (const id of hit) {
        const { attach: _, ...rest } = nodes[id]!;
        nodes[id] = rest as DeskNode<D>;
      }
      this.set({ nodes });
    };
    if (history) this.commit(label, run);
    else run();
    return hit;
  }

  /* ── containers (Figma L: galleries) ─────────────────────────────── */

  /** Nodes inside container `id`, in paint order. */
  childrenOf(id: string): DeskNode<D>[] {
    return this.nodes.filter((n) => n.parent?.id === id);
  }

  /** Whether `id` may go inside `container`: a container that is not `id`, and `id` is no container nor stuck. */
  canParent(id: string, container: string): boolean {
    const { nodes } = this.state;
    const n = nodes[id];
    const c = nodes[container];
    return !!n && !!c && id !== container && !!c.container && !c.parent && !n.container && !n.attach;
  }

  /**
   * Put nodes inside `container` (or take them out with `null`), where they are on the desk.
   * Returns the ids that changed. Runs inside a gesture's undo step when one is open.
   */
  setParent(ids: string[], container: string | null, { label = container ? t.parent : t.unparent } = {}): string[] {
    const { nodes } = this.state;
    const c = container ? nodes[container] : null;
    const hit = ids.filter((id) => (container ? this.canParent(id, container) && nodes[id]!.parent?.id !== container : !!nodes[id]?.parent));
    if (!hit.length) return [];
    this.commit(label, () => {
      const map = { ...this.state.nodes };
      for (const id of hit) {
        const n = map[id]!;
        if (c) map[id] = { ...n, parent: { id: c.id, dx: n.x - c.x, dy: n.y - c.y } };
        else {
          const { parent: _, ...rest } = n;
          map[id] = rest as DeskNode<D>;
        }
      }
      this.set({ nodes: settle(map), order: withChildrenAbove(this.state.order, map) });
    });
    return hit;
  }

  /** Work inside a container (its children become selectable), or leave with `null`. */
  enter(id: string | null) {
    const prev = this.state.enteredId;
    if (id && !this.state.nodes[id]?.container) return;
    this.set({ enteredId: id, selection: id ? [] : prev ? [prev] : this.state.selection, focusedId: id ?? prev ?? this.state.focusedId });
  }

  /** The node a pointer on `id` acts on: outside an entered container, a child stands for its container. */
  actsOn(id: string): string {
    const { nodes, enteredId } = this.state;
    const n = nodes[id];
    // A note stuck to a picture inside a container belongs to that container too.
    const owner = n?.parent?.id ?? (n?.attach ? nodes[n.attach.to]?.parent?.id : undefined);
    return owner && owner !== enteredId ? owner : id;
  }

  /** Top-most container under world point `p` that `ids` may all go into. */
  containerAt(p: Vec, ids: string[]): DeskNode<D> | null {
    const list = this.nodes;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      if (!c.container || ids.includes(c.id)) continue;
      if (p.x < c.x || p.y < c.y || p.x > c.x + c.w || p.y > c.y + c.h) continue;
      if (ids.every((id) => this.canParent(id, c.id) || this.state.nodes[id]?.parent?.id === c.id)) return c;
    }
    return null;
  }

  /* ── resize ───────────────────────────────────────────────────── */

  /**
   * Live resize (no history; wrap in begin/end for drags). `scale` nodes remember their
   * natural size on the first resize. A container's children keep their place on the desk
   * when its top or left edge moves, and the container never gets smaller than them.
   */
  resizeTo(id: string, r: Rect, { mode = 'free' as ResizeMode, min = MIN_NODE_SIZE } = {}) {
    const n = this.state.nodes[id];
    if (!n || n.locked || mode === 'none') return;
    let { x, y, w, h } = r;
    w = Math.max(min, w);
    h = Math.max(min, h);
    if (n.container) {
      const kids = union(this.childrenOf(id).map(rectOf));
      if (kids) {
        x = Math.min(x, kids.x);
        y = Math.min(y, kids.y);
        w = Math.max(w, kids.x + kids.w - x);
        h = Math.max(h, kids.y + kids.h - y);
      }
    }
    const map = { ...this.state.nodes };
    const base = mode === 'scale' ? (n.base ?? { w: n.w, h: n.h }) : n.base;
    map[id] = { ...n, x, y, w, h, ...(base ? { base } : {}) };
    if (n.container && (x !== n.x || y !== n.y))
      for (const c of Object.values(map)) if (c.parent?.id === id) map[c.id] = { ...c, parent: { id, dx: c.x - x, dy: c.y - y } };
    this.set({ nodes: settle(map) });
  }

  /** One-step resize (keyboard, toolbar). */
  resize(id: string, r: Rect, opts: { mode?: ResizeMode; min?: number; label?: string } = {}) {
    this.commit(opts.label ?? t.resize, () => this.resizeTo(id, r, opts));
  }

  /* ── history ──────────────────────────────────────────────────── */

  private snapshot(label: string): HistoryEntry<D> {
    return { label, nodes: this.state.nodes, order: this.state.order, links: this.state.links };
  }

  /** Start a gesture (e.g. a drag): records the "before" once, mutations stay live. */
  begin(label: string) {
    if (!this.pending) this.pending = this.snapshot(label);
  }

  /** End a gesture: one undo step for the whole drag. */
  end() {
    if (!this.pending) return;
    const before = this.pending;
    this.pending = null;
    if (before.nodes === this.state.nodes && before.links === this.state.links && before.order === this.state.order) return;
    this.pushPast(before);
  }

  /** Run a mutation as a single undoable step. */
  commit(label: string, mutate: () => void) {
    const before = this.snapshot(label);
    mutate();
    if (!this.pending) this.pushPast(before);
  }

  private pushPast(entry: HistoryEntry<D>) {
    this.past.push(entry);
    if (this.past.length > this.historyLimit) this.past.shift();
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Returns the label of the undone step (for announcements). */
  undo(): string | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.snapshot(prev.label));
    this.restore(prev);
    return prev.label;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.snapshot(next.label));
    this.restore(next);
    return next.label;
  }

  private restore(e: HistoryEntry<D>) {
    const selection = this.state.selection.filter((id) => e.nodes[id]);
    const focusedId = this.state.focusedId && e.nodes[this.state.focusedId] ? this.state.focusedId : null;
    this.set({ nodes: e.nodes, order: e.order, links: e.links, selection, focusedId });
  }

  /* ── nodes ────────────────────────────────────────────────────── */

  add(nodes: DeskNode<D>[], { select = true } = {}) {
    this.commit(nodes.length > 1 ? t.addMany(nodes.length) : t.add(nodes[0]?.title ?? ''), () => {
      let map = { ...this.state.nodes };
      for (const n of nodes) map[n.id] = n;
      map = settle(map);
      this.set({
        nodes: map,
        order: withChildrenAbove([...this.state.order.filter((id) => !nodes.some((n) => n.id === id)), ...nodes.map((n) => n.id)], map),
        ...(select ? { selection: nodes.map((n) => n.id), focusedId: nodes[0]?.id ?? null } : {}),
      });
    });
  }

  /** Patch nodes. Pass `history: false` for live updates (progress, engine results). */
  update(id: string, patch: Partial<DeskNode<D>>, { history = true, label = t.edit } = {}) {
    const run = () => {
      const n = this.state.nodes[id];
      if (!n) return;
      let next = { ...n, ...patch };
      // Moving an attached node moves it along its target.
      const t = next.attach && this.state.nodes[next.attach.to];
      if (t && !('attach' in patch) && (next.x !== n.x || next.y !== n.y)) next = { ...next, attach: { to: t.id, dx: next.x - t.x, dy: next.y - t.y } };
      const c = next.parent && this.state.nodes[next.parent.id];
      if (c && !('parent' in patch) && (next.x !== n.x || next.y !== n.y)) next = { ...next, parent: { id: c.id, dx: next.x - c.x, dy: next.y - c.y } };
      const nodes = settle({ ...this.state.nodes, [id]: next });
      this.set({ nodes, ...('attach' in patch || 'parent' in patch ? { order: withChildrenAbove(this.state.order, nodes) } : {}) });
    };
    if (history) this.commit(label, run);
    else run();
  }

  /**
   * Delete nodes. Nodes stuck to a deleted one stay where they are, unstuck, and nodes inside
   * a deleted container are released onto the desk; their ids are returned (« 2 notes
   * décollées »). Same undo step.
   */
  remove(ids: string[]): string[] {
    if (ids.length === 0) return [];
    const freed: string[] = [];
    this.commit(ids.length > 1 ? t.removeMany(ids.length) : t.remove, () => {
      const map = { ...this.state.nodes };
      for (const id of ids) delete map[id];
      for (const [id, n] of Object.entries(map)) {
        if (n.attach && !map[n.attach.to]) {
          const { attach: _, ...rest } = n;
          map[id] = rest as DeskNode<D>;
          freed.push(id);
        } else if (n.parent && !map[n.parent.id]) {
          const { parent: _, ...rest } = n;
          map[id] = rest as DeskNode<D>;
          freed.push(id);
        }
      }
      const remaining = this.state.order.filter((id) => map[id]);
      this.set({
        nodes: map,
        order: remaining,
        links: this.state.links.filter((l) => map[l.from] && map[l.to]),
        selection: [],
        focusedId: remaining.find((id) => !ids.includes(id)) ?? null,
        enteredId: this.state.enteredId && map[this.state.enteredId] ? this.state.enteredId : null,
      });
    });
    return freed;
  }

  /**
   * Live move (no history); wrap in begin/end for drags. Nodes stuck to a
   * moving node come along; a stuck node moved without its target slides
   * along it (its offset changes, it stays stuck).
   */
  moveBy(ids: string[], d: Vec) {
    if (ids.length === 0 || (d.x === 0 && d.y === 0)) return;
    const map = { ...this.state.nodes };
    const moving = new Set(ids.filter((id) => map[id] && !map[id]!.locked));
    for (const id of moving) {
      const n = map[id]!;
      const a = n.attach && !moving.has(n.attach.to) ? { ...n.attach, dx: n.attach.dx + d.x, dy: n.attach.dy + d.y } : n.attach;
      const p = n.parent && !moving.has(n.parent.id) ? { ...n.parent, dx: n.parent.dx + d.x, dy: n.parent.dy + d.y } : n.parent;
      map[id] = { ...n, x: n.x + d.x, y: n.y + d.y, ...(a ? { attach: a } : {}), ...(p ? { parent: p } : {}) };
    }
    this.set({ nodes: settle(map) });
  }

  /** Keyboard nudge — one undo step per press. */
  nudge(ids: string[], d: Vec) {
    this.commit(t.move, () => this.moveBy(ids, d));
  }

  /** Raise nodes (with what is stuck to them) above the rest. */
  bringToFront(ids: string[]) {
    const rest = this.state.order.filter((id) => !ids.includes(id));
    this.set({ order: withChildrenAbove([...rest, ...this.state.order.filter((id) => ids.includes(id))], this.state.nodes) });
  }

  /** Align selected nodes (B7 "arrange"). */
  align(ids: string[], edge: 'left' | 'top' | 'hcenter' | 'vcenter') {
    ids = this.free(ids);
    const b = this.bounds(ids);
    if (!b || ids.length < 2) return;
    this.commit(t.align, () => {
      const map = { ...this.state.nodes };
      for (const id of ids) {
        const n = map[id];
        if (!n) continue;
        if (edge === 'left') map[id] = { ...n, x: b.x };
        if (edge === 'top') map[id] = { ...n, y: b.y };
        if (edge === 'hcenter') map[id] = { ...n, x: b.x + b.w / 2 - n.w / 2 };
        if (edge === 'vcenter') map[id] = { ...n, y: b.y + b.h / 2 - n.h / 2 };
      }
      this.set({ nodes: settle(map) });
    });
  }

  /** Lay nodes out in a row with a gap (B7 "stack"/"tidy"). */
  distribute(ids: string[], gap = 48) {
    const list = readingOrder(this.free(ids).map((id) => this.state.nodes[id]).filter((n): n is DeskNode<D> => !!n));
    const first = list[0];
    if (!first || list.length < 2) return;
    this.commit(t.arrange, () => {
      const map = { ...this.state.nodes };
      let x = first.x;
      for (const n of list) {
        map[n.id] = { ...n, x, y: first.y, rotation: 0 };
        x += n.w + gap;
      }
      this.set({ nodes: settle(map) });
    });
  }

  /** Arrange and align move items, not what is stuck to them (it follows). */
  private free(ids: string[]): string[] {
    return ids.filter((id) => !this.state.nodes[id]?.attach);
  }

  /* ── links ────────────────────────────────────────────────────── */

  /** Replace the threads. `history: false` for threads derived from elsewhere (they are not the person's edits). */
  setLinks(links: DeskLink[], label = t.links, { history = true } = {}) {
    if (history) this.commit(label, () => this.set({ links }));
    else this.set({ links });
  }

  toggleLinks(show = !this.state.showLinks) {
    this.set({ showLinks: show });
  }

  /* ── selection & focus ────────────────────────────────────────── */

  select(ids: string[], mode: 'replace' | 'add' | 'toggle' = 'replace') {
    let next: string[];
    if (mode === 'replace') next = ids;
    else if (mode === 'add') next = [...new Set([...this.state.selection, ...ids])];
    else {
      const s = new Set(this.state.selection);
      for (const id of ids) {
        if (s.has(id)) s.delete(id);
        else s.add(id);
      }
      next = [...s];
    }
    this.set({ selection: next, focusedId: ids[ids.length - 1] ?? this.state.focusedId });
  }

  /** Every node reachable now (inside the entered container, or the desk's own). */
  selectAll() {
    this.set({ selection: this.ordered().map((n) => n.id) });
  }

  clearSelection() {
    this.set({ selection: [] });
  }

  focus(id: string | null) {
    this.set({ focusedId: id });
  }

  /** Arrow-key navigation; falls back to reading order when nothing lies that way. */
  focusDirection(dir: Direction): DeskNode<D> | null {
    const nodes = this.ordered();
    const cur = this.state.focusedId ? this.state.nodes[this.state.focusedId] : undefined;
    if (!cur) return this.ordered()[0] ?? null;
    return nearestInDirection(cur, nodes, dir);
  }

  focusSibling(step: 1 | -1): DeskNode<D> | null {
    const list = this.ordered();
    const i = list.findIndex((n) => n.id === this.state.focusedId);
    return list[(i + step + list.length) % list.length] ?? null;
  }

  /* ── open in place (B4) ───────────────────────────────────────── */

  open(id: string | null) {
    this.set({ openId: id, ...(id ? { selection: [id], focusedId: id } : {}) });
  }

  /* ── viewport ─────────────────────────────────────────────────── */

  setScreen(w: number, h: number) {
    if (w === this.state.screen.w && h === this.state.screen.h) return;
    this.set({ screen: { w, h } });
  }

  setViewport(v: Viewport) {
    this.set({ viewport: { ...v, zoom: clamp(v.zoom, this.zoomLimits.min, this.zoomLimits.max) } });
  }

  panBy(dxScreen: number, dyScreen: number) {
    const v = this.state.viewport;
    this.set({ viewport: { ...v, x: v.x - dxScreen / v.zoom, y: v.y - dyScreen / v.zoom } });
  }

  zoomBy(factor: number, anchor?: Vec) {
    const a = anchor ?? { x: this.state.screen.w / 2, y: this.state.screen.h / 2 };
    this.set({ viewport: zoomAt(this.state.viewport, a, factor, this.zoomLimits) });
  }

  /** One step of a two-finger pinch (screen px): zoom around the fingers and follow their midpoint. */
  pinch(from: [Vec, Vec], to: [Vec, Vec]) {
    this.set({ viewport: pinchViewport(this.state.viewport, from, to, this.zoomLimits) });
  }

  /** Back to 100 %, keeping the centre of the screen in place. */
  zoomReset(anchor?: Vec) {
    const a = anchor ?? { x: this.state.screen.w / 2, y: this.state.screen.h / 2 };
    this.set({ viewport: zoomTo(this.state.viewport, a, 1, this.zoomLimits) });
  }

  get isMaxZoomOut() {
    return this.state.viewport.zoom <= this.zoomLimits.min + 1e-6;
  }

  /** Frame some papers (never beyond the max zoom-out). */
  zoomToFit(ids?: string[], maxZoom = 1) {
    const b = this.bounds(ids);
    if (!b || this.state.screen.w === 0) return;
    this.set({ viewport: fitRect(b, this.state.screen, 96, maxZoom, this.zoomLimits.min) });
  }

  /** Pan so the node is visible, keeping zoom (used when keyboard focus moves). */
  reveal(id: string, margin = 80) {
    const n = this.state.nodes[id];
    if (!n) return;
    const { viewport: v, screen } = this.state;
    const left = (n.x - v.x) * v.zoom;
    const top = (n.y - v.y) * v.zoom;
    const right = left + n.w * v.zoom;
    const bottom = top + n.h * v.zoom;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > screen.w - margin) dx = Math.max(screen.w - margin - right, margin - left);
    if (top < margin) dy = margin - top;
    else if (bottom > screen.h - margin) dy = Math.max(screen.h - margin - bottom, margin - top);
    if (dx || dy) this.panBy(dx, dy);
  }

  centerOn(p: Vec) {
    const v = this.state.viewport;
    const s = this.state.screen;
    this.set({ viewport: { ...v, x: p.x - s.w / 2 / v.zoom, y: p.y - s.h / 2 / v.zoom } });
  }

  /** World point at the centre of the screen (where new papers land). */
  viewCenter(): Vec {
    const v = this.state.viewport;
    return { x: v.x + this.state.screen.w / 2 / v.zoom, y: v.y + this.state.screen.h / 2 / v.zoom };
  }

  nodeCenter(id: string): Vec | null {
    const n = this.state.nodes[id];
    return n ? center(rectOf(n)) : null;
  }
}

/**
 * Put every contained node at its container + offset, then every attached node at its target
 * + offset; drop links whose other end is gone or breaks the one-level rules.
 */
function settle<D>(nodes: Record<string, DeskNode<D>>): Record<string, DeskNode<D>> {
  let out = nodes;
  const put = (id: string, next: DeskNode<D>) => {
    if (out === nodes) out = { ...nodes };
    out[id] = next;
  };
  for (const [id, n] of Object.entries(nodes)) {
    if (!n.parent) continue;
    const c = nodes[n.parent.id];
    if (!c || !c.container || c.parent || n.container) {
      const { parent: _, ...rest } = n;
      put(id, rest as DeskNode<D>);
    } else if (c.x + n.parent.dx !== n.x || c.y + n.parent.dy !== n.y) put(id, { ...n, x: c.x + n.parent.dx, y: c.y + n.parent.dy });
  }
  for (const [id, n] of Object.entries(out)) {
    if (!n.attach) continue;
    const t = out[n.attach.to];
    if (!t || t.attach || n.parent) {
      const { attach: _, ...rest } = n;
      put(id, rest as DeskNode<D>);
    } else if (t.x + n.attach.dx !== n.x || t.y + n.attach.dy !== n.y) put(id, { ...n, x: t.x + n.attach.dx, y: t.y + n.attach.dy });
  }
  return out;
}

/**
 * Paint order with each container's children just above it and each attached node just above
 * its target (siblings keep their relative order).
 */
function withChildrenAbove<D>(order: string[], nodes: Record<string, DeskNode<D>>): string[] {
  const owner = (id: string) => {
    const n = nodes[id];
    const o = n?.parent?.id ?? n?.attach?.to;
    return o && nodes[o] ? o : null;
  };
  const children = new Map<string, string[]>();
  for (const id of order) {
    const o = owner(id);
    if (o) children.set(o, [...(children.get(o) ?? []), id]);
  }
  if (!children.size) return order;
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    for (const c of children.get(id) ?? []) visit(c);
  };
  for (const id of order) if (!owner(id)) visit(id);
  return out;
}

export function createDesk<D>(opts?: DeskStoreOptions<D>) {
  return new DeskStore<D>(opts);
}
