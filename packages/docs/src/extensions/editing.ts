/**
 * Docs conveniences: format painter, clear formatting, Markdown-style input
 * rules, French typography (guillemets, non-breaking spaces before : ; ! ?).
 */
import { Extension, InputRule } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docEditing: {
      /** Copy formatting at the caret; the next selection receives it (Docs "Reproduire la mise en forme"). */
      startFormatPainter: () => ReturnType;
      cancelFormatPainter: () => ReturnType;
      clearFormatting: () => ReturnType;
    };
  }
  interface Storage {
    docEditing: {
      painter: { marks: readonly Mark[]; para: Record<string, unknown> } | null;
      frenchTypography: boolean;
    };
  }
}

const PARA_FORMAT_KEYS = ['styleId', 'align', 'spacing', 'ind', 'outline', 'css', 'pPr'] as const;

export const DocEditing = Extension.create({
  name: 'docEditing',

  addStorage() {
    return { painter: null as { marks: readonly Mark[]; para: Record<string, unknown> } | null, frenchTypography: true };
  },

  addCommands() {
    return {
      startFormatPainter:
        () =>
        ({ state }) => {
          const { $from } = state.selection;
          const marks = state.storedMarks ?? $from.marks();
          const para: Record<string, unknown> = {};
          for (const k of PARA_FORMAT_KEYS) para[k] = $from.parent.attrs[k];
          this.storage.painter = { marks, para };
          return true;
        },
      cancelFormatPainter: () => () => {
        this.storage.painter = null;
        return true;
      },
      clearFormatting:
        () =>
        ({ chain }) =>
          chain()
            .unsetAllMarks()
            .command(({ tr, state }) => {
              const { from, to } = state.selection;
              state.doc.nodesBetween(from, to, (node, pos) => {
                if (node.type.name !== 'paragraph') return true;
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: null, spacing: null, ind: null, css: null });
                return false;
              });
              return true;
            })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-\\': () => this.editor.commands.clearFormatting(),
    };
  },

  onSelectionUpdate() {
    const p = this.storage.painter;
    const { state } = this.editor;
    if (!p || state.selection.empty) return;
    // Apply on the first non-empty selection after picking the format.
    this.storage.painter = null;
    const { from, to } = state.selection;
    const tr = state.tr;
    for (const m of Object.values(state.schema.marks)) tr.removeMark(from, to, m);
    for (const m of p.marks) tr.addMark(from, to, m);
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'paragraph') return true;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...p.para });
      return false;
    });
    this.editor.view.dispatch(tr);
  },

  addInputRules() {
    const editor = this.editor;
    const french = () => this.storage.frenchTypography;
    const block = (re: RegExp, run: (match: RegExpMatchArray) => void) =>
      new InputRule({
        find: re,
        handler: ({ range, match, chain }) => {
          const $from = editor.state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== 0) return null;
          chain().deleteRange(range).run();
          run(match);
        },
      });
    return [
      block(/^(#{1,6})\s$/, (m) => editor.commands.setParagraphRole(`heading${m[1]!.length}`)),
      block(/^[*-]\s$/, () => editor.commands.toggleList('bullet')),
      block(/^1[.)]\s$/, () => editor.commands.toggleList('numbered')),
      block(/^\[\s?\]\s$/, () => editor.commands.toggleList('check')),
      block(/^---$/, () => editor.commands.insertHorizontalLine()),
      // « guillemets » with non-breaking spaces, as French typesetting expects.
      new InputRule({
        find: /(?:^|[\s(\[{])"$/,
        handler: ({ state, range }) => {
          if (!french()) return null;
          state.tr.insertText('« ', range.to, range.to);
        },
      }),
      new InputRule({
        find: /\S"$/,
        handler: ({ state, range }) => {
          if (!french()) return null;
          state.tr.insertText(' »', range.to, range.to);
        },
      }),
      new InputRule({
        find: /(\S) ([:;!?])$/,
        handler: ({ state, range, match }) => {
          if (!french() || match[1] === ' ') return null;
          state.tr.insertText(`${match[1]} ${match[2]}`, range.from, range.to);
        },
      }),
      new InputRule({
        find: /\.\.\.$/,
        handler: ({ state, range }) => {
          state.tr.insertText('…', range.from, range.to);
        },
      }),
      new InputRule({
        find: /(\w)'$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText(`${match[1]}’`, range.from, range.to);
        },
      }),
    ];
  },
});
