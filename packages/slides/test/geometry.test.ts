import { describe, expect, it } from 'vitest';
import { formula, geometryPaths, hasPreset } from '../src/model/geometry';

const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe('shape geometry', () => {
  it('evaluates DrawingML guide formulas', () => {
    const v = new Map([['w', 200], ['adj', 25000], ['ss', 100]]);
    expect(formula('*/ w adj 100000', v)).toBe(50);
    expect(formula('+- w 0 10', v)).toBe(190);
    expect(formula('pin 0 adj 20000', v)).toBe(20000);
    expect(formula('?: -1 5 7', v)).toBe(7);
    expect(Math.round(formula('cos 100 5400000', v))).toBe(0);
    expect(Math.round(formula('at2 0 1', v))).toBe(5400000);
  });

  it('draws presets at any size', () => {
    expect(geometryPaths({ type: 'preset', prst: 'rect' }, 100, 50)[0]!.d).toBe('M0 0L100 0L100 50L0 50Z');
    // Rounded corners keep their radius (16.667 % of the short side) when the shape is stretched.
    const rr = geometryPaths({ type: 'preset', prst: 'roundRect' }, 300, 60)[0]!.d;
    expect(rr.startsWith('M0 10')).toBe(true);
    expect(rr).toContain('A10 10');
    // Adjust values from the file win.
    const tri = geometryPaths({ type: 'preset', prst: 'triangle', av: [{ name: 'adj', fmla: 'val 0' }] }, 100, 100)[0]!.d;
    expect(tri).toBe('M0 100L0 0L100 100Z');
    // Unknown presets fall back to a rectangle rather than vanishing.
    expect(hasPreset('cloud')).toBe(false);
    expect(geometryPaths({ type: 'preset', prst: 'cloud' }, 10, 10)[0]!.d).toBe('M0 0L10 0L10 10L0 10Z');
  });

  it('closes ellipses with arcs that end where they started', () => {
    const d = geometryPaths({ type: 'preset', prst: 'ellipse' }, 200, 100)[0]!.d;
    const n = nums(d);
    expect(n.slice(0, 2)).toEqual([0, 50]);
    expect(n.slice(-2)).toEqual([0, 50]);
  });

  it('scales freeform paths from their own coordinate space', () => {
    const d = geometryPaths(
      { type: 'custom', paths: [{ w: 10, h: 10, fill: 'norm', stroke: true, cmds: [{ t: 'M', x: '0', y: '0' }, { t: 'L', x: '10', y: '5' }, { t: 'C', p: ['10', '10', '0', '10', '0', '5'] }, { t: 'Z' }] }] },
      100,
      200,
    )[0]!.d;
    expect(d).toBe('M0 0L100 100C100 200 0 200 0 100Z');
  });
});
