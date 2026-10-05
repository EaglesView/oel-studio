/**
 * Values in a linked table come from the sheet (Figma I2, I6 §2 and §4): typing,
 * pasting, adding or removing rows inside one is refused, and the editor is
 * told so it can explain (« Modifier dans le tableur » / « Délier et
 * modifier »). Style stays editable for real: marks, cell fills and column
 * widths (attribute changes) go through, as does deleting the whole table.
 * Remote changes and link updates (y-sync) are never filtered.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { linkHost } from '@oel/links';

/** Fired on the editor's DOM when a value edit in a linked table was refused. */
export const LINKED_EDIT_EVENT = 'oel-linked-edit';
export interface LinkedEditDetail {
  linkId: string;
  source: string;
  /** Document position of the refused edit. */
  pos: number;
}

/** The linked table around a position, if any: its position, size and link. */
function linkedTableAt(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(Math.min(pos, state.doc.content.size));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'table' || !node.attrs.oid) continue;
    const copy = linkHost().copyOf(node.attrs.oid as string);
    if (!copy) return null;
    return { from: $pos.before(d), to: $pos.after(d), copy };
  }
  return null;
}

function refused(tr: Transaction, state: EditorState): { pos: number; copy: NonNullable<ReturnType<typeof linkedTableAt>>['copy'] } | null {
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep)) continue;
    const { from, to } = step as unknown as { from: number; to: number };
    const t = linkedTableAt(state, from);
    // Strictly inside the table: content changes. Covering it: deleting the copy, allowed.
    if (t && from > t.from && to < t.to) return { pos: from, copy: t.copy };
  }
  return null;
}

/** The guard as a plugin; `onRefused` hears about refused edits (the editor shows why). */
export function linkedTableGuard(onRefused: (d: LinkedEditDetail) => void = () => {}) {
  return new Plugin({
    key: new PluginKey('linkedTableGuard'),
    filterTransaction: (tr, state) => {
      if (!tr.docChanged || tr.getMeta(ySyncPluginKey) || tr.getMeta('addToHistory') === false) return true;
      const hit = refused(tr, state);
      if (!hit) return true;
      onRefused({ linkId: hit.copy.linkId, source: hit.copy.source, pos: hit.pos });
      return false;
    },
  });
}

export const LinkedTableGuard = Extension.create({
  name: 'linkedTableGuard',
  addProseMirrorPlugins() {
    return [linkedTableGuard((detail) => this.editor?.view?.dom?.dispatchEvent(new CustomEvent<LinkedEditDetail>(LINKED_EDIT_EVENT, { bubbles: true, detail })))];
  },
});
