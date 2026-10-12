import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import { Button, Checkbox } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import { fragmentJSON, noteKey, notesIndex, storiesIndex, storyKey } from '../model/ydoc';
import type { AnchorAttrs, HeaderFooterKind, Section, StorySide } from '../model/types';
import { effectiveStory, pageKind, sectionsPhrase, sectionsUsingStory, storyOwner, type PageInfo } from '../model/sections';
import { updateSections, type DocMeta } from './useDocEditor';
import { StoryEditor } from './StoryEditor';
import { Fields } from './Fields';
import { AnchorLayer, anchorsOf, type PlacedAnchor } from './Anchors';
import { createStory, linkToPrevious, noteOrder, pagesPerSection, removeStory, setSectionStory, toHTML } from './actions';
import { tr } from '@oel/i18n';

/** Live HTML (and floating objects) of every header/footer story, for drawing them on each sheet. */
function useStories(session: DocSession) {
  const [stories, setStories] = useState<{ html: Record<string, string>; anchors: Record<string, AnchorAttrs[]> }>({ html: {}, anchors: {} });
  useEffect(() => {
    const idx = storiesIndex(session.ydoc);
    let frame = 0;
    const render = () => {
      frame = 0;
      const html: Record<string, string> = {};
      const anchors: Record<string, AnchorAttrs[]> = {};
      idx.forEach((_, id) => {
        try {
          const doc = fragmentJSON(session.ydoc.getXmlFragment(storyKey(id)));
          html[id] = toHTML(doc);
          anchors[id] = anchorsOf(doc);
        } catch {
          html[id] = '';
        }
      });
      setStories({ html, anchors });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    render();
    session.ydoc.on('update', schedule);
    return () => {
      session.ydoc.off('update', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [session]);
  return stories;
}

/** The laid-out sheets, live. */
export function usePages(editor: Editor | null): PageInfo[] {
  const [pages, setPages] = useState<PageInfo[]>(() => editor?.storage.pagination.pages ?? []);
  useEffect(() => {
    if (!editor) return;
    const st = editor.storage.pagination;
    const l = (p: PageInfo[]) => setPages(p);
    st.listeners.add(l);
    setPages(st.pages);
    return () => void st.listeners.delete(l);
  }, [editor]);
  return pages;
}

/** Sections in layout order, with the latest records from the shared document. */
export function useOrderedSections(editor: Editor, docMeta: DocMeta, pages: PageInfo[]): Section[] {
  return useMemo(
    () => editor.storage.pagination.layout.sections.map((s) => docMeta.sections.get(s.id) ?? s),
    // `pages` changes whenever the layout does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docMeta.sections, pages],
  );
}

export interface EditingStory {
  side: StorySide;
  kind: HeaderFooterKind;
  /** Sheet it was opened on (the editor appears there). */
  page: number;
  /** Section shown on that sheet, and the story being edited. */
  section: number;
  storyId: string;
}

export interface PageViewProps {
  editor: Editor;
  session: DocSession;
  docMeta: DocMeta;
  editable: boolean;
  paginated: boolean;
  zoom: number;
  onStoryFocus: (e: Editor) => void;
  editingStory: EditingStory | null;
  setEditingStory: (s: EditingStory | null) => void;
  children?: ReactNode;
}

const SIDE_LABEL: Record<StorySide, string> = { header: tr('En-tête', 'Header'), footer: tr('Pied de page', 'Footer') };
const KIND_LABEL: Record<HeaderFooterKind, string> = { default: '', first: tr(' · première page', ' · first page'), even: ' · pages paires' };

export function PageView({ editor, session, docMeta, editable, paginated, zoom, onStoryFocus, editingStory, setEditingStory, children }: PageViewProps) {
  const pages = usePages(editor);
  const sections = useOrderedSections(editor, docMeta, pages);
  const { html: stories, anchors: storyAnchors } = useStories(session);
  const { frame } = editor.storage.pagination.layout;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sheets = pages.length ? pages : editor.storage.pagination.pages;
  const first = sheets[0]!;
  const W = frame.width;
  const single = !paginated;
  const sheetHeight = (p: PageInfo) => (single ? Math.max(p.height, bodyHeight + p.margins.top + p.margins.bottom) : p.height);
  const last = sheets[sheets.length - 1]!;
  const total = single ? sheetHeight(first) : last.top + last.height;
  const perSection = useMemo(() => pagesPerSection(sheets), [sheets]);
  const fieldsOf = (p: PageInfo) => ({ page: p.label, pages: sheets.length, sectionPages: perSection.get(p.section) ?? 1 });

  // Floating objects per sheet: the body's (placed by pagination) and those of the sheet's header and footer.
  const bodyAnchors = useMemo(() => {
    const m = new Map<number, PlacedAnchor[]>();
    for (const a of editor.storage.pagination.anchors) {
      const list = m.get(single ? 0 : a.page) ?? [];
      list.push({ key: `b${a.pos}`, attrs: a.attrs, paraTop: a.paraTop, lineTop: a.lineTop, charLeft: a.charLeft });
      m.set(single ? 0 : a.page, list);
    }
    return m;
    // `pages` changes whenever the placements do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, pages, single]);

  const slotOf = (side: StorySide, p: PageInfo) => {
    const section = sections[p.section];
    const kind = section ? pageKind(p.indexInSection, p.number, section, docMeta.settings) : 'default';
    const id = effectiveStory(sections, p.section, side, kind);
    return { kind, id: id && stories[id] !== undefined ? id : null };
  };

  const open = (side: StorySide, index: number) => {
    if (!editable) return;
    const p = sheets[index]!;
    const { kind, id } = slotOf(side, p);
    let storyId = id;
    if (!storyId) {
      storyId = createStory(editor, session, side);
      setSectionStory(session, sections[p.section]!.id, side, kind, storyId);
    }
    setEditingStory({ side, kind, page: index, section: p.section, storyId });
  };

  const bar = (e: EditingStory) => {
    const section = sections[e.section];
    if (!section) return null;
    const own = (e.side === 'header' ? section.headers : section.footers)[e.kind];
    const linked = e.section > 0 && !own;
    const users = sectionsUsingStory(sections, e.storyId).filter((i) => i !== e.section);
    const relink = (link: boolean) => {
      const next = linkToPrevious(editor, session, sections, e.section, e.side, e.kind, link);
      if (next) setEditingStory({ ...e, storyId: next });
      else setEditingStory(null);
    };
    const remove = () => {
      const owner = storyOwner(sections, e.section, e.side, e.kind);
      // Only drop the reference when other sections still use the story; else delete it.
      if (users.length && owner != null) setSectionStory(session, sections[owner]!.id, e.side, e.kind, null);
      else removeStory(session, e.storyId);
      setEditingStory(null);
    };
    return (
      <div className="oel-hf__bar" onMouseDown={(ev) => ev.preventDefault()}>
        <span className="oel-hf__label">
          {sections.length > 1 ? tr(`Section ${e.section + 1} · `, `Section ${e.section + 1} · `) : ''}
          {SIDE_LABEL[e.side]}
          {KIND_LABEL[e.kind]}
        </span>
        {users.length > 0 && <span className="oel-hf__shared">{tr('Aussi utilisé par', 'Also used by')} {sectionsPhrase(users)}</span>}
        {e.section > 0 && (
          <Checkbox isSelected={linked} onChange={relink}>
            {tr('Lier au précédent', 'Link to previous')}
          </Checkbox>
        )}
        <Checkbox isSelected={section.titlePg} onChange={(v) => updateSections(session, section.id, () => ({ titlePg: v }))}>
          {tr('Première page différente', 'Different first page')}
        </Checkbox>
        <Button size="sm" variant="ghost" onPress={remove}>
          {tr('Supprimer', 'Delete')}
        </Button>
        <Button size="sm" variant="secondary" onPress={() => setEditingStory(null)}>
          {tr('Fermer', 'Close')}
        </Button>
      </div>
    );
  };

  const anchorsFor = (p: PageInfo, index: number): PlacedAnchor[] => {
    const out = [...(bodyAnchors.get(index) ?? [])];
    for (const side of ['header', 'footer'] as const) {
      const { id } = slotOf(side, p);
      if (!id) continue;
      // Approximation: paragraph- and line-relative objects of a header/footer hang from its zone.
      const top = side === 'header' ? p.margins.header : p.height - p.margins.footer;
      (storyAnchors[id] ?? []).forEach((attrs, k) => out.push({ key: `${id}:${k}`, attrs, paraTop: top, lineTop: top, charLeft: p.margins.left }));
    }
    return out;
  };

  const zone = (side: StorySide, index: number) => {
    const p = sheets[index]!;
    const editingHere = editingStory?.side === side && editingStory.page === index;
    const m = p.margins;
    const style = side === 'header' ? { top: m.header, left: m.left, right: m.right } : { bottom: m.footer, left: m.left, right: m.right };
    const label = SIDE_LABEL[side];
    const { id } = slotOf(side, p);
    return (
      <div
        className={`oel-hf oel-hf--${side}${editingHere ? ' is-editing' : ''}`}
        style={style}
        onDoubleClick={() => open(side, index)}
        title={editable && !editingHere ? tr(`Double-cliquez pour modifier : ${label.toLowerCase()}`, `Double-click to edit: ${label.toLowerCase()}`) : undefined}
      >
        {editingHere && editingStory ? (
          <div className="oel-hf__editor">
            <StoryEditor
              session={session}
              fragment={storyKey(editingStory.storyId)}
              docMeta={docMeta}
              editable={editable}
              label={label}
              autofocus
              className="oel-doc oel-hf__content"
              onFocus={onStoryFocus}
            />
            {bar(editingStory)}
          </div>
        ) : id ? (
          <Fields html={stories[id] ?? ''} values={fieldsOf(p)} className="oel-doc oel-hf__content" />
        ) : null}
      </div>
    );
  };

  return (
    <div className="oel-pages" style={{ width: W * zoom, minHeight: total * zoom }}>
      <div className="oel-pages__inner" style={{ zoom, width: W }}>
        <div className="oel-pagestack" style={{ height: total }} aria-hidden={!editingStory}>
          {(single ? [first] : sheets).map((p, i) => (
            <div
              key={i}
              className={`oel-sheet${p.blank ? ' is-blank' : ''}`}
              data-section={p.sectionId}
              style={{ top: single ? 0 : p.top, left: p.sheetLeft, height: sheetHeight(p), width: p.width, background: docMeta.background ?? undefined }}
            >
              <AnchorLayer sheet={p} anchors={anchorsFor(p, i)} behind url={session.mediaUrl} fields={fieldsOf(p)} />
              {zone('header', i)}
              {zone('footer', i)}
              {!single && sheets.length > 1 && <span className="oel-sheet__num" aria-hidden>{p.label}</span>}
            </div>
          ))}
        </div>
        <div className="oel-doc oel-body-wrap" ref={bodyRef} style={{ marginTop: first.margins.top, marginLeft: frame.textLeft, width: frame.textWidth }}>
          <EditorContent editor={editor} />
        </div>
        <div className="oel-anchors-front" style={{ height: total }} aria-hidden>
          {(single ? [first] : sheets).map((p, i) => (
            <div key={i} className="oel-anchors-front__sheet" style={{ top: single ? 0 : p.top, left: p.sheetLeft, width: p.width, height: sheetHeight(p) }}>
              <AnchorLayer sheet={p} anchors={anchorsFor(p, i)} behind={false} url={session.mediaUrl} fields={fieldsOf(p)} />
            </div>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Footnotes and endnotes, numbered in reference order, each editable in place. */
export function NotesArea({ editor, session, docMeta, editable, onFocus }: { editor: Editor; session: DocSession; docMeta: DocMeta; editable: boolean; onFocus: (e: Editor) => void }) {
  const [order, setOrder] = useState<{ footnote: string[]; endnote: string[] }>({ footnote: [], endnote: [] });
  useEffect(() => {
    const update = () => {
      const exists = notesIndex(session.ydoc);
      setOrder({
        footnote: noteOrder(editor, 'footnote').filter((id) => exists.get(`footnote:${id}`)),
        endnote: noteOrder(editor, 'endnote').filter((id) => exists.get(`endnote:${id}`)),
      });
    };
    update();
    editor.on('update', update);
    notesIndex(session.ydoc).observe(update);
    return () => {
      editor.off('update', update);
      notesIndex(session.ydoc).unobserve(update);
    };
  }, [editor, session]);
  const roman = (n: number) => ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n - 1] ?? String(n);
  const lists = useMemo(
    () =>
      (['footnote', 'endnote'] as const)
        .filter((k) => order[k].length)
        .map((kind) => ({ kind, ids: order[kind], title: kind === 'footnote' ? tr('Notes de bas de page', 'Footnotes') : tr('Notes de fin', 'Endnotes') })),
    [order],
  );
  if (!lists.length) return null;
  const jump = (kind: string, id: string) => {
    let target: number | null = null;
    editor.state.doc.descendants((n, pos) => {
      if (target == null && n.type.name === 'noteRef' && n.attrs.kind === kind && String(n.attrs.id) === id) target = pos;
      return target == null;
    });
    if (target != null) editor.chain().focus().setNodeSelection(target).scrollIntoView().run();
  };
  return (
    <section className="oel-notes oel-doc" aria-label="Notes">
      {lists.map(({ kind, ids, title }) => (
        <div key={kind} className="oel-notes__group">
          <h2 className="oel-notes__title">{title}</h2>
          <ol className="oel-notes__list">
            {ids.map((id, i) => (
              <li key={id} className="oel-note" id={`oel-${kind}-${id}`}>
                <button type="button" className="oel-note__num" onClick={() => jump(kind, id)} aria-label={tr(`Aller à l’appel de note ${i + 1}`, `Go to note reference ${i + 1}`)}>
                  {kind === 'footnote' ? i + 1 : roman(i + 1)}
                </button>
                <StoryEditor session={session} fragment={noteKey(kind, id)} docMeta={docMeta} editable={editable} label={`Note ${i + 1}`} className="oel-note__body" onFocus={onFocus} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
