import { describe, expect, it } from 'vitest';
import {
  createDesk,
  fitRect,
  lodForZoom,
  nearestInDirection,
  readingOrder,
  wheelZoomFactor,
  screenToWorld,
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
