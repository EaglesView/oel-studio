/** A document as a link target: copies are body nodes found by their `oid` (charts today). */
import * as Y from 'yjs';
import type { ChartSpec } from '@oel/charts';
import { LINK_ORIGIN, pictureBytes, type LinkedValue } from '@oel/links';
import { chartOf, findChart, findLinkedTable, findPicture, pictureOf, setChart, setLinkedTable, setPicture, type DocSession } from '@oel/docs';
import { linkMedia, preparePicture, type LinkTarget } from '../kinds';

export function documentTarget(s: DocSession): LinkTarget {
  const ydoc = s.ydoc;
  return {
    kind: 'document',
    ydoc,
    exists: (objectId) => !!chartOf(ydoc, objectId) || !!pictureOf(ydoc, objectId) || !!findLinkedTable(ydoc, objectId),
    current(objectId): LinkedValue | null {
      const spec = chartOf(ydoc, objectId);
      return spec ? { kind: 'chart', spec } : null;
    },
    prepare: (value) => preparePicture(ydoc, value, (blob) => s.addImage(blob), pictureBytes),
    write(objectId, value, link) {
      if (value.kind === 'table') return setLinkedTable(ydoc, objectId, value.table, link.theme ?? 'source', LINK_ORIGIN);
      if (value.kind === 'chart') return setChart(ydoc, objectId, value.spec as ChartSpec, LINK_ORIGIN);
      if (value.kind === 'picture') {
        const path = linkMedia(ydoc).get(value.media.hash);
        return !!path && setPicture(ydoc, objectId, path, value.media.width / Math.max(1, value.media.height), LINK_ORIGIN);
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
