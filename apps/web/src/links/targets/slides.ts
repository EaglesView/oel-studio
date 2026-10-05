/** A deck as a link target: copies are slide elements (charts today). */
import type { ChartSpec } from '@oel/charts';
import type { LinkedValue } from '@oel/links';
import type { SlideSession } from '@oel/slides';
import type { LinkTarget } from '../kinds';

export function slidesTarget(s: SlideSession): LinkTarget {
  const sd = s.slides;
  const slideOf = (objectId: string) => sd.slideIds().find((id) => sd.slide(id)?.elements.some((e) => e.id === objectId));
  const element = (objectId: string) => {
    const id = slideOf(objectId);
    return id ? sd.slide(id)!.elements.find((e) => e.id === objectId) : undefined;
  };
  return {
    kind: 'slides',
    ydoc: s.ydoc,
    exists: (objectId) => !!slideOf(objectId),
    current(objectId): LinkedValue | null {
      const chart = element(objectId)?.chart;
      return chart ? { kind: 'chart', spec: chart } : null;
    },
    write(objectId, value) {
      const slideId = slideOf(objectId);
      if (!slideId || value.kind !== 'chart') return false;
      sd.updateElement(slideId, objectId, { chart: value.spec as ChartSpec });
      return true;
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
