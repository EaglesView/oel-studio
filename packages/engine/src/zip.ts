/**
 * Minimal ZIP reader (central directory + stored/deflate entries) built on the
 * platform DecompressionStream. Enough to peek into OOXML/ODF packages for a
 * preview; real parsing belongs to the WASM engines.
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: scan backwards for 0x06054b50.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Archive ZIP invalide');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function readZipText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`Compression ZIP ${entry.method} non prise en charge`);
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
