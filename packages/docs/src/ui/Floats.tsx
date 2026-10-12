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
import { Button, Icon, Menu, MenuItem, MenuPopover, MenuTrigger, Popover, toast, Toolbar, ToolbarSeparator, ToolButton } from '@oel/emboss';
import type { ChartSpec } from '@oel/charts';
import { CopyChartBar } from '@oel/charts/ui';
import { LinkedCopyBar } from '@oel/collab-client';
import { STATE_LABEL, linkHost, onLinkHost } from '@oel/links';
import { TEXT_COLORS } from '../model/format';
import { LINKED_EDIT_EVENT, type LinkedEditDetail } from '../extensions/linkedTables';
import { Swatches } from './DocsToolbar';
import { messages, tr } from '@oel/i18n';

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

/**
 * Where the bars are mounted: inside the editor's scrolling canvas, not on `document.body`.
 * In the desk the open document is a react-aria modal, which makes everything outside it
 * inert: a bar on the body can't take focus and a click on it counts as a click outside.
 * The bars keep `position: fixed` (no ancestor of the canvas is transformed).
 */
const floatRoot = (scroller: HTMLElement | null) => scroller ?? document.body;

const placed = (at: { left: number; top: number } | null) => (at ? { left: at.left, top: at.top } : { visibility: 'hidden' as const });

/**
 * Small floating bar over the table that holds the caret: rows, columns,
 * merge, cell fill and deletes. It floats above the table (inside its top
 * edge when there is no room) so the page never moves; the same actions are
 * in the right-click menu.
 */
export function TableFloat({ editor, scroller, onSend }: { editor: Editor; scroller: HTMLElement | null; onSend?: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const at = useFloatAbove(editor, scroller, bar, () => {
    if (!editor.isActive('table')) return null;
    const dom = editor.view.domAtPos(editor.state.selection.from).node;
    return (dom instanceof HTMLElement ? dom : dom.parentElement)?.closest('table') ?? null;
  });
  const chain = () => editor.chain().focus();
  // A linked table (Figma I2): values and rows come from the sheet; its look is the document's to change.
  const oid = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const $from = e.state.selection.$from;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') return ($from.node(d).attrs.oid as string | null) ?? null;
      return null;
    },
  });
  const host = useSyncExternalStore(onLinkHost, linkHost, linkHost);
  const copyJson = useSyncExternalStore(host.subscribe, () => JSON.stringify(oid ? host.copyOf(oid) : null), () => 'null');
  const copy = JSON.parse(copyJson) as ReturnType<typeof host.copyOf>;
  const fill = (
    <DialogTrigger>
      <ToolButton icon="fill-color" label={tr('Fond de cellule', 'Cell fill')} />
      <Popover placement="bottom">
        <Dialog aria-label={tr('Fond de cellule', 'Cell fill')} className="oel-popover-dialog">
          {({ close }) => <Swatches colors={TEXT_COLORS} none={tr('Aucun fond', 'No fill')} onPick={(c) => (chain().setCellAttribute('background', c).run(), close())} />}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
  if (copy)
    return createPortal(
      <div ref={bar} className="oel-docfloat" style={placed(at)}>
        <LinkedCopyBar
          label={tr('Tableau lié', 'Linked table')}
          link={{
            source: copy.source,
            stateLabel: copy.frozen ? tr('Figé', 'Frozen') : STATE_LABEL[copy.state],
            stale: copy.state === 'stale',
            frozen: copy.frozen,
            onSource: () => void (host.openSource(copy.linkId) || toast({ title: tr('Source introuvable', 'Source not found'), description: tr('Le tableur n’est pas sur ce bureau.', 'The spreadsheet is not on this desk.'), tone: 'warning' })),
            onUpdate: () => host.update(copy.linkId),
            onManage: (r) => host.manage(copy.linkId, r),
          }}
        >
          <MenuTrigger>
            <ToolButton icon="palette" label={tr('Mise en forme', 'Formatting')} showLabel description={tr('Thème du tableur ou du document', 'Spreadsheet or document theme')} />
            <MenuPopover placement="bottom start">
              <Menu aria-label={tr('Mise en forme', 'Formatting')} onAction={(k) => host.setLinkOptions(copy.linkId, { theme: k as 'source' | 'target' })}>
                <MenuItem id="source" textValue={tr('Thème du tableur', 'Spreadsheet theme')}>{(copy.theme ?? 'source') === 'source' ? '✓ ' : '\u2003'}{tr('Thème du tableur', 'Spreadsheet theme')}</MenuItem>
                <MenuItem id="target" textValue={tr('Thème du document', 'Document theme')}>{copy.theme === 'target' ? '✓ ' : '\u2003'}{tr('Thème du document', 'Document theme')}</MenuItem>
              </Menu>
            </MenuPopover>
          </MenuTrigger>
          {fill}
        </LinkedCopyBar>
      </div>,
      floatRoot(scroller),
    );
  return createPortal(
    <div ref={bar} className="oel-tablefloat" style={placed(at)} onMouseDown={(e) => e.preventDefault()}>
      <Toolbar aria-label={tr('Tableau', 'Table')} appearance="pill">
        <ToolButton icon="table-rows" label={tr('Insérer une ligne au-dessus', 'Insert row above')} onPress={() => chain().addRowBefore().run()} />
        <ToolButton icon="table-rows" label={tr('Insérer une ligne en dessous', 'Insert row below')} onPress={() => chain().addRowAfter().run()} />
        <ToolButton icon="insert-col" label={tr('Insérer une colonne à gauche', 'Insert column left')} onPress={() => chain().addColumnBefore().run()} />
        <ToolButton icon="insert-col" label={tr('Insérer une colonne à droite', 'Insert column right')} onPress={() => chain().addColumnAfter().run()} />
        <ToolbarSeparator />
        <ToolButton icon="merge" label={tr('Fusionner / scinder les cellules', 'Merge / split cells')} onPress={() => chain().mergeOrSplit().run()} />
        <DialogTrigger>
          <ToolButton icon="fill-color" label={tr('Fond de cellule', 'Cell fill')} />
          <Popover placement="bottom">
            <Dialog aria-label={tr('Fond de cellule', 'Cell fill')} className="oel-popover-dialog">
              {({ close }) => <Swatches colors={TEXT_COLORS} none={tr('Aucun fond', 'No fill')} onPick={(c) => (chain().setCellAttribute('background', c).run(), close())} />}
            </Dialog>
          </Popover>
        </DialogTrigger>
        <ToolButton icon="table" label={tr('Envoyer vers un tableur…', 'Send to a spreadsheet…')} description={tr('Le tableur commandera les valeurs ; ce tableau en deviendra une copie liée.', 'The spreadsheet will lead the values; this table will become a linked copy.')} onPress={() => onSend?.()} />
        <ToolbarSeparator />
        <MenuTrigger>
          <ToolButton icon="trash" label={tr('Supprimer…', 'Delete…')} />
          <MenuPopover placement="bottom end">
            <Menu
              aria-label={tr('Supprimer', 'Delete')}
              onAction={(k) => {
                if (k === 'row') chain().deleteRow().run();
                if (k === 'col') chain().deleteColumn().run();
                if (k === 'table') chain().deleteTable().run();
              }}
            >
              <MenuItem id="row">{tr('Supprimer la ligne', 'Delete row')}</MenuItem>
              <MenuItem id="col">{tr('Supprimer la colonne', 'Delete column')}</MenuItem>
              <MenuItem id="table">{tr('Supprimer le tableau', 'Delete table')}</MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
      </Toolbar>
    </div>,
    floatRoot(scroller),
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
    const txn = editor.state.tr.setNodeMarkup(s.from, undefined, { ...s.node.attrs, chart: fn(s.node.attrs.chart as ChartSpec) });
    editor.view.dispatch(txn.setSelection(NodeSelection.create(txn.doc, s.from)));
    if (copy && !copy.frozen && copy.carries === 'chart') {
      // After the edit reaches the Y.Doc, so the next update keeps it.
      setTimeout(() => host.setCarries(copy.linkId, 'chart-data'));
      toast({ title: tr('Style propre à cette copie', 'Style of this copy only'), description: tr('Les données suivent toujours la source ; le style choisi ici est gardé.', 'The data always follows the source; the style chosen here is kept.'), tone: 'info' });
    }
  };
  const lock = !editable ? tr('Lecture seule', 'Read-only') : !oid ? tr('Graphique du fichier Word : affiché et conservé, pas encore modifiable.', 'Chart from the Word file: shown and kept, not editable yet.') : undefined;
  return createPortal(
    <div ref={bar} className="oel-docfloat" style={placed(at)}>
      <CopyChartBar
        spec={node.chart}
        apply={apply}
        lockReason={lock}
        link={
          copy && {
            source: copy.source,
            stateLabel: copy.frozen ? tr('Figé', 'Frozen') : STATE_LABEL[copy.state],
            stale: copy.state === 'stale',
            frozen: copy.frozen,
            onSource: () => void (host.openSource(copy.linkId) || toast({ title: tr('Source introuvable', 'Source not found'), description: tr('Le fichier source n’est pas sur ce bureau.', 'The source file is not on this desk.'), tone: 'warning' })),
            onUpdate: () => host.update(copy.linkId),
            onManage: (r) => host.manage(copy.linkId, r),
          }
        }
      />
    </div>,
    floatRoot(scroller),
  );
}

export interface PictureActions {
  /** Opens the retouch panel (L3); `crop`: straight into the crop frame. Absent: no image engine here. */
  onRetouch?: (crop: boolean) => void;
  onReplace: () => void;
  onAlt: () => void;
}

/**
 * The bar over a selected picture (Figma L3), one toolbar: Retoucher · Recadrer · Remplacer ·
 * Habillage · Texte alternatif, then for a linked copy (Figma I1) where it comes from,
 * « Mettre à jour » when it's behind and the link popover.
 */
export function PictureFloat({ editor, scroller, editable, actions }: { editor: Editor; scroller: HTMLElement | null; editable: boolean; actions: PictureActions }) {
  const bar = useRef<HTMLDivElement>(null);
  const oid = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = e.state.selection;
      return s instanceof NodeSelection && s.node.type.name === 'image' ? ((s.node.attrs.oid as string | null) ?? null) : null;
    },
  });
  const host = useSyncExternalStore(onLinkHost, linkHost, linkHost);
  const copyJson = useSyncExternalStore(host.subscribe, () => JSON.stringify(oid ? host.copyOf(oid) : null), () => 'null');
  const copy = JSON.parse(copyJson) as ReturnType<typeof host.copyOf>;
  const at = useFloatAbove(editor, scroller, bar, () => {
    const s = editor.state.selection;
    return s instanceof NodeSelection && s.node.type.name === 'image' ? (editor.view.nodeDOM(s.from) as Element | null) : null;
  });
  const ro = editable ? undefined : tr('Lecture seule', 'Read-only');
  const noEngine = actions.onRetouch ? undefined : tr('La retouche n’est pas disponible ici.', 'Retouching is not available here.');
  const tools = (
    <>
      <ToolButton icon="palette" label={tr('Retoucher', 'Retouch')} showLabel unavailableReason={ro ?? noEngine} onPress={() => actions.onRetouch?.(false)} />
      <ToolButton icon="crop" label={tr('Recadrer', 'Crop')} unavailableReason={ro ?? noEngine} onPress={() => actions.onRetouch?.(true)} />
      <ToolButton icon="refresh" label={tr('Remplacer', 'Replace')} unavailableReason={ro} onPress={actions.onReplace} />
      <ToolButton icon="wrap-text" label={tr('Habillage', 'Text wrapping')} unavailableReason={tr('Changer l’habillage arrive bientôt ; les images flottantes gardent leur position à l’export.', 'Changing the wrapping comes soon; floating images keep their position on export.')} />
      <ToolButton icon="text-block" label={tr('Texte alternatif', 'Alt text')} unavailableReason={ro} onPress={actions.onAlt} />
    </>
  );
  return createPortal(
    <div ref={bar} className="oel-docfloat" style={placed(at)}>
      {copy ? (
        <LinkedCopyBar
          label={tr('Image liée', 'Linked image')}
          link={{
            source: copy.source,
            stateLabel: copy.frozen ? tr('Figé', 'Frozen') : STATE_LABEL[copy.state],
            stale: copy.state === 'stale',
            frozen: copy.frozen,
            onSource: () => void (host.openSource(copy.linkId) || toast({ title: tr('Source introuvable', 'Source not found'), description: tr('L’image source n’est pas sur ce bureau.', 'The source image is not on this desk.'), tone: 'warning' })),
            onUpdate: () => host.update(copy.linkId),
            onManage: (r) => host.manage(copy.linkId, r),
          }}
        >
          {tools}
        </LinkedCopyBar>
      ) : (
        // Same look and same guards as the linked bar: the picture stays selected while a tool is pressed.
        <div className="oel-chart-bar" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} onKeyDown={(e) => e.stopPropagation()}>
          <Toolbar aria-label="Image">{tools}</Toolbar>
        </div>
      )}
    </div>,
    floatRoot(scroller),
  );
}

/**
 * Why a value in a linked table can't be typed here (Figma I2): it comes from
 * the sheet. Offers to edit it there, or to unlink the table and edit here.
 */
export function LinkedEditNotice({ editor, root }: { editor: Editor; root: HTMLElement | null }) {
  const [hit, setHit] = useState<(LinkedEditDetail & { x: number; y: number }) | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!root) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<LinkedEditDetail>).detail;
      const c = editor.view.coordsAtPos(Math.min(d.pos, editor.state.doc.content.size));
      setHit({ ...d, x: c.left, y: c.bottom });
    };
    root.addEventListener(LINKED_EDIT_EVENT, on);
    return () => root.removeEventListener(LINKED_EDIT_EVENT, on);
  }, [editor, root]);
  if (!hit) return null;
  const close = () => (setHit(null), editor.commands.focus());
  return (
    <>
      <span ref={anchor} style={{ position: 'fixed', left: hit.x, top: hit.y, width: 1, height: 1, pointerEvents: 'none' }} aria-hidden />
      <Popover triggerRef={anchor as RefObject<HTMLSpanElement>} isOpen onOpenChange={(o) => !o && close()} placement="bottom start">
        <Dialog aria-label={tr('Valeurs liées', 'Linked values')} className="oel-popover-dialog oel-linked-edit">
          <p className="oel-linked-edit__title">
            <Icon name="lock" size={16} aria-hidden /> Ces valeurs viennent de {hit.source}
          </p>
          <p className="oel-linked-edit__body">{tr('Elles se modifient dans le tableur. La mise en forme, elle, se change ici et reste propre à ce document.', 'They are edited in the spreadsheet. Formatting is changed here and stays with this document.')}</p>
          <div className="oel-linked-edit__actions">
            <Button size="sm" onPress={() => (linkHost().openSource(hit.linkId), setHit(null))}>
              {tr('Modifier dans le tableur', 'Edit in the spreadsheet')}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => (linkHost().unlink(hit.linkId), close())}>
              {tr('Délier et modifier', 'Unlink and edit')}
            </Button>
          </div>
        </Dialog>
      </Popover>
    </>
  );
}
