import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { docsExtensions } from '../extensions';
import type { DocSession } from '../collab/session';
import type { DocMeta } from './useDocEditor';
import { styleRegistry } from './useDocEditor';
import { lists } from '../model/ydoc';

/**
 * A small collaborative editor for a secondary story (header, footer, note),
 * bound to its own Y fragment of the same document.
 */
export function StoryEditor({
  session,
  fragment,
  docMeta,
  editable,
  label,
  autofocus,
  className,
  onFocus,
  onReady,
}: {
  session: DocSession;
  fragment: string;
  docMeta: DocMeta;
  editable: boolean;
  label: string;
  autofocus?: boolean;
  className?: string;
  onFocus?: (e: Editor) => void;
  onReady?: (e: Editor) => void;
}) {
  const extensions = useMemo(
    () => docsExtensions({ fragment: session.ydoc.getXmlFragment(fragment), resolver: { url: session.mediaUrl }, pagination: false, placeholder: label }),
    [session, fragment, label],
  );
  const editor = useEditor(
    {
      extensions,
      editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      autofocus: autofocus ? 'end' : false,
      editorProps: { attributes: { class: 'oel-body oel-story', 'aria-label': label, lang: 'fr-CA' } },
      onFocus: ({ editor: e }) => onFocus?.(e as Editor),
    },
    [extensions],
  );
  useEffect(() => {
    if (!editor) return;
    editor.storage.paragraph.styles = styleRegistry(docMeta.styles);
    editor.storage.docList.numbering = docMeta.numbering;
    const l = lists(session.ydoc);
    editor.storage.docList.synthetic = new Map([...l.entries()].map(([k, v]) => [Number(k), v]));
    editor.storage.docList.onCreateList = (numId, kind) => l.set(String(numId), kind);
    editor.commands.refreshLists();
    onReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docMeta.styles, docMeta.numbering, session]);
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  return <EditorContent editor={editor} className={className} />;
}
