/// <reference path="./fontsource.d.ts" />
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
  return `${name} (remplacée par ${f.substitute})`;
}

const registered = new Set<string>();

/**
 * Make a file's fonts render: embedded faces as FontFaces (once per URL),
 * missing fonts' substitutes from the self-hosted web fonts. Resolves when
 * they are loaded; a face that fails to load is skipped (the substitute or
 * the CSS fallback shows instead).
 */
export async function loadFonts(fonts: FontSpec[], mediaUrl: (path: string) => string | null): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const tasks: Array<Promise<unknown>> = [];
  for (const f of fonts) {
    let embedded = false;
    for (const face of f.embedded ?? []) {
      const url = mediaUrl(face.path);
      if (!url) continue;
      embedded = true;
      const key = `${f.name}|${url}`;
      if (registered.has(key)) continue;
      registered.add(key);
      const ff = new FontFace(f.name, `url("${url}")`, { weight: String(face.weight), style: face.italic ? 'italic' : 'normal' });
      tasks.push(ff.load().then((x) => document.fonts.add(x), () => registered.delete(key)));
    }
    if (!embedded && f.substitute && !isFontAvailable(f.name)) tasks.push(loadWebFont(f.substitute));
  }
  await Promise.all(tasks);
}
