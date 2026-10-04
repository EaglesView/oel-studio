import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { DocSession } from '../collab/session';
import { sanitizeStylesheet } from '../model/format';
import type { PageInfo } from '../model/sections';
import type { DocFont } from '../model/types';
import { loadDocumentFonts } from './fonts';
import { PageView } from './PageView';
import { useDocEditor, useDocMeta } from './useDocEditor';

export interface DocFirstPageProps {
  session: DocSession;
  /** Called once the first page is laid out with its fonts and pictures: the element shows exactly that page (`fonts`: the document's). */
  onReady: (page: HTMLElement, size: { width: number; height: number }, fonts: DocFont[]) => void;
  /** Laying out the page failed. */
  onError?: (error: unknown) => void;
}

const noop = () => {};
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** Resolves once pagination has not changed for `quiet` ms (or after `max` ms). */
function laidOut(editor: Editor, quiet = 350, max = 5000): Promise<void> {
  return new Promise((resolve) => {
    const st = editor.storage.pagination;
    let t: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(t);
      clearTimeout(cap);
      st.listeners.delete(bump);
      resolve();
    };
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(done, quiet);
    };
    const cap = setTimeout(done, max);
    st.listeners.add(bump);
    bump();
  });
}

/**
 * The document's first page, read-only, drawn by the editor's own layout
 * (pagination, headers and footers, floating objects, the file's fonts), for
 * desk thumbnails. Mount it off screen (laid out, not `display: none`).
 */
export function DocFirstPage({ session, onReady, onError }: DocFirstPageProps) {
  const docMeta = useDocMeta(session);
  const editor = useDocEditor(session, docMeta, { editable: false, pagination: true });
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const failed = useRef(onError);
  failed.current = onError;

  useEffect(() => {
    if (!editor) return;
    let alive = true;
    void (async () => {
      await loadDocumentFonts(docMeta.fonts, session.mediaUrl);
      await laidOut(editor);
      const first = editor.storage.pagination.pages[0] as PageInfo | undefined;
      if (!alive) return;
      if (!first) throw new Error('aucune page mise en page');
      setPage(first);
      await frame();
      await frame();
      const el = ref.current;
      if (!alive || !el) return;
      await Promise.all([...el.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
      if (alive) ready.current(el, { width: first.width, height: first.height }, docMeta.fonts);
    })().catch((e: unknown) => alive && failed.current?.(e));
    return () => void (alive = false);
    // Once per editor: the thumbnail is a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;
  return (
    <div
      ref={ref}
      className="oel-first-page"
      style={{ ['--oel-paper' as string]: '#fff', position: 'relative', overflow: 'hidden', width: page?.width ?? 816, height: page?.height ?? 1056, background: docMeta.background ?? '#fff' }}
    >
      <style>{sanitizeStylesheet(docMeta.stylesCss)}</style>
      <div style={{ marginLeft: -(page?.sheetLeft ?? 0), marginTop: -(page?.top ?? 0) }}>
        <PageView editor={editor} session={session} docMeta={docMeta} editable={false} paginated zoom={1} onStoryFocus={noop} editingStory={null} setEditingStory={noop} />
      </div>
    </div>
  );
}
