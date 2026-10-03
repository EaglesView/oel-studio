import { Extension, getSchema, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { defaultDeleteFilter, defaultProtectedNodes, ySyncPluginKey } from '@tiptap/y-tiptap';
import {
  DocImage,
  DocParagraph,
  DocTable,
  DocTableCell,
  DocTableHeader,
  DocTableRow,
  NoteRef,
  OoxmlBlock,
  OoxmlInline,
  PageBreak,
  SdtBlock,
  Tab,
  type ImageResolver,
} from './nodes';
import { DocTextStyle } from './marks';
import { DocList } from './lists';
import { FindReplace } from './find';
import { DocEditing } from './editing';
import { Pagination } from './pagination';

export interface DocsExtensionOptions {
  /** Bind to a Yjs fragment (undo/redo then come from Yjs). */
  fragment?: Y.XmlFragment | null;
  resolver?: ImageResolver;
  placeholder?: string;
  pagination?: boolean;
  /** Minimal set for schema checks and static rendering (no plugins with views). */
  bare?: boolean;
  /**
   * Other shared types undone together with the fragment (e.g. the section
   * records, so a section break is one undo step). Changes to them are tracked
   * when made in a transaction with origin `SHARED_EDIT_ORIGIN`.
   */
  undoAlso?: Array<Y.AbstractType<unknown>>;
}

/** Transaction origin for edits outside the fragment that undo/redo should include. */
export const SHARED_EDIT_ORIGIN = 'oel-shared-edit';

export function docsExtensions(o: DocsExtensionOptions = {}): AnyExtension[] {
  const exts: AnyExtension[] = [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      undoRedo: o.fragment ? false : { depth: 200 },
      dropcursor: o.bare ? false : { color: 'var(--emboss-fill-primary, #4A86E8)', width: 2 },
      gapcursor: o.bare ? false : undefined,
      trailingNode: o.bare ? false : { node: 'paragraph' },
    }),
    DocParagraph,
    PageBreak,
    Tab,
    DocImage.configure({ resolver: o.resolver ?? { url: () => null } }),
    NoteRef,
    OoxmlInline,
    OoxmlBlock,
    SdtBlock,
    DocTable.configure({ resizable: !o.bare, cellMinWidth: 32, allowTableNodeSelection: true, lastColumnResizable: true }),
    DocTableRow,
    DocTableCell,
    DocTableHeader,
    DocTextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
    DocList,
  ];
  if (!o.bare) {
    exts.push(FindReplace, DocEditing, CharacterCount, Placeholder.configure({ placeholder: o.placeholder ?? 'Commencez à écrire…' }));
    if (o.pagination !== false) exts.push(Pagination);
  }
  if (o.fragment) {
    // Same settings as y-tiptap's own manager, with a wider scope; we own its lifecycle.
    const undoManager = o.undoAlso?.length
      ? new Y.UndoManager([o.fragment, ...o.undoAlso], {
          trackedOrigins: new Set<unknown>([ySyncPluginKey, SHARED_EDIT_ORIGIN]),
          deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
          captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
        })
      : null;
    exts.push(Collaboration.configure({ fragment: o.fragment, ...(undoManager ? { yUndoOptions: { undoManager } } : {}) }));
    if (undoManager) exts.push(Extension.create({ name: 'sharedUndoLifecycle', onDestroy: () => undoManager.destroy() }));
  }
  return exts;
}

/** The ProseMirror schema documents are stored in. */
export function docsSchema() {
  return getSchema(docsExtensions({ bare: true }));
}

export * from './nodes';
export * from './lists';
export * from './find';
export * from './editing';
export * from './pagination';
export { DocTextStyle } from './marks';
