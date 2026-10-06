/**
 * Bureau ↔ @oel/img: the image worker and saving exports. These two functions are what a native
 * app replaces (its own transport, a save dialog).
 */
import ImageWorker from '@oel/img/worker?worker';
import { RecipeDoc, type Raster, type Recipe } from '@oel/img';

export const createImageWorker = () => new ImageWorker();

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * One recipe document per image paper while the tab lives (the desk is not in Yjs yet — plan N;
 * the recipe is also mirrored on the paper so it survives the atelier closing).
 */
const docs = new Map<string, RecipeDoc>();
export function recipeDocFor(paperId: string, initial: Recipe | undefined): RecipeDoc {
  let d = docs.get(paperId);
  if (!d) {
    d = RecipeDoc.create(initial ?? {});
    docs.set(paperId, d);
  }
  return d;
}

/** A rendering as an object URL (desk picture of a retouched image). */
export async function rasterUrl(r: Raster): Promise<string> {
  const c = new OffscreenCanvas(r.width, r.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer, r.data.byteOffset, r.data.byteLength), r.width, r.height), 0, 0);
  return URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.9 }));
}
