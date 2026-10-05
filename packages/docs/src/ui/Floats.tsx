/**
 * Bars that float over what the caret or selection is on (a table, a chart),
 * so the page never moves when they appear. Rendered in a portal with fixed
 * positions; they follow scrolling and stay inside the editor's viewport.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useEditorState, type Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { Menu, MenuItem, MenuPopover, MenuTrigger, Popover, toast, Toolbar, ToolbarSeparator, ToolButton } from '@oel/emboss';
import type { ChartSpec } from '@oel/charts';
import { CopyChartBar } from '@oel/charts/ui';
import { STATE_LABEL, linkHost, onLinkHost } from '@oel/links';
import { TEXT_COLORS } from '../model/format';
import { Swatches } from './DocsToolbar';

/**
 * Screen position for a bar of `bar`'s size, centred above the element
 * `target()` returns (inside its top edge when there is no room above);
 * null when there is nothing to float over or it is scrolled out of view.
 */
function useFloatAbove(editor: Editor, scroller: HTMLElement | null, bar: RefObject<HTMLElement | null>, target: () => Element | null) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const find = useRef(target);
  find.current = target;
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = editor.isDestroyed ? null : find.current();
        if (!el) return setAt(null);
        const r = el.getBoundingClientRect();
        const clip = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
        if (r.bottom < clip.top + 8 || r.top > clip.bottom - 8) return setAt(null);
        const h = bar.current?.offsetHeight ?? 40;
        const w = bar.current?.offsetWidth ?? 320;
        const top = Math.max(clip.top + 4, r.top - h - 6);
        const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, clip.left + 4), clip.right - w - 4);
        setAt((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      });
    };
    place();
    editor.on('transaction', place);
    scroller?.addEventListener('scroll', place, { passive: true });
    addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      editor.off('transaction', place);
      scroller?.removeEventListener('scroll', place);
      removeEventListener('resize', place);
    };
  }, [editor, scroller, bar]);
  return at;
}

const placed = (at: { left: number; top: number } | null) => (at ? { left: at.left, top: at.top } : { visibility: 'hidden' as const });

/**
 * Small floating bar over the table that holds the caret: rows, columns,
 * merge, cell fill and deletes. It floats above the table (inside its top
 * edge when there is no room) so the page never moves; the same actions are
 * in the right-click menu.
 */
export function TableFloat({ editor, scroller }: { editor: Editor; scroller: HTMLElement | null }) {
  const bar = useRef<HTMLDivElement>(null);
  const at = useFloatAbove(editor, scroller, bar, () => {
    if (!editor.isActive('table')) return null;
    const dom = editor.view.domAtPos(editor.state.selection.from).node;
    return (dom instanceof HTMLElement ? dom : dom.parentElement)?.closest('table') ?? null;
  });
  const chain = () => editor.chain().focus();
  return createPortal(
    <div ref={bar} className="oel-tablefloat" style={placed(at)} onMouseDown={(e) => e.preventDefault()}>
      <Toolbar aria-label="Tableau" appearance="pill">
        <ToolButton icon="table-rows" label="Insérer une ligne au-dessus" onPress={() => chain().addRowBefore().run()} />
        <ToolButton icon="table-rows" label="Insérer une ligne en dessous" onPress={() => chain().addRowAfter().run()} />
        <ToolButton icon="insert-col" label="Insérer une colonne à gauche" onPress={() => chain().addColumnBefore().run()} />
        <ToolButton icon="insert-col" label="Insérer une colonne à droite" onPress={() => chain().addColumnAfter().run()} />
        <ToolbarSeparator />
        <ToolButton icon="merge" label="Fusionner / scinder les cellules" onPress={() => chain().mergeOrSplit().run()} />
        <DialogTrigger>
          <ToolButton icon="fill-color" label="Fond de cellule" />
          <Popover placement="bottom">
            <Dialog aria-label="Fond de cellule" className="oel-popover-dialog">
              {({ close }) => <Swatches colors={TEXT_COLORS} none="Aucun fond" onPick={(c) => (chain().setCellAttribute('background', c).run(), close())} />}
            </Dialog>
          </Popover>
        </DialogTrigger>
        <ToolbarSeparator />
        <MenuTrigger>
          <ToolButton icon="trash" label="Supprimer…" />
          <MenuPopover placement="bottom end">
            <Menu
              aria-label="Supprimer"
              onAction={(k) => {
                if (k === 'row') chain().deleteRow().run();
                if (k === 'col') chain().deleteColumn().run();
                if (k === 'table') chain().deleteTable().run();
              }}
            >
              <MenuItem id="row">Supprimer la ligne</MenuItem>
              <MenuItem id="col">Supprimer la colonne</MenuItem>
              <MenuItem id="table">Supprimer le tableau</MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
      </Toolbar>
    </div>,
    document.body,
  );
}

/**
 * The bar over a selected chart (Figma G4 + H2): variant, colours, elements
 * and, on a linked copy, « Voir la source », « Mettre à jour » and the link.
 * Restyling a copy that carries the source's style switches it to « Données
 * seulement », so the next update keeps the look chosen here.
 */
export function ChartFloat({ editor, scroller, editable }: { editor: Editor; scroller: HTMLElement | null; editable: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const node = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = e.state.selection;
      return s instanceof NodeSelection && s.node.type.name === 'ooxmlInline' && s.node.attrs.chart ? { chart: s.node.attrs.chart as ChartSpec, oid: (s.node.attrs.oid as string | null) ?? null } : null;
    },
  });
  const oid = node?.oid ?? null;
  const host = useSyncExternalStore(onLinkHost, linkHost, linkHost);
  const copyJson = useSyncExternalStore(host.subscribe, () => JSON.stringify(oid ? host.copyOf(oid) : null), () => 'null');
  const copy = JSON.parse(copyJson) as ReturnType<typeof host.copyOf>;
  const at = useFloatAbove(editor, scroller, bar, () => {
    const s = editor.state.selection;
    return s instanceof NodeSelection && s.node.attrs.chart ? (editor.view.nodeDOM(s.from) as Element | null) : null;
  });
  if (!node) return null;
  const apply = (fn: (s: ChartSpec) => ChartSpec) => {
    const s = editor.state.selection;
    if (!(s instanceof NodeSelection) || !s.node.attrs.chart) return;
    const tr = editor.state.tr.setNodeMarkup(s.from, undefined, { ...s.node.attrs, chart: fn(s.node.attrs.chart as ChartSpec) });
    editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, s.from)));
    if (copy && !copy.frozen && copy.carries === 'chart') {
      // After the edit reaches the Y.Doc, so the next update keeps it.
      setTimeout(() => host.setCarries(copy.linkId, 'chart-data'));
      toast({ title: 'Style propre à cette copie', description: 'Les données suivent toujours la source ; le style choisi ici est gardé.', tone: 'info' });
    }
  };
  const lock = !editable ? 'Lecture seule' : !oid ? 'Graphique du fichier Word : affiché et conservé, pas encore modifiable.' : undefined;
  return createPortal(
    <div ref={bar} className="oel-docfloat" style={placed(at)}>
      <CopyChartBar
        spec={node.chart}
        apply={apply}
        lockReason={lock}
        link={
          copy && {
            source: copy.source,
            stateLabel: copy.frozen ? 'Figé' : STATE_LABEL[copy.state],
            stale: copy.state === 'stale',
            frozen: copy.frozen,
            onSource: () => void (host.openSource(copy.linkId) || toast({ title: 'Source introuvable', description: 'Le fichier source n’est pas sur ce bureau.', tone: 'warning' })),
            onUpdate: () => host.update(copy.linkId),
            onManage: (r) => host.manage(copy.linkId, r),
          }
        }
      />
    </div>,
    document.body,
  );
}
