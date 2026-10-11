import { useEffect, useState } from 'react';
import { DocsEditor, previewFromYDoc, type DocSession } from '@oel/docs';
import '@oel/docs/styles.css';
import '@oel/img/styles.css';
import { createImageWorker } from '../images';
import type { WorkspaceProps } from '../OpenSheet';
import { exportDocx, identity, sessionFor } from '../docs';
import { features } from '../../edition';

/**
 * 01 · Feuille: the Docs-style editor (@oel/docs) on a collaborative,
 * offline-capable document. Compact at level 2 (ouvert sur place), with its
 * own breadcrumb, menus, outline and status bar at level 3 (plein écran).
 * Imported .docx keep their original package so export writes back
 * everything the editor does not touch.
 */
export function DocumentWorkspace({ paper, level, onDraft, registerFlush, onPatch, onExpand, onReduce, onBureau }: WorkspaceProps) {
  const [session, setSession] = useState<DocSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    sessionFor(paper, (docId) => onPatch?.({ data: { ...paper.data, docId } }))
      .then((s) => alive && setSession(s))
      .catch((e: Error) => alive && setError(e.message));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  // On close, the desk thumbnail is rebuilt from the shared document itself (no 700 ms wait).
  useEffect(() => {
    registerFlush(() => (session ? previewFromYDoc(session.ydoc) : null));
  }, [session, registerFlush]);

  if (error) return <p className="workspace-empty">Impossible d’ouvrir le document : {error}</p>;
  if (!session) return <p className="workspace-empty">Ouverture du document…</p>;
  return (
    <div className={`ws ws--docs ws--docs-${level === 3 ? 'full' : 'sheet'}`}>
      <DocsEditor
        createImageWorker={createImageWorker}
        session={session}
        variant={level === 3 ? 'full' : 'sheet'}
        title={paper.title}
        identity={identity()}
        collab={features.collab}
        onTitleChange={(title) => onPatch?.({ title })}
        onPreview={(p) => onDraft(p)}
        exportDocx={exportDocx}
        onBureau={onBureau}
        onExpand={onExpand}
        onReduce={onReduce}
      />
    </div>
  );
}
