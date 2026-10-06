import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createDesk } from '@oel/desk';
import { DeskCanvas, Minimap, useDesk, useDeskState, type PickTarget } from '@oel/desk/react';
import '@oel/desk/desk.css';
import {
  Badge,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  SubmenuTrigger,
  ToastRegion,
  toast,
} from '@oel/emboss';
import { AppMenu, type MenuPane } from './AppMenu';
import { ContextToolbar, type NoteActions } from './ContextToolbar';
import { BottomBar, EmptyDesk, NEW_KINDS, PresenceCursors, ProjectPill, SharePill, ZoomControl, type ArrivalRules } from './Chrome';
import { ListView } from './ListView';
import { KIND_TAB, RESIZE_MODE, blankPaper, describePaper, kindLabel, type Bureau, type Paper as PaperNode, type PaperData, type PaperKind } from './model';
import { OpenSheet, type OpenSheetHandle } from './OpenSheet';
import { Paper, type NoteEditing } from './Paper';
import { migrateNote, startsNoteText } from './notes';
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
import { ProjectProvider, useProject, useSetting } from '../project/ProjectContext';
import { bindImages, createGallery } from './images';
import './bureau.css';

/** Furthest you can zoom out: papers are small thumbnails, never piles or a full overview. */
const MAX_ZOOM_OUT = 0.25;

/**
 * 05 · Bureau (projet multimodal). An infinite desk where every file of a
 * project lies side by side as real paper. Selecting shows a contextual
 * toolbar; double-click / Enter opens the paper in place (B4).
 */
export function BureauApp() {
  return (
    <ProjectProvider>
      <BureauDesk />
    </ProjectProvider>
  );
}

function BureauDesk() {
  const project = useProject();
  const store = useMemo<Bureau>(() => {
    const desk = createDesk<PaperData>({
      nodes: SEED_PAPERS.map(migrateNote),
      viewport: { x: 0, y: 40, zoom: 0.9 },
      zoom: { min: MAX_ZOOM_OUT, max: 4 },
    });
    return desk;
  }, []);
  const [view, setView] = useState<'desk' | 'list'>('desk');
  /** K2 · the note being written on the desk (one undo step per writing session). */
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const noteStart = useRef<{ id: string; text: string } | null>(null);
  const noteText = (id: string) => {
    const p = store.node(id)?.data.preview;
    return p?.kind === 'note' ? p.text : '';
  };
  const setNoteText = (id: string, text: string) => {
    const n = store.node(id);
    if (n) store.update(id, { data: { ...n.data, preview: { kind: 'note', text } } }, { history: false });
  };
  const editNote = (id: string, typed = '') => {
    if (store.node(id)?.kind !== 'note' || editingNote === id) return;
    setView('desk');
    store.select([id]);
    store.focus(id);
    store.begin(`Note « ${store.node(id)!.title} »`);
    noteStart.current = { id, text: noteText(id) };
    if (typed) setNoteText(id, noteText(id) + typed);
    setEditingNote(id);
  };
  const noteEditing = useMemo<NoteEditing | null>(() => {
    if (!editingNote) return null;
    const id = editingNote;
    return {
      onText: (text) => setNoteText(id, text),
      onHeight: (h) => store.update(id, { h: Math.ceil(h) }, { history: false }),
      onDone: () => {
        const n = store.node(id);
        if (n && noteStart.current?.id === id && noteText(id) !== noteStart.current.text) {
          store.update(id, { data: { ...n.data, editor: project.me.initials, updatedAt: Date.now() } }, { history: false });
        }
        store.end();
        noteStart.current = null;
        setEditingNote(null);
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNote, store, project.me.initials]);

  /* K1 · notes collées: stick to the item underneath, pick one (« Coller à… »), or unstick. */
  const [pickFor, setPickFor] = useState<string | null>(null);
  const titleOf = (id: string) => store.node(id)?.title ?? '';
  const stuckToast = (id: string, to: string) =>
    toast({ title: `Note collée à « ${titleOf(to)} »`, tone: 'success', action: { label: 'Annuler', onAction: () => store.undo() } });
  const notes: NoteActions = {
    stick: (id) => {
      const under = store.overlapping(id, isStickTarget);
      if (!under) return setPickFor(id);
      if (store.attach(id, under.id)) stuckToast(id, under.id);
    },
    stickTo: (id) => setPickFor(id),
    unstick: (id) => {
      if (!store.detach([id]).length) return;
      toast({ title: 'Note décollée', tone: 'info', action: { label: 'Annuler', onAction: () => store.undo() } });
    },
  };
  const pickTarget = useMemo<PickTarget<PaperData> | null>(
    () =>
      pickFor
        ? {
            from: pickFor,
            filter: isStickTarget,
            onPick: (to) => {
              setPickFor(null);
              if (store.attach(pickFor, to, stickSpot(store, pickFor, to))) {
                stuckToast(pickFor, to);
                store.select([pickFor]);
                store.focus(pickFor);
              }
            },
            onCancel: () => setPickFor(null),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickFor, store],
  );
  /** The bottom bar's « + » menu (M1), opened by Alt + N too. */
  const [newMenu, setNewMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const sortByType = useSetting('import.sortByType');
  const ocr = useSetting('import.ocr');
  const linkTables = useSetting('import.linkTables');
  const rules: ArrivalRules = { sortByType: sortByType.value, ocr: ocr.value, linkTables: linkTables.value };
  const setRules = (r: ArrivalRules) => {
    const failed = (e: unknown) => toast({ title: 'Réglage non appliqué', description: e instanceof Error ? e.message : String(e), tone: 'danger' });
    if (r.sortByType !== rules.sortByType) sortByType.set(r.sortByType).catch(failed);
    if (r.ocr !== rules.ocr) ocr.set(r.ocr).catch(failed);
    if (r.linkTables !== rules.linkTables) linkTables.set(r.linkTables).catch(failed);
  };
  /** M2 · the logo's full-screen menu: open, on which pane, growing from where. */
  const [appMenu, setAppMenu] = useState<{ open: boolean; pane: MenuPane; origin: { x: number; y: number } | null }>({
    open: false,
    pane: 'home',
    origin: null,
  });
  const openMenu = (pane: MenuPane, origin: { x: number; y: number } | null) => setAppMenu({ open: true, pane, origin });
  const [minimap, setMinimap] = useState(true);
  const [menu, setMenu] = useState<{ ids: string[]; at: { x: number; y: number } } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<OpenSheetHandle>(null);
  const [full, setFull] = useState(false);
  const announceRef = useRef<(m: string) => void>(() => {});
  const announce = useCallback((m: string) => announceRef.current(m), []);
  /** E2 · 1 « Nouveau formulaire » (from the « + » menu, or from a selected spreadsheet). */
  const [newForm, setNewForm] = useState<{ sheetId: string | null } | null>(null);
  useFormSync(store, formsBackend, announce);
  // Figma L: recipes mirrored on papers, desk pictures re-rendered, galleries kept in step.
  useEffect(() => bindImages(store), [store]);

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
  const linksVersion = useSyncExternalStore(links.subscribe, () => links.version, () => links.version);
  /** Late threads put a dot on the logo (M3). */
  const lateLinks = useMemo(() => links.all().filter((l) => l.state === 'stale').length, [links, linksVersion]);
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
    // K2 · a note never opens: Entrée, double-click or « Écrire » write in it on the desk.
    if (store.node(id)?.kind === 'note') return editNote(id);
    // L1 · an image (or a gallery) opens straight in the atelier (plein écran).
    if (store.node(id)?.kind === 'image' || store.node(id)?.kind === 'gallery') level = 3;
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
    // The atelier has no « ouvert sur place »: Échap goes back to the desk.
    if (store.node(id)?.kind === 'image' || store.node(id)?.kind === 'gallery') return toDesk();
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
    // A new note is written straight away, on the desk (K2); other files open in place.
    setTimeout(() => (kind === 'note' ? editNote(p.id) : openAt(p.id, 2)), 50);
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
  /** Show a file on the desk (from the menu's lists). */
  const reveal = (id: string) => {
    setView('desk');
    store.select([id]);
    store.focus(id);
    requestAnimationFrame(() => store.reveal(id));
  };
  const remove = (ids: string[]) => {
    const n = ids.length;
    const freed = store.remove(ids);
    toast({
      title: n > 1 ? `${n} fichiers retirés du bureau` : 'Fichier retiré du bureau',
      // K « Le fichier est supprimé »: its notes stay on the desk, unstuck.
      description: freed.length ? (freed.length > 1 ? `${freed.length} notes décollées` : '1 note décollée') : undefined,
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
            label={`Bureau du projet ${project.name}`}
            describeNode={(n) => describePaper(n as PaperNode)}
            renderNode={(n, ctx) => <Paper node={n as PaperNode} ctx={ctx} editing={n.id === editingNote ? noteEditing : null} />}
            selectionOverhang={(n, zoom) => (KIND_TAB[n.kind as PaperKind] ? tabHeightOnScreen(zoom) - 4 : 0)}
            resizeMode={(n) => RESIZE_MODE[n.kind as PaperKind] ?? 'aspect'}
            canContain={(c, n) => c.kind === 'gallery' && n.kind === 'image'}
            renderGroupLabel={(nodes) => {
              const kinds = new Set(nodes.map((n) => n.kind)).size;
              return `${nodes.length} fichiers · ${kinds} type${kinds > 1 ? 's' : ''}`;
            }}
            onOpen={open}
            onDelete={remove}
            onContextMenu={(ids, at) => setMenu({ ids, at })}
            pickTarget={pickTarget}
            onMoveEnd={(ids, { altKey }) => {
              // K1 · Alt + lâcher une note sur un fichier l'y colle.
              const id = ids.length === 1 ? ids[0]! : null;
              const n = id ? store.node(id) : undefined;
              if (!altKey || !id || n?.kind !== 'note' || n.attach) return;
              const under = store.overlapping(id, isStickTarget);
              if (under && store.attach(id, under.id)) stuckToast(id, under.id);
            }}
            onDetach={() => toast({ title: 'Note décollée', tone: 'info', action: { label: 'Annuler', onAction: () => store.undo() } })}
            onDropFiles={(files, at) => doImport(files, at)}
            onLinkOpen={(id, anchor) => links.manage(id.replace(THREAD_PREFIX, ''), deskToViewport(anchor))}
            onLinkDelete={(id) => links.setUi({ cut: id.replace(THREAD_PREFIX, '') })}
            activeLinkId={linksUi.popover ? THREAD_PREFIX + linksUi.popover.linkId : null}
            renderEmpty={() => <EmptyDesk onCreate={create} onImport={(files) => doImport(files)} />}
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
              {
                const sel = store.getState().selection;
                const only = sel.length === 1 ? store.node(sel[0]!) : undefined;
                // K1 · P sticks (or unsticks) the selected note, Maj + P picks where.
                if (only?.kind === 'note' && e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  if (e.shiftKey) notes.stickTo(only.id);
                  else if (only.attach) notes.unstick(only.id);
                  else notes.stick(only.id);
                  return true;
                }
                // K2 · typing on a selected note starts writing with that character.
                if (only?.kind === 'note' && startsNoteText(e)) {
                  editNote(only.id, e.key);
                  return true;
                }
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
              notes={notes}
              onRemove={remove}
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
                onCreate={create}
                notes={notes}
                onRetouch={(ids) => {
                  // L2 · « Modifier les images (N) » : a gallery around them, opened in the atelier.
                  const id = ids.length > 1 ? createGallery(store, ids) : ids[0];
                  if (id) openAt(id, 3);
                }}
              />
            )}
          </DeskCanvas>
        ) : (
          <ListView store={store} onOpen={open} />
        )}

        <ProjectPill
          title={project.name}
          count={count}
          view={view}
          onToggleView={() => setView((v) => (v === 'desk' ? 'list' : 'desk'))}
          onProjects={() => openMenu('projects', { x: 60, y: 40 })}
        />
        <SharePill />
        <BottomBar
          onCreate={create}
          onImport={(files) => doImport(files)}
          newMenuOpen={newMenu}
          onNewMenuOpenChange={setNewMenu}
          menuOpen={appMenu.open}
          onMenu={(origin) => openMenu('home', origin)}
          lateLinks={lateLinks}
        />
        {view === 'desk' && (
          <div className="bureau__corner">
            <ZoomControl store={store} />
            {minimap && <Minimap store={store} />}
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
      <AppMenu
        isOpen={appMenu.open}
        onOpenChange={(o) => setAppMenu((m) => ({ ...m, open: o }))}
        pane={appMenu.pane}
        onPaneChange={(pane) => setAppMenu((m) => ({ ...m, pane }))}
        origin={appMenu.origin}
        project={project.name}
        store={store}
        onCreate={create}
        onImport={(files) => doImport(files)}
        onReveal={reveal}
        onLinksPanel={() => links.setUi({ panel: true })}
        lateLinks={lateLinks}
        rules={rules}
        onRulesChange={setRules}
        view={view}
        onViewChange={setView}
        minimap={minimap}
        onMinimapChange={setMinimap}
      />
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
  onCreate,
  notes,
  onRetouch,
}: {
  notes: NoteActions;
  /** Images only: open the atelier (one) or make a gallery of them (several). */
  onRetouch: (ids: string[]) => void;
  at: { x: number; y: number };
  ids: string[];
  store: Bureau;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRemove: (ids: string[]) => void;
  onCreate: (kind: PaperKind) => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const single = ids.length === 1 ? ids[0]! : null;
  const singleNode = single ? store.node(single) : undefined;
  // L2 · only when the selection is images and nothing else.
  const images = ids.length > 0 && ids.every((id) => store.node(id)?.kind === 'image');
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
              if (key === 'stick' && single) notes.stick(single);
              if (key === 'stick-to' && single) notes.stickTo(single);
              if (key === 'unstick' && single) notes.unstick(single);
              if (key === 'retouch') onRetouch(ids);
              onClose();
            }}
          >
            {ids.length === 0 ? (
              <SubmenuTrigger>
                <MenuItem id="new" icon="plus">Nouveau</MenuItem>
                <MenuPopover placement="end top">
                  <Menu
                    aria-label="Nouveau"
                    onAction={(key) => {
                      onCreate(key as PaperKind);
                      onClose();
                    }}
                  >
                    {NEW_KINDS.map((k) => (
                      <MenuItem key={k.kind} id={k.kind} icon={k.icon} className={`bottom-bar__kind bottom-bar__kind--${k.kind}`}>
                        {k.label}
                      </MenuItem>
                    ))}
                    <MenuItem id="note" icon="note" shortcut="N">Note</MenuItem>
                  </Menu>
                </MenuPopover>
              </SubmenuTrigger>
            ) : null}
            {ids.length === 0 ? <MenuSeparator /> : null}
            {single && singleNode?.kind === 'note' ? (
              singleNode.attach ? (
                <MenuItem id="unstick" icon="pin-slash" shortcut="P">Décoller</MenuItem>
              ) : (
                [
                  <MenuItem key="stick" id="stick" icon="pin" shortcut="P">Coller</MenuItem>,
                  <MenuItem key="stick-to" id="stick-to" icon="pin" shortcut="Maj+P">Coller à…</MenuItem>,
                ]
              )
            ) : images ? (
              <MenuItem id="retouch" icon="magic-wand">{single ? 'Retoucher l’image' : `Modifier les images (${ids.length})`}</MenuItem>
            ) : single ? (
              <MenuItem id="open" icon="expand" shortcut="Entrée">Ouvrir sur place</MenuItem>
            ) : null}
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

/** Notes stick to whole desk items, never to other notes (Figma K0). */
const isStickTarget = (n: { kind: string }) => n.kind !== 'note';

/**
 * Where « Coller à… » puts a note: over the item's top-right corner, like a
 * sticky note, staggered down the right edge when the item already has some.
 */
function stickSpot(store: Bureau, id: string, to: string): { x: number; y: number } {
  const n = store.node(id)!;
  const t = store.node(to)!;
  const i = store.attachedTo(to).filter((c) => c.id !== id).length;
  return { x: t.x + t.w - n.w * 0.6, y: t.y - 16 + i * Math.round(n.h * 0.6 + 8) };
}
