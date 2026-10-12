/**
 * The desk saved on this device (plan solo MVP, S-2): one Y.Doc per project, the shape the
 * server will sync later (backend plan B-5 / projects N-2).
 *
 *   papers  Y.Map  paper id → paper (plain JSON, see `storedPaper`)
 *   meta    Y.Map  format, order (paint order), links (desk-only threads), viewport,
 *                  demoVersion, trash (files of removed papers, deleted on a later visit)
 *
 * The DeskStore stays the live model and keeps its own undo history; `bindDesk` copies what
 * changed into the Y.Doc, a moment after each change. Nothing here touches IndexedDB, so it is
 * tested on a bare Y.Doc; `openDeviceDoc` (@oel/collab-client) saves it.
 */
import * as Y from 'yjs';
import type { DeskLink, Viewport } from '@oel/desk';
import { THREAD_PREFIX } from '@oel/links';
import type { Bureau, Paper, PaperKind } from './model';
import { tr } from '@oel/i18n';

export const DESK_FORMAT = 1;
export const deskDbName = (projectId: string) => `oel-desk:${projectId}`;

/** A removed paper's file, kept until no paper refers to it on a later visit (undo may bring it back). */
export interface TrashEntry {
  docId: string;
  kind: PaperKind;
}

export interface DeskContent {
  papers: Paper[];
  links: DeskLink[];
  viewport: Viewport | null;
  demoVersion: number | null;
}

const papersOf = (doc: Y.Doc) => doc.getMap<Paper>('papers');
const metaOf = (doc: Y.Doc) => doc.getMap<unknown>('meta');

/**
 * What a paper keeps between visits. Object URLs (thumbnail, image, rendering) belong to
 * this tab and are rebuilt on load (`restore.ts`); « +1 ligne » flashes are momentary.
 */
export function storedPaper(p: Paper): Paper {
  const { thumbnail: _t, imageUrl: _i, flash: _f, ...data } = p.data;
  const image = data.image && (({ rendered: _r, ...rest }) => rest)(data.image);
  // JSON round trip: no `undefined` fields in the Y.Doc.
  return JSON.parse(JSON.stringify({ ...p, data: { ...data, image } })) as Paper;
}

/** A paper as it comes back: an import cut short by closing the tab says so. */
export function restoredPaper(p: Paper): Paper {
  if (p.data.status.state !== 'importing') return p;
  return { ...p, data: { ...p.data, status: { state: 'error', reason: tr('Import interrompu : déposez le fichier à nouveau.', 'Import interrupted: drop the file again.') } } };
}

/** Threads the link resolver derives from the files are not saved: they come back from the files. */
const ownLinks = (links: DeskLink[]) => links.filter((l) => !l.id.startsWith(THREAD_PREFIX));

/** The saved desk, or null when this project has never had one. */
export function readDesk(doc: Y.Doc): DeskContent | null {
  const meta = metaOf(doc);
  if (meta.get('format') == null) return null;
  const papers = papersOf(doc);
  const order = (meta.get('order') as string[] | undefined) ?? [];
  const ids = [...order.filter((id) => papers.has(id)), ...[...papers.keys()].filter((id) => !order.includes(id))];
  return {
    papers: ids.map((id) => restoredPaper(papers.get(id)!)),
    links: (meta.get('links') as DeskLink[] | undefined) ?? [],
    viewport: (meta.get('viewport') as Viewport | undefined) ?? null,
    demoVersion: (meta.get('demoVersion') as number | undefined) ?? null,
  };
}

/** Mark the desk as created (format, demo version); papers follow with the first `flush`. */
export function initDesk(doc: Y.Doc, { demoVersion }: { demoVersion: number | null }) {
  doc.transact(() => {
    const meta = metaOf(doc);
    meta.set('format', DESK_FORMAT);
    if (demoVersion != null) meta.set('demoVersion', demoVersion);
  });
}

export function trashOf(doc: Y.Doc): TrashEntry[] {
  return (metaOf(doc).get('trash') as TrashEntry[] | undefined) ?? [];
}

/**
 * Empty the trash: the files no paper refers to any more (safe to delete now; the ones an undo
 * brought back are simply forgotten). Run once on load, before anything is edited.
 */
export function takeTrash(doc: Y.Doc): TrashEntry[] {
  const trash = trashOf(doc);
  if (!trash.length) return [];
  const used = new Set([...papersOf(doc).values()].map((p) => p.data.docId).filter(Boolean));
  metaOf(doc).set('trash', []);
  const seen = new Set<string>();
  return trash.filter((t) => !used.has(t.docId) && !seen.has(t.docId) && seen.add(t.docId));
}

export interface DeskBinding {
  /** Write pending changes now (before a backup, on `pagehide`). */
  flush(): void;
  dispose(): void;
}

const sameViewport = (a: Viewport | null, b: Viewport | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/**
 * Keep `doc` in step with the desk: papers by id (only those whose saved form changed),
 * paint order, desk-only links and the viewport, `delay` ms after the last change.
 * `saved` is what `doc` already holds (from `readDesk`), or null for a new desk: then the
 * first flush writes everything.
 */
export function bindDesk(store: Bureau, doc: Y.Doc, saved: DeskContent | null, { delay = 400, onWrite }: { delay?: number; onWrite?: () => void } = {}): DeskBinding {
  const papers = papersOf(doc);
  const meta = metaOf(doc);
  const json = new Map<string, string>((saved?.papers ?? []).map((p) => [p.id, JSON.stringify(storedPaper(p))]));
  const kinds = new Map<string, { kind: PaperKind; docId?: string }>((saved?.papers ?? []).map((p) => [p.id, { kind: p.kind, docId: p.data.docId }]));
  let order = saved ? JSON.stringify(saved.papers.map((p) => p.id)) : '';
  let links = saved ? JSON.stringify(saved.links) : '';
  let viewport = saved?.viewport ?? null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastNodes: unknown = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const s = store.getState();
    let wrote = false;
    doc.transact(() => {
      if (s.nodes !== lastNodes) {
        lastNodes = s.nodes;
        const removed: TrashEntry[] = [];
        for (const [id, node] of Object.entries(s.nodes)) {
          const p = storedPaper(node as Paper);
          const j = JSON.stringify(p);
          if (json.get(id) === j) continue;
          json.set(id, j);
          kinds.set(id, { kind: p.kind, docId: p.data.docId });
          papers.set(id, p);
          wrote = true;
        }
        for (const id of [...json.keys()]) {
          if (s.nodes[id]) continue;
          json.delete(id);
          const k = kinds.get(id);
          kinds.delete(id);
          if (k?.docId) removed.push({ docId: k.docId, kind: k.kind });
          papers.delete(id);
          wrote = true;
        }
        if (removed.length) meta.set('trash', [...trashOf(doc), ...removed]);
      }
      const o = JSON.stringify(s.order);
      if (o !== order) {
        order = o;
        meta.set('order', s.order);
        wrote = true;
      }
      const l = JSON.stringify(ownLinks(s.links));
      if (l !== links) {
        links = l;
        meta.set('links', ownLinks(s.links));
        wrote = true;
      }
      if (!sameViewport(s.viewport, viewport)) {
        viewport = s.viewport;
        meta.set('viewport', s.viewport);
      }
    });
    if (wrote) onWrite?.();
  };

  const unsub = store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });
  if (!saved) flush();
  return {
    flush,
    dispose() {
      unsub();
      if (timer) flush();
    },
  };
}
