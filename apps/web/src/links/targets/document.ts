/** A document as a link target: copies are body nodes found by their `oid` (charts today). */
import * as Y from 'yjs';
import type { ChartSpec } from '@oel/charts';
import { LINK_ORIGIN, pictureBytes, type LinkedValue } from '@oel/links';
import { chartOf, findChart, findLinkedTable, findPicture, pictureOf, pictureRecipe, setChart, setLinkedTable, setPicture, setValue, valueOf, type DocSession } from '@oel/docs';
import { renderWithRecipe } from '../../bureau/images';
import { linkMedia, preparePicture, prepareLocalRetouch, type LocalRetouch, type LinkTarget } from '../kinds';

export function documentTarget(s: DocSession): LinkTarget {
  const ydoc = s.ydoc;
  /** Copies' own retouches rendered over the incoming pixels, waiting for `write`. */
  const retouched = new Map<string, LocalRetouch>();
  return {
    kind: 'document',
    ydoc,
    exists: (objectId) => !!chartOf(ydoc, objectId) || !!pictureOf(ydoc, objectId) || !!findLinkedTable(ydoc, objectId) || valueOf(ydoc, objectId) != null,
    current(objectId): LinkedValue | null {
      const spec = chartOf(ydoc, objectId);
      return spec ? { kind: 'chart', spec } : null;
    },
    async prepare(value, objectId) {
      if (!(await preparePicture(ydoc, value, (blob) => s.addImage(blob), pictureBytes))) return false;
      const local = await prepareLocalRetouch(ydoc, value, pictureRecipe(ydoc, objectId), (blob) => s.addImage(blob), pictureBytes, renderWithRecipe).catch(() => null);
      if (local) retouched.set(objectId, local);
      else retouched.delete(objectId);
      return true;
    },
    write(objectId, value, link) {
      if (value.kind === 'value') return setValue(ydoc, objectId, value.text, LINK_ORIGIN);
      if (value.kind === 'table') return setLinkedTable(ydoc, objectId, value.table, link.theme ?? 'source', LINK_ORIGIN, link.edits);
      if (value.kind === 'chart') return setChart(ydoc, objectId, value.spec as ChartSpec, LINK_ORIGIN);
      if (value.kind === 'picture') {
        const path = linkMedia(ydoc).get(value.media.hash);
        if (!path) return false;
        // The copy's own retouch (L-8) is made again over the new pixels.
        const local = retouched.get(objectId);
        retouched.delete(objectId);
        if (local) return setPicture(ydoc, objectId, local.path, local.aspect, LINK_ORIGIN, { orig: local.orig, recipe: local.recipe });
        return setPicture(ydoc, objectId, path, value.media.width / Math.max(1, value.media.height), LINK_ORIGIN);
      }
      return false;
    },
    remove(objectId) {
      const table = findLinkedTable(ydoc, objectId);
      if (table?.parent) return void (table.parent as Y.XmlFragment).delete((table.parent as Y.XmlFragment).toArray().indexOf(table), 1);
      const el = findChart(ydoc, objectId) ?? findPicture(ydoc, objectId);
      const para = el?.parent;
      // A paragraph made for the copy goes with it.
      if (para instanceof Y.XmlElement && para.length === 1 && para.parent) (para.parent as Y.XmlFragment).delete((para.parent as Y.XmlFragment).toArray().indexOf(para), 1);
      else if (el?.parent) (el.parent as Y.XmlElement).delete((el.parent as Y.XmlElement).toArray().indexOf(el), 1);
    },
  };
}
