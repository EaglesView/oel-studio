import type { CalcClient } from '../calc/client';
import type { SheetSession } from '../collab/session';
import type { SheetDoc } from '../model/ydoc';

/**
 * The grid paints pictures on its canvas, which needs an SVG with a pixel
 * size: give it one (up to 2048 px on the long side, from its viewBox) so it
 * is rasterised once, sharply, then stretched to its frame like Excel does.
 */
export function svgForCanvas(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  const out = text.replace(/<svg\b[^>]*>/i, (tag) => {
    const num = (name: string) => Number.parseFloat(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? '');
    const vb = /\sviewBox\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
    const w = vb?.length === 4 ? vb[2]! : num('width');
    const h = vb?.length === 4 ? vb[3]! : num('height');
    if (!(w > 0 && h > 0)) return tag;
    const k = 2048 / Math.max(w, h);
    const strip = (t: string) => t.replace(/\s(width|height|preserveAspectRatio)\s*=\s*(["'])[^"']*\2/gi, '');
    const withBox = vb?.length === 4 ? strip(tag) : strip(tag).replace(/^<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
    return withBox.replace(/^<svg\b/i, `<svg width="${Math.round(w * k)}" height="${Math.round(h * k)}" preserveAspectRatio="none"`);
  });
  return out === text ? bytes : new TextEncoder().encode(out);
}

/** Package path and mime of every drawing image in the workbook. */
export function drawingImagePaths(doc: SheetDoc): Array<[string, string]> {
  const set = new Set<string>();
  for (const id of doc.sheetIds()) for (const d of doc.drawings(id)) if (d.media) set.add(`${d.media}\n${d.mime ?? ''}`);
  return [...set].sort().map((p) => p.split('\n') as [string, string]);
}

/**
 * Object URLs for drawing images. Imported images live in the original .xlsx
 * (kept by the session, offline too); the calc worker reads them out of the
 * package. Pictures made in the editor (retouched ones) are in the session's
 * media store. The caller revokes the URLs.
 */
export async function drawingImageUrls(session: SheetSession, calc: CalcClient, wanted: Array<[string, string]>): Promise<Map<string, string>> {
  const next = new Map<string, string>();
  const inPackage: Array<[string, string]> = [];
  for (const [path, mime] of wanted) {
    const url = session.media.url(path);
    if (!url) {
      inPackage.push([path, mime]);
      continue;
    }
    const blob = await fetch(url)
      .then((r) => r.blob())
      .catch(() => null);
    if (blob) next.set(path, URL.createObjectURL(blob));
  }
  if (!inPackage.length) return next;
  const original = await session.original().catch(() => null);
  if (!original) return next;
  const files = await calc.media(original, inPackage.map(([p]) => p));
  for (const f of files) {
    const mime = wanted.find(([p]) => p === f.path)?.[1] || 'application/octet-stream';
    const bytes = mime === 'image/svg+xml' ? svgForCanvas(f.bytes) : f.bytes;
    next.set(f.path, URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })));
  }
  return next;
}
