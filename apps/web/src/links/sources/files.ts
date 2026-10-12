/**
 * Pictures inside decks and documents as link sources (plan I-3, Figma I1 d:
 * « d’un fichier à l’autre »). A slide picture is found by its element id, a
 * document picture by its `oid`. Replacing the picture's bytes in the source
 * file is a new version: copies follow.
 */
import type * as Y from 'yjs';
import { pictureValue, type LinkedValue, type SourceRef } from '@oel/links';
import { findPicture } from '@oel/docs';
import type { Paper } from '../../bureau/model';
import { sessionFor } from '../../bureau/docs';
import { slideSessionFor } from '../../bureau/slides';
import type { LinkSource } from '../kinds';

function pictureSource(docId: string, ydoc: Y.Doc, locate: (objectId: string) => string | null, url: (path: string) => string | null): LinkSource {
  let last: { key: string; value: LinkedValue } | null = null;
  return {
    docId,
    ydoc,
    async read(ref: SourceRef) {
      if (ref.kind !== 'image') return null;
      const path = locate(ref.objectId);
      if (!path) return null;
      const u = url(path);
      if (!u) return undefined; // bytes still loading (offline copy, server)
      const key = `${path}|${u}`;
      if (last?.key === key) return last.value;
      try {
        const value = await pictureValue(await (await fetch(u)).blob());
        last = { key, value };
        return value;
      } catch {
        return undefined;
      }
    },
    onChange(fn) {
      ydoc.on('afterTransaction', fn);
      return () => ydoc.off('afterTransaction', fn);
    },
    dispose: () => {},
  };
}

export async function openSlidesSource(p: Paper): Promise<LinkSource> {
  const s = await slideSessionFor(p, () => {});
  const sd = s.slides;
  const locate = (objectId: string) => {
    for (const id of sd.slideIds()) {
      const el = sd.slide(id)?.elements.find((e) => e.id === objectId);
      if (el) return el.image?.media || null;
    }
    return null;
  };
  return pictureSource(s.status.docId, s.ydoc, locate, (path) => s.media.url(path));
}

export async function openDocumentSource(p: Paper): Promise<LinkSource> {
  const s = await sessionFor(p, () => {});
  const locate = (oid: string) => (findPicture(s.ydoc, oid)?.getAttribute('path') as string | undefined) ?? null;
  return pictureSource(s.status.docId, s.ydoc, locate, (path) => s.mediaUrl(path));
}
