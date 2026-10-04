/**
 * Document fonts: the shared loader of @oel/fonts, under the names the docs
 * editor uses (`DocFont` is a `FontSpec`).
 */
import { fontLabel as label, isFontAvailable, loadFonts, loadWebFont } from '@oel/fonts';
import type { DocFont } from '../model/types';

export { isFontAvailable, loadWebFont };

/** How a font shows in the font menu: « Felix Titling (remplacée par Cinzel) » when substituted. */
export const fontLabel = (name: string, fonts: DocFont[], available?: (name: string) => boolean) => label(name, fonts, available);

/** Embedded faces as FontFaces, missing fonts' substitutes from the self-hosted web fonts. */
export const loadDocumentFonts = (fonts: DocFont[], mediaUrl: (path: string) => string | null) => loadFonts(fonts, mediaUrl);
