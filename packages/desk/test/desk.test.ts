import { describe, expect, it } from 'vitest';
import {
  createDesk,
  fitRect,
  lodForZoom,
  nearestInDirection,
  resizeRect,
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

describe('resize (Figma L5: every desk item)', () => {
  it('resizes in one undo step, never below the minimum', () => {
    const s = createDesk({ nodes: [node('a', 0, 0)] });
    s.resize('a', { x: 10, y: 20, w: 300, h: 200 });
    expect(s.node('a')).toMatchObject({ x: 10, y: 20, w: 300, h: 200 });
    s.resize('a', { x: 10, y: 20, w: 5, h: 5 });
    expect(s.node('a')).toMatchObject({ w: 48, h: 48 });
    s.undo();
    s.undo();
    expect(s.node('a')).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('remembers the natural size of scaled content once', () => {
    const s = createDesk({ nodes: [node('a', 0, 0)] });
    s.resize('a', { x: 0, y: 0, w: 200, h: 200 }, { mode: 'scale' });
    s.resize('a', { x: 0, y: 0, w: 50, h: 50 }, { mode: 'scale' });
    expect(s.node('a')!.base).toEqual({ w: 100, h: 100 });
    s.resize('a', { x: 0, y: 0, w: 60, h: 60 }, { mode: 'none' });
    expect(s.node('a')!.w).toBe(50);
  });

  it('a drag is one undo step', () => {
    const s = createDesk({ nodes: [node('a', 0, 0)] });
    s.begin('Redimensionnement');
    for (const w of [120, 140, 160]) s.resizeTo('a', { x: 0, y: 0, w, h: w });
    s.end();
    s.undo();
    expect(s.node('a')!.w).toBe(100);
  });
});

describe('containers (Figma L5: a gallery is a folder)', () => {
  const desk = () => {
    const s = createDesk({ nodes: [{ ...node('g', 0, 0, 'gallery'), w: 600, h: 400, container: true }, node('a', 50, 60, 'image'), node('b', 900, 0, 'image'), node('n', 2000, 0, 'note')] });
    return s;
  };

  it('puts nodes inside with local offsets, and they follow the container', () => {
    const s = desk();
    expect(s.setParent(['a'], 'g')).toEqual(['a']);
    expect(s.node('a')!.parent).toEqual({ id: 'g', dx: 50, dy: 60 });
    s.moveBy(['g'], { x: 100, y: 10 });
    expect(s.node('a')).toMatchObject({ x: 150, y: 70, parent: { dx: 50, dy: 60 } });
    // Moving a child alone moves it inside its container.
    s.moveBy(['a'], { x: 5, y: 5 });
    expect(s.node('a')!.parent).toMatchObject({ dx: 55, dy: 65 });
    // Children are drawn above their container.
    expect(s.getState().order.indexOf('a')).toBe(s.getState().order.indexOf('g') + 1);
  });

  it('takes nodes out where they are, and undoes it', () => {
    const s = desk();
    s.setParent(['a'], 'g');
    s.moveBy(['g'], { x: 10, y: 0 });
    s.setParent(['a'], null);
    expect(s.node('a')).toMatchObject({ x: 60, y: 60 });
    expect(s.node('a')!.parent).toBeUndefined();
    s.undo();
    expect(s.node('a')!.parent).toMatchObject({ id: 'g' });
  });

  it('refuses what a container cannot hold', () => {
    const s = desk();
    s.attach('n', 'b');
    expect(s.canParent('g', 'g')).toBe(false);
    expect(s.canParent('n', 'g')).toBe(false); // stuck to something
    expect(s.canParent('b', 'a')).toBe(false); // not a container
    expect(s.setParent(['n'], 'g')).toEqual([]);
    s.setParent(['a'], 'g');
    expect(s.canAttach('n', 'a')).toBe(true); // a note may stick to a picture inside
    expect(s.canAttach('a', 'b')).toBe(false); // a picture inside cannot stick elsewhere
  });

  it('keeps children in place when the container is resized from the top-left, and never smaller than them', () => {
    const s = desk();
    s.setParent(['a'], 'g');
    s.resize('g', { x: -100, y: -50, w: 700, h: 450 });
    expect(s.node('a')).toMatchObject({ x: 50, y: 60, parent: { dx: 150, dy: 110 } });
    s.resize('g', { x: 100, y: 100, w: 48, h: 48 });
    const g = s.node('g')!;
    expect(g.x).toBeLessThanOrEqual(50);
    expect(g.x + g.w).toBeGreaterThanOrEqual(150);
  });

  it('enters and leaves; outside, a child stands for its container', () => {
    const s = desk();
    s.setParent(['a'], 'g');
    s.attach('n', 'a');
    expect(s.actsOn('a')).toBe('g');
    expect(s.actsOn('n')).toBe('g');
    expect(s.ordered().map((n) => n.id)).toEqual(['g', 'b']);
    s.enter('g');
    expect(s.actsOn('a')).toBe('a');
    expect(s.ordered().map((n) => n.id)).toEqual(['a', 'n']);
    s.selectAll();
    expect(s.getState().selection).toEqual(['a', 'n']);
    s.enter(null);
    expect(s.getState()).toMatchObject({ enteredId: null, selection: ['g'] });
  });

  it('finds the container under a point for a drop', () => {
    const s = desk();
    expect(s.containerAt({ x: 300, y: 200 }, ['b'])?.id).toBe('g');
    expect(s.containerAt({ x: 800, y: 200 }, ['b'])).toBeNull();
    expect(s.containerAt({ x: 300, y: 200 }, ['g'])).toBeNull();
  });

  it('releases the children of a deleted container', () => {
    const s = desk();
    s.setParent(['a'], 'g');
    expect(s.remove(['g'])).toEqual(['a']);
    expect(s.node('a')).toMatchObject({ x: 50, y: 60 });
    expect(s.node('a')!.parent).toBeUndefined();
    s.undo();
    expect(s.node('a')!.parent?.id).toBe('g');
  });
});

describe('resizeRect', () => {
  const r = { x: 0, y: 0, w: 200, h: 100 };
  it('moves the dragged edges only', () => {
    expect(resizeRect(r, 'se', { x: 50, y: 20 })).toEqual({ x: 0, y: 0, w: 250, h: 120 });
    expect(resizeRect(r, 'nw', { x: 50, y: 20 })).toEqual({ x: 50, y: 20, w: 150, h: 80 });
    expect(resizeRect(r, 'e', { x: -30, y: 99 })).toEqual({ x: 0, y: 0, w: 170, h: 100 });
  });
  it('keeps the shape, centres edge drags, grows from the centre with Alt', () => {
    expect(resizeRect(r, 'se', { x: 100, y: 0 }, { keepAspect: true })).toEqual({ x: 0, y: 0, w: 300, h: 150 });
    expect(resizeRect(r, 'n', { x: 0, y: -50 }, { keepAspect: true })).toEqual({ x: -50, y: -50, w: 300, h: 150 });
    expect(resizeRect(r, 'e', { x: 20, y: 0 }, { fromCenter: true })).toEqual({ x: -20, y: 0, w: 240, h: 100 });
  });
  it('stops at the minimum size, keeping the shape', () => {
    const t = resizeRect(r, 'se', { x: -500, y: -500 }, { keepAspect: true, min: 40 });
    expect(t.h).toBeCloseTo(40);
    expect(t.w).toBeCloseTo(80);
    expect(resizeRect(r, 'w', { x: 500, y: 0 }, { min: 40 })).toEqual({ x: 160, y: 0, w: 40, h: 100 });
  });
});
