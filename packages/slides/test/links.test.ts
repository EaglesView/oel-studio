/** Linked copies follow copy, cut, paste and slide duplication (Figma G7). */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { linksOf, type LinkDef } from '@oel/links';
import { SlidesDoc, chartFrame, type Deck } from '../src/model';
import { SlidesController } from '../src/ui/controller';
import type { SlideSession } from '../src/collab/session';

const require = createRequire(import.meta.url);
const codec = require('oelpptx-node') as { new_deck(): { json: string } };

function setup(docId = 'deck') {
  const ydoc = new Y.Doc();
  const slides = new SlidesDoc(ydoc);
  slides.seed(JSON.parse(codec.new_deck().json) as Deck);
  const session = { ydoc, slides, media: { subscribe: () => () => {} }, status: { docId, readOnly: false } } as unknown as SlideSession;
  return { ydoc, slides, ctl: new SlidesController(session) };
}

const link = (objectId: string): LinkDef => ({
  id: 'l1',
  source: { docId: 'budget', kind: 'spreadsheet', ref: { kind: 'chart', sheetId: 's', chartId: 'g' }, title: 'Budget', label: 'Dépenses' },
  target: { objectId, label: 'diapo 1' },
  carries: 'chart',
  mode: 'live',
  snapshot: { rev: 'r', at: 1, by: 'JB' },
});

function withChart() {
  const t = setup();
  const el = chartFrame({ groups: [] } as never, { x: 0, y: 0, cx: 100, cy: 100 });
  const slide = t.slides.slideIds()[0]!;
  t.slides.addElement(slide, el);
  linksOf(t.ydoc).put(link(el.id));
  t.ctl.selection = [el.id];
  return { ...t, el, slide };
}

describe('linked copies in slides', () => {
  it('copy + paste makes a second link to the same source', () => {
    const { ydoc, ctl, el } = withChart();
    ctl.copy();
    ctl.paste();
    const [pasted] = ctl.selection;
    expect(pasted).not.toBe(el.id);
    expect(linksOf(ydoc).byObject(pasted!)?.source.docId).toBe('budget');
    expect(linksOf(ydoc).byObject(el.id)?.id).toBe('l1');
  });

  it('cut + paste keeps the copy linked, also into another deck', () => {
    const { ctl } = withChart();
    ctl.cut();
    const other = setup('deck-2');
    other.ctl.paste();
    const [pasted] = other.ctl.selection;
    expect(pasted).toBeTruthy();
    expect(linksOf(other.ydoc).byObject(pasted!)?.source.ref).toEqual(link('x').source.ref);
  });

  it('duplicating a slide gives its linked copy its own id and link', () => {
    const { ydoc, slides, ctl, el, slide } = withChart();
    ctl.duplicateSlide(slide);
    const copySlide = slides.slideIds()[1]!;
    const copied = slides.slide(copySlide)!.elements.find((e) => e.kind === 'graphic')!;
    expect(copied.id).not.toBe(el.id);
    expect(linksOf(ydoc).byObject(copied.id)).toMatchObject({ target: { label: 'diapo 2' }, source: { docId: 'budget' } });
  });
});
