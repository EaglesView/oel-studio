import { describe, expect, it } from 'vitest';
import { createDesk } from '@oel/desk';
import { GALLERY_PAD, createGallery, layoutGallery } from '../src/bureau/galleries';
import type { Paper, PaperData } from '../src/bureau/model';

const img = (id: string, x: number, y: number, w = 300, h = 200): Paper => ({
  id, kind: 'image', title: id, x, y, w, h, rotation: 2, data: { preview: { kind: 'image' }, status: { state: 'ready' } } as PaperData,
});

describe('galleries (Figma L2)', () => {
  it('wraps the selected images, which keep their places, in one undo step', () => {
    const store = createDesk<PaperData>({ nodes: [img('a', 0, 0), img('b', 400, 100), { ...img('d', 0, 0), kind: 'document' }] });
    const id = createGallery(store, ['a', 'b', 'd'])!;
    const g = store.node(id)!;
    expect(g).toMatchObject({ kind: 'gallery', container: true, x: -GALLERY_PAD.side, y: -GALLERY_PAD.top, w: 700 + 2 * GALLERY_PAD.side, h: 300 + GALLERY_PAD.top + GALLERY_PAD.bottom });
    expect(store.childrenOf(id).map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(store.node('a')).toMatchObject({ x: 0, y: 0 });
    expect(store.node('d')!.parent).toBeUndefined();
    expect(store.getState().selection).toEqual([id]);
    store.undo();
    expect(store.node(id)).toBeUndefined();
    expect(store.node('a')!.parent).toBeUndefined();
  });

  it('lays the pictures out in a grid and fits the planche around them', () => {
    const store = createDesk<PaperData>({ nodes: [img('a', 0, 0), img('b', 900, 700, 200, 100), img('c', 50, 400)] });
    const id = createGallery(store, ['a', 'b', 'c'])!;
    layoutGallery(store, id);
    const g = store.node(id)!;
    const kids = store.childrenOf(id);
    for (const k of kids) {
      expect(k.rotation).toBe(0);
      expect(k.x).toBeGreaterThanOrEqual(g.x);
      expect(k.y).toBeGreaterThanOrEqual(g.y + GALLERY_PAD.top - 1);
      expect(k.x + k.w).toBeLessThanOrEqual(g.x + g.w);
      expect(k.y + k.h).toBeLessThanOrEqual(g.y + g.h);
    }
    expect(g.w).toBe(GALLERY_PAD.side * 2 + 2 * 300 + 24);
    store.undo();
    expect(store.node('b')).toMatchObject({ x: 900, y: 700 });
  });
});
