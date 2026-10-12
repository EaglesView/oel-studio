/**
 * The site around the Bureau (home and docs), in French at / and English at /en (plan solo MVP,
 * S-8). Strings live here, typed: an English entry is required for every French one. The Bureau
 * has its own tables (`@oel/i18n`) and opens in the language of the site page it was opened from
 * (`bureauHref`).
 */
export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];
export const HTML_LANG: Record<Lang, 'fr-CA' | 'en'> = { fr: 'fr-CA', en: 'en' };

/** Public links. `repo` stays null until the repository is published; links to it are hidden until then. */
export const SITE = {
  repo: null as string | null,
  tools: 'https://outilsenligne.ca',
};

/** A site path in a language: `/docs/liens` → `/en/docs/links` comes from `DOCS`; other paths just get the prefix. */
export function href(lang: Lang, path: string): string {
  if (lang === 'fr') return path;
  return path === '/' ? '/en/' : `/en${path}`;
}

/** « Ouvrir le Bureau »: the Bureau opens in this page's language and remembers it (`src/lang.ts`). */
export const bureauHref = (lang: Lang) => `/bureau?lang=${lang}`;

/** Docs pages, in reading order: one id, a slug and a title per language. */
export const DOCS = [
  { id: 'index', fr: { slug: '', title: 'Prise en main' }, en: { slug: '', title: 'Getting started' } },
  { id: 'bureau', fr: { slug: 'bureau', title: 'Le bureau' }, en: { slug: 'desk', title: 'The desk' } },
  { id: 'editeurs', fr: { slug: 'editeurs', title: 'Les éditeurs' }, en: { slug: 'editors', title: 'The editors' } },
  { id: 'liens', fr: { slug: 'liens', title: 'Fils de liaison' }, en: { slug: 'links', title: 'Linked copies' } },
  { id: 'clavier', fr: { slug: 'clavier', title: 'Clavier et accessibilité' }, en: { slug: 'keyboard', title: 'Keyboard and accessibility' } },
  { id: 'formats', fr: { slug: 'formats', title: 'Formats et confidentialité' }, en: { slug: 'formats', title: 'Formats and privacy' } },
] as const;
export type DocId = (typeof DOCS)[number]['id'];

export function docHref(lang: Lang, id: DocId, hash = ''): string {
  const d = DOCS.find((x) => x.id === id)!;
  const slug = d[lang].slug;
  return href(lang, `/docs${slug ? `/${slug}` : ''}`) + (hash ? `#${hash}` : '');
}

const fr = {
  brand: 'Bureau',
  brandSub: 'par OutilsEnLigne',
  nav: { features: 'Fonctionnalités', docs: 'Documentation', code: 'Code ouvert', faq: 'Questions' },
  open: 'Ouvrir le Bureau',
  otherLang: { label: 'English', short: 'EN' },
  more: 'En savoir plus',
  docsTitle: 'Documentation',
  docsNav: 'Pages de la documentation',
  prev: 'Précédent',
  next: 'Suivant',
  capturePending: 'Capture à venir',
  footer: {
    tagline: 'Un espace de travail gratuit pour les élèves et les étudiant·es du Québec, du secondaire à l’université.',
    product: 'Produit',
    resources: 'Ressources',
    oel: 'OutilsEnLigne',
    allTools: 'Tous les outils (outilsenligne.ca)',
    source: 'Code source',
    shortcuts: 'Raccourcis clavier',
    rights: '© 2026 OutilsEnLigne · Fait au Québec',
    licence: 'Moteurs de fichiers libres · MPL-2.0',
  },
};

/** English must have every French string (checked by the type). */
const en: typeof fr = {
  brand: 'Bureau',
  brandSub: 'by OutilsEnLigne',
  nav: { features: 'Features', docs: 'Docs', code: 'Open source', faq: 'FAQ' },
  open: 'Open the Bureau',
  otherLang: { label: 'Français', short: 'FR' },
  more: 'Learn more',
  docsTitle: 'Documentation',
  docsNav: 'Documentation pages',
  prev: 'Previous',
  next: 'Next',
  capturePending: 'Screenshot coming',
  footer: {
    tagline: 'A free workspace for Québec students, from high school to university.',
    product: 'Product',
    resources: 'Resources',
    oel: 'OutilsEnLigne',
    allTools: 'All the tools (outilsenligne.ca)',
    source: 'Source code',
    shortcuts: 'Keyboard shortcuts',
    rights: '© 2026 OutilsEnLigne · Made in Québec',
    licence: 'Open file engines · MPL-2.0',
  },
};

export const UI: Record<Lang, typeof fr> = { fr, en };

/** The same page in the other language (`/docs/liens` ↔ `/en/docs/links`). */
export function alternatePath(lang: Lang, docId?: DocId): Record<Lang, string> {
  if (docId) return { fr: docHref('fr', docId), en: docHref('en', docId) };
  return { fr: '/', en: '/en/' };
}
