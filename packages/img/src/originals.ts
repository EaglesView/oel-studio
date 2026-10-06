/**
 * Originals of edited images, by content hash: never changed, shared by every recipe that uses
 * them. Kept on this device (IndexedDB) for now; the project's server media store
 * (restructure Phases 4–5) and the desktop app plug in through `setOriginalStore`.
 */
// The UI-free entry: @oel/img must not pull React into pages or workers.
import { localFiles } from '@oel/collab-client/local';
import { contentHash } from '@oel/links';

export interface OriginalRef {
  hash: string;
  mime: string;
}

export interface OriginalStore {
  put(blob: Blob): Promise<OriginalRef>;
  get(hash: string): Promise<Blob | null>;
}

const key = (hash: string) => `img|original|${hash}`;

class DeviceOriginals implements OriginalStore {
  private memory = new Map<string, Blob>();

  async put(blob: Blob): Promise<OriginalRef> {
    const hash = await contentHash(blob);
    const mime = blob.type || 'application/octet-stream';
    if (!this.memory.has(hash)) {
      this.memory.set(hash, blob);
      await localFiles.put(key(hash), { mime, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    return { hash, mime };
  }

  async get(hash: string): Promise<Blob | null> {
    const m = this.memory.get(hash);
    if (m) return m;
    const f = await localFiles.get(key(hash));
    if (!f) return null;
    const blob = new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime });
    this.memory.set(hash, blob);
    return blob;
  }
}

let store: OriginalStore = new DeviceOriginals();

export const originals = (): OriginalStore => store;
export const setOriginalStore = (s: OriginalStore) => {
  store = s;
};
