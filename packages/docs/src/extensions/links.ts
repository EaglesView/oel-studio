/**
 * Linked copies in a document (Figma G4, G7): copying or cutting a linked
 * chart remembers its link; pasting it (or dropping it after a drag) gives the
 * pasted chart an id and a link of its own to the same source. Right-click on
 * a linked chart opens its link (update, mode, « Couper le lien »).
 */
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type * as Y from 'yjs';
import { adoptCopy, linksOf, rememberCopied } from '@oel/links';

const isChart = (n: PMNode) => n.type.name === 'ooxmlInline' && typeof n.attrs.oid === 'string' && !!n.attrs.oid;
const freshOid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const LinkedCopies = Extension.create<{ doc: Y.Doc | null }>({
  name: 'linkedCopies',
  addOptions: () => ({ doc: null }),
  addProseMirrorPlugins() {
    const ydoc = this.options.doc;
    if (!ydoc) return [];
    const links = linksOf(ydoc);
    const remember = (view: EditorView) => {
      const defs: ReturnType<typeof links.byObject>[] = [];
      view.state.selection.content().content.descendants((n) => {
        if (isChart(n)) defs.push(links.byObject(n.attrs.oid as string));
      });
      rememberCopied(defs);
      return false;
    };
    const remap = (frag: Fragment, label: string): Fragment => {
      const out: PMNode[] = [];
      frag.forEach((n) => {
        if (isChart(n)) {
          const oid = freshOid();
          adoptCopy(links, n.attrs.oid as string, oid, label);
          out.push(n.type.create({ ...n.attrs, oid }, n.content, n.marks));
        } else out.push(n.isLeaf ? n : n.copy(remap(n.content, label)));
      });
      return Fragment.fromArray(out);
    };
    return [
      new Plugin({
        props: {
          handleDOMEvents: { copy: remember, cut: remember },
          transformPasted: (slice, view) => {
            let has = false;
            slice.content.descendants((n) => {
              if (isChart(n)) has = true;
              return !has;
            });
            if (!has) return slice;
            const label = `§ ${view.state.doc.resolve(view.state.selection.from).index(0) + 1}`;
            return new Slice(remap(slice.content, label), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});
