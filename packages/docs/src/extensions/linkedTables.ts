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
import type { Node as PMNode } from '@tiptap/pm/model';
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

/** A style change on one cell of a linked table, by its row and grid column in the copy. */
export interface TableStyleChange {
  linkId: string;
  r: number;
  c: number;
  prop: 'fill' | 'bold' | 'italic' | 'color';
  value: string | boolean | null;
}

/** The look of a cell: its fill, and the bold/italic/colour all of its text has. */
function cellLook(cell: PMNode) {
  const texts: PMNode[] = [];
  cell.descendants((n) => void (n.isText && texts.push(n)));
  const all = (name: string) => texts.length > 0 && texts.every((t) => t.marks.some((m) => m.type.name === name));
  const color = texts.length ? ((texts[0]!.marks.find((m) => m.type.name === 'textStyle')?.attrs.color as string | null | undefined) ?? null) : null;
  return { fill: (cell.attrs.background as string | null) ?? null, bold: all('bold'), italic: all('italic'), color };
}

function linkedTables(doc: PMNode): Map<string, PMNode> {
  const out = new Map<string, PMNode>();
  doc.descendants((n) => {
    if (n.type.name === 'table' && n.attrs.oid) out.set(n.attrs.oid as string, n);
    return n.type.name !== 'table';
  });
  return out;
}

/**
 * Style changes made by a person on linked tables between two documents
 * (Figma I6 §1): they become the copy's local edits. Values can't change in
 * a linked table (the guard), so cells line up one to one.
 */
export function linkedTableStyleChanges(before: PMNode, after: PMNode): TableStyleChange[] {
  const out: TableStyleChange[] = [];
  const old = linkedTables(before);
  for (const [oid, table] of linkedTables(after)) {
    const prev = old.get(oid);
    const copy = linkHost().copyOf(oid);
    if (!prev || !copy || prev === table || prev.childCount !== table.childCount) continue;
    table.forEach((row, _o, r) => {
      const prow = prev.child(r);
      if (prow.childCount !== row.childCount) return;
      let c = 0;
      row.forEach((cell, _o2, i) => {
        const a = cellLook(prow.child(i));
        const b = cellLook(cell);
        for (const prop of ['fill', 'bold', 'italic', 'color'] as const) if (a[prop] !== b[prop]) out.push({ linkId: copy.linkId, r, c, prop, value: b[prop] });
        c += (cell.attrs.colspan as number) || 1;
      });
    });
  }
  return out;
}
