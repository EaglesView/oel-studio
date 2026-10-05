import { describe, expect, it } from 'vitest';
import type { LinkedTable } from '@oel/links';
import { linkedTableContent } from '../src/model/linkedTable';

const tall = (n: number): LinkedTable => ({
  rows: [[{ text: 'Poste', bold: true }, { text: 'T1', bold: true }], ...Array.from({ length: n - 1 }, (_, i) => [{ text: `Ligne ${i + 1}` }, { text: String(i), num: i, align: 'right' as const, fill: '#FFF4D6' }])],
  widths: [90, 45],
  header: 1,
});
const box = { cx: 6_000_000, cy: 12700 * 12 * 1.9 * 9 }; // nine rows at 12 pt

describe('linked tables on slides (plan I-4, I6 §3)', () => {
  it('keeps every row when they fit, with columns in the sheet’s proportions', () => {
    const { table, name } = linkedTableContent(tall(5), 'source', 'truncate', box);
    expect(table.rows).toHaveLength(5);
    expect(name).toBe('Tableau lié');
    expect(table.cols[0]! / table.cols[1]!).toBeCloseTo(2, 1);
    expect(table.rows[1]!.cells[1]!.fill).toEqual({ type: 'solid', color: '#FFF4D6' });
  });
  it('truncates to the rows that fit and says so', () => {
    const { table, name } = linkedTableContent(tall(40), 'source', 'truncate', box);
    expect(table.rows).toHaveLength(9);
    expect(name).toBe('Tableau lié · 9 lignes sur 40');
  });
  it('shows everything with smaller text when asked, never below 6 pt', () => {
    const { table } = linkedTableContent(tall(20), 'target', 'all', box);
    expect(table.rows).toHaveLength(20);
    const size = (table.rows[0]!.cells[0]!.text as unknown as { paras: Array<{ end: { size: number } }> }).paras[0]!.end.size;
    expect(size).toBeLessThan(12);
    expect(size).toBeGreaterThanOrEqual(6);
    // The destination's theme: no fills from the sheet.
    expect(table.rows[1]!.cells[1]!.fill).toBeUndefined();
  });
});
