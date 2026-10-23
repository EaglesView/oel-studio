/// <reference path="./fontsource.d.ts" />
import { tr } from '@oel/i18n';
/**
 * Fonts of opened files, in the browser, for every editor (@oel/docs,
 * @oel/slides…): faces embedded in the file are registered as `FontFace`s;
 * fonts the machine lacks get their open substitute (self-hosted Fontsource
 * files, SIL OFL 1.1), loaded only when a file needs one, never at startup.
 *
 * The substitute names come from the codecs (`oel_opc::fonts::SUBSTITUTES`);
 * keep `WEB_FONTS` in step with that table.
 */

/** A font a file uses, as the codecs describe it (`DocFont`, `DeckFont`). */
export interface FontSpec {
  name: string;
  /** Open font standing in when `name` is not installed. */
  substitute?: string | null;
  /** Faces embedded in the file, unwrapped by the codec, among the file's media. */
  embedded?: Array<{ path: string; weight: number; italic: boolean }>;
}

type UrlModule = () => Promise<{ default: string }>;

/**
 * Web fonts by family (must match `SUBSTITUTES` in `crates/oel-opc/src/fonts.rs`):
 * per weight, the Latin and Latin Extended files. Imported as URLs and registered
 * with the FontFace API, so nothing is fetched (not even a stylesheet) until a
 * document needs the family.
 */
const WEB_FONTS: Record<string, Array<[number, UrlModule, UrlModule]>> = {
  Carlito: [
    [400, () => import('@fontsource/carlito/files/carlito-latin-400-normal.woff2?url'), () => import('@fontsource/carlito/files/carlito-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/carlito/files/carlito-latin-700-normal.woff2?url'), () => import('@fontsource/carlito/files/carlito-latin-ext-700-normal.woff2?url')],
  ],
  Caladea: [
    [400, () => import('@fontsource/caladea/files/caladea-latin-400-normal.woff2?url'), () => import('@fontsource/caladea/files/caladea-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/caladea/files/caladea-latin-700-normal.woff2?url'), () => import('@fontsource/caladea/files/caladea-latin-ext-700-normal.woff2?url')],
  ],
  Arimo: [
    [400, () => import('@fontsource/arimo/files/arimo-latin-400-normal.woff2?url'), () => import('@fontsource/arimo/files/arimo-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/arimo/files/arimo-latin-700-normal.woff2?url'), () => import('@fontsource/arimo/files/arimo-latin-ext-700-normal.woff2?url')],
  ],
  Tinos: [
    [400, () => import('@fontsource/tinos/files/tinos-latin-400-normal.woff2?url'), () => import('@fontsource/tinos/files/tinos-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/tinos/files/tinos-latin-700-normal.woff2?url'), () => import('@fontsource/tinos/files/tinos-latin-ext-700-normal.woff2?url')],
  ],
  Cousine: [
    [400, () => import('@fontsource/cousine/files/cousine-latin-400-normal.woff2?url'), () => import('@fontsource/cousine/files/cousine-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/cousine/files/cousine-latin-700-normal.woff2?url'), () => import('@fontsource/cousine/files/cousine-latin-ext-700-normal.woff2?url')],
  ],
  Gelasio: [
    [400, () => import('@fontsource/gelasio/files/gelasio-latin-400-normal.woff2?url'), () => import('@fontsource/gelasio/files/gelasio-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/gelasio/files/gelasio-latin-700-normal.woff2?url'), () => import('@fontsource/gelasio/files/gelasio-latin-ext-700-normal.woff2?url')],
  ],
  Questrial: [
    [400, () => import('@fontsource/questrial/files/questrial-latin-400-normal.woff2?url'), () => import('@fontsource/questrial/files/questrial-latin-ext-400-normal.woff2?url')],
  ],
  Cinzel: [
    [400, () => import('@fontsource/cinzel/files/cinzel-latin-400-normal.woff2?url'), () => import('@fontsource/cinzel/files/cinzel-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url'), () => import('@fontsource/cinzel/files/cinzel-latin-ext-700-normal.woff2?url')],
  ],
  Lato: [
    [400, () => import('@fontsource/lato/files/lato-latin-400-normal.woff2?url'), () => import('@fontsource/lato/files/lato-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/lato/files/lato-latin-700-normal.woff2?url'), () => import('@fontsource/lato/files/lato-latin-ext-700-normal.woff2?url')],
  ],
  'Open Sans': [
    [400, () => import('@fontsource/open-sans/files/open-sans-latin-400-normal.woff2?url'), () => import('@fontsource/open-sans/files/open-sans-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/open-sans/files/open-sans-latin-700-normal.woff2?url'), () => import('@fontsource/open-sans/files/open-sans-latin-ext-700-normal.woff2?url')],
  ],
  Inconsolata: [
    [400, () => import('@fontsource/inconsolata/files/inconsolata-latin-400-normal.woff2?url'), () => import('@fontsource/inconsolata/files/inconsolata-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/inconsolata/files/inconsolata-latin-700-normal.woff2?url'), () => import('@fontsource/inconsolata/files/inconsolata-latin-ext-700-normal.woff2?url')],
  ],
  'EB Garamond': [
    [400, () => import('@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url'), () => import('@fontsource/eb-garamond/files/eb-garamond-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/eb-garamond/files/eb-garamond-latin-700-normal.woff2?url'), () => import('@fontsource/eb-garamond/files/eb-garamond-latin-ext-700-normal.woff2?url')],
  ],
  'Libre Franklin': [
    [400, () => import('@fontsource/libre-franklin/files/libre-franklin-latin-400-normal.woff2?url'), () => import('@fontsource/libre-franklin/files/libre-franklin-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/libre-franklin/files/libre-franklin-latin-700-normal.woff2?url'), () => import('@fontsource/libre-franklin/files/libre-franklin-latin-ext-700-normal.woff2?url')],
  ],
  'Great Vibes': [
    [400, () => import('@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2?url'), () => import('@fontsource/great-vibes/files/great-vibes-latin-ext-400-normal.woff2?url')],
  ],
  'Fira Sans': [
    [400, () => import('@fontsource/fira-sans/files/fira-sans-latin-400-normal.woff2?url'), () => import('@fontsource/fira-sans/files/fira-sans-latin-ext-400-normal.woff2?url')],
    [700, () => import('@fontsource/fira-sans/files/fira-sans-latin-700-normal.woff2?url'), () => import('@fontsource/fira-sans/files/fira-sans-latin-ext-700-normal.woff2?url')],
  ],
};

/** Unicode ranges of Fontsource's `latin` and `latin-ext` subsets. */
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const loaded = new Map<string, Promise<unknown>>();

/** Whether a font is installed (its glyphs differ from every generic fallback's). */
export function isFontAvailable(name: string): boolean {
  if (typeof document === 'undefined') return false;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const sample = 'mmmmmmmmmmlli1WQ@#';
  return ['monospace', 'serif', 'sans-serif'].some((generic) => {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `72px "${name.replace(/"/g, '')}", ${generic}`;
    return ctx.measureText(sample).width !== base;
  });
}

/** Load a self-hosted substitute once (all its weights and both Latin subsets). */
export function loadWebFont(family: string): Promise<unknown> {
  const faces = WEB_FONTS[family];
  if (!faces || typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  let p = loaded.get(family);
  if (!p) {
    p = Promise.all(
      faces.flatMap(([weight, latin, ext]) =>
        [
          [latin, LATIN],
          [ext, LATIN_EXT],
        ].map(async ([load, range]) => {
          const url = (await (load as UrlModule)()).default;
          const face = new FontFace(family, `url("${url}") format("woff2")`, { weight: String(weight), unicodeRange: range as string, display: 'swap' });
          document.fonts.add(await face.load());
        }),
      ),
    ).catch(() => undefined);
    loaded.set(family, p);
  }
  return p;
}

/** How a font shows in a font menu: « Felix Titling (remplacée par Cinzel) » when substituted. */
export function fontLabel(name: string, fonts: FontSpec[], available: (name: string) => boolean = isFontAvailable): string {
  const f = fonts.find((x) => x.name === name);
  if (!f?.substitute || f.embedded?.length || available(name)) return name;
  return tr(`${name} (remplacée par ${f.substitute})`, `${name} (replaced by ${f.substitute})`);
}

const registered = new Set<string>();

/** Fonts of a file that this machine cannot show as they are (neither embedded nor installed). */
export interface FontReport {
  /** Drawn with another font: their open look-alike, or the one the user chose (`chosen`). */
  substituted: Array<{ name: string; substitute: string; chosen?: boolean }>;
  /** No look-alike: drawn with the generic fallback. */
  missing: string[];
}

/** The open fonts a missing font can be shown with (self-hosted, SIL OFL), by name. */
export const OPEN_FONTS: readonly string[] = Object.keys(WEB_FONTS).sort((a, b) => a.localeCompare(b));

const CHOICES_KEY = 'oel:font-choices';

/** Fonts the user chose to show missing fonts with, in this browser: missing font name → open font. */
export function fontChoices(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CHOICES_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Faces registered under a missing font's own name, drawing it with the chosen font. */
const aliases = new Map<string, FontFace[]>();

/** Register `family`'s files under the name `name`, so text set in `name` is drawn with `family`. */
async function alias(name: string, family: string | null): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  for (const face of aliases.get(name) ?? []) document.fonts.delete(face);
  aliases.delete(name);
  const files = family ? WEB_FONTS[family] : undefined;
  if (!files) return;
  const faces = await Promise.all(
    files.flatMap(([weight, latin, ext]) =>
      [
        [latin, LATIN],
        [ext, LATIN_EXT],
      ].map(async ([load, range]) => {
        const url = (await (load as UrlModule)()).default;
        return new FontFace(name, `url("${url}") format("woff2")`, { weight: String(weight), unicodeRange: range as string, display: 'swap' }).load();
      }),
    ),
  ).catch(() => [] as FontFace[]);
  for (const face of faces) document.fonts.add(face);
  aliases.set(name, faces);
}

/**
 * Show a missing font with an open font of the user's choice from now on
 * (null: back to the automatic look-alike). Only the screen changes; files
 * keep their fonts. Remembered in this browser.
 */
export async function chooseFont(name: string, family: string | null): Promise<void> {
  const choices = fontChoices();
  if (family) choices[name] = family;
  else delete choices[name];
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // No storage: the choice lasts for this page.
  }
  await alias(name, family);
}

/**
 * Make a file's fonts render: embedded faces as FontFaces (once per URL),
 * missing fonts' substitutes from the self-hosted web fonts. Resolves when
 * they are loaded, with the fonts that do not show as they are; a face that
 * fails to load is skipped (the substitute or the CSS fallback shows instead).
 */
export async function loadFonts(fonts: FontSpec[], mediaUrl: (path: string) => string | null): Promise<FontReport> {
  const report: FontReport = { substituted: [], missing: [] };
  if (typeof document === 'undefined' || !document.fonts) return report;
  const tasks: Array<Promise<unknown>> = [];
  for (const f of fonts) {
    const faces: Array<Promise<boolean>> = [];
    for (const face of f.embedded ?? []) {
      const url = mediaUrl(face.path);
      if (!url) continue;
      const key = `${f.name}|${url}`;
      if (registered.has(key)) {
        faces.push(Promise.resolve(true));
        continue;
      }
      registered.add(key);
      const ff = new FontFace(f.name, `url("${url}")`, { weight: String(face.weight), style: face.italic ? 'italic' : 'normal' });
      faces.push(
        ff.load().then(
          (x) => (document.fonts.add(x), true),
          () => (registered.delete(key), false),
        ),
      );
    }
    tasks.push(
      Promise.all(faces).then(async (ok) => {
        if (ok.some(Boolean)) return;
        const chosen = fontChoices()[f.name];
        if (chosen && WEB_FONTS[chosen]) {
          if (!aliases.has(f.name)) await alias(f.name, chosen);
          report.substituted.push({ name: f.name, substitute: chosen, chosen: true });
          return;
        }
        if (isFontAvailable(f.name)) return;
        if (f.substitute) {
          report.substituted.push({ name: f.name, substitute: f.substitute });
          await loadWebFont(f.substitute);
        } else report.missing.push(f.name);
      }),
    );
  }
  await Promise.all(tasks);
  return report;
}

/**
 * What to tell someone opening a file whose fonts are not all here (null
 * when they are): short, the details are in the fonts dialog.
 */
export function fontNotice(report: FontReport): { title: string; description: string } | null {
  const n = report.substituted.length + report.missing.length;
  if (!n) return null;
  return n > 1
    ? { title: tr(`${n} polices manquantes`, `${n} missing fonts`), description: tr('Elles sont affichées avec des polices de remplacement.', 'They are shown with replacement fonts.') }
    : { title: tr('Une police manquante', 'One missing font'), description: tr('Elle est affichée avec une police de remplacement.', 'It is shown with a replacement font.') };
}

/** Whether the font notice for a file still has to be shown in this browser (then remembers it was). */
export function firstFontNotice(fileId: string): boolean {
  const key = `oel:font-notice:${fileId}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch {
    // No storage (private window…): show it on every open.
  }
  return true;
}

const dataUrl = async (url: string): Promise<string | null> => {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/**
 * `@font-face` rules carrying a file's fonts as data URLs (embedded faces,
 * and the substitutes of fonts this machine lacks), for drawing its pages as
 * pictures: an SVG image cannot fetch fonts, nor see `FontFace`s.
 */
export async function fontFaceCss(fonts: FontSpec[], mediaUrl: (path: string) => string | null): Promise<string> {
  if (typeof document === 'undefined') return '';
  const rules: Array<Promise<string>> = [];
  const rule = async (family: string, url: string, weight: number, italic: boolean, range?: string) => {
    const data = await dataUrl(url);
    return data ? `@font-face{font-family:"${family.replace(/"/g, '')}";src:url(${data});font-weight:${weight};font-style:${italic ? 'italic' : 'normal'};${range ? `unicode-range:${range};` : ''}}` : '';
  };
  // Open fonts to embed, each under the name text uses: its own, or the missing font it stands in for.
  const open = new Map<string, string>();
  const choices = fontChoices();
  for (const f of fonts) {
    const faces = (f.embedded ?? []).map((face) => [face, mediaUrl(face.path)] as const).filter(([, url]) => url);
    if (faces.length) for (const [face, url] of faces) rules.push(rule(f.name, url!, face.weight, face.italic));
    else if (choices[f.name] && WEB_FONTS[choices[f.name]!]) open.set(f.name, choices[f.name]!);
    else if (f.substitute && WEB_FONTS[f.substitute] && !isFontAvailable(f.name)) open.set(f.substitute, f.substitute);
  }
  for (const [as, family] of open)
    for (const [weight, latin, ext] of WEB_FONTS[family]!)
      for (const [load, range] of [
        [latin, LATIN],
        [ext, LATIN_EXT],
      ] as const)
        rules.push(load().then((m) => rule(as, m.default, weight, false, range)));
  return (await Promise.all(rules)).join('\n');
}
