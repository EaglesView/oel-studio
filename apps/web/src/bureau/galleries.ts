/**
 * L2 · galleries on the desk: a planche (desk container) around images. Pure desk logic, so it
 * is tested without the image engine; recipes and rendering live in `images.ts`.
 */
import { tr } from '@oel/i18n';
import { blankTitle, uid, type Bureau, type Paper } from './model';

/** Room around the pictures inside a planche: header (title, style), sides, footer. */
export const GALLERY_PAD = { top: 64, side: 28, bottom: 44 };

/** « Modifier les images » : a gallery around these images (they keep their places). */
export function createGallery(store: Bureau, imageIds: string[]): string | null {
  const ids = imageIds.filter((id) => store.node(id)?.kind === 'image');
  const b = store.bounds(ids);
  if (!b || !ids.length) return null;
  const id = uid('gallery');
  const now = Date.now();
  const g: Paper = {
    id,
    kind: 'gallery',
    title: blankTitle('gallery'),
    x: b.x - GALLERY_PAD.side,
    y: b.y - GALLERY_PAD.top,
    w: b.w + GALLERY_PAD.side * 2,
    h: b.h + GALLERY_PAD.top + GALLERY_PAD.bottom,
    rotation: 0,
    container: true,
    data: { preview: { kind: 'unsupported' }, status: { state: 'ready' }, editor: 'JB', updatedAt: now, gallery: {} },
  };
  store.begin(tr(`Galerie de ${ids.length} images`, `Gallery of ${ids.length} images`));
  store.add([g], { select: false });
  store.setParent(ids, id);
  store.end();
  store.select([id]);
  return id;
}

/** « Étaler les images » : a tidy grid inside the planche, which fits around it. */
export function layoutGallery(store: Bureau, galleryId: string) {
  const g = store.node(galleryId);
  const kids = store.childrenOf(galleryId).filter((n) => !n.attach);
  if (!g || !kids.length) return;
  const cols = Math.ceil(Math.sqrt(kids.length));
  const gap = 24;
  const cellW = Math.max(...kids.map((k) => k.w));
  const cellH = Math.max(...kids.map((k) => k.h));
  store.begin(tr('Images étalées', 'Images spread out'));
  kids.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    store.update(
      k.id,
      { x: g.x + GALLERY_PAD.side + col * (cellW + gap) + (cellW - k.w) / 2, y: g.y + GALLERY_PAD.top + row * (cellH + gap) + (cellH - k.h) / 2, rotation: 0 },
      { history: false },
    );
  });
  const rows = Math.ceil(kids.length / cols);
  store.resizeTo(galleryId, {
    x: g.x,
    y: g.y,
    w: GALLERY_PAD.side * 2 + cols * cellW + (cols - 1) * gap,
    h: GALLERY_PAD.top + GALLERY_PAD.bottom + rows * cellH + (rows - 1) * gap,
  });
  store.end();
}

