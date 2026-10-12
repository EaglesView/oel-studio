/**
 * Document fonts: the shared loader of @oel/fonts, under the names the docs
 * editor uses (`DocFont` is a `FontSpec`).
 */
import { firstFontNotice, fontLabel as label, fontNotice, isFontAvailable, loadFonts, loadWebFont, type FontReport } from '@oel/fonts';
import type { DocFont } from '../model/types';

export { isFontAvailable, loadWebFont };

/** How a font shows in the font menu: « Felix Titling (remplacée par Cinzel) » when substituted. */
export const fontLabel = (name: string, fonts: DocFont[], available?: (name: string) => boolean) => label(name, fonts, available);

/** Embedded faces as FontFaces, missing fonts' substitutes from the self-hosted web fonts. */
export const loadDocumentFonts = (fonts: DocFont[], mediaUrl: (path: string) => string | null) => loadFonts(fonts, mediaUrl);

/**
 * The first time a document opens in this browser, tell which of its fonts do
 * not show as they are (`notify` gets the notice and the details for the fonts
 * dialog). Returns a cleanup for effects.
 */
export function fontNoticeOnFirstOpen(
  docId: string,
  fonts: DocFont[],
  mediaUrl: (path: string) => string | null,
  notify: (n: { title: string; description: string }, report: FontReport) => void,
): () => void {
  let alive = true;
  if (fonts.length)
    void loadFonts(fonts, mediaUrl).then((report) => {
      const notice = fontNotice(report);
      if (alive && notice && firstFontNotice(docId)) notify(notice, report);
    });
  return () => void (alive = false);
}
