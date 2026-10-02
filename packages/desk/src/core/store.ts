import {
  ZOOM_PRESETS,
  fitRect,
  rectOf,
  union,
  zoomAt,
  zoomTo,
  center,
  type Direction,
  nearestInDirection,
  readingOrder,
} from './geometry';
import type { DeskLink, DeskNode, DeskState, HistoryEntry, Rect, Vec, Viewport } from './types';

type Listener = () => void;

export interface DeskStoreOptions<D> {
  nodes?: DeskNode<D>[];
  links?: DeskLink[];
  viewport?: Viewport;
  historyLimit?: number;
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
      showLinks: true,
    };
    this.historyLimit = opts.historyLimit ?? 100;
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

  /** Nodes in keyboard reading order. */
  ordered(): DeskNode<D>[] {
    return readingOrder(this.nodes);
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
    this.commit(nodes.length > 1 ? `Ajout de ${nodes.length} fichiers` : `Ajout de ${nodes[0]?.title}`, () => {
      const map = { ...this.state.nodes };
      for (const n of nodes) map[n.id] = n;
      this.set({
        nodes: map,
        order: [...this.state.order.filter((id) => !nodes.some((n) => n.id === id)), ...nodes.map((n) => n.id)],
        ...(select ? { selection: nodes.map((n) => n.id), focusedId: nodes[0]?.id ?? null } : {}),
      });
    });
  }

  /** Patch nodes. Pass `history: false` for live updates (progress, engine results). */
  update(id: string, patch: Partial<DeskNode<D>>, { history = true, label = 'Modification' } = {}) {
    const run = () => {
      const n = this.state.nodes[id];
      if (!n) return;
      this.set({ nodes: { ...this.state.nodes, [id]: { ...n, ...patch } } });
    };
    if (history) this.commit(label, run);
    else run();
  }

  remove(ids: string[]) {
    if (ids.length === 0) return;
    this.commit(ids.length > 1 ? `Suppression de ${ids.length} fichiers` : 'Suppression', () => {
      const map = { ...this.state.nodes };
      for (const id of ids) delete map[id];
      const remaining = this.state.order.filter((id) => map[id]);
      this.set({
        nodes: map,
        order: remaining,
        links: this.state.links.filter((l) => map[l.from] && map[l.to]),
        selection: [],
        focusedId: remaining.find((id) => !ids.includes(id)) ?? null,
      });
    });
  }

  /** Live move (no history); wrap in begin/end for drags. */
  moveBy(ids: string[], d: Vec) {
    if (ids.length === 0 || (d.x === 0 && d.y === 0)) return;
    const map = { ...this.state.nodes };
    for (const id of ids) {
      const n = map[id];
      if (n && !n.locked) map[id] = { ...n, x: n.x + d.x, y: n.y + d.y };
    }
    this.set({ nodes: map });
  }

  /** Keyboard nudge — one undo step per press. */
  nudge(ids: string[], d: Vec) {
    this.commit('Déplacement', () => this.moveBy(ids, d));
  }

  bringToFront(ids: string[]) {
    const rest = this.state.order.filter((id) => !ids.includes(id));
    this.set({ order: [...rest, ...this.state.order.filter((id) => ids.includes(id))] });
  }

  /** Align selected nodes (B7 "arrange"). */
  align(ids: string[], edge: 'left' | 'top' | 'hcenter' | 'vcenter') {
    const b = this.bounds(ids);
    if (!b || ids.length < 2) return;
    this.commit('Alignement', () => {
      const map = { ...this.state.nodes };
      for (const id of ids) {
        const n = map[id];
        if (!n) continue;
        if (edge === 'left') map[id] = { ...n, x: b.x };
        if (edge === 'top') map[id] = { ...n, y: b.y };
        if (edge === 'hcenter') map[id] = { ...n, x: b.x + b.w / 2 - n.w / 2 };
        if (edge === 'vcenter') map[id] = { ...n, y: b.y + b.h / 2 - n.h / 2 };
      }
      this.set({ nodes: map });
    });
  }

  /** Lay nodes out in a row with a gap (B7 "stack"/"tidy"). */
  distribute(ids: string[], gap = 48) {
    const list = readingOrder(ids.map((id) => this.state.nodes[id]).filter((n): n is DeskNode<D> => !!n));
    const first = list[0];
    if (!first || list.length < 2) return;
    this.commit('Rangement', () => {
      const map = { ...this.state.nodes };
      let x = first.x;
      for (const n of list) {
        map[n.id] = { ...n, x, y: first.y, rotation: 0 };
        x += n.w + gap;
      }
      this.set({ nodes: map });
    });
  }

  /* ── links ────────────────────────────────────────────────────── */

  setLinks(links: DeskLink[], label = 'Liens') {
    this.commit(label, () => this.set({ links }));
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

  selectAll() {
    this.set({ selection: [...this.state.order] });
  }

  clearSelection() {
    this.set({ selection: [] });
  }

  focus(id: string | null) {
    this.set({ focusedId: id });
  }

  /** Arrow-key navigation; falls back to reading order when nothing lies that way. */
  focusDirection(dir: Direction): DeskNode<D> | null {
    const nodes = this.nodes;
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
    this.set({ viewport: v });
  }

  panBy(dxScreen: number, dyScreen: number) {
    const v = this.state.viewport;
    this.set({ viewport: { ...v, x: v.x - dxScreen / v.zoom, y: v.y - dyScreen / v.zoom } });
  }

  zoomBy(factor: number, anchor?: Vec) {
    const a = anchor ?? { x: this.state.screen.w / 2, y: this.state.screen.h / 2 };
    this.set({ viewport: zoomAt(this.state.viewport, a, factor) });
  }

  /** Jump to a B5 level-of-detail preset (keys 1/2/3). */
  zoomPreset(index: 0 | 1 | 2) {
    const a = { x: this.state.screen.w / 2, y: this.state.screen.h / 2 };
    this.set({ viewport: zoomTo(this.state.viewport, a, ZOOM_PRESETS[index]) });
  }

  zoomToFit(ids?: string[], maxZoom = 1) {
    const b = this.bounds(ids);
    if (!b || this.state.screen.w === 0) return;
    this.set({ viewport: fitRect(b, this.state.screen, 96, maxZoom) });
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

export function createDesk<D>(opts?: DeskStoreOptions<D>) {
  return new DeskStore<D>(opts);
}
