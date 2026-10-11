import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { adoptPicture, findPicture, insertPictureParagraph, pictureOf, pictureRecipe, setPicture } from '../src/model/pictures';
import { BODY } from '../src/model/ydoc';

describe('linked pictures in a document (plan I-3)', () => {
  it('inserts, finds and re-points a picture by oid, keeping its width', () => {
    const ydoc = new Y.Doc();
    insertPictureParagraph(ydoc, 'p1', { path: 'word/media/a.png', cx: 4_000_000, cy: 2_000_000, alt: 'Affiche' }, 'end', 'person');
    expect(pictureOf(ydoc, 'p1')).toEqual({ path: 'word/media/a.png', cx: 4_000_000, cy: 2_000_000, alt: 'Affiche' });
    expect(findPicture(ydoc, 'nope')).toBeNull();
    // The source became square: same width, new height; the original run is dropped.
    expect(setPicture(ydoc, 'p1', 'word/media/b.png', 1, 'link')).toBe(true);
    const el = findPicture(ydoc, 'p1')!;
    expect(el.getAttribute('src')).toBe('media:word/media/b.png');
    expect(pictureOf(ydoc, 'p1')).toMatchObject({ path: 'word/media/b.png', cx: 4_000_000, cy: 4_000_000 });
    expect(setPicture(ydoc, 'gone', 'x', 1, 'link')).toBe(false);
  });
});

describe('a linked copy retouched on its own (plan L-8)', () => {
  it('keeps its recipe over the new source pixels, and loses it when updated without', () => {
    const ydoc = new Y.Doc();
    insertPictureParagraph(ydoc, 'p1', { path: 'word/media/a.png', cx: 4_000_000, cy: 2_000_000, alt: '' }, 'end', 'person');
    const recipe = { geometry: { crop: [0, 0, 0.5, 1] } };
    // The copy's crop rendered over the source's new pixels: half as wide.
    setPicture(ydoc, 'p1', 'word/media/oel-r.png', 1, 'link', { orig: 'word/media/b.png', recipe });
    expect(pictureRecipe(ydoc, 'p1')).toEqual(recipe);
    expect(findPicture(ydoc, 'p1')!.getAttribute('orig')).toBe('word/media/b.png');
    expect(pictureOf(ydoc, 'p1')).toMatchObject({ path: 'word/media/oel-r.png', cy: 4_000_000 });
    setPicture(ydoc, 'p1', 'word/media/c.png', 2, 'link');
    expect(pictureRecipe(ydoc, 'p1')).toBeNull();
  });
});

describe('a file\'s own picture becomes a linked copy (plan solo MVP, S-4)', () => {
  it('takes an oid by its package path, once, and then updates like any copy', () => {
    const ydoc = new Y.Doc();
    const own = new Y.XmlElement('image');
    own.setAttribute('path', 'word/media/image1.png');
    own.setAttribute('cx', 1_440_000 as unknown as string);
    own.setAttribute('cy', 1_440_000 as unknown as string);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [own]);
    ydoc.getXmlFragment(BODY).insert(0, [p]);
    expect(adoptPicture(ydoc, 'word/media/other.png', 'p1', 'person')).toBe(false);
    expect(adoptPicture(ydoc, 'word/media/image1.png', 'p1', 'person')).toBe(true);
    expect(adoptPicture(ydoc, 'word/media/image1.png', 'p2', 'person')).toBe(false);
    expect(setPicture(ydoc, 'p1', 'word/media/oel-logo.png', 1, 'link')).toBe(true);
    expect(pictureOf(ydoc, 'p1')).toMatchObject({ path: 'word/media/oel-logo.png', cx: 1_440_000, cy: 1_440_000 });
  });
});
