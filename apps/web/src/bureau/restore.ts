/**
 * What a saved desk needs again on load (plan solo MVP, S-2): object URLs are this tab's
 * only, so thumbnails, image originals and retouched renderings are rebuilt from what the
 * device keeps. Also deletes the files of papers removed on an earlier visit.
 */
import { deleteDeviceDoc, docDbName, localFiles, type DocKind } from '@oel/collab-client';
import { isEmptyRecipe, originals } from '@oel/img';
import { queueRender } from './images';
import { queueThumbnail } from './thumbnails';
import type { Bureau, Paper, PaperData, PaperKind } from './model';
import type { TrashEntry } from './persist';

/** Paper kinds backed by an editing session (a Y.Doc of that collab kind). */
export const DOC_KIND: Partial<Record<PaperKind, DocKind>> = { document: 'doc', spreadsheet: 'sheet', slides: 'slides' };

const thumbKey = (paperId: string) => `desk|thumb|${paperId}`;
const blobOf = (f: { mime: string; bytes: Uint8Array }) => new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime });

function patch(store: Bureau, id: string, data: Partial<PaperData>) {
  const cur = store.node(id) as Paper | undefined;
  if (cur) store.update(id, { data: { ...cur.data, ...data } }, { history: false });
}

/** Thumbnail URLs that came from the device (not to be saved again). */
const restored = new Set<string>();

/** Thumbnails saved on the device (else redrawn), image originals, retouched renderings. */
export async function restoreMedia(store: Bureau): Promise<void> {
  await Promise.all(
    store.nodes.map(async (n) => {
      const p = n as Paper;
      if (p.kind === 'image' && p.data.image?.original) {
        const blob = await originals().get(p.data.image.original);
        if (blob) patch(store, p.id, { imageUrl: URL.createObjectURL(blob) });
        const inGallery = store.node(p.parent?.id ?? '')?.kind === 'gallery';
        if (inGallery || (p.data.image.recipe && !isEmptyRecipe(p.data.image.recipe))) queueRender(store, p.id);
      }
      if (DOC_KIND[p.kind] && p.data.docId) {
        const f = await localFiles.get(thumbKey(p.id));
        if (!f) return queueThumbnail(store, p.id);
        const url = URL.createObjectURL(blobOf(f));
        restored.add(url);
        patch(store, p.id, { thumbnail: url });
      }
    }),
  );
}

/** Save each newly drawn thumbnail on the device, so the next visit shows it at once. */
export function bindThumbnails(store: Bureau): () => void {
  const seen = new Map<string, string>();
  return store.subscribe(() => {
    for (const n of store.nodes) {
      const url = (n as Paper).data.thumbnail;
      if (!url || seen.get(n.id) === url) continue;
      seen.set(n.id, url);
      if (restored.has(url) || !url.startsWith('blob:')) continue;
      void fetch(url)
        .then((r) => r.blob())
        .then(async (b) => localFiles.put(thumbKey(n.id), { mime: b.type || 'image/png', bytes: new Uint8Array(await b.arrayBuffer()) }))
        .catch(() => {});
    }
  });
}

/** Delete removed papers' files from the device: their document copy and binary files. */
export async function deleteFiles(entries: TrashEntry[]): Promise<void> {
  for (const t of entries) {
    const kind = DOC_KIND[t.kind];
    if (kind) await deleteDeviceDoc(docDbName(kind, t.docId)).catch(() => {});
    for (const k of await localFiles.keys(`${t.docId}|`)) await localFiles.remove(k);
  }
}

/** Ask the browser not to evict this site's data under storage pressure; false when refused or unknown. */
export async function askPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}

/** Bytes this site uses on the device, when the browser says. */
export async function storageUsed(): Promise<number | null> {
  try {
    return (await navigator.storage?.estimate?.())?.usage ?? null;
  } catch {
    return null;
  }
}
