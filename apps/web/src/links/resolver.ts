/**
 * Links between the papers of the desk (Figma G): reads sources, keeps
 * copies up to date, derives the desk's threads and answers editors (badges).
 *
 * - Links live in the **target** file's Y.Doc (`@oel/links`), backlinks in the
 *   source's. The desk threads are derived from them, never stored on the desk.
 * - A source is watched once some copy on the desk points at it: its sheet
 *   session plus a calc engine of its own (the values of a chart's ranges).
 *   Any change to the workbook → 300 ms → the chart is read again; its `rev` is
 *   the hash of what a copy would show.
 * - Live copies are written with `LINK_ORIGIN` (no one's undo). Two clients
 *   computing the same `rev` write the same content (G7 « un seul Mis à jour »).
 * - A source chart that disappears makes its links « Rompu »; the copies keep
 *   their last value. Ctrl+Z in the source brings the chart back, and the links.
 */
import * as Y from 'yjs';
import { chartName, keepLook, type ChartSpec } from '@oel/charts';
import { chartBoxOn, chartFrame, chartSlide, linkedTableFrame, picture, type SlideSession } from '@oel/slides';
import { insertChartParagraph, insertLinkedTable, insertPictureParagraph, type DocSession } from '@oel/docs';
import {
  LINK_ORIGIN,
  THREAD_PREFIX,
  createsCycle,
  deriveThreads,
  linkState,
  linksOf,
  setLinkHost,
  stableJson,
  type Carries,
  type LinkDef,
  type LinkHost,
  type LinkMode,
  type LinkState,
  type LinkedValue,
  type CellStyleEdit,
  cellEditLabel,
  withEdit,
  withoutEdit,
  type LinkTheme,
  type Overflow,
  pictureBytes,
  type LinksDoc,
  type ResolvedLink,
  type SourceRef,
} from '@oel/links';
import type { DeskLink } from '@oel/desk';
import type { Bureau, Paper } from '../bureau/model';
import { identity, sessionFor } from '../bureau/docs';
import { sheetSessionFor } from '../bureau/sheets';
import { slideSessionFor } from '../bureau/slides';
import { linkMedia, preparePicture, valueRev, type LinkSource, type LinkTarget } from './kinds';
import { imageDocId, openImageSource } from './sources/image';
import { openDocumentSource, openSlidesSource } from './sources/files';
import { openSheetSource } from './sources/sheet';
import { slidesTarget } from './targets/slides';
import { documentTarget } from './targets/document';

/** Kinds that can hold a linked chart. */
export const TARGET_KINDS = new Set(['slides', 'document']);

export interface ChartRequest {
  kind?: 'chart';
  sourcePaperId: string;
  sheetId: string;
  chartId: string;
  name: string;
  spec: ChartSpec;
}

/** « Lier dans… » on a desk image paper (Figma I1). */
export interface ImageRequest {
  kind: 'image';
  sourcePaperId: string;
  name: string;
}

/** « Lier dans… » on a sheet range (Figma G2b d, I2): a linked table. */
export interface RangeRequest {
  kind: 'range';
  sourcePaperId: string;
  sheetId: string;
  ids: { r0: string; c0: string; r1: string; c1: string };
  /** « Budget!B2:F7 ». */
  name: string;
}

export type LinkRequest = ChartRequest | ImageRequest | RangeRequest;

export type Placement = { kind: 'slides'; where: 'new-slide' | 'last-slide' } | { kind: 'document'; where: 'end' | 'start' };

export interface UiState {
  /** G3 popover: which link, next to what (viewport pixels). */
  popover: { linkId: string; anchor: { x: number; y: number; width: number; height: number } } | null;
  /** G2 / I1 « Lier dans… ». */
  dialog: LinkRequest | null;
  /** G6 « Fils » panel. */
  panel: boolean;
  /** « Couper le lien ? » for this link. */
  cut: string | null;
}

interface Target {
  paperId: string;
  docId: string;
  kind: 'slides' | 'document';
  ydoc: Y.Doc;
  links: LinksDoc;
  /** Reads and writes the copies (per kind). */
  adapter: LinkTarget;
  slides?: SlideSession;
  doc?: DocSession;
  off: () => void;
}

interface Source {
  docId: string;
  /** Reads what links point at (per kind). */
  src: LinkSource;
  /** By ref key: the copy value and its revision; `null` = the object is gone. */
  values: Map<string, { value: LinkedValue; rev: string } | null>;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  again: boolean;
  off: () => void;
}

const refKey = (r: SourceRef) => stableJson(r);
const UPDATING_MS = 700;

export class LinkResolver implements LinkHost {
  private targets = new Map<string, Target>();
  private sources = new Map<string, Source>();
  private opening = new Set<string>();
  private updatingUntil = new Map<string, number>();
  /** Links whose copy is being written (bytes on their way): don't start a second write. */
  private applying = new Set<string>();
  private listeners = new Set<() => void>();
  private uiListeners = new Set<() => void>();
  private threadsJson = '';
  private papersSig = '';
  private refreshQueued = false;
  private disposed = false;
  ui: UiState = { popover: null, dialog: null, panel: false, cut: null };
  /** Version bumped on every change (for React). */
  version = 0;
  private unsubStore: () => void;

  constructor(
    readonly store: Bureau,
    private open: { paper: (paperId: string) => void; announce: (m: string) => void },
  ) {
    this.unsubStore = store.subscribe(() => this.onStore());
    setLinkHost(this);
    this.onStore();
  }

  dispose() {
    this.disposed = true;
    this.unsubStore();
    setLinkHost(null);
    for (const t of this.targets.values()) t.off();
    for (const s of this.sources.values()) s.off();
  }

  // ===== desk ↔ files ======================================================

  private papers(): Paper[] {
    return this.store.ordered() as Paper[];
  }

  private paperOfDoc(docId: string): Paper | undefined {
    return this.papers().find((p) => p.data.docId === docId);
  }

  private onStore() {
    if (this.disposed) return;
    const st = this.store.getState();
    const sig = this.papers()
      .map((p) => `${p.id}:${p.kind}:${p.data.docId ?? ''}:${p.title}`)
      .join('|');
    if (sig !== this.papersSig) {
      this.papersSig = sig;
      for (const p of this.papers()) if (p.data.docId && TARGET_KINDS.has(p.kind)) void this.ensureTarget(p);
      this.queueRefresh();
      return;
    }
    // Undo/redo on the desk restores old thread lists: put the derived ones back.
    const owned = JSON.stringify(st.links.filter((l) => l.id.startsWith(THREAD_PREFIX)));
    if (owned !== this.threadsJson) this.queueRefresh();
  }

  private async ensureTarget(p: Paper) {
    const docId = p.data.docId!;
    if (this.targets.has(docId) || this.opening.has(docId)) return;
    this.opening.add(docId);
    try {
      const kind = p.kind as 'slides' | 'document';
      const t: Target =
        kind === 'slides'
          ? await slideSessionFor(p, () => {}).then((s) => ({ paperId: p.id, docId, kind, ydoc: s.ydoc, links: linksOf(s.ydoc), adapter: slidesTarget(s), slides: s, off: () => {} }))
          : await sessionFor(p, () => {}).then((s) => ({ paperId: p.id, docId, kind, ydoc: s.ydoc, links: linksOf(s.ydoc), adapter: documentTarget(s), doc: s, off: () => {} }));
      if (this.disposed) return;
      // Links whose copy is gone since the file was last open (no undo can bring it back now) go away.
      for (const l of t.links.list()) if (!this.copyExists(t, l.target.objectId)) t.links.remove(l.id);
      t.off = t.links.observe(() => this.queueRefresh());
      // A copy deleted (or cut) in its file stops being followed; Ctrl+Z brings it back, still linked.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onTx = (tr: Y.Transaction) => {
        if (tr.origin === LINK_ORIGIN || timer || !t.links.links.size) return;
        timer = setTimeout(() => ((timer = null), this.queueRefresh()), 150);
      };
      t.ydoc.on('afterTransaction', onTx);
      const offLinks = t.off;
      t.off = () => (offLinks(), t.ydoc.off('afterTransaction', onTx), timer && clearTimeout(timer));
      this.targets.set(docId, t);
      this.queueRefresh();
    } catch {
      // The file can't be opened (removed, offline without a copy): its links stay unknown.
    } finally {
      this.opening.delete(docId);
    }
  }

  private async ensureSource(docId: string) {
    if (this.sources.has(docId) || this.opening.has(docId)) return;
    const p = this.paperOfDoc(docId);
    if (!p || !['spreadsheet', 'image', 'slides', 'document'].includes(p.kind)) return;
    this.opening.add(docId);
    try {
      const opened =
        p.kind === 'image' ? openImageSource(this.store, p) : p.kind === 'slides' ? await openSlidesSource(p) : p.kind === 'document' ? await openDocumentSource(p) : await openSheetSource(p);
      if (this.disposed) return opened.dispose();
      const src: Source = { docId, src: opened, values: new Map(), timer: null, running: null, again: false, off: () => {} };
      // Any change in the source → read the linked objects again.
      const offChange = opened.onChange(() => this.scheduleSource(src));
      src.off = () => {
        offChange();
        if (src.timer) clearTimeout(src.timer);
        opened.dispose();
      };
      this.sources.set(docId, src);
      this.scheduleSource(src, 0);
    } catch {
      // Not readable: links from it stay « en attente ».
    } finally {
      this.opening.delete(docId);
    }
  }

  // ===== reading sources ===================================================

  /** Refs of every link on the desk that reads this source. */
  private refsOf(docId: string): SourceRef[] {
    const out = new Map<string, SourceRef>();
    for (const t of this.targets.values()) for (const l of t.links.list()) if (l.source.docId === docId) out.set(refKey(l.source.ref), l.source.ref);
    return [...out.values()];
  }

  private scheduleSource(src: Source, ms = 300) {
    if (src.timer) clearTimeout(src.timer);
    src.timer = setTimeout(() => {
      src.timer = null;
      if (src.running) {
        src.again = true;
        return;
      }
      src.running = this.readSource(src).finally(() => {
        src.running = null;
        if (src.again) {
          src.again = false;
          this.scheduleSource(src, 0);
        }
      });
    }, ms);
  }

  private async readSource(src: Source) {
    for (const ref of this.refsOf(src.docId)) {
      const value = await src.src.read(ref);
      if (value !== undefined) src.values.set(refKey(ref), value ? { value, rev: valueRev(value) } : null);
    }
    this.pushLive();
    this.queueRefresh();
  }

  // ===== writing copies ====================================================

  private sourceValue(l: LinkDef) {
    return this.sources.get(l.source.docId)?.values.get(refKey(l.source.ref));
  }

  /** Write every live copy whose source moved on. */
  private pushLive() {
    for (const t of this.targets.values())
      for (const l of t.links.list()) {
        if (l.mode !== 'live' || !this.copyExists(t, l.target.objectId)) continue;
        const v = this.sourceValue(l);
        if (v && v.rev !== l.snapshot.rev) void this.apply(t, l, v.value, v.rev);
      }
  }

  private async apply(t: Target, l: LinkDef, value: LinkedValue, rev: string) {
    if (this.applying.has(l.id)) return;
    const by = identity().name;
    const oid = l.target.objectId;
    if (t.adapter.prepare) {
      this.applying.add(l.id);
      try {
        if (!(await t.adapter.prepare(value))) return;
      } finally {
        this.applying.delete(l.id);
      }
    }
    // « Données seulement »: the copy keeps its own look (and variant) around the source's data.
    if (value.kind === 'chart' && l.carries === 'chart-data') {
      const current = t.adapter.current(oid);
      value = { kind: 'chart', spec: keepLook(current?.kind === 'chart' ? (current.spec as ChartSpec) : null, value.spec as ChartSpec) };
    }
    t.ydoc.transact(() => {
      if (t.adapter.write(oid, value, l)) t.links.patch(l.id, { snapshot: { rev, at: Date.now(), by } });
    }, LINK_ORIGIN);
    this.updatingUntil.set(l.id, Date.now() + UPDATING_MS);
    setTimeout(() => this.queueRefresh(), UPDATING_MS + 20);
  }

  /** Whether the copy a link writes into is still in its file. */
  private copyExists(t: Target, objectId: string): boolean {
    return t.adapter.exists(objectId);
  }

  /**
   * The sources' backlinks follow the links of the files open here: a link
   * made by a paste gets one, a link cut or whose copy was deleted loses it.
   */
  private repairBacklinks(list: Array<ResolvedLink & { target: Target; targetPaper?: Paper }>) {
    const openTargets = new Set(this.targets.keys());
    for (const src of this.sources.values()) {
      if (!src.src.ydoc) continue;
      const bl = linksOf(src.src.ydoc);
      const wanted = new Map(list.filter((l) => l.def.source.docId === src.docId).map((l) => [l.def.id, l]));
      for (const [id, l] of wanted)
        bl.putBacklink({ linkId: id, ref: l.def.source.ref, docId: l.targetDocId, kind: l.target.kind, objectId: l.def.target.objectId, title: l.targetPaper?.title ?? '', label: l.def.target.label }, LINK_ORIGIN);
      for (const b of bl.backlinkList()) if (openTargets.has(b.docId) && !wanted.has(b.linkId)) bl.removeBacklink(b.linkId, LINK_ORIGIN);
    }
  }

  // ===== state & threads ===================================================

  private resolved(): Array<ResolvedLink & { target: Target; targetPaper?: Paper }> {
    const out: Array<ResolvedLink & { target: Target; targetPaper?: Paper }> = [];
    const now = Date.now();
    for (const t of this.targets.values())
      for (const def of t.links.list()) {
        // A deleted copy's link sleeps until undo brings the copy back.
        if (!this.copyExists(t, def.target.objectId)) continue;
        const v = this.sourceValue(def);
        const state = linkState(def, { rev: v === undefined ? undefined : (v?.rev ?? null), updating: (this.updatingUntil.get(def.id) ?? 0) > now });
        out.push({ def, targetDocId: t.docId, state, target: t, targetPaper: this.store.node(t.paperId) as Paper | undefined });
      }
    return out;
  }

  private queueRefresh() {
    if (this.refreshQueued || this.disposed) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  private refresh() {
    const list = this.resolved();
    // Sources some copy reads, and that are on the desk: watch them.
    for (const l of list) void this.ensureSource(l.def.source.docId);
    for (const src of this.sources.values()) {
      const wanted = this.refsOf(src.docId).some((r) => !src.values.has(refKey(r)));
      if (wanted) this.scheduleSource(src, 0);
    }
    this.repairBacklinks(list);
    const threads = deriveThreads(
      this.papers().map((p) => ({ id: p.id, title: p.title, docId: p.data.docId })),
      list,
    );
    const desk: DeskLink[] = threads.map((t) => ({ id: t.id, from: t.from, to: t.to, label: t.label, title: t.title, state: t.state }));
    const json = JSON.stringify(desk);
    const st = this.store.getState();
    const others = st.links.filter((l) => !l.id.startsWith(THREAD_PREFIX));
    if (json !== this.threadsJson || JSON.stringify(st.links.filter((l) => l.id.startsWith(THREAD_PREFIX))) !== json) {
      this.threadsJson = json;
      this.store.setLinks([...others, ...desk], 'Fils', { history: false });
    }
    this.bump();
  }

  private bump() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  // ===== LinkHost (editors) ================================================

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Every link on the desk, with its state (G6). */
  all(): Array<ResolvedLink & { target: Target; targetPaper: Paper | undefined; sourcePaper: Paper | undefined }> {
    return this.resolved().map((l) => ({ ...l, targetPaper: this.store.node(l.target.paperId) as Paper | undefined, sourcePaper: this.paperOfDoc(l.def.source.docId) }));
  }

  find(linkId: string) {
    return this.all().find((l) => l.def.id === linkId) ?? null;
  }

  state(linkId: string): LinkState {
    return this.find(linkId)?.state ?? 'waiting';
  }

  copyOf(objectId: string) {
    for (const l of this.resolved()) if (l.def.target.objectId === objectId) return { linkId: l.def.id, source: l.def.source.title, state: l.state, frozen: l.def.mode === 'frozen', carries: l.def.carries, theme: l.def.theme, overflow: l.def.view?.overflow };
    return null;
  }

  manage(linkId: string, anchor: { x: number; y: number; width: number; height: number }) {
    this.setUi({ popover: { linkId, anchor } });
  }

  /** « Mettre à jour » (any mode but Figé). */
  update(linkId: string) {
    const l = this.find(linkId);
    if (!l || l.def.mode === 'frozen') return;
    const v = this.sourceValue(l.def);
    if (v) void this.apply(l.target, l.def, v.value, v.rev);
    this.queueRefresh();
  }

  updateAll() {
    let n = 0;
    for (const l of this.resolved())
      if (l.state === 'stale') {
        this.update(l.def.id);
        n++;
      }
    this.open.announce(n ? `${n} copie${n > 1 ? 's' : ''} mise${n > 1 ? 's' : ''} à jour` : 'Tout est à jour');
  }

  setMode(linkId: string, mode: LinkMode) {
    const l = this.find(linkId);
    if (!l) return;
    // Back to « En direct » from Figé or Manuel: catch up at once (Figma G1 « Reprendre le lien »).
    l.target.links.patch(linkId, { mode }, 'person');
    if (mode === 'live') this.update(linkId);
    this.queueRefresh();
  }

  setCarries(linkId: string, carries: Carries) {
    const l = this.find(linkId);
    if (!l) return;
    l.target.links.patch(linkId, { carries }, 'person');
    if (l.def.mode !== 'frozen') this.update(linkId);
  }

  recordTableEdit(linkId: string, ch: { r: number; c: number; prop: CellStyleEdit['prop']; value: string | boolean | null }) {
    const l = this.find(linkId);
    const v = l && this.sourceValue(l.def);
    const table = v?.value.kind === 'table' ? v.value.table : null;
    const row = table?.rowIds?.[ch.r];
    const col = table?.colIds?.[ch.c];
    if (!l || !table || !row || !col) return;
    const src = table.rows[ch.r]?.[ch.c];
    const norm = (x: unknown) => (typeof x === 'string' ? x.toUpperCase() : x === undefined ? null : x);
    const style = ch.prop === 'bold' || ch.prop === 'italic';
    const fromSource = style ? !!src?.[ch.prop] : (l.def.theme ?? 'source') === 'source' ? (src?.[ch.prop] ?? null) : null;
    const id = `${row}:${col}:${ch.prop}`;
    const patch: CellStyleEdit = { kind: 'cell-style', row, col, prop: ch.prop, value: ch.value };
    const where = `${table.rows[ch.r]?.[0]?.text || `ligne ${ch.r + 1}`}, ${table.rows[0]?.[ch.c]?.text || `colonne ${ch.c + 1}`}`;
    // Back to what the source shows: no longer a local edit.
    const edits = norm(fromSource) === norm(ch.value) ? withoutEdit(l.def.edits, id) : withEdit(l.def.edits, { id, label: cellEditLabel(patch, where), at: Date.now(), by: identity().name, patch });
    l.target.links.patch(linkId, { edits }, 'person');
    this.queueRefresh();
  }

  /** Undo one local edit: the copy shows the source's style there again. */
  removeEdit(linkId: string, editId: string) {
    const l = this.find(linkId);
    if (!l) return;
    l.target.links.patch(linkId, { edits: withoutEdit(l.def.edits, editId) }, 'person');
    this.update(linkId);
  }

  /** Whether « Appliquer à la source » can work for this link (its source is open here and knows how). */
  canApplyToSource(linkId: string): boolean {
    const l = this.find(linkId);
    return !!l && !!this.sources.get(l.def.source.docId)?.src.applyEdit;
  }

  /** « Appliquer à la source »: the edit goes into the source, then every copy gets it from there. */
  applyEditToSource(linkId: string, editId: string): boolean {
    const l = this.find(linkId);
    const edit = l?.def.edits?.find((e) => e.id === editId);
    const src = l && this.sources.get(l.def.source.docId)?.src;
    if (!l || !edit || !src?.applyEdit?.(l.def.source.ref, edit.patch)) return false;
    l.target.links.patch(linkId, { edits: withoutEdit(l.def.edits, editId) }, 'person');
    this.open.announce('Modification appliquée à la source : toutes les copies la recevront.');
    return true;
  }

  setLinkOptions(linkId: string, patch: { theme?: LinkTheme; overflow?: Overflow }) {
    const l = this.find(linkId);
    if (!l) return;
    l.target.links.patch(linkId, { ...(patch.theme ? { theme: patch.theme } : {}), ...(patch.overflow ? { view: { overflow: patch.overflow } } : {}) }, 'person');
    // Draw the copy again from the source with the new options.
    this.update(linkId);
  }

  /** « Couper le lien »: the copy stays as it is, with no link. */
  unlink(linkId: string) {
    const l = this.find(linkId);
    if (!l) return;
    l.target.links.remove(linkId, 'person');
    const src = this.sources.get(l.def.source.docId)?.src.ydoc;
    if (src) linksOf(src).removeBacklink(linkId, 'person');
    if (this.ui.popover?.linkId === linkId) this.setUi({ popover: null });
    this.open.announce('Lien coupé : la copie garde sa dernière image.');
    this.queueRefresh();
  }

  openSource(linkId: string): boolean {
    const p = this.find(linkId)?.sourcePaper;
    if (p) this.open.paper(p.id);
    return !!p;
  }

  fileTitle(docId: string): string | null {
    return this.paperOfDoc(docId)?.title ?? null;
  }

  openPaper(paperId: string) {
    this.open.paper(paperId);
  }

  /** « Annuler » right after « Lier »: the copy and its link go away. */
  undoCreate(linkId: string) {
    const l = this.find(linkId);
    if (!l) return;
    const t = l.target;
    t.ydoc.transact(() => {
      t.adapter.remove(l.def.target.objectId);
      t.links.remove(linkId, 'person');
    }, 'person');
    const srcDoc = this.sources.get(l.def.source.docId)?.src.ydoc;
    if (srcDoc) linksOf(srcDoc).removeBacklink(linkId, 'person');
    this.queueRefresh();
  }

  openTarget(linkId: string) {
    const p = this.find(linkId)?.targetPaper;
    if (p) this.open.paper(p.id);
  }

  // ===== UI state ==========================================================

  setUi(patch: Partial<UiState>) {
    this.ui = { ...this.ui, ...patch };
    this.uiListeners.forEach((f) => f());
  }

  subscribeUi = (fn: () => void) => {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  };

  getUi = () => this.ui;

  // ===== creating links (G2) ===============================================

  /** Why a paper can't take a copy of this chart, or null when it can (G2 step 2, G7 cycles). */
  refusal(req: LinkRequest, target: Paper): string | null {
    const what = req.kind === 'image' ? 'une image liée' : req.kind === 'range' ? 'un tableau lié' : 'un graphique lié';
    if (target.id === req.sourcePaperId) return req.kind === 'image' ? 'Une image ne peut pas se lier à elle-même.' : 'Un graphique ne peut pas dépendre de lui-même.';
    if (!TARGET_KINDS.has(target.kind)) {
      if (target.kind === 'spreadsheet') return req.kind === 'image' ? 'Les images dans un tableur arrivent plus tard.' : 'Lier entre tableurs arrive plus tard.';

      return `${target.kind === 'image' ? 'Une image' : target.kind === 'pdf' ? 'Un PDF' : 'Ce fichier'} ne peut pas accueillir ${what}.`;
    }
    const from = (this.store.node(req.sourcePaperId) as Paper | undefined)?.data.docId;
    const to = target.data.docId;
    if (from && to) {
      const edges = this.resolved().map((l) => ({ from: l.def.source.docId, to: l.targetDocId }));
      if (createsCycle(edges, from, to)) return 'Un graphique ne peut pas dépendre de lui-même.';
    }
    return null;
  }

  async createLink(req: LinkRequest, targetPaperId: string, placement: Placement, carries: Carries): Promise<{ linkId: string; where: string } | null> {
    if (req.kind === 'image') return this.createImageLink(req, targetPaperId, placement);
    // The dialog's « keep the copy's style » choice means, for a table, the destination's theme.
    if (req.kind === 'range') return this.createRangeLink(req, targetPaperId, placement, carries === 'chart-data' ? 'target' : 'source');
    const sourcePaper = this.store.node(req.sourcePaperId) as Paper | undefined;
    const targetPaper = this.store.node(targetPaperId) as Paper | undefined;
    if (!sourcePaper?.data.docId || !targetPaper) return null;
    const reason = this.refusal(req, targetPaper);
    if (reason) throw new Error(reason);
    const ref: SourceRef = { kind: 'chart', sheetId: req.sheetId, chartId: req.chartId };
    // The value comes from the source's own engine, so it matches what live updates will write.
    await this.ensureSource(sourcePaper.data.docId);
    const src = this.sources.get(sourcePaper.data.docId);
    const read = src ? await src.src.read(ref) : null;
    const value: ChartSpec = read?.kind === 'chart' ? (read.spec as ChartSpec) : { ...req.spec, part: '' };
    const rev = valueRev({ kind: 'chart', spec: value });
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const name = chartName(value) === 'Graphique' ? req.name : chartName(value);
    let objectId = '';
    let where = '';
    let targetDocId = targetPaper.data.docId ?? '';

    if (targetPaper.kind === 'slides') {
      const s = await slideSessionFor(targetPaper, (docId) => this.patchDocId(targetPaperId, docId));
      targetDocId = s.status.docId;
      const sd = s.slides;
      const info = sd.info();
      const ids = sd.slideIds();
      const last = ids[ids.length - 1];
      const def = (oid: string, label: string): LinkDef => ({
        id,
        source: { docId: sourcePaper.data.docId!, kind: 'spreadsheet', ref, title: sourcePaper.title, label: name },
        target: { objectId: oid, label },
        carries,
        mode: 'live',
        snapshot: { rev, at: Date.now(), by: identity().name },
      });
      // One transaction: the copy and its link arrive together for everyone.
      if (placement.kind === 'slides' && placement.where === 'last-slide' && last) {
        const el = chartFrame(value, chartBoxOn(info, sd.slide(last)?.elements ?? []), name);
        objectId = el.id;
        where = `diapo ${ids.length}`;
        s.ydoc.transact(() => {
          sd.addElement(last, el);
          linksOf(s.ydoc).put(def(objectId, where), 'person');
        }, 'person');
      } else {
        const { slide, chartId } = chartSlide(info, value, name, last ? sd.slide(last)?.layout : undefined);
        objectId = chartId;
        where = `diapo ${ids.length + 1}`;
        s.ydoc.transact(() => {
          sd.insertSlide(ids.length, slide);
          linksOf(s.ydoc).put(def(objectId, where), 'person');
        }, 'person');
      }
    } else {
      const s = await sessionFor(targetPaper, (docId) => this.patchDocId(targetPaperId, docId));
      targetDocId = s.status.docId;
      objectId = `c${id}`;
      const atStart = placement.kind === 'document' && placement.where === 'start';
      where = atStart ? 'début' : `§ ${s.fragment.length + 1}`;
      s.ydoc.transact(() => {
        insertChartParagraph(s.ydoc, objectId, value, atStart ? 'start' : 'end', 'person');
        linksOf(s.ydoc).put(
          {
            id,
            source: { docId: sourcePaper.data.docId!, kind: 'spreadsheet', ref, title: sourcePaper.title, label: name },
            target: { objectId, label: where },
            carries,
            mode: 'live',
            snapshot: { rev, at: Date.now(), by: identity().name },
          },
          'person',
        );
      }, 'person');
    }

    // The source learns where it is used (« Utilisé dans… »).
    const srcDoc = src?.src.ydoc ?? (await sheetSessionFor(sourcePaper, () => {})).ydoc;
    linksOf(srcDoc).putBacklink({ linkId: id, ref, docId: targetDocId, kind: targetPaper.kind as 'slides' | 'document', objectId, title: targetPaper.title, label: where }, 'person');
    if (targetPaper.data.docId) void this.ensureTarget(this.store.node(targetPaperId) as Paper);
    this.queueRefresh();
    return { linkId: id, where };
  }

  /** « Lier dans… » on a range (Figma I2): a real table in a slide or a document. */
  private async createRangeLink(req: RangeRequest, targetPaperId: string, placement: Placement, theme: 'source' | 'target'): Promise<{ linkId: string; where: string } | null> {
    const sourcePaper = this.store.node(req.sourcePaperId) as Paper | undefined;
    const targetPaper = this.store.node(targetPaperId) as Paper | undefined;
    if (!sourcePaper?.data.docId || !targetPaper) return null;
    const reason = this.refusal(req, targetPaper);
    if (reason) throw new Error(reason);
    const docId = sourcePaper.data.docId;
    const ref: SourceRef = { kind: 'range', sheetId: req.sheetId, ids: req.ids };
    await this.ensureSource(docId);
    const src = this.sources.get(docId);
    const value = await src?.src.read(ref);
    if (!value || value.kind !== 'table') throw new Error('Cette plage ne peut pas être lue pour l’instant.');
    const rev = valueRev(value);
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const def = (objectId: string, label: string): LinkDef => ({
      id,
      source: { docId, kind: 'spreadsheet', ref, title: sourcePaper.title, label: req.name },
      target: { objectId, label },
      carries: 'table',
      mode: 'live',
      snapshot: { rev, at: Date.now(), by: identity().name },
      theme,
      ...(targetPaper.kind === 'slides' ? { view: { overflow: 'truncate' as const } } : {}),
    });
    let objectId = '';
    let where = '';
    let targetDocId = targetPaper.data.docId ?? '';
    if (targetPaper.kind === 'slides') {
      const s = await slideSessionFor(targetPaper, (d) => this.patchDocId(targetPaperId, d));
      targetDocId = s.status.docId;
      const sd = s.slides;
      const info = sd.info();
      const ids = sd.slideIds();
      const last = ids[ids.length - 1];
      if (placement.kind === 'slides' && placement.where === 'last-slide' && last) {
        const el = linkedTableFrame(info, value.table, theme, 'truncate', chartBoxOn(info, sd.slide(last)?.elements ?? []));
        objectId = el.id;
        where = `diapo ${ids.length}`;
        s.ydoc.transact(() => {
          sd.addElement(last, el);
          linksOf(s.ydoc).put(def(objectId, where), 'person');
        }, 'person');
      } else {
        const { slide, chartId } = chartSlide(info, { groups: [] } as unknown as ChartSpec, req.name.split('!')[0] || sourcePaper.title, last ? sd.slide(last)?.layout : undefined);
        const i = slide.elements.findIndex((e) => e.id === chartId);
        const frame = slide.elements[i]!;
        const el = linkedTableFrame(info, value.table, theme, 'truncate', frame);
        slide.elements[i] = el;
        objectId = el.id;
        where = `diapo ${ids.length + 1}`;
        s.ydoc.transact(() => {
          sd.insertSlide(ids.length, slide);
          linksOf(s.ydoc).put(def(objectId, where), 'person');
        }, 'person');
      }
    } else {
      const s = await sessionFor(targetPaper, (d) => this.patchDocId(targetPaperId, d));
      targetDocId = s.status.docId;
      objectId = `t${id}`;
      const atStart = placement.kind === 'document' && placement.where === 'start';
      where = atStart ? 'début' : `§ ${s.fragment.length + 1}`;
      s.ydoc.transact(() => {
        insertLinkedTable(s.ydoc, objectId, value.table, theme, atStart ? 'start' : 'end', 'person');
        linksOf(s.ydoc).put(def(objectId, where), 'person');
      }, 'person');
    }
    if (src?.src.ydoc) linksOf(src.src.ydoc).putBacklink({ linkId: id, ref, docId: targetDocId, kind: targetPaper.kind as 'slides' | 'document', objectId, title: targetPaper.title, label: where }, 'person');
    if (targetPaper.data.docId) void this.ensureTarget(this.store.node(targetPaperId) as Paper);
    this.queueRefresh();
    return { linkId: id, where };
  }

  /** « Lier dans… » on a desk image (Figma I1): a picture copy in a slide or a document. */
  private async createImageLink(req: ImageRequest, targetPaperId: string, placement: Placement): Promise<{ linkId: string; where: string } | null> {
    const sourcePaper = this.store.node(req.sourcePaperId) as Paper | undefined;
    const targetPaper = this.store.node(targetPaperId) as Paper | undefined;
    if (!sourcePaper || !targetPaper) return null;
    const reason = this.refusal(req, targetPaper);
    if (reason) throw new Error(reason);
    const docId = sourcePaper.data.docId ?? imageDocId(sourcePaper.id);
    if (!sourcePaper.data.docId) this.patchDocId(sourcePaper.id, docId);
    const ref: SourceRef = { kind: 'image', objectId: sourcePaper.id };
    await this.ensureSource(docId);
    const value = await this.sources.get(docId)?.src.read(ref);
    if (!value || value.kind !== 'picture') throw new Error('Cette image ne peut pas être lue pour l’instant.');
    const rev = valueRev(value);
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const aspect = value.media.width / Math.max(1, value.media.height);
    const def = (objectId: string, label: string): LinkDef => ({
      id,
      source: { docId, kind: 'image', ref, title: sourcePaper.title, label: req.name },
      target: { objectId, label },
      carries: 'picture',
      mode: 'live',
      snapshot: { rev, at: Date.now(), by: identity().name },
    });
    let objectId = '';
    let where = '';
    if (targetPaper.kind === 'slides') {
      const s = await slideSessionFor(targetPaper, (d) => this.patchDocId(targetPaperId, d));
      if (!(await preparePicture(s.ydoc, value, (b) => s.addPicture(b), pictureBytes))) throw new Error('Cette image ne peut pas être copiée.');
      const path = linkMedia(s.ydoc).get(value.media.hash)!;
      const sd = s.slides;
      const info = sd.info();
      const ids = sd.slideIds();
      const last = ids[ids.length - 1];
      // The picture fits the area a chart would take, keeping its proportions.
      const fit = (box: { x: number; y: number; cx: number; cy: number }) => {
        const cx = Math.round(Math.min(box.cx, box.cy * aspect));
        const cy = Math.round(cx / aspect);
        return { x: box.x + Math.round((box.cx - cx) / 2), y: box.y, cx, cy };
      };
      if (placement.kind === 'slides' && placement.where === 'last-slide' && last) {
        const el = picture(path, value.media.mime, fit(chartBoxOn(info, sd.slide(last)?.elements ?? [])), req.name);
        objectId = el.id;
        where = `diapo ${ids.length}`;
        s.ydoc.transact(() => {
          sd.addElement(last, el);
          linksOf(s.ydoc).put(def(objectId, where), 'person');
        }, 'person');
      } else {
        const { slide, chartId } = chartSlide(info, { groups: [] } as unknown as ChartSpec, req.name, last ? sd.slide(last)?.layout : undefined);
        const i = slide.elements.findIndex((e) => e.id === chartId);
        const frame = slide.elements[i]!;
        slide.elements[i] = { ...picture(path, value.media.mime, fit(frame), req.name), id: chartId };
        objectId = chartId;
        where = `diapo ${ids.length + 1}`;
        s.ydoc.transact(() => {
          sd.insertSlide(ids.length, slide);
          linksOf(s.ydoc).put(def(objectId, where), 'person');
        }, 'person');
      }
    } else {
      const s = await sessionFor(targetPaper, (d) => this.patchDocId(targetPaperId, d));
      if (!(await preparePicture(s.ydoc, value, (b) => s.addImage(b), pictureBytes))) throw new Error('Cette image ne peut pas être copiée.');
      const path = linkMedia(s.ydoc).get(value.media.hash)!;
      objectId = `p${id}`;
      const atStart = placement.kind === 'document' && placement.where === 'start';
      where = atStart ? 'début' : `§ ${s.fragment.length + 1}`;
      // 15 cm wide at most, keeping the picture's proportions.
      const cx = Math.min(5_400_000, Math.round(value.media.width * 9525));
      s.ydoc.transact(() => {
        insertPictureParagraph(s.ydoc, objectId, { path, cx, cy: Math.round(cx / aspect), alt: req.name }, atStart ? 'start' : 'end', 'person');
        linksOf(s.ydoc).put(def(objectId, where), 'person');
      }, 'person');
    }
    if (targetPaper.data.docId) void this.ensureTarget(this.store.node(targetPaperId) as Paper);
    this.queueRefresh();
    return { linkId: id, where };
  }

  private patchDocId(paperId: string, docId: string) {
    const p = this.store.node(paperId) as Paper | undefined;
    if (p) this.store.update(paperId, { data: { ...p.data, docId } }, { history: false });
  }
}

let active: LinkResolver | null = null;
/** The desk's resolver (workspaces ask it for « Lier dans… »). */
export const activeLinks = () => active;
export function setActiveLinks(r: LinkResolver | null) {
  active = r;
}
