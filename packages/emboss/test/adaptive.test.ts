import { describe, expect, it } from 'vitest';
import { foldGroups } from '../src/components/AdaptiveToolbar';

const docs = [
  { id: 'history', priority: 1, width: 70 },
  { id: 'style', priority: 1, width: 120 },
  { id: 'font', priority: 3, width: 140 },
  { id: 'text', priority: 1, width: 180 },
  { id: 'paragraph', priority: 2, width: 220 },
  { id: 'insert', priority: 4, width: 150 },
  { id: 'tools', priority: 5, width: 80 },
];

describe('foldGroups (Figma J1–J2)', () => {
  it('folds nothing when everything fits', () => {
    expect(foldGroups(docs, 2000, 14)).toEqual([]);
  });
  it('folds the highest priority numbers first', () => {
    // 960 + 6×14 = 1044 wide; 900 available: Outils (5) then Insertion (4) go.
    expect(foldGroups(docs, 900, 14)).toEqual(['tools', 'insert']);
  });
  it('never folds priority 1, even when it still does not fit', () => {
    expect(foldGroups(docs, 100, 14)).toEqual(['tools', 'insert', 'font', 'paragraph']);
  });
  it('folds the rightmost first among equal priorities', () => {
    const g = [
      { id: 'a', priority: 3, width: 100 },
      { id: 'b', priority: 3, width: 100 },
      { id: 'c', priority: 1, width: 100 },
    ];
    expect(foldGroups(g, 250, 0)).toEqual(['b']);
  });
});
