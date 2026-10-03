import { useCallback } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Button } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import { VersionPanel as SharedVersionPanel } from '@oel/collab-client';
import type * as Y from 'yjs';
import { fragmentJSON, BODY } from '../model/ydoc';
import { toHTML } from './actions';

// ---------------------------------------------------------------------------
// Outline (Docs "Plan du document")
// ---------------------------------------------------------------------------

export function OutlinePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: Array<{ pos: number; level: number; text: string }> = [];
      e.state.doc.descendants((n, pos) => {
        if (n.type.name === 'paragraph') {
          if (n.attrs.outline != null && n.textContent.trim()) out.push({ pos, level: n.attrs.outline, text: n.textContent.trim() });
          return false;
        }
        return true;
      });
      return out;
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  return (
    <aside className="oel-panel oel-panel--outline" aria-label="Plan du document">
      <header className="oel-panel__head">
        <h2>Plan</h2>
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer le plan" onPress={onClose} />
      </header>
      {headings.length ? (
        <nav>
          <ul className="oel-outline">
            {headings.map((h) => (
              <li key={h.pos} style={{ paddingLeft: `${Math.min(h.level, 5) * 12}px` }}>
                <button type="button" className={`oel-outline__item oel-outline__item--${h.level}`} onClick={() => editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run()}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <p className="oel-panel__empty">Les titres ajoutés au document apparaîtront ici.</p>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

/** Version history with a read-only rendering of the selected version. */
export function VersionPanel({ session, onClose, onRestored }: { session: DocSession; onClose: () => void; onRestored: () => void }) {
  const renderPreview = useCallback((d: Y.Doc) => <div className="oel-doc oel-versions__doc" dangerouslySetInnerHTML={{ __html: toHTML(fragmentJSON(d.getXmlFragment(BODY))) }} />, []);
  const restore = useCallback(async (id: string) => {
    const { docsSchema } = await import('../extensions');
    await session.restoreVersion(id, docsSchema());
  }, [session]);
  return <SharedVersionPanel session={session} onClose={onClose} onRestored={onRestored} restore={restore} renderPreview={renderPreview} />;
}
