/** The bilingual site (plan solo MVP, S-8): paths, the docs list and the shared shortcut list. */
import { describe, expect, it } from 'vitest';
import { DOCS, alternatePath, docHref, href } from '../src/site/i18n';
import { shortcutGroups } from '../src/bureau/shortcuts';

describe('site paths', () => {
  it('keeps French at the root and English under /en', () => {
    expect(href('fr', '/')).toBe('/');
    expect(href('en', '/')).toBe('/en/');
    expect(docHref('fr', 'index')).toBe('/docs');
    expect(docHref('en', 'liens', 'states')).toBe('/en/docs/links#states');
    expect(alternatePath('fr', 'clavier')).toEqual({ fr: '/docs/clavier', en: '/en/docs/keyboard' });
  });

  it('gives every docs page a distinct slug and title in each language', () => {
    for (const lang of ['fr', 'en'] as const) {
      expect(new Set(DOCS.map((d) => d[lang].slug)).size).toBe(DOCS.length);
      expect(DOCS.every((d) => d[lang].title.length > 0)).toBe(true);
    }
  });
});

describe('shortcuts', () => {
  it('lists the same shortcuts in both languages, with English key names', () => {
    const fr = shortcutGroups('fr');
    const en = shortcutGroups('en');
    expect(en.map((g) => g.rows.length)).toEqual(fr.map((g) => g.rows.length));
    expect(fr.flatMap((g) => g.rows).length).toBe(39);
    const keys = en.flatMap((g) => g.rows.flatMap((r) => r.keys));
    for (const french of ['Entrée', 'Échap', 'Maj', 'Suppr', 'Espace']) expect(keys).not.toContain(french);
    expect(fr[0]!.rows.find((r) => r.what === 'Ouvrir sur place')!.keys).toEqual(['Entrée']);
    expect(en[0]!.rows.find((r) => r.what === 'Open in place')!.keys).toEqual(['Enter']);
  });
});
