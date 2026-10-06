import { useEffect, useState } from 'react';
import { SlidesEditor, toPreview, type SlideSession } from '@oel/slides';
import '@oel/slides/styles.css';
import '@oel/img/styles.css';
import { createImageWorker } from '../images';
import type { WorkspaceProps } from '../OpenSheet';
import { identity } from '../docs';
import { exportSlides, slideSessionFor, takePresent } from '../slides';

/**
 * 02 · Diapositives (C2): the presentation editor (@oel/slides) on a
 * collaborative, offline-capable deck — filmstrip, the slide as a sheet of
 * paper, notes, slideshow. Imported .pptx keep their original package, so
 * export writes back everything the editor does not touch (animations,
 * transitions, charts…). Compact at level 2 (ouvert sur place), with menus,
 * notes and history at level 3 (plein écran).
 */
export function SlidesWorkspace({ paper, level, onDraft, registerFlush, onPatch, onExpand, onReduce, onBureau }: WorkspaceProps) {
  const [session, setSession] = useState<SlideSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    slideSessionFor(paper, (docId) => onPatch?.({ data: { ...paper.data, docId } }))
      .then((s) => alive && setSession(s))
      .catch((e: Error) => alive && setError(e.message));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  // On close, the desk thumbnail is rebuilt from the deck itself.
  useEffect(() => {
    registerFlush(() => (session ? toPreview(session.slides) : null));
  }, [session, registerFlush]);

  if (error) return <p className="workspace-empty">Impossible d’ouvrir la présentation : {error}</p>;
  if (!session) return <p className="workspace-empty">Ouverture de la présentation…</p>;
  return (
    <div className={`ws ws--slides-editor ws--slides-${level === 3 ? 'full' : 'sheet'}`}>
      <SlidesEditor
        createImageWorker={createImageWorker}
        session={session}
        variant={level === 3 ? 'full' : 'sheet'}
        title={paper.title}
        identity={identity()}
        onTitleChange={(title) => onPatch?.({ title })}
        onPreview={(p) => onDraft(p)}
        exportFile={exportSlides}
        autoPresent={takePresent(paper.id)}
        onBureau={onBureau}
        onExpand={onExpand}
        onReduce={onReduce}
      />
    </div>
  );
}
