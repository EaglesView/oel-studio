import { useEffect, useMemo, useState } from 'react';
import { useDeskState } from '@oel/desk/react';
import { Atelier, type AtelierImage } from '@oel/img/ui';
import '@oel/img/styles.css';
import type { WorkspaceProps } from '../OpenSheet';
import type { Paper } from '../model';
import { createImageWorker, exportGallery, galleryUndo, originalOf, recipeDocFor, saveFile } from '../images';
import { tr } from '@oel/i18n';

const MISSING = tr('Cette image n’a pas encore de fichier (exemple du bureau) : déposez une image sur le bureau pour la retoucher.', 'This image has no file yet (desk example): drop an image on the desk to retouch it.');

/** The original of `p`, loaded once per picture. */
function useOriginal(p: Paper | undefined) {
  const [state, setState] = useState<{ id: string; blob: Blob | null } | null>(null);
  useEffect(() => {
    if (!p) return;
    let alive = true;
    void originalOf(p).then((blob) => alive && setState({ id: p.id, blob }));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);
  const loaded = state && p && state.id === p.id ? state : null;
  return { blob: loaded?.blob ?? null, missing: loaded && !loaded.blob ? MISSING : undefined };
}

/**
 * L1 · L'atelier d'image, at full screen. A picture inside a gallery — or the gallery itself —
 * opens the gallery's atelier (L2): filmstrip, style shared by every picture.
 */
export function ImageWorkspace(props: WorkspaceProps) {
  const { paper, store } = props;
  const galleryId = paper.kind === 'gallery' ? paper.id : paper.parent && store?.node(paper.parent.id)?.kind === 'gallery' ? paper.parent.id : null;
  if (galleryId && store) return <GalleryAtelier {...props} galleryId={galleryId} />;
  return <SingleAtelier {...props} />;
}

function SingleAtelier({ paper, onBureau }: WorkspaceProps) {
  const doc = recipeDocFor(paper.id, paper.data.image?.recipe);
  const { blob, missing } = useOriginal(paper);
  return (
    <div className="ws ws--atelier">
      <Atelier
        title={paper.data.fileName ?? paper.title}
        original={blob}
        missing={missing}
        doc={doc}
        createWorker={createImageWorker}
        onBureau={onBureau}
        onExport={saveFile}
      />
    </div>
  );
}

function GalleryAtelier({ paper, onBureau, store, galleryId }: WorkspaceProps & { galleryId: string }) {
  const bureau = store!;
  const nodes = useDeskState(bureau, (s) => s.nodes);
  const gallery = nodes[galleryId] as Paper | undefined;
  const images = useMemo(
    () => bureau.childrenOf(galleryId).filter((n) => n.kind === 'image') as Paper[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, galleryId],
  );
  const [current, setCurrent] = useState<string | null>(paper.kind === 'image' ? paper.id : null);
  const currentId = current && images.some((i) => i.id === current) ? current : (images[0]?.id ?? null);
  const currentPaper = images.find((i) => i.id === currentId);
  const { blob, missing } = useOriginal(currentPaper);

  const ids = images.map((i) => i.id).join(' ');
  const undo = useMemo(() => galleryUndo([galleryId, ...ids.split(' ').filter(Boolean)]), [galleryId, ids]);
  useEffect(() => () => undo.destroy(), [undo]);

  if (!gallery) return null;
  const styleDoc = recipeDocFor(galleryId, gallery.data.gallery?.style);
  const film: AtelierImage[] = images.map((i) => ({
    id: i.id,
    title: i.data.fileName ?? i.title,
    doc: recipeDocFor(i.id, i.data.image?.recipe),
    thumbnail: i.data.image?.rendered ?? i.data.imageUrl,
  }));
  if (!currentPaper) {
    return (
      <div className="ws ws--atelier">
        <p className="workspace-empty">{tr('Cette galerie est vide : glissez des images sur sa planche, sur le bureau.', 'This gallery is empty: drag images onto its board, on the desk.')}</p>
      </div>
    );
  }
  return (
    <div className="ws ws--atelier">
      <Atelier
        title={currentPaper.data.fileName ?? currentPaper.title}
        original={blob}
        missing={missing}
        doc={recipeDocFor(currentPaper.id, currentPaper.data.image?.recipe)}
        createWorker={createImageWorker}
        onBureau={onBureau}
        onExport={saveFile}
        gallery={{
          title: gallery.title,
          styleDoc,
          images: film,
          current: currentPaper.id,
          onCurrent: setCurrent,
          undo,
          onExportAll: (o, ext) => exportGallery(bureau, galleryId, o, ext),
        }}
      />
    </div>
  );
}
