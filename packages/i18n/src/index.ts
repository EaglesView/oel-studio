/**
 * Interface language of the Bureau and its editors: French (fr-CA) by default, or English.
 *
 * Packages never store or choose the language: they follow the page's `<html lang>`, which the app
 * sets before any module runs (from the user's choice). The language is fixed for the life of the
 * page — changing it reloads — so message tables can be picked once, at module load:
 *
 *   const t = messages({ save: 'Enregistrer', count: (n: number) => `${n} fichiers` },
 *                      { save: 'Save', count: (n) => `${n} files` });
 *
 * English is typed against French, so a missing or misshapen English entry fails the typecheck.
 * A Web Worker has no page: it is created with `workerOptions(name)`, whose name carries the
 * language. Elsewhere (tests) the language is French unless `setLang` says otherwise.
 */
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];

/** BCP 47 tag for `<html lang>` and for `Intl` formatters. */
export const LOCALES: Record<Lang, 'fr-CA' | 'en-CA'> = { fr: 'fr-CA', en: 'en-CA' };

let forced: Lang | null = null;

/** Parse a language tag or a stored choice: anything English is `en`, everything else `fr`. */
export function toLang(tag: string | null | undefined): Lang {
  return tag?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

const WORKER_LANG = /#lang=(fr|en)$/;

/** The interface language: the page's `<html lang>` (a worker's name in a worker), French by default. */
export function lang(): Lang {
  if (forced) return forced;
  const g = globalThis as { document?: Document; name?: unknown };
  if (g.document) return toLang(g.document.documentElement.lang);
  return typeof g.name === 'string' ? toLang(WORKER_LANG.exec(g.name)?.[1]) : 'fr';
}

/** Options for `new Worker(…)`: the worker's name carries the interface language to its messages. */
export function workerOptions(name: string): { name: string } {
  return { name: `${name}#lang=${lang()}` };
}

/** For contexts without a page (a worker told the language, a test). Pages use `<html lang>`. */
export function setLang(value: Lang | null): void {
  forced = value;
}

/** `fr-CA` or `en-CA`, for `Intl.*Format`, `localeCompare` and `toLocaleString`. */
export function locale(): 'fr-CA' | 'en-CA' {
  return LOCALES[lang()];
}

/** The message table for the interface language; `en` must have every entry of `fr`, same shape. */
export function messages<T>(fr: T, en: NoInfer<T>): T {
  return lang() === 'en' ? en : fr;
}

/** One string, French or English, for a lone label that doesn't warrant a table. */
export function tr(fr: string, en: string): string {
  return lang() === 'en' ? en : fr;
}

/** Plural helper: `plural(n, 'fichier', 'fichiers')` → the singular for 0 and 1 in French, for 1 in English. */
export function plural(n: number, one: string, many: string): string {
  return (lang() === 'fr' ? Math.abs(n) < 2 : n === 1) ? one : many;
}
