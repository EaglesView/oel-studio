import { useEffect, useMemo, useState } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import { docsExtensions, fallbackRegistry, type StyleRegistry } from '../extensions';
import type { DocSession } from '../collab/session';
import { lists, meta } from '../model/ydoc';
import { DEFAULT_PAGE, twipsToPx, type DocStyle, type NumberingDefs, type PageSetup } from '../model/types';
import { sanitizeStylesheet } from '../model/format';

export const PAGE_GAP = 24;

export interface DocMeta {
  page: PageSetup;
  styles: DocStyle[];
  stylesCss: string;
  defaults: { fontFamily: string; fontSize: string };
  numbering: NumberingDefs | null;
  title: string | null;
}

function readMeta(ydoc: Y.Doc): DocMeta {
  const m = meta(ydoc);
  return {
    page: { ...DEFAULT_PAGE, ...((m.get('page') as PageSetup | undefined) ?? {}) },
    styles: (m.get('styles') as DocStyle[] | undefined) ?? [],
    stylesCss: sanitizeStylesheet((m.get('stylesCss') as string | undefined) ?? ''),
    defaults: (m.get('defaults') as DocMeta['defaults'] | undefined) ?? { fontFamily: 'Arial', fontSize: '11pt' },
    numbering: (m.get('numbering') as NumberingDefs | undefined) ?? null,
    title: (m.get('title') as string | null | undefined) ?? null,
  };
}

export function styleRegistry(styles: DocStyle[]): StyleRegistry {
  if (!styles.length) return fallbackRegistry;
  const byId = new Map(styles.map((s) => [s.id, s]));
  return {
    idForRole: (role) => styles.find((s) => s.kind === 'paragraph' && s.role === role)?.id ?? fallbackRegistry.idForRole(role),
    outlineOf: (id) => (id ? byId.get(id)?.outline ?? null : null),
    normalId: () => styles.find((s) => s.kind === 'paragraph' && s.isDefault)?.id ?? null,
  };
}

/** Shared document metadata (page setup, styles…), live. */
export function useDocMeta(session: DocSession): DocMeta {
  const [state, setState] = useState(() => readMeta(session.ydoc));
  useEffect(() => {
    const m = meta(session.ydoc);
    const update = () => setState(readMeta(session.ydoc));
    m.observe(update);
    update();
    return () => m.unobserve(update);
  }, [session]);
  return state;
}

export function setPage(session: DocSession, patch: Partial<PageSetup>) {
  const m = meta(session.ydoc);
  m.set('page', { ...DEFAULT_PAGE, ...((m.get('page') as PageSetup) ?? {}), ...patch });
}

/** The Tiptap editor bound to the session's body fragment. */
export function useDocEditor(session: DocSession, docMeta: DocMeta, opts: { editable: boolean; pagination: boolean }): Editor | null {
  const extensions = useMemo(
    () => docsExtensions({ fragment: session.fragment, resolver: { url: session.mediaUrl }, pagination: true }),
    [session],
  );
  const editor = useEditor(
    {
      extensions,
      editable: opts.editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: 'oel-body', spellcheck: 'true', lang: 'fr-CA', 'aria-label': 'Texte du document', 'aria-multiline': 'true', role: 'textbox' },
      },
    },
    [extensions],
  );

  // Styles registry and list definitions follow the shared metadata.
  useEffect(() => {
    if (!editor) return;
    editor.storage.paragraph.styles = styleRegistry(docMeta.styles);
    editor.storage.docList.numbering = docMeta.numbering;
    editor.commands.refreshLists();
  }, [editor, docMeta.styles, docMeta.numbering]);

  useEffect(() => {
    if (!editor) return;
    const l = lists(session.ydoc);
    const sync = () => {
      editor.storage.docList.synthetic = new Map([...l.entries()].map(([k, v]) => [Number(k), v]));
      editor.commands.refreshLists();
    };
    editor.storage.docList.onCreateList = (numId, kind) => l.set(String(numId), kind);
    l.observe(sync);
    sync();
    return () => l.unobserve(sync);
  }, [editor, session]);

  // Page geometry for pagination.
  useEffect(() => {
    if (!editor) return;
    const p = docMeta.page;
    const st = editor.storage.pagination;
    st.geometry = { pageHeight: twipsToPx(p.height), marginTop: twipsToPx(p.top), marginBottom: twipsToPx(p.bottom), gap: PAGE_GAP };
    st.enabled = opts.pagination;
    st.relayout();
  }, [editor, docMeta.page, opts.pagination]);

  useEffect(() => {
    editor?.setEditable(opts.editable);
  }, [editor, opts.editable]);

  return editor;
}
