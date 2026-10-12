/**
 * The person's interface language for the Bureau (French by default, or English), kept in the
 * `oel-lang` cookie. `Base.astro` applies it to `<html lang>` before any module runs, so every
 * package's message table (`@oel/i18n`) is picked at load; changing it reloads the page.
 *
 * The site's « Ouvrir le Bureau » links carry `?lang=fr|en`: the Bureau then opens in the
 * language of the page the person came from, without asking (`cameFromSite`).
 *
 * This is the platform seam for the choice: a desktop app would keep it in its own settings.
 */
import { lang, toLang, workerOptions, type Lang } from '@oel/i18n';

export const LANG_COOKIE = 'oel-lang';
/** One year; the cookie only says which language to show. */
const MAX_AGE = 60 * 60 * 24 * 365;
const WELCOMED = 'oel-welcomed';

/** The language saved in the cookie, or null when the person never chose one. */
export function savedLang(): Lang | null {
  const m = document.cookie.match(/(?:^|;\s*)oel-lang=(fr|en)\b/);
  return m ? toLang(m[1]) : null;
}

/** Remember a language for the next visits (does not change this page). */
export function saveLang(value: Lang) {
  document.cookie = `${LANG_COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax`;
}

/** Remember `value` and reload into it (the desk is saved on `pagehide`). Nothing happens if it is already the page's. */
export function switchLang(value: Lang) {
  saveLang(value);
  if (value !== lang()) location.reload();
}

/** The person arrived from the site's « Ouvrir le Bureau » (its language was applied). */
export const cameFromSite = () => document.documentElement.dataset.langFrom === 'site';

/** The welcome dialog was answered on this device. */
export function welcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED) === '1';
  } catch {
    return savedLang() != null;
  }
}

export function markWelcomed() {
  try {
    localStorage.setItem(WELCOMED, '1');
  } catch {
    /* private mode: the language cookie still says a choice was made */
  }
}

/**
 * `new W()` for a Vite `?worker` import, named so the worker's messages follow the interface
 * language (`@oel/i18n` reads it from the name). Vite takes `{ name }`; Astro types the
 * constructor without it.
 */
export function namedWorker(W: new () => Worker, name: string): Worker {
  return new (W as unknown as new (options: { name: string }) => Worker)(workerOptions(name));
}
