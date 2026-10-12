import { afterEach, describe, expect, it } from 'vitest';
import { lang, locale, messages, plural, setLang, toLang, tr, workerOptions } from '../src';

afterEach(() => setLang(null));

describe('@oel/i18n', () => {
  it('is French without a page', () => {
    expect(lang()).toBe('fr');
    expect(locale()).toBe('fr-CA');
    expect(messages({ a: 'Ouvrir' }, { a: 'Open' }).a).toBe('Ouvrir');
  });

  it('follows setLang', () => {
    setLang('en');
    expect(locale()).toBe('en-CA');
    expect(tr('Ouvrir', 'Open')).toBe('Open');
    expect(messages({ n: (k: number) => `${k} f` }, { n: (k) => `${k} e` }).n(2)).toBe('2 e');
  });

  it('parses tags', () => {
    expect(toLang('en-CA')).toBe('en');
    expect(toLang('EN')).toBe('en');
    expect(toLang('fr-CA')).toBe('fr');
    expect(toLang(undefined)).toBe('fr');
  });

  it('tells a worker the language through its name', () => {
    setLang('en');
    const { name } = workerOptions('oel-engine');
    expect(name).toBe('oel-engine#lang=en');
    setLang(null);
    const g = globalThis as { name?: string };
    g.name = name;
    expect(lang()).toBe('en');
    delete g.name;
  });

  it('pluralises per language', () => {
    expect(plural(0, 'fichier', 'fichiers')).toBe('fichier');
    setLang('en');
    expect(plural(0, 'file', 'files')).toBe('files');
    expect(plural(1, 'file', 'files')).toBe('file');
  });
});
