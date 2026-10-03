import { describe, expect, it } from 'vitest';
import { fontLabel } from '../src/ui/fonts';
import type { DocFont } from '../src/model/types';

describe('font menu labels', () => {
  const fonts: DocFont[] = [
    { name: 'Felix Titling', substitute: 'Cinzel', embedded: [] },
    { name: 'Comfortaa', substitute: null, embedded: [{ path: 'word/fonts/font1.otf', weight: 400, italic: false }] },
    { name: 'Calibri', substitute: 'Carlito', embedded: [] },
  ];
  const installed = new Set(['Calibri']);
  const has = (n: string) => installed.has(n);

  it('names the substitute when the font is missing', () => {
    expect(fontLabel('Felix Titling', fonts, has)).toBe('Felix Titling (remplacée par Cinzel)');
  });

  it('keeps the plain name when installed, embedded or unknown', () => {
    expect(fontLabel('Calibri', fonts, has)).toBe('Calibri');
    expect(fontLabel('Comfortaa', fonts, has)).toBe('Comfortaa');
    expect(fontLabel('Arial', fonts, has)).toBe('Arial');
  });
});
