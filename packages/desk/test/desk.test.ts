import { describe, expect, it } from 'vitest';
import {
  createDesk,
  fitRect,
  lodForZoom,
  nearestInDirection,
  readingOrder,
  wheelZoomFactor,
  screenToWorld,
  threadPath,
  worldToScreen,
  zoomAt,
  type DeskNode,
} from '../src/core';

const node = (id: string, x: number, y: number, kind = 'doc'): DeskNode => ({
  id, kind, title: id, x, y, w: 100, h: 100, rotation: 0, data: null,
});

describe('geometry', () => {
  it('round-trips world and screen coordinates', () => {
    const v = { x: 120, y: -40, zoom: 0.5 };
    const p = { x: 300, y: 200 };
    expect(screenToWorld(worldToScreen(p, v), v)).toEqual(p);
  });

  it('keeps the anchor fixed when zooming', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(anchor, v);
    const after = screenToWorld(anchor, zoomAt(v, anchor, 2));
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('draws thumbnails when zoomed out, live content up close', () => {
    expect(lodForZoom(0.3)).toBe('thumbnail');
    expect(lodForZoom(0.6)).toBe('live');
  });

  it('keeps a mouse-wheel notch a small zoom step', () => {
    const notch = wheelZoomFactor(100);
    expect(notch).toBeGreaterThan(0.85);
    expect(notch).toBeLessThan(0.95);
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(notch); // 3 lines ≈ one notch
    expect(wheelZoomFactor(-2)).toBeGreaterThan(1);
  });

  it('fits bounds inside the screen', () => {
    const v = fitRect({ x: 0, y: 0, w: 2000, h: 1000 }, { w: 1000, h: 600 }, 0);
    expect(v.zoom).toBeCloseTo(0.5);
  });

  it('sorts in reading order and navigates spatially', () => {
    const a = node('a', 0, 0), b = node('b', 300, 10), c = node('c', 0, 400);
    expect(readingOrder([c, b, a]).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(nearestInDirection(a, [a, b, c], 'right')?.id).toBe('b');
    expect(nearestInDirection(a, [a, b, c], 'down')?.id).toBe('c');
    expect(nearestInDirection(a, [a, b, c], 'left')).toBeNull();
  });

});

describe('DeskStore', () => {
  it('records one undo step per drag gesture', () => {
    const desk = createDesk({ nodes: [node('a', 0, 0)] });
    desk.begin('Déplacement');
    desk.moveBy(['a'], { x: 10, y: 0 });
    desk.moveBy(['a'], { x: 10, y: 0 });
    desk.end();
    expect(desk.node('a')?.x).toBe(20);
    expect(desk.undo()).toBe('Déplacement');
    expect(desk.node('a')?.x).toBe(0);
    expect(desk.redo()).toBe('Déplacement');
    expect(desk.node('a')?.x).toBe(20);
  });

  it('removes links with their nodes and keeps undo', () => {
    const desk = createDesk({
      nodes: [node('a', 0, 0), node('b', 200, 0)],
      links: [{ id: 'l', from: 'a', to: 'b', state: 'fresh' }],
    });
    desk.remove(['a']);
    expect(desk.getState().links).toHaveLength(0);
    desk.undo();
    expect(desk.getState().links).toHaveLength(1);
    expect(desk.node('a')).toBeDefined();
  });

  it('toggles selection and notifies subscribers', () => {
    const desk = createDesk({ nodes: [node('a', 0, 0), node('b', 200, 0)] });
    let calls = 0;
    desk.subscribe(() => calls++);
    desk.select(['a']);
    desk.select(['b'], 'toggle');
    desk.select(['a'], 'toggle');
    expect(desk.getState().selection).toEqual(['b']);
    expect(calls).toBe(3);
  });

  it('never zooms out past the limit, even when fitting', () => {
    const desk = createDesk({ nodes: [node('a', 0, 0), node('b', 20000, 0)], zoom: { min: 0.25 } });
    desk.setScreen(1000, 600);
    desk.zoomToFit();
    expect(desk.getState().viewport.zoom).toBe(0.25);
    for (let i = 0; i < 50; i++) desk.zoomBy(0.5);
    expect(desk.getState().viewport.zoom).toBe(0.25);
    expect(desk.isMaxZoomOut).toBe(true);
    desk.zoomReset();
    expect(desk.getState().viewport.zoom).toBe(1);
  });

  it('does not move locked papers', () => {
    const desk = createDesk({ nodes: [{ ...node('a', 0, 0), locked: true }] });
    desk.nudge(['a'], { x: 10, y: 10 });
    expect(desk.node('a')?.x).toBe(0);
  });
});

describe('threadPath', () => {
  it('runs from edge to edge with its middle between them', () => {
    const t = threadPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 0, w: 100, h: 100 });
    expect(t.from).toEqual({ x: 100, y: 50 });
    expect(t.to).toEqual({ x: 300, y: 50 });
    expect(t.mid).toEqual({ x: 200, y: 50 });
    expect(t.d).toBe('M100 50 C200 50 200 50 300 50');
  });

  it('leaves from the top or bottom when papers are stacked', () => {
    const t = threadPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 400, w: 100, h: 100 });
    expect(t.from).toEqual({ x: 50, y: 100 });
    expect(t.to).toEqual({ x: 50, y: 400 });
  });
});

describe('attachments (Figma K)', () => {
  const desk = () => createDesk({ nodes: [node('a', 0, 0), node('b', 300, 0), { ...node('n', 80, 20, 'note'), w: 40, h: 40 }] });

  it('sticks a node to another and draws it just above', () => {
    const s = desk();
    expect(s.attach('n', 'a')).toBe(true);
    expect(s.node('n')?.attach).toEqual({ to: 'a', dx: 80, dy: 20 });
    s.bringToFront(['a']);
    expect(s.getState().order).toEqual(['b', 'a', 'n']);
    expect(s.ordered().map((n) => n.id)).toEqual(['a', 'n', 'b']);
    expect(s.attachedTo('a').map((n) => n.id)).toEqual(['n']);
  });

  it('keeps one level: no chains, no self, no target that is attached', () => {
    const s = desk();
    s.attach('n', 'a');
    expect(s.attach('b', 'n')).toBe(false);
    expect(s.attach('a', 'b')).toBe(false); // a has a note on it
    expect(s.attach('b', 'b')).toBe(false);
  });

  it('carries stuck nodes on move, nudge, align and distribute', () => {
    const s = desk();
    s.attach('n', 'a');
    s.moveBy(['a'], { x: 10, y: 5 });
    expect(s.node('n')).toMatchObject({ x: 90, y: 25 });
    s.nudge(['a', 'n'], { x: 10, y: 0 });
    expect(s.node('n')).toMatchObject({ x: 100, y: 25, attach: { dx: 80, dy: 20 } });
    s.align(['a', 'b', 'n'], 'top');
    expect(s.node('a')?.y).toBe(0);
    expect(s.node('n')?.y).toBe(20);
    s.distribute(['b', 'a', 'n'], 10);
    expect(s.node('b')?.x).toBe(s.node('a')!.x + 110);
    expect(s.node('n')).toMatchObject({ x: s.node('a')!.x + 80, y: s.node('a')!.y + 20 });
  });

  it('slides a stuck node along its target when it moves alone', () => {
    const s = desk();
    s.attach('n', 'a');
    s.moveBy(['n'], { x: 0, y: 30 });
    expect(s.node('n')?.attach).toEqual({ to: 'a', dx: 80, dy: 50 });
    s.update('n', { x: 70 });
    expect(s.node('n')?.attach).toEqual({ to: 'a', dx: 70, dy: 50 });
    s.update('a', { x: 100 });
    expect(s.node('n')?.x).toBe(170);
  });

  it('unsticks in place when the target is deleted, in one undo step', () => {
    const s = desk();
    s.attach('n', 'a');
    s.moveBy(['a'], { x: 5, y: 0 });
    expect(s.remove(['a'])).toEqual(['n']);
    expect(s.node('n')).toMatchObject({ x: 85, y: 20 });
    expect(s.node('n')?.attach).toBeUndefined();
    s.undo();
    expect(s.node('n')?.attach?.to).toBe('a');
  });

  it('round-trips attach and detach through undo/redo', () => {
    const s = desk();
    s.attach('n', 'a', { x: 60, y: 10 });
    expect(s.node('n')).toMatchObject({ x: 60, y: 10 });
    expect(s.detach(['n', 'b'])).toEqual(['n']);
    expect(s.node('n')?.attach).toBeUndefined();
    expect(s.undo()).toBe('Décollage');
    expect(s.node('n')?.attach?.to).toBe('a');
    expect(s.undo()).toBe('Collage');
    expect(s.node('n')).toMatchObject({ x: 80, y: 20 });
    expect(s.node('n')?.attach).toBeUndefined();
    s.redo();
    expect(s.node('n')?.attach).toEqual({ to: 'a', dx: 60, dy: 10 });
  });

  it('picks the node with the largest overlap', () => {
    const s = createDesk({ nodes: [node('a', 0, 0), node('b', 100, 0), { ...node('n', 70, 10, 'note'), w: 40, h: 40 }] });
    expect(s.overlapping('n')?.id).toBe('a'); // 30 px over a, 10 px over b
    s.moveBy(['n'], { x: 20, y: 0 });
    expect(s.overlapping('n')?.id).toBe('b');
    expect(s.overlapping('n', (c) => c.id !== 'b')?.id).toBe('a');
    s.moveBy(['n'], { x: 500, y: 0 });
    expect(s.overlapping('n')).toBeNull();
  });

  it('settles attachments given at creation and drops dangling ones', () => {
    const s = createDesk({ nodes: [node('a', 10, 10), { ...node('n', 0, 0), attach: { to: 'a', dx: 5, dy: 5 } }, { ...node('m', 0, 0), attach: { to: 'gone', dx: 0, dy: 0 } }] });
    expect(s.node('n')).toMatchObject({ x: 15, y: 15 });
    expect(s.node('m')?.attach).toBeUndefined();
  });
});
