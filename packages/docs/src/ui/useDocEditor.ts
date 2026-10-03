import { useEffect, useMemo, useState } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import { docsExtensions, fallbackRegistry, SHARED_EDIT_ORIGIN, type StyleRegistry } from '../extensions';
import type { DocSession } from '../collab/session';
import { lists, meta, sectionsById, sectionsMap, settingsOf } from '../model/ydoc';
import { defaultSection, BODY_SECTION } from '../model/sections';
import type { DocSettings, DocStyle, NumberingDefs, PageSetup, Section } from '../model/types';
import { sanitizeStylesheet } from '../model/format';

export const PAGE_GAP = 24;

export interface DocMeta {
  /** Section records by id; their order comes from the body (see `editor.storage.pagination.layout`). */
  sections: Map<string, Section>;
  settings: DocSettings;
  /** Page colour, `#RRGGBB`. */
  background: string | null;
  styles: DocStyle[];
  stylesCss: string;
  defaults: { fontFamily: string; fontSize: string };
  numbering: NumberingDefs | null;
  title: string | null;
}

function readMeta(ydoc: Y.Doc): DocMeta {
  const m = meta(ydoc);
  return {
    sections: sectionsById(ydoc),
    settings: settingsOf(ydoc),
    background: (m.get('background') as string | null | undefined) ?? null,
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
    const sm = sectionsMap(session.ydoc);
    m.observe(update);
    sm.observe(update);
    update();
    return () => {
      m.unobserve(update);
      sm.unobserve(update);
    };
  }, [session]);
  return state;
}

/** Change one section (`sectionId`) or every section (`'all'`), as one undoable change. */
export function updateSections(session: DocSession, sectionId: string | 'all', patch: (s: Section) => Partial<Section>) {
  const map = sectionsMap(session.ydoc);
  session.ydoc.transact(() => {
    if (!map.size) map.set(BODY_SECTION, defaultSection());
    for (const [id, s] of [...map.entries()]) if (sectionId === 'all' || id === sectionId) map.set(id, { ...s, ...patch(s) });
  }, SHARED_EDIT_ORIGIN);
}

/** Page setup of one section or of the whole document. */
export function setSectionPage(session: DocSession, sectionId: string | 'all', patch: Partial<PageSetup>) {
  updateSections(session, sectionId, (s) => ({ page: { ...s.page, ...patch } }));
}

export function setBackground(session: DocSession, color: string | null) {
  meta(session.ydoc).set('background', color);
}

/** The Tiptap editor bound to the session's body fragment. */
export function useDocEditor(session: DocSession, docMeta: DocMeta, opts: { editable: boolean; pagination: boolean }): Editor | null {
  const extensions = useMemo(
    () => docsExtensions({ fragment: session.fragment, resolver: { url: session.mediaUrl }, pagination: true, undoAlso: [sectionsMap(session.ydoc) as Y.AbstractType<unknown>] }),
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

  // Sections for pagination (page sizes, margins, breaks).
  useEffect(() => {
    if (!editor) return;
    const st = editor.storage.pagination;
    st.sections = docMeta.sections;
    st.settings = docMeta.settings;
    st.gap = PAGE_GAP;
    st.enabled = opts.pagination;
    st.relayout();
  }, [editor, docMeta.sections, docMeta.settings, opts.pagination]);

  useEffect(() => {
    editor?.setEditable(opts.editable);
  }, [editor, opts.editable]);

  return editor;
}
