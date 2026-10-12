/**
 * Word-model lists: a paragraph is in a list when it has `numId` (+ `ilvl`).
 * Markers are drawn with node decorations computed from the numbering
 * definitions, so imported numbering (1.2.3, a), i.…) renders as in Word.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ListCounter, listDefs, listKindOf, newNumId, type ListDefs } from '../model/numbering';
import type { NumberingDefs, SyntheticListKind } from '../model/types';

export type ListKind = 'bullet' | 'numbered' | 'check';

export interface DocListStorage {
  numbering: NumberingDefs | null;
  synthetic: Map<number, SyntheticListKind>;
  /** Called when a list is created, so the session can record it in the shared doc. */
  onCreateList: (numId: number, kind: SyntheticListKind) => void;
  defs: () => ListDefs;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docList: {
      toggleList: (kind: ListKind) => ReturnType;
      toggleChecked: (pos: number) => ReturnType;
      /** Recompute markers after numbering definitions changed. */
      refreshLists: () => ReturnType;
    };
  }
  interface Storage {
    docList: DocListStorage;
  }
}

export const listKey = new PluginKey<DecorationSet>('docList');

const pt = (tw: number) => `${+(tw / 20).toFixed(2)}pt`;

function buildDecorations(doc: PMNode, defs: ListDefs): DecorationSet {
  const counter = new ListCounter(defs);
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    const numId = node.attrs.numId as number | null;
    if (numId == null || numId === 0) return false;
    const ilvl = Number(node.attrs.ilvl ?? 0);
    const res = counter.next(numId, ilvl);
    if (!res) return false;
    const kind = listKindOf(defs, numId, ilvl);
    const def = defs.get(numId);
    const ind = node.attrs.ind as { left?: number; hanging?: number; firstLine?: number } | null;
    const style: string[] = [];
    const hanging = ind?.hanging ?? res.level.hanging ?? 360;
    if (!ind || ind.left == null) style.push(`margin-left:${pt(res.level.indLeft ?? 720 * (ilvl + 1))}`);
    if (!ind || (ind.hanging == null && ind.firstLine == null)) style.push(`text-indent:${pt(-hanging)}`);
    style.push(`--oel-hang:${pt(Math.max(hanging, 0))}`);
    if (res.level.font) style.push(`--oel-marker-font:"${res.level.font}"`);
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        'data-marker': res.marker,
        'data-list': kind ?? 'numbered',
        'data-checked': def?.kind === 'checked' ? '' : undefined,
        style: style.join(';'),
      } as Record<string, string>),
    );
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export const DocList = Extension.create<object, DocListStorage>({
  name: 'docList',

  addStorage() {
    const storage: DocListStorage = {
      numbering: null,
      synthetic: new Map(),
      onCreateList: () => {},
      defs: () => listDefs(storage.numbering, storage.synthetic),
    };
    return storage;
  },

  addCommands() {
    return {
      refreshLists:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(listKey, 'refresh'));
          return true;
        },
      toggleList:
        (kind) =>
        ({ state, tr, dispatch }) => {
          const defs = this.storage.defs();
          const { from, to } = state.selection;
          const paras: Array<{ pos: number; node: PMNode }> = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph') {
              paras.push({ pos, node });
              return false;
            }
            return true;
          });
          if (!paras.length) return false;
          const all = paras.every((p) => listKindOf(defs, p.node.attrs.numId, p.node.attrs.ilvl) === kind);
          if (all) {
            for (const p of paras) tr.setNodeMarkup(p.pos, undefined, { ...p.node.attrs, numId: null, ilvl: 0 });
            if (dispatch) dispatch(tr);
            return true;
          }
          // Join the list just above if it is the same kind, else start a new one.
          let numId: number | null = null;
          const $first = state.doc.resolve(paras[0]!.pos);
          const idx = $first.index();
          const before = idx > 0 ? $first.parent.child(idx - 1) : null;
          if (before?.type.name === 'paragraph' && listKindOf(defs, before.attrs.numId, before.attrs.ilvl) === kind) {
            numId = before.attrs.numId;
            if (kind === 'check' && defs.get(numId!)?.kind === 'checked') numId = numId! - 1;
          }
          if (numId == null) {
            const taken = [...Object.keys(this.storage.numbering?.nums ?? {}).map(Number), ...this.storage.synthetic.keys()];
            const synth: SyntheticListKind = kind === 'numbered' ? 'decimal' : kind === 'check' ? 'check' : 'bullet';
            numId = newNumId(taken.flatMap((t) => [t, t - 1, t + 1]));
            this.storage.synthetic.set(numId, synth);
            this.storage.onCreateList(numId, synth);
            if (kind === 'check') {
              this.storage.synthetic.set(numId + 1, 'checked');
              this.storage.onCreateList(numId + 1, 'checked');
            }
          }
          for (const p of paras) {
            const keepLevel = p.node.attrs.numId != null && p.node.attrs.numId !== 0;
            tr.setNodeMarkup(p.pos, undefined, { ...p.node.attrs, numId, ilvl: keepLevel ? p.node.attrs.ilvl : 0 });
          }
          tr.setMeta(listKey, 'refresh');
          if (dispatch) dispatch(tr);
          return true;
        },
      toggleChecked:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== 'paragraph') return false;
          const kind = this.storage.synthetic.get(node.attrs.numId);
          if (kind !== 'check' && kind !== 'checked') return false;
          const numId = kind === 'check' ? node.attrs.numId + 1 : node.attrs.numId - 1;
          if (!this.storage.synthetic.has(numId)) {
            this.storage.synthetic.set(numId, kind === 'check' ? 'checked' : 'check');
            this.storage.onCreateList(numId, kind === 'check' ? 'checked' : 'check');
          }
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...node.attrs, numId }));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-8': () => this.editor.commands.toggleList('bullet'),
      'Mod-Shift-7': () => this.editor.commands.toggleList('numbered'),
      'Mod-Shift-9': () => this.editor.commands.toggleList('check'),
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key: listKey,
        state: {
          init: (_, state: EditorState) => buildDecorations(state.doc, storage.defs()),
          apply(tr, old) {
            if (tr.docChanged || tr.getMeta(listKey) === 'refresh') return buildDecorations(tr.doc, storage.defs());
            return old;
          },
        },
        props: {
          decorations(state) {
            return listKey.getState(state);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const el = (event.target as HTMLElement).closest?.('.oel-p[data-list="check"]') as HTMLElement | null;
              if (!el || !editor.isEditable) return false;
              const rect = el.getBoundingClientRect();
              const indent = parseFloat(getComputedStyle(el).textIndent) || 0;
              // Click on the box (left of the text) toggles it.
              if (event.clientX > rect.left + Math.max(0, -indent) + 4 && event.clientX > rect.left + 24) return false;
              const pos = view.posAtDOM(el, 0) - 1;
              event.preventDefault();
              return editor.commands.toggleChecked(pos);
            },
          },
        },
      }),
    ];
  },
});
