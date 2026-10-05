import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createDesk } from '@oel/desk';
import { DeskCanvas, Minimap, useDesk, useDeskState } from '@oel/desk/react';
import '@oel/desk/desk.css';
import {
  Badge,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  ToastRegion,
  toast,
} from '@oel/emboss';
import { ContextToolbar } from './ContextToolbar';
import { BottomBar, PresenceCursors, ProjectPill, SharePill, ZoomControl, type ArrivalRules } from './Chrome';
import { ListView } from './ListView';
import { KIND_TAB, blankPaper, describePaper, kindLabel, type Bureau, type Paper as PaperNode, type PaperData, type PaperKind } from './model';
import { OpenSheet, type OpenSheetHandle } from './OpenSheet';
import { Paper } from './Paper';
import { SEED_PAPERS } from './seed';
import { LinkResolver, setActiveLinks } from '../links/resolver';
import { LinksUI } from '../links/LinksUI';
import { THREAD_PREFIX } from '@oel/links';
import { ShortcutsDialog } from './ShortcutsDialog';
import { convertToEditable, importFiles } from './importFiles';
import { seedFixtures } from './seedFixtures';
import { identity } from './docs';
import { NewFormDialog, createLink, type NewFormResult } from '@oel/forms';
import { formsBackend } from '../forms/backend';
import { ensureFormThread, sheetRefs, useFormSync, writeHeaders } from './forms';
import './bureau.css';

const PROJECT = 'Lancement automne 2026';
/** Furthest you can zoom out: papers are small thumbnails, never piles or a full overview. */
const MAX_ZOOM_OUT = 0.25;

/**
 * 05 · Bureau (projet multimodal). An infinite desk where every file of a
 * project lies side by side as real paper. Selecting shows a contextual
 * toolbar; double-click / Enter opens the paper in place (B4).
 */
export function BureauApp() {
  const store = useMemo<Bureau>(() => {
    const desk = createDesk<PaperData>({
      nodes: SEED_PAPERS,
      viewport: { x: 0, y: 40, zoom: 0.9 },
      zoom: { min: MAX_ZOOM_OUT, max: 4 },
    });
    return desk;
  }, []);
  const [view, setView] = useState<'desk' | 'list'>('desk');
  /** The bottom bar's « + » menu (M1), opened by Alt + N too. */
  const [newMenu, setNewMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [rules, setRules] = useState<ArrivalRules>({ sortByType: false, ocr: true, linkTables: true });
  const [menu, setMenu] = useState<{ ids: string[]; at: { x: number; y: number } } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<OpenSheetHandle>(null);
  const [full, setFull] = useState(false);
  const announceRef = useRef<(m: string) => void>(() => {});
  const announce = useCallback((m: string) => announceRef.current(m), []);
  /** E2 · 1 « Nouveau formulaire » (from the « + » menu, or from a selected spreadsheet). */
  const [newForm, setNewForm] = useState<{ sheetId: string | null } | null>(null);
  useFormSync(store, formsBackend, announce);

  // Fils de liaison (Figma G): derived from the links stored in the files.
  const openRef = useRef<(id: string) => void>(() => {});
  const links = useMemo(() => new LinkResolver(store, { paper: (id) => openRef.current(id), announce: (m) => announceRef.current(m) }), [store]);
  useEffect(() => {
    setActiveLinks(links);
    return () => {
      setActiveLinks(null);
      links.dispose();
    };
  }, [links]);
  const linksUi = useSyncExternalStore(links.subscribeUi, links.getUi, links.getUi);
  /** Desk-element pixels → viewport (the popover anchors in the viewport). */
  const deskToViewport = (r: { x: number; y: number; w: number; h: number }) => {
    const d = document.querySelector('.desk')?.getBoundingClientRect();
    return { x: r.x + (d?.left ?? 0), y: r.y + (d?.top ?? 0), width: r.w, height: r.h };
  };

  const count = useDeskState(store, (s) => s.order.length);
  const openId = useDeskState(store, (s) => s.openId);
  const openPaper = useDeskState(store, (s) => (s.openId ? (s.nodes[s.openId] as PaperNode | undefined) : undefined));

  // TEMPORARY: real fixture files in place of two sample papers (see seedFixtures.ts).
  useEffect(() => seedFixtures(store), [store]);

  // Fit the seeded desk once the canvas knows its size.
  useEffect(() => {
    if (store.getState().screen.w > 0) {
      store.zoomToFit(undefined, 0.92);
      return;
    }
    const unsub = store.subscribe(() => {
      if (store.getState().screen.w > 0) {
        unsub();
        store.zoomToFit(undefined, 0.92);
      }
    });
    return unsub;
  }, [store]);

  // ── Levels (Editor — Behaviors · A1/A2) ─────────────────────────────
  // 1 desk · 2 ouvert sur place (?f=id) · 3 plein écran (&vue=plein-ecran).
  // Each level has its own address, so the browser's Back does what Échap does.
  const urlFor = (id: string | null, isFull: boolean) =>
    id ? `${location.pathname}?f=${encodeURIComponent(id)}${isFull ? '&vue=plein-ecran' : ''}` : location.pathname;
  const depth = (): number => (history.state as { oelDepth?: number } | null)?.oelDepth ?? 0;

  /** Show a level. Leaving a file commits its thumbnail and puts it back, selected and focused. */
  const apply = (id: string | null, isFull: boolean) => {
    const prev = store.getState().openId;
    if (prev && prev !== id) {
      sheetRef.current?.commit();
      store.open(null);
      store.select([prev]);
      store.focus(prev);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(prev)}"]`)?.focus({ preventScroll: true }));
    }
    if (id) store.open(id);
    setFull(!!id && isFull);
  };
  const openAt = (id: string, level: 2 | 3) => {
    history.pushState({ oelDepth: 1 }, '', urlFor(id, false));
    if (level === 3) history.pushState({ oelDepth: 2 }, '', urlFor(id, true));
    apply(id, level === 3);
  };
  const expand = () => {
    const id = store.getState().openId;
    if (!id) return;
    history.pushState({ oelDepth: depth() + 1 }, '', urlFor(id, true));
    apply(id, true);
  };
  const reduce = () => {
    const id = store.getState().openId;
    if (!id) return;
    if (depth() >= 2) return history.back();
    history.replaceState({ oelDepth: 1 }, '', urlFor(id, false));
    apply(id, false);
  };
  /** Back to the desk in one step (« ‹ Bureau », « Reposer », Échap at level 2). */
  const toDesk = () => {
    const d = depth();
    if (d > 0) return history.go(-d);
    history.replaceState(null, '', urlFor(null, false));
    apply(null, false);
  };

  useEffect(() => {
    const fromUrl = () => {
      const u = new URL(location.href);
      const id = u.searchParams.get('f');
      return { id: id && store.node(id) ? id : null, isFull: u.searchParams.get('vue') === 'plein-ecran' };
    };
    const onPop = () => {
      const { id, isFull } = fromUrl();
      apply(id, isFull);
    };
    // Deep link: /bureau?f=communique&vue=plein-ecran opens that level.
    const first = fromUrl();
    if (first.id) {
      history.replaceState({ oelDepth: 0 }, '', urlFor(null, false));
      openAt(first.id, first.isFull ? 3 : 2);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const open = (id: string) => openAt(id, 2);
  /** Open a paper from a link (« Ouvrir la source / la copie »), even from inside another open paper. */
  openRef.current = (id: string) => {
    if (store.getState().openId === id) return;
    if (store.getState().openId) {
      apply(id, false);
      history.replaceState({ oelDepth: depth() || 1 }, '', urlFor(id, false));
    } else openAt(id, 2);
  };
  const create = (kind: PaperKind) => {
    if (kind === 'form') return setNewForm({ sheetId: null });
    const p = blankPaper(kind, store.viewCenter());
    store.add([p]);
    announceRef.current(`${kindLabel(kind)} créé au centre de la vue`);
    if (kind !== 'note') setTimeout(() => openAt(p.id, 2), 50);
  };
  const createForm = ({ form, linkTo }: NewFormResult) => {
    const p = blankPaper('form', store.viewCenter());
    const link = linkTo ? createLink(form, { id: linkTo.id, title: linkTo.title, tab: linkTo.tab, header: linkTo.rows[0] ?? [] }) : null;
    // Lay the form left of the sheet it reads from, so the thread is short.
    const sheet = linkTo ? store.node(linkTo.id) : null;
    const at = sheet ? { x: sheet.x - p.w - 80, y: sheet.y } : { x: p.x, y: p.y };
    store.add([{ ...p, ...at, title: form.title, data: { ...p.data, preview: { kind: 'unsupported' }, form: { ...form, link } } }]);
    if (link) {
      ensureFormThread(store, p.id, link);
      writeHeaders(store, link);
    }
    announceRef.current(`Formulaire « ${form.title} » créé`);
    setTimeout(() => openAt(p.id, 2), 50);
  };
  const doImport = (files: File[], at: { x: number; y: number } | null = null) =>
    void importFiles(store, files, at, rules, (m) => announceRef.current(m));
  const remove = (ids: string[]) => {
    const n = ids.length;
    store.remove(ids);
    toast({
      title: n > 1 ? `${n} fichiers retirés du bureau` : 'Fichier retiré du bureau',
      tone: 'info',
      action: { label: 'Annuler', onAction: () => store.undo() },
    });
  };

  // App-wide keys: help and import work from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        links.setUi({ panel: !links.getUi().panel });
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') {
        // Alt + N: the « + » menu (M1). By key code: on macOS Option + N types a dead key.
        e.preventDefault();
        setNewMenu(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.bottom-bar input[type=file]')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="bureau" style={{ ['--desk-selection' as string]: identity().color }}>
      <main id="contenu" className="bureau__main">
        {view === 'desk' ? (
          <DeskCanvas<PaperData>
            store={store}
            label={`Bureau du projet ${PROJECT}`}
            describeNode={(n) => describePaper(n as PaperNode)}
            renderNode={(n, ctx) => <Paper node={n as PaperNode} ctx={ctx} />}
            selectionOverhang={(n, zoom) => (KIND_TAB[n.kind as PaperKind] ? tabHeightOnScreen(zoom) - 4 : 0)}
            renderGroupLabel={(nodes) => {
              const kinds = new Set(nodes.map((n) => n.kind)).size;
              return `${nodes.length} fichiers · ${kinds} type${kinds > 1 ? 's' : ''}`;
            }}
            onOpen={open}
            onDelete={remove}
            onContextMenu={(ids, at) => setMenu({ ids, at })}
            onDropFiles={(files, at) => doImport(files, at)}
            onLinkOpen={(id, anchor) => links.manage(id.replace(THREAD_PREFIX, ''), deskToViewport(anchor))}
            onLinkDelete={(id) => links.setUi({ cut: id.replace(THREAD_PREFIX, '') })}
            activeLinkId={linksUi.popover ? THREAD_PREFIX + linksUi.popover.linkId : null}
            renderDropZone={(n) => (
              <div className="dropzone">
                <Badge tone="accent" dot={false}>{n}</Badge>
                <strong>Déposez pour ajouter au projet</strong>
                <span>PDF, Word, PowerPoint, Excel, images · 100 Mo max</span>
              </div>
            )}
            onKeyDown={(e) => {
              // Ctrl+Maj+Entrée on the desk opens the selection straight in full screen (A2).
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
                const st = store.getState();
                const id = st.focusedId ?? st.selection[0];
                if (id) openAt(id, 3);
                return true;
              }
              if (e.key === '/' && toolbarRef.current) {
                toolbarRef.current.querySelector<HTMLElement>('button')?.focus();
                return true;
              }
              if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
                create('note');
                return true;
              }
              return false;
            }}
          >
            <AnnounceBridge target={announceRef} />
            <PresenceCursors store={store} />
            <ContextToolbar
              store={store}
              onOpen={open}
              onConvert={(id) => convertToEditable(store, id, announceRef.current)}
              onCreateForm={(sheetId) => setNewForm({ sheetId })}
              onOpenFull={(id) => openAt(id, 3)}
              toolbarRef={toolbarRef}
            />
            {menu && (
              <ContextMenu
                at={menu.at}
                ids={menu.ids}
                store={store}
                onClose={() => setMenu(null)}
                onOpen={open}
                onRemove={remove}
              />
            )}
          </DeskCanvas>
        ) : (
          <ListView store={store} onOpen={open} />
        )}

        <ProjectPill title={PROJECT} count={count} view={view} onToggleView={() => setView((v) => (v === 'desk' ? 'list' : 'desk'))} />
        <SharePill onHelp={() => setHelp(true)} />
        <BottomBar
          onCreate={create}
          onImport={(files) => doImport(files)}
          newMenuOpen={newMenu}
          onNewMenuOpenChange={setNewMenu}
          linksPanel={linksUi.panel}
          onLinksPanel={() => links.setUi({ panel: !linksUi.panel })}
          rules={rules}
          onRulesChange={setRules}
          onHelp={() => setHelp(true)}
        />
        {view === 'desk' && (
          <div className="bureau__corner">
            <ZoomControl store={store} />
            <Minimap store={store} />
          </div>
        )}
      </main>

      {openId && openPaper && (
        <OpenSheet
          handle={sheetRef}
          store={store}
          paper={openPaper}
          level={full ? 3 : 2}
          onExpand={expand}
          onReduce={reduce}
          onRepose={toDesk}
          onBureau={toDesk}
          onConvert={(id) => {
            toDesk();
            convertToEditable(store, id, announceRef.current);
          }}
          onOpenPaper={(id) => openAt(id, 2)}
        />
      )}
      {newForm && (
        <NewFormDialog
          isOpen
          onOpenChange={(o) => !o && setNewForm(null)}
          sheets={sheetRefs(store)}
          initialSheetId={newForm.sheetId}
          onCreate={createForm}
        />
      )}
      <LinksUI resolver={links} store={store} />
      <ShortcutsDialog isOpen={help} onOpenChange={setHelp} />
      <ToastRegion />
    </div>
  );
}

/** Height of a paper's kind tab on screen (`.paper-tab`: 22 px, scaled by clamp(1, 1 / zoom, 2.6)). */
const tabHeightOnScreen = (zoom: number) => 22 * Math.min(Math.max(zoom, 1), 2.6 * zoom);

/** Exposes the desk's live-region `announce` to callbacks outside the canvas. */
function AnnounceBridge({ target }: { target: React.MutableRefObject<(m: string) => void> }) {
  const { announce } = useDesk();
  useEffect(() => {
    target.current = announce;
  }, [announce, target]);
  return null;
}

function ContextMenu({
  at,
  ids,
  store,
  onClose,
  onOpen,
  onRemove,
}: {
  at: { x: number; y: number };
  ids: string[];
  store: Bureau;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRemove: (ids: string[]) => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const single = ids.length === 1 ? ids[0]! : null;
  return (
    <>
      <span ref={anchor} className="context-anchor" style={{ left: at.x, top: at.y }} data-desk-ui />
      {ready && (
        <MenuPopover triggerRef={anchor} isOpen onOpenChange={(o) => !o && onClose()} placement="bottom start">
          <Menu
            aria-label="Actions"
            autoFocus="first"
            onAction={(key) => {
              if (key === 'open' && single) onOpen(single);
              if (key === 'front') store.bringToFront(ids);
              if (key === 'arrange') store.distribute(ids);
              if (key === 'all') store.selectAll();
              if (key === 'fit') store.zoomToFit(ids.length ? ids : undefined);
              if (key === 'remove') onRemove(ids);
              onClose();
            }}
          >
            {single ? <MenuItem id="open" icon="expand" shortcut="Entrée">Ouvrir sur place</MenuItem> : null}
            {ids.length > 0 ? <MenuItem id="front" icon="layout">Mettre au premier plan</MenuItem> : null}
            {ids.length > 1 ? <MenuItem id="arrange" icon="grid">Ranger en ligne</MenuItem> : null}
            <MenuItem id="fit" icon="search" shortcut="0">{ids.length ? 'Zoomer sur la sélection' : 'Tout voir'}</MenuItem>
            <MenuItem id="all" icon="check" shortcut="Ctrl+A">Tout sélectionner</MenuItem>
            {ids.length > 0 ? <MenuSeparator /> : null}
            {ids.length > 0 ? <MenuItem id="remove" icon="trash" shortcut="Suppr">Retirer du bureau</MenuItem> : null}
          </Menu>
        </MenuPopover>
      )}
    </>
  );
}
