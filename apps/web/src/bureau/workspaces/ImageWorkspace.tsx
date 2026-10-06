import { useEffect, useRef, useState } from 'react';
import { Atelier } from '@oel/img/ui';
import { isEmptyRecipe, originals } from '@oel/img';
import '@oel/img/styles.css';
import type { WorkspaceProps } from '../OpenSheet';
import { createImageWorker, rasterUrl, recipeDocFor, saveFile } from '../images';

/**
 * L1 · L'atelier d'image: opens at full screen (no « ouvert sur place »). The recipe is edited
 * in a Yjs document and mirrored on the paper; the desk shows the retouched rendering.
 */
export function ImageWorkspace({ paper, onPatch, onBureau, store }: WorkspaceProps) {
  const doc = recipeDocFor(paper.id, paper.data.image?.recipe);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [missing, setMissing] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const hash = paper.data.image?.original;
      const blob = (hash && (await originals().get(hash))) || (paper.data.imageUrl ? await fetch(paper.data.imageUrl).then((r) => r.blob()).catch(() => null) : null);
      if (!alive) return;
      if (blob) setOriginal(blob);
      else setMissing('Cette image n’a pas encore de fichier (exemple du bureau) : déposez une image sur le bureau pour la retoucher.');
    })();
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  // Mirror the recipe on the paper (one write per burst of edits).
  const patch = useRef(onPatch);
  patch.current = onPatch;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = doc.onChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const cur = store?.node(paper.id);
        if (!cur) return;
        patch.current?.({ data: { ...cur.data, image: { ...cur.data.image, recipe: doc.recipe() }, updatedAt: Date.now() } });
      }, 250);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [doc, paper.id, store]);

  return (
    <div className="ws ws--atelier">
      <Atelier
        title={paper.data.fileName ?? paper.title}
        original={original}
        missing={missing}
        doc={doc}
        createWorker={createImageWorker}
        onBureau={onBureau}
        onExport={saveFile}
        onRendered={async (r) => {
          const cur = store?.node(paper.id);
          if (!cur) return;
          const old = cur.data.image?.rendered;
          const rendered = isEmptyRecipe(doc.recipe()) ? undefined : await rasterUrl(r);
          patch.current?.({ data: { ...cur.data, image: { ...cur.data.image, rendered } } });
          if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
        }}
      />
    </div>
  );
}
