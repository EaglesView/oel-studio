/**
 * The live model against the real codec (oelpptx-node): an untouched deck
 * goes through Yjs and back to a byte-identical .pptx; edits made the way
 * the editor makes them come back from PowerPoint's format.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readZipDirectory, readZipText } from '../../engine/src/zip';
import { SlidesDoc, plainText, setRunProps, shape, slideFromLayout, textBox, toPreview, type Deck } from '../src/model';

const require = createRequire(import.meta.url);
const codec = require('oelpptx-node') as {
  pptx_to_deck(b: Uint8Array): { json: string; media: Array<{ path: string }> };
  deck_to_pptx(json: string, original: Uint8Array | undefined, media: Array<{ path: string; bytes: Uint8Array }>): Uint8Array;
  new_deck(): { json: string };
};
const fixture = (n: number) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../fixtures/pptx/Presentation ${n}.pptx`, import.meta.url))));

const load = (bytes: Uint8Array) => JSON.parse(codec.pptx_to_deck(bytes).json) as Deck;
const live = (deck: Deck) => {
  const d = new SlidesDoc(new Y.Doc());
  d.seed(deck);
  return d;
};
/** Two docs kept in sync, like two browsers on the collab server. */
function pair(deck: Deck) {
  const a = live(deck);
  const b = new SlidesDoc(new Y.Doc());
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  a.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b.doc, u, 'remote'));
  b.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a.doc, u, 'remote'));
  return { a, b };
}

describe('SlidesDoc ↔ oelpptx', () => {
  it('writes an untouched deck back byte for byte (through Yjs)', async () => {
    for (const n of [1, 2, 3]) {
      const bytes = fixture(n);
      const d = live(load(bytes));
      // Through a second client, as a shared document would.
      const other = new SlidesDoc(new Y.Doc());
      Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(d.doc));
      const out = codec.deck_to_pptx(JSON.stringify(other.toDeck()), bytes, []);
      expect(load(out)).toEqual(load(bytes));
      // Every XML part is the same text (the writer left the slides alone).
      const [za, zb] = [readZipDirectory(bytes), readZipDirectory(out)];
      expect([...zb.keys()].sort()).toEqual([...za.keys()].sort());
      for (const [name, entry] of za) if (/\.(xml|rels)$/.test(name)) expect(await readZipText(out, zb.get(name)!), name).toBe(await readZipText(bytes, entry));
    }
  });

  it('writes the editor’s edits: text, new slides and shapes, deletion, notes', () => {
    const bytes = fixture(2);
    const d = live(load(bytes));
    const info = d.info();
    const ids = d.slideIds();
    const first = d.slide(ids[0]!)!;
    const title = first.elements.find((e) => e.ph?.type === 'ctrTitle' || e.ph?.type === 'title')!;
    d.edit(() => {
      d.updateElement(ids[0]!, title.id, { text: setRunProps({ ...title.text!, paras: [{ runs: [{ kind: 'text', text: 'Bienvenue au vernissage', props: {} }], props: {}, end: {} }] }, { bold: true }) });
      d.removeSlide(ids[1]!);
      const s = slideFromLayout(info.layouts[1]!);
      s.elements = s.elements.map((e) => (e.ph?.type === 'title' ? { ...e, text: { ...e.text!, paras: [{ runs: [{ kind: 'text', text: 'Programme', props: {} }], props: {}, end: {} }] } } : e));
      d.insertSlide(1, s);
      const box = textBox(info, { x: 914400, y: 914400, cx: 3000000, cy: 500000 });
      box.text!.paras = [{ runs: [{ kind: 'text', text: 'Entrée libre', props: { color: '#C00000' } }], props: {}, end: {} }];
      d.addElement(s.id, box);
      d.addElement(s.id, shape(info, 'star5', { x: 6000000, y: 2000000, cx: 1000000, cy: 1000000 }));
      d.notes(s.id)!.insert(0, 'Présenter les artistes');
    });
    const out = codec.deck_to_pptx(JSON.stringify(d.toDeck()), bytes, []);
    const back = load(out);
    expect(back.slides).toHaveLength(15);
    expect(plainText(back.slides[0]!.elements.find((e) => e.ph?.type === 'ctrTitle' || e.ph?.type === 'title')!.text)).toBe('Bienvenue au vernissage');
    const s = back.slides[1]!;
    expect(plainText(s.elements.find((e) => e.ph?.type === 'title')!.text)).toBe('Programme');
    const box = s.elements.find((e) => plainText(e.text) === 'Entrée libre')!;
    expect(box.text!.paras[0]!.runs[0]!.props!.color).toBe('#C00000');
    expect(s.elements.some((e) => e.geom?.type === 'preset' && e.geom.prst === 'star5')).toBe(true);
    expect(s.notes).toBe('Présenter les artistes');
  });

  it('merges concurrent edits of different facets of one shape', () => {
    const { a, b } = pair(load(fixture(1)));
    const sid = a.slideIds()[0]!;
    const el = a.slide(sid)!.elements[0]!;
    a.edit(() => a.updateElement(sid, el.id, { x: el.x + 127000 }));
    b.edit(() => b.updateElement(sid, el.id, { text: { ...el.text!, paras: [{ runs: [{ kind: 'text', text: 'Ensemble', props: {} }], props: {}, end: {} }] } }));
    for (const d of [a, b]) {
      const e = d.slide(sid)!.elements[0]!;
      expect(e.x).toBe(el.x + 127000);
      expect(plainText(e.text)).toBe('Ensemble');
    }
  });

  it('gives the desk a preview with the deck’s shape and colours', () => {
    const p = toPreview(live(load(fixture(3))));
    expect(p.size).toEqual({ width: 6858000, height: 9144000 });
    expect(p.slides).toHaveLength(3);
  });

  it('starts new presentations from the template', () => {
    const deck = JSON.parse(codec.new_deck().json) as Deck;
    const d = live(deck);
    expect(d.info().layouts.map((l) => l.name)).toContain('Titre et contenu');
    const out = codec.deck_to_pptx(JSON.stringify(d.toDeck()), undefined, []);
    expect(load(out).slides).toHaveLength(1);
  });
});
