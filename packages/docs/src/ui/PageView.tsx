import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import { Button, Checkbox } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import { fragmentJSON, noteKey, notesIndex, storiesIndex, storyKey } from '../model/ydoc';
import { twipsToPx, type HeaderFooterKind } from '../model/types';
import { PAGE_GAP, setPage, type DocMeta } from './useDocEditor';
import { StoryEditor } from './StoryEditor';
import { noteOrder, removeStory, toHTML } from './actions';

type Side = 'header' | 'footer';

/** Live HTML of every header/footer story, for drawing them on each sheet. */
function useStories(session: DocSession) {
  const [stories, setStories] = useState<Record<string, string>>({});
  useEffect(() => {
    const idx = storiesIndex(session.ydoc);
    let frame = 0;
    const render = () => {
      frame = 0;
      const out: Record<string, string> = {};
      idx.forEach((_, key) => {
        const [side, kind] = key.split(':') as [Side, HeaderFooterKind];
        try {
          out[key] = toHTML(fragmentJSON(session.ydoc.getXmlFragment(storyKey(side, kind))));
        } catch {
          out[key] = '';
        }
      });
      setStories(out);
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

/** Fill PAGE / NUMPAGES fields inside a static header or footer. */
function Fields({ html, page, pages, className }: { html: string; page: number; pages: number; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const value = (field: string | undefined) => (field === 'PAGE' ? String(page) : field === 'NUMPAGES' ? String(pages) : null);
    // Simple fields (w:fldSimple) render as one element.
    root.querySelectorAll<HTMLElement>('[data-field]:not([data-hidden])').forEach((el) => {
      const v = value(el.dataset.field);
      if (v != null) el.textContent = v;
    });
    // Complex fields: begin … instrText … separate [cached result] end. Replace the cached result.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let field: string | null = null;
    let inResult = false;
    let first = true;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof HTMLElement && n.dataset.ooxml) {
        const xml = n.dataset.ooxml;
        if (n.dataset.field) field = n.dataset.field;
        if (xml.includes('fldCharType="separate"')) {
          inResult = value(field ?? undefined) != null;
          first = true;
        } else if (xml.includes('fldCharType="end"')) {
          inResult = false;
          field = null;
        }
        continue;
      }
      if (inResult && n.nodeType === Node.TEXT_NODE && !n.parentElement?.closest('[data-ooxml]')) {
        n.textContent = first ? value(field ?? undefined)! : '';
        first = false;
      }
    }
  }, [html, page, pages]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface EditingStory {
  side: Side;
  kind: HeaderFooterKind;
  /** Sheet it was opened on (the editor appears there). */
  page: number;
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

export function PageView({ editor, session, docMeta, editable, paginated, zoom, onStoryFocus, editingStory, setEditingStory, children }: PageViewProps) {
  const [pages, setPages] = useState(editor.storage.pagination.pages);
  useEffect(() => {
    const st = editor.storage.pagination;
    const l = (n: number) => setPages(n);
    st.listeners.add(l);
    setPages(st.pages);
    return () => void st.listeners.delete(l);
  }, [editor]);

  const stories = useStories(session);
  const p = docMeta.page;
  const W = twipsToPx(p.width);
  const H = twipsToPx(p.height);
  const m = { top: twipsToPx(p.top), right: twipsToPx(p.right), bottom: twipsToPx(p.bottom), left: twipsToPx(p.left), header: twipsToPx(p.header), footer: twipsToPx(p.footer) };
  const stride = H + PAGE_GAP;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = paginated ? pages : 1;
  const sheetHeight = paginated ? H : Math.max(H, bodyHeight + m.top + m.bottom);
  const total = paginated ? count * stride - PAGE_GAP : sheetHeight;

  const storyFor = (side: Side, page: number): HeaderFooterKind | null => {
    if (p.titlePg && page === 0) return stories[`${side}:first`] !== undefined ? 'first' : null;
    return stories[`${side}:default`] !== undefined ? 'default' : null;
  };

  const zone = (side: Side, page: number) => {
    const kind = storyFor(side, page);
    const editingHere = editingStory?.side === side && editingStory.page === page;
    const style = side === 'header' ? { top: m.header, left: m.left, right: m.right } : { bottom: m.footer, left: m.left, right: m.right };
    const label = side === 'header' ? 'En-tête' : 'Pied de page';
    const open = () => {
      if (!editable) return;
      setEditingStory({ side, kind: kind ?? (p.titlePg && page === 0 ? 'first' : 'default'), page });
    };
    return (
      <div
        className={`oel-hf oel-hf--${side}${editingHere ? ' is-editing' : ''}`}
        style={style}
        onDoubleClick={open}
        title={editable && !editingHere ? `Double-cliquez pour modifier : ${label.toLowerCase()}` : undefined}
      >
        {editingHere && editingStory ? (
          <div className="oel-hf__editor">
            <StoryEditor
              session={session}
              fragment={storyKey(side, editingStory.kind)}
              docMeta={docMeta}
              editable={editable}
              label={label}
              autofocus
              className="oel-doc oel-hf__content"
              onFocus={onStoryFocus}
            />
            <div className="oel-hf__bar" onMouseDown={(e) => e.preventDefault()}>
              <span className="oel-hf__label">{label}{editingStory.kind === 'first' ? ' · première page' : ''}</span>
              <Checkbox isSelected={p.titlePg} onChange={(v) => setPage(session, { titlePg: v })}>
                Première page différente
              </Checkbox>
              <Button size="sm" variant="ghost" onPress={() => (removeStory(session, side, editingStory.kind), setEditingStory(null))}>
                Supprimer
              </Button>
              <Button size="sm" variant="secondary" onPress={() => setEditingStory(null)}>
                Fermer
              </Button>
            </div>
          </div>
        ) : kind ? (
          <Fields html={stories[`${side}:${kind}`] ?? ''} page={page + 1} pages={count} className="oel-doc oel-hf__content" />
        ) : null}
      </div>
    );
  };

  // Ensure a story exists before editing it.
  useEffect(() => {
    if (!editingStory) return;
    const key = `${editingStory.side}:${editingStory.kind}`;
    const idx = storiesIndex(session.ydoc);
    if (!idx.has(key)) idx.set(key, '');
  }, [editingStory, session]);

  return (
    <div className="oel-pages" style={{ width: W * zoom, minHeight: total * zoom }}>
      <div className="oel-pages__inner" style={{ zoom, width: W }}>
        <div className="oel-sheets" style={{ height: total }} aria-hidden={!editingStory}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="oel-sheet" style={{ top: paginated ? i * stride : 0, height: sheetHeight, width: W, background: p.background ?? undefined }}>
              {zone('header', i)}
              {zone('footer', i)}
              {paginated && count > 1 && <span className="oel-sheet__num" aria-hidden>{i + 1}</span>}
            </div>
          ))}
        </div>
        <div className="oel-doc oel-body-wrap" ref={bodyRef} style={{ marginTop: m.top, marginLeft: m.left, width: W - m.left - m.right }}>
          <EditorContent editor={editor} />
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
        .map((kind) => ({ kind, ids: order[kind], title: kind === 'footnote' ? 'Notes de bas de page' : 'Notes de fin' })),
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
                <button type="button" className="oel-note__num" onClick={() => jump(kind, id)} aria-label={`Aller à l’appel de note ${i + 1}`}>
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
