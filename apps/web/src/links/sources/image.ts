/**
 * A desk image paper as a link source (plan I-3, Figma I1). It has no
 * document behind it: its bytes are the paper's `imageUrl`, and its « file »
 * id is `img:<paper id>`. A new picture on the paper (dropped, or edited by
 * the image tool) is a new version: copies follow.
 */
import { pictureValue, type LinkedValue } from '@oel/links';
import type { Bureau, Paper } from '../../bureau/model';
import type { LinkSource } from '../kinds';

/** The link « file » id of an image paper. */
export const imageDocId = (paperId: string) => `img:${paperId}`;

export function openImageSource(store: Bureau, p: Paper): LinkSource {
  const url = () => (store.node(p.id) as Paper | undefined)?.data.imageUrl;
  let read: { url: string; value: LinkedValue } | null = null;
  return {
    docId: imageDocId(p.id),
    ydoc: null,
    async read(ref) {
      if (ref.kind !== 'image') return null;
      const u = url();
      if (!u) return null;
      if (read?.url === u) return read.value;
      try {
        const value = await pictureValue(await (await fetch(u)).blob());
        read = { url: u, value };
        return value;
      } catch {
        return undefined;
      }
    },
    onChange(fn) {
      let last = url();
      return store.subscribe(() => {
        const now = url();
        if (now !== last) {
          last = now;
          fn();
        }
      });
    },
    dispose: () => {},
  };
}
