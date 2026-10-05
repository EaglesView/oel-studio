/** A document as a link target: copies are body nodes found by their `oid` (charts today). */
import * as Y from 'yjs';
import type { ChartSpec } from '@oel/charts';
import { LINK_ORIGIN, type LinkedValue } from '@oel/links';
import { chartOf, findChart, setChart, type DocSession } from '@oel/docs';
import type { LinkTarget } from '../kinds';

export function documentTarget(s: DocSession): LinkTarget {
  const ydoc = s.ydoc;
  return {
    kind: 'document',
    ydoc,
    exists: (objectId) => !!chartOf(ydoc, objectId),
    current(objectId): LinkedValue | null {
      const spec = chartOf(ydoc, objectId);
      return spec ? { kind: 'chart', spec } : null;
    },
    write: (objectId, value) => value.kind === 'chart' && setChart(ydoc, objectId, value.spec as ChartSpec, LINK_ORIGIN),
    remove(objectId) {
      const el = findChart(ydoc, objectId);
      const para = el?.parent;
      // A paragraph made for the copy goes with it.
      if (para instanceof Y.XmlElement && para.length === 1 && para.parent) (para.parent as Y.XmlFragment).delete((para.parent as Y.XmlFragment).toArray().indexOf(para), 1);
      else if (el?.parent) (el.parent as Y.XmlElement).delete((el.parent as Y.XmlElement).toArray().indexOf(el), 1);
    },
  };
}
