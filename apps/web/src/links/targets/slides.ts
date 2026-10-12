/** A deck as a link target: copies are slide elements (charts today). */
import type { ChartSpec } from '@oel/charts';
import { pictureBytes, type LinkedValue } from '@oel/links';
import { linkedTableContent, type SlideSession } from '@oel/slides';
import { renderWithRecipe } from '../../bureau/images';
import { linkMedia, preparePicture, prepareLocalRetouch, type LocalRetouch, type LinkTarget } from '../kinds';

export function slidesTarget(s: SlideSession): LinkTarget {
  const sd = s.slides;
  const slideOf = (objectId: string) => sd.slideIds().find((id) => sd.slide(id)?.elements.some((e) => e.id === objectId));
  const element = (objectId: string) => {
    const id = slideOf(objectId);
    return id ? sd.slide(id)!.elements.find((e) => e.id === objectId) : undefined;
  };
  /** Copies' own retouches rendered over the incoming pixels, waiting for `write`. */
  const retouched = new Map<string, LocalRetouch>();
  return {
    kind: 'slides',
    ydoc: s.ydoc,
    exists: (objectId) => !!slideOf(objectId),
    current(objectId): LinkedValue | null {
      const chart = element(objectId)?.chart;
      return chart ? { kind: 'chart', spec: chart } : null;
    },
    async prepare(value, objectId) {
      if (!(await preparePicture(s.ydoc, value, (blob) => s.addPicture(blob), pictureBytes))) return false;
      const local = await prepareLocalRetouch(s.ydoc, value, element(objectId)?.image?.recipe, (blob) => s.addPicture(blob), pictureBytes, renderWithRecipe).catch(() => null);
      if (local) retouched.set(objectId, local);
      else retouched.delete(objectId);
      return true;
    },
    write(objectId, value, link) {
      const slideId = slideOf(objectId);
      if (!slideId) return false;
      if (value.kind === 'table') {
        const el = element(objectId);
        if (!el) return false;
        // The copy keeps its place and width; it may grow down to the slide's bottom margin.
        const info = sd.info();
        const room = Math.max(el.cy, Math.round(info.height * 0.94) - el.y);
        const content = linkedTableContent(value.table, link.theme ?? 'source', link.view?.overflow ?? 'truncate', { cx: el.cx, cy: room });
        const needed = content.table.rows.reduce((a, r) => a + r.h, 0);
        sd.updateElement(slideId, objectId, { table: content.table, name: content.name, cy: Math.min(room, needed) });
        return true;
      }
      if (value.kind === 'chart') {
        sd.updateElement(slideId, objectId, { chart: value.spec as ChartSpec });
        return true;
      }
      if (value.kind === 'picture') {
        const path = linkMedia(s.ydoc).get(value.media.hash);
        const el = element(objectId);
        if (!path || !el) return false;
        // The copy keeps its frame width (its size is its own) and takes the new picture's proportions;
        // its own retouch (L-8) is made again over the new pixels.
        const local = retouched.get(objectId);
        retouched.delete(objectId);
        const { recipe: _r, orig: _o, svg: _s, ...image } = el.image ?? { media: '', mime: '' };
        const next = local ? { ...image, media: local.path, mime: local.mime, orig: local.orig, recipe: local.recipe } : { ...image, media: path, mime: value.media.mime };
        const aspect = local?.aspect ?? value.media.width / Math.max(1, value.media.height);
        sd.updateElement(slideId, objectId, { image: next, cy: Math.round(el.cx / aspect) });
        return true;
      }
      return false;
    },
    remove(objectId) {
      for (const id of sd.slideIds()) {
        const slide = sd.slide(id);
        if (!slide?.elements.some((e) => e.id === objectId)) continue;
        // A slide made for the copy (title placeholder + the copy) goes with it.
        if (slide.elements.length <= 2 && slide.elements.every((e) => e.id === objectId || !!e.ph)) sd.removeSlide(id);
        else sd.removeElements(id, [objectId]);
      }
    },
  };
}
