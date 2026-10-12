/**
 * L3 · « Retoucher » on a picture of the document: the image atelier docked at the right
 * (it pushes the page, like the version panel). The picture on the page shows the live
 * rendering; closing the panel writes the final pixels as a new media part and keeps the
 * original and the recipe on the node (`orig`, `recipe`), which the .docx carries along.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { toast } from '@oel/emboss';
import { RecipeDoc, isEmptyRecipe, outputSize, type ImageEngine, type Recipe } from '@oel/img';
import { Atelier } from '@oel/img/ui';
import type { DocSession } from '../collab/session';
import { EMU_PER_PX } from '../model/types';
import { tr } from '@oel/i18n';

const NOTE = tr('Le fichier Word garde l’image retouchée et, à part, l’original et la recette : rouvert dans OEL, tout reste modifiable.', 'The Word file keeps the retouched image and, separately, the original and the recipe: reopened in OEL, everything stays editable.');

export function RetouchPanel({ editor, session, pos, crop, createWorker, onClose }: { editor: Editor; session: DocSession; pos: number; crop: boolean; createWorker: () => Worker; onClose: () => void }) {
  // The picture's position follows edits made around it while the panel is open.
  const at = useRef(pos);
  useEffect(() => {
    const onTx = ({ transaction }: { transaction: { mapping: { map(p: number): number } } }) => (at.current = transaction.mapping.map(at.current));
    editor.on('transaction', onTx);
    return () => void editor.off('transaction', onTx);
  }, [editor]);
  const node = () => {
    const n = editor.state.doc.nodeAt(at.current);
    return n?.type.name === 'image' ? n : null;
  };
  const start = useMemo(() => node()?.attrs ?? null, []); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = useMemo(() => RecipeDoc.create((start?.recipe as Recipe | null) ?? {}), [start]);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [missing, setMissing] = useState<string | undefined>();
  const originalPath = (start?.orig as string | null) ?? (start?.path as string | null) ?? null;

  useEffect(() => {
    const url = originalPath ? session.mediaUrl(originalPath) : null;
    if (!url) {
      setMissing(tr('Image introuvable : elle n’est pas encore sur cet appareil.', 'Image not found: it is not on this device yet.'));
      return;
    }
    let alive = true;
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => alive && setOriginal(b))
      .catch(() => alive && setMissing(tr('Image introuvable.', 'Image not found.')));
    return () => void (alive = false);
  }, [originalPath, session]);

  // The recipe travels with the node (collaboration, undo of the document), a beat after each change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = doc.onChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const n = node();
        if (!n) return;
        const r = doc.recipe();
        editor.view.dispatch(editor.state.tr.setNodeMarkup(at.current, undefined, { ...n.attrs, recipe: isEmptyRecipe(r) ? null : r }).setMeta('addToHistory', false));
      }, 300);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [doc, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const dom = () => editor.view.nodeDOM(at.current) as HTMLElement | null;
  /** The live rendering on the page, in its own shape: same width, height from its proportions. */
  const setPreview = (url: string | null, ratio?: number) => {
    const el = dom();
    const img = el?.querySelector('img');
    if (!el || !img) return;
    const old = el.dataset.preview;
    if (url) {
      el.dataset.preview = url;
      if (ratio) el.dataset.previewRatio = String(ratio);
      img.src = url;
      if (ratio && img.style.width) img.style.height = `${parseFloat(img.style.width) * ratio}px`;
    } else {
      delete el.dataset.preview;
      delete el.dataset.previewRatio;
      const cy = node()?.attrs.cy as number | null | undefined;
      if (cy) img.style.height = `${cy / EMU_PER_PX}px`;
    }
    if (old && old !== url) setTimeout(() => URL.revokeObjectURL(old), 1000);
  };
  useEffect(() => () => setPreview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Final pixels as a new media part; back to the original when nothing is left of the recipe. */
  const commit = async (engine: ImageEngine | null) => {
    const n = node();
    if (!n || !originalPath) return;
    const r = doc.recipe();
    const cx = (n.attrs.cx as number | null) ?? null;
    if (isEmptyRecipe(r)) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(at.current, undefined, { ...n.attrs, src: `media:${originalPath}`, path: originalPath, recipe: null, orig: null }));
      return;
    }
    if (!engine) return;
    const png = original?.type === 'image/png' || original?.type === 'image/webp';
    const blob = await engine.export({ mime: png ? 'image/png' : 'image/jpeg', quality: 0.92 });
    const path = await session.addImage(blob);
    const out = outputSize(r, ...(await sizeOf(original!)));
    // A crop changes the shape: keep the width, follow the new proportions.
    const cy = cx ? Math.round((cx * out.height) / out.width) : n.attrs.cy;
    const cur = node() ?? n;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(at.current, undefined, { ...cur.attrs, src: `media:${path}`, path, orig: originalPath, recipe: r, cy, rid: null }),
    );
  };

  return (
    <Atelier
      variant="panel"
      title={(start?.alt as string) || 'Image'}
      original={original}
      missing={missing}
      doc={doc}
      createWorker={createWorker}
      startInCrop={crop}
      note={NOTE}
      onExport={() => {}}
      onRendered={async (raster) => {
        const c = new OffscreenCanvas(raster.width, raster.height);
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(raster.data.buffer as ArrayBuffer, raster.data.byteOffset, raster.data.byteLength), raster.width, raster.height), 0, 0);
        setPreview(URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.9 })), raster.height / raster.width);
      }}
      onClose={async (engine) => {
        try {
          await commit(engine);
        } catch (e) {
          toast({ title: tr('Retouche non enregistrée', 'Retouch not saved'), description: e instanceof Error ? e.message : String(e), tone: 'danger' });
        }
        setPreview(null);
        const n = node();
        if (n) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at.current)));
        onClose();
      }}
    />
  );
}

async function sizeOf(blob: Blob): Promise<[number, number]> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s: [number, number] = [bmp.width, bmp.height];
  bmp.close();
  return s;
}
