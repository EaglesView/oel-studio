/**
 * L3 · « Retoucher » on a picture inside an editor (Slides, Sheets): the atelier docked beside
 * the editor, whatever holds the picture. The host shows the live rendering through `onPreview`
 * and stores the final pixels, the original and the recipe in `onCommit` (one undo step).
 * (Docs has its own panel, tied to the Tiptap node.)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@oel/emboss';
import type { ImageEngine } from '../engine';
import { RecipeDoc } from '../model/recipeDoc';
import { isEmptyRecipe, outputSize, type Recipe } from '../recipe';
import { Atelier } from './Atelier';
import { tr } from '@oel/i18n';

export interface RetouchResult {
  /** Final pixels (PNG for PNG/WebP originals, else JPEG). */
  blob: Blob;
  recipe: Recipe;
  /** Size of the rendering, px (a crop changes the shape)… */
  width: number;
  height: number;
  /** …and of the rendering the picture showed before (the original, or its previous retouch). */
  before: { width: number; height: number };
}

export interface RetouchPreview {
  url: string;
  /** Size of the rendering, px: only its proportions matter. */
  width: number;
  height: number;
}

export interface RetouchDockProps {
  title: string;
  /** The original picture; `null` (or a rejection) when it is not on this device. */
  loadOriginal: () => Promise<Blob | null>;
  /** The recipe already on the picture. */
  recipe: Recipe | null;
  /** Open on the crop frame (« Recadrer »). */
  crop?: boolean;
  note?: string;
  createWorker: () => Worker;
  /**
   * Live rendering for the picture in the editor, with its shape (a crop or a quarter turn
   * changes it); `null`: back to what the file holds.
   */
  onPreview: (preview: RetouchPreview | null) => void;
  /** On closing: the final pixels, or `null` when nothing is left of the recipe (back to the original). */
  onCommit: (result: RetouchResult | null) => void | Promise<void>;
  onClose: () => void;
}

export function RetouchDock(props: RetouchDockProps) {
  const { loadOriginal, onPreview } = props;
  const doc = useMemo(() => RecipeDoc.create(props.recipe ?? {}), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [original, setOriginal] = useState<Blob | null>(null);
  const [missing, setMissing] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    loadOriginal()
      .then((b) => alive && (b ? setOriginal(b) : setMissing(tr('Image introuvable : elle n’est pas encore sur cet appareil.', 'Image not found: it is not on this device yet.'))))
      .catch(() => alive && setMissing(tr('Image introuvable.', 'Image not found.')));
    return () => void (alive = false);
  }, [loadOriginal]);

  // The preview URL shown by the host; the previous one is revoked once the host has moved on.
  const shown = useRef<string | null>(null);
  const preview = (p: RetouchPreview | null) => {
    const old = shown.current;
    const url = p?.url ?? null;
    shown.current = url;
    onPreview(p);
    if (old && old !== url) setTimeout(() => URL.revokeObjectURL(old), 1000);
  };
  useEffect(() => () => preview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async (engine: ImageEngine | null) => {
    const r = doc.recipe();
    if (isEmptyRecipe(r)) return props.onCommit(null);
    if (!engine || !original) return;
    const png = original.type === 'image/png' || original.type === 'image/webp';
    const blob = await engine.export({ mime: png ? 'image/png' : 'image/jpeg', quality: 0.92 });
    const size = await sizeOf(original);
    const out = outputSize(r, ...size);
    await props.onCommit({ blob, recipe: r, width: out.width, height: out.height, before: outputSize(props.recipe ?? {}, ...size) });
  };

  return (
    <Atelier
      variant="panel"
      title={props.title}
      original={original}
      missing={missing}
      doc={doc}
      createWorker={props.createWorker}
      startInCrop={props.crop}
      note={props.note}
      onExport={() => {}}
      onRendered={async (raster) => {
        const c = new OffscreenCanvas(raster.width, raster.height);
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(raster.data.buffer as ArrayBuffer, raster.data.byteOffset, raster.data.byteLength), raster.width, raster.height), 0, 0);
        preview({ url: URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.9 })), width: raster.width, height: raster.height });
      }}
      onClose={async (engine) => {
        try {
          await commit(engine);
        } catch (e) {
          toast({ title: tr('Retouche non enregistrée', 'Retouch not saved'), description: e instanceof Error ? e.message : String(e), tone: 'danger' });
        }
        preview(null);
        props.onClose();
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

/** Pictures the atelier can open (not vector graphics). */
export const RETOUCHABLE = /^image\/(png|jpeg|gif|webp|bmp)$/;
