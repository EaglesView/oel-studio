/**
 * Charts made in the editor (linked copies, `@oel/links`): an `ooxmlInline`
 * node with a chart and an `oid`, written straight into the Y.Doc so a copy
 * can be placed or updated while the document is closed. The open editor
 * follows through y-prosemirror like any remote change.
 */
import * as Y from 'yjs';
import type { ChartSpec } from '@oel/engine/generated/oelchart';
import { BODY } from './ydoc';

/** Default size of a chart in a document: 15 × 9 cm. */
export const DOC_CHART_SIZE = { cx: 5_400_000, cy: 3_240_000 };

function chartNode(oid: string, chart: ChartSpec, size: { cx: number; cy: number }): Y.XmlElement {
  const el = new Y.XmlElement('ooxmlInline');
  el.setAttribute('xml', '');
  el.setAttribute('label', 'Graphique');
  el.setAttribute('hidden', false as unknown as string);
  el.setAttribute('chart', chart as unknown as string);
  el.setAttribute('cx', size.cx as unknown as string);
  el.setAttribute('cy', size.cy as unknown as string);
  el.setAttribute('floating', false as unknown as string);
  el.setAttribute('oid', oid);
  return el;
}

/** Add a chart in its own paragraph at the start or the end of the body. */
export function insertChartParagraph(ydoc: Y.Doc, oid: string, chart: ChartSpec, where: 'start' | 'end', origin: unknown, size = DOC_CHART_SIZE) {
  const body = ydoc.getXmlFragment(BODY);
  ydoc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [chartNode(oid, chart, size)]);
    body.insert(where === 'start' ? 0 : body.length, [p]);
  }, origin);
}

/** The chart node with this `oid`, anywhere in the body (tables, sections…). */
export function findChart(ydoc: Y.Doc, oid: string): Y.XmlElement | null {
  const walk = (n: Y.XmlFragment | Y.XmlElement): Y.XmlElement | null => {
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'ooxmlInline' && c.getAttribute('oid') === oid) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(ydoc.getXmlFragment(BODY));
}

export function chartOf(ydoc: Y.Doc, oid: string): ChartSpec | null {
  return (findChart(ydoc, oid)?.getAttribute('chart') as unknown as ChartSpec | undefined) ?? null;
}

/** Replace a chart's spec. Returns false when the node is gone. */
export function setChart(ydoc: Y.Doc, oid: string, chart: ChartSpec, origin: unknown): boolean {
  const el = findChart(ydoc, oid);
  if (!el) return false;
  ydoc.transact(() => el.setAttribute('chart', chart as unknown as string), origin);
  return true;
}

/** A linked value (Figma I4): an editor-made `ooxmlInline` with an `oid`, no XML and no chart; its text is its label. */
export function findValue(ydoc: Y.Doc, oid: string): Y.XmlElement | null {
  const el = findChart(ydoc, oid);
  return el && !el.getAttribute('chart') && !el.getAttribute('xml') ? el : null;
}

/** The text a linked value shows, or null when it is gone. */
export function valueOf(ydoc: Y.Doc, oid: string): string | null {
  const el = findValue(ydoc, oid);
  return el ? ((el.getAttribute('label') as string | undefined) ?? '') : null;
}

/** Show a new value. Returns false when the node is gone. */
export function setValue(ydoc: Y.Doc, oid: string, text: string, origin: unknown): boolean {
  const el = findValue(ydoc, oid);
  if (!el) return false;
  ydoc.transact(() => el.setAttribute('label', text), origin);
  return true;
}
