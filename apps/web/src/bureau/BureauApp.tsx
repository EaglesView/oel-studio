import { useEffect, useMemo, useRef, useState } from 'react';
import { createDesk } from '@oel/desk';
import { DeskCanvas, Minimap, useDesk, useDeskState } from '@oel/desk/react';
import '@oel/desk/desk.css';
import {
  Badge,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  NavItem,
  Sidebar,
  ToastRegion,
  toast,
} from '@oel/emboss';
import { ContextToolbar } from './ContextToolbar';
import { Dock, PresenceCursors, ProjectPill, SharePill, ZoomControl, type ArrivalRules } from './Chrome';
import { ListView } from './ListView';
import { blankPaper, describePaper, kindLabel, type Bureau, type Paper as PaperNode, type PaperData, type PaperKind } from './model';
import { OpenSheet } from './OpenSheet';
import { Paper, PaperPile } from './Paper';
import { SEED_LINKS, SEED_PAPERS } from './seed';
import { ShortcutsDialog } from './ShortcutsDialog';
import { convertToEditable, importFiles } from './importFiles';
import './bureau.css';

const PROJECT = 'Lancement automne 2026';

/**
 * 05 · Bureau (projet multimodal). An infinite desk where every file of a
 * project lies side by side as real paper. Selecting shows a contextual
 * toolbar; double-click / Enter opens the paper in place (B4).
 */
export function BureauApp() {
  const store = useMemo<Bureau>(() => {
    const desk = createDesk<PaperData>({ nodes: SEED_PAPERS, links: SEED_LINKS, viewport: { x: 0, y: 40, zoom: 0.9 } });
    return desk;
  }, []);
  const [view, setView] = useState<'desk' | 'list'>('desk');
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [help, setHelp] = useState(false);
  const [rules, setRules] = useState<ArrivalRules>({ sortByType: false, ocr: true, linkTables: true });
  const [menu, setMenu] = useState<{ ids: string[]; at: { x: number; y: number } } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const announceRef = useRef<(m: string) => void>(() => {});

  const count = useDeskState(store, (s) => s.order.length);
  const openId = useDeskState(store, (s) => s.openId);
  const showLinks = useDeskState(store, (s) => s.showLinks);
  const openPaper = useDeskState(store, (s) => (s.openId ? (s.nodes[s.openId] as PaperNode | undefined) : undefined));

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

  const open = (id: string) => store.open(id);
  const create = (kind: PaperKind) => {
    const p = blankPaper(kind, store.viewCenter());
    store.add([p]);
    announceRef.current(`${kindLabel(kind)} créé au centre de la vue`);
    if (kind !== 'note') setTimeout(() => store.open(p.id), 50);
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.dock input[type=file]')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="bureau">
      <Sidebar collapsed={navCollapsed} onToggle={() => setNavCollapsed((c) => !c)}>
        <NavItem icon="home" label="Accueil" href="/" collapsed={navCollapsed} />
        <NavItem icon="folder" label="Bureau" href="/bureau" current count={count} collapsed={navCollapsed} />
        <NavItem icon="grid" label="Composants" href="/composants" collapsed={navCollapsed} />
      </Sidebar>

      <main id="contenu" className="bureau__main">
        {view === 'desk' ? (
          <DeskCanvas<PaperData>
            store={store}
            label={`Bureau du projet ${PROJECT}`}
            describeNode={(n) => describePaper(n as PaperNode)}
            renderNode={(n, ctx) => <Paper node={n as PaperNode} ctx={ctx} />}
            pileLabel={(k) => kindLabel(k)}
            renderPile={(pile, nodes) => <PaperPile pile={pile} nodes={nodes as PaperNode[]} />}
            renderGroupLabel={(nodes) => {
              const kinds = new Set(nodes.map((n) => n.kind)).size;
              return `${nodes.length} fichiers · ${kinds} type${kinds > 1 ? 's' : ''}`;
            }}
            onOpen={open}
            onDelete={remove}
            onContextMenu={(ids, at) => setMenu({ ids, at })}
            onDropFiles={(files, at) => doImport(files, at)}
            renderDropZone={(n) => (
              <div className="dropzone">
                <Badge tone="accent" dot={false}>{n}</Badge>
                <strong>Déposez pour ajouter au projet</strong>
                <span>PDF, Word, PowerPoint, Excel, images · 100 Mo max</span>
              </div>
            )}
            onKeyDown={(e, s) => {
              if (e.key === '/' && toolbarRef.current) {
                toolbarRef.current.querySelector<HTMLElement>('button')?.focus();
                return true;
              }
              if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && s.getState().selection.length === 1) {
                toolbarRef.current?.querySelector<HTMLElement>('[aria-label="Commenter"]')?.click();
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
            <ContextToolbar store={store} onOpen={open} onConvert={(id) => convertToEditable(store, id, announceRef.current)} toolbarRef={toolbarRef} />
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
        <Dock
          onCreate={create}
          onImport={(files) => doImport(files)}
          showLinks={showLinks}
          onToggleLinks={() => store.toggleLinks()}
          rules={rules}
          onRulesChange={setRules}
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
          store={store}
          paper={openPaper}
          onClose={() => store.open(null)}
          onConvert={(id) => {
            store.open(null);
            convertToEditable(store, id, announceRef.current);
          }}
        />
      )}
      <ShortcutsDialog isOpen={help} onOpenChange={setHelp} />
      <ToastRegion />
    </div>
  );
}

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
