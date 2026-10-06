import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { findPicture, insertPictureParagraph, pictureOf, pictureRecipe, setPicture } from '../src/model/pictures';

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
