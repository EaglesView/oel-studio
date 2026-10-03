/** Find & replace (Ctrl+F / Ctrl+H): match case, whole word, regex; decorations only. */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindStorage extends FindOptions {
  results: Array<{ from: number; to: number }>;
  index: number;
  error: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    find: {
      setSearch: (opts: Partial<FindOptions>) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
  interface Storage {
    find: FindStorage;
  }
}

const key = new PluginKey<DecorationSet>('find');

export function buildPattern(o: FindOptions): RegExp | null {
  if (!o.query) return null;
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${o.caseSensitive ? '' : 'i'}`);
}

/** All matches in text blocks; matches never span atoms (tabs, images…). */
export function findMatches(doc: PMNode, re: RegExp): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let run = '';
    let runStart = -1;
    const flush = () => {
      if (!run) return;
      re.lastIndex = 0;
      for (let m = re.exec(run); m; m = re.exec(run)) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        out.push({ from: runStart + m.index, to: runStart + m.index + m[0].length });
      }
      run = '';
      runStart = -1;
    };
    node.forEach((child, offset) => {
      if (child.isText) {
        if (runStart < 0) runStart = pos + 1 + offset;
        run += child.text;
      } else flush();
    });
    flush();
    return false;
  });
  return out;
}

export const FindReplace = Extension.create<object, FindStorage>({
  name: 'find',

  addStorage() {
    return { query: '', caseSensitive: false, wholeWord: false, regex: false, results: [], index: 0, error: null };
  },

  addCommands() {
    const s = () => this.storage;
    const select = (tr: import('@tiptap/pm/state').Transaction) => {
      const r = s().results[s().index];
      if (r) tr.setSelection(TextSelection.create(tr.doc, r.from, r.to)).scrollIntoView();
      return tr.setMeta(key, 'refresh');
    };
    return {
      setSearch:
        (opts) =>
        ({ tr, dispatch }) => {
          Object.assign(s(), opts);
          s().index = 0;
          if (dispatch) dispatch(tr.setMeta(key, 'refresh'));
          return true;
        },
      findNext:
        () =>
        ({ tr, dispatch }) => {
          if (!s().results.length) return false;
          s().index = (s().index + 1) % s().results.length;
          if (dispatch) dispatch(select(tr));
          return true;
        },
      findPrev:
        () =>
        ({ tr, dispatch }) => {
          if (!s().results.length) return false;
          s().index = (s().index - 1 + s().results.length) % s().results.length;
          if (dispatch) dispatch(select(tr));
          return true;
        },
      replaceCurrent:
        (text) =>
        ({ tr, dispatch }) => {
          const r = s().results[s().index];
          if (!r) return false;
          if (dispatch) {
            tr.insertText(text, r.from, r.to);
            dispatch(tr.setMeta(key, 'refresh'));
          }
          return true;
        },
      replaceAll:
        (text) =>
        ({ tr, dispatch }) => {
          const results = [...s().results];
          if (!results.length) return false;
          if (dispatch) {
            for (const r of results.reverse()) tr.insertText(text, r.from, r.to);
            dispatch(tr.setMeta(key, 'refresh'));
          }
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          s().query = '';
          if (dispatch) dispatch(tr.setMeta(key, 'refresh'));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const compute = (doc: PMNode) => {
      let re: RegExp | null = null;
      try {
        re = buildPattern(storage);
        storage.error = null;
      } catch (e) {
        storage.error = (e as Error).message;
      }
      storage.results = re ? findMatches(doc, re) : [];
      if (storage.index >= storage.results.length) storage.index = 0;
      return DecorationSet.create(
        doc,
        storage.results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === storage.index ? 'oel-find oel-find--current' : 'oel-find' })),
      );
    };
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => compute(state.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? compute(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});
