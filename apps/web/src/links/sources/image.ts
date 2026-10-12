/**
 * A desk image paper as a link source (plan I-3, Figma I1). It has no
 * document behind it: its « file » id is `img:<paper id>`. Copies show what
 * the paper shows: its picture, retouched with its settings over its
 * gallery's style (plan L-8). A new picture or a new look is a new version:
 * copies follow.
 */
import { pictureValue, type LinkedValue } from '@oel/links';
import type { Bureau, Paper } from '../../bureau/model';
import { linkPictureKey, linkPictureOf } from '../../bureau/images';
import type { LinkSource } from '../kinds';

const SETTLE_MS = 1500;

/** The link « file » id of an image paper. */
export const imageDocId = (paperId: string) => `img:${paperId}`;

export function openImageSource(store: Bureau, p: Paper): LinkSource {
  const key = () => linkPictureKey(store, p.id);
  let read: { key: string; value: LinkedValue } | null = null;
  return {
    docId: imageDocId(p.id),
    ydoc: null,
    async read(ref) {
      if (ref.kind !== 'image') return null;
      const k = key();
      if (k == null) return null;
      if (read?.key === k) return read.value;
      try {
        const pic = await linkPictureOf(store, p.id);
        if (!pic) return null;
        const value = await pictureValue(pic.blob);
        read = { key: pic.key, value };
        return value;
      } catch {
        return undefined;
      }
    },
    onChange(fn) {
      let last = key();
      // Retouching changes the look many times a minute: copies get a new rendering (and their
      // files a new picture) once the edits pause.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = store.subscribe(() => {
        const now = key();
        if (now === last) return;
        last = now;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => ((timer = null), fn()), SETTLE_MS);
      });
      return () => {
        off();
        if (timer) clearTimeout(timer);
      };
    },
    dispose: () => {},
  };
}
