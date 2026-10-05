/**
 * Bytes of linked pictures, by content hash (plan I-3). A picture link carries
 * only `{ hash, mime, width, height }`; the bytes travel through this cache
 * from the source (read) to each target's media store (prepare), once per
 * target file.
 */
import type { LinkedValue } from '@oel/links';

const bytes = new Map<string, Blob>();

export const pictureBytes = (hash: string): Blob | undefined => bytes.get(hash);

async function hashOf(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    // SVG and some formats can't be decoded off-DOM: a square is a safe default for proportions.
    return { width: 1, height: 1 };
  }
}

/** The link value of a picture, its bytes kept for targets. */
export async function pictureValue(blob: Blob): Promise<Extract<LinkedValue, { kind: 'picture' }>> {
  const [hash, size] = await Promise.all([hashOf(blob), sizeOf(blob)]);
  bytes.set(hash, blob);
  return { kind: 'picture', media: { hash, mime: blob.type || 'image/png', ...size } };
}
