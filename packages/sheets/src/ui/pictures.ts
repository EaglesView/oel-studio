/**
 * Picture commands of the spreadsheet editor (Figma L3): retouch, replace, alternative text.
 * Pictures made here go to the session's media store (`xl/media/oel-….png`); the .xlsx writer
 * points the picture's anchor at them and keeps a retouch's original and recipe beside them.
 * Each command is one Y.Doc transaction, so one undo step.
 */
import type { RetouchResult } from '@oel/img/ui';
import type { SheetSession } from '../collab/session';
import type { Drawing } from '../model/types';
import type { SheetController } from './controller';
import { frameOf, placed } from './charts';

/** Height for a new shape of the picture, keeping its width (only on the sheet shown: the grid's geometry). */
function reshaped(ctl: SheetController, sheet: string, d: Drawing, k: number): Drawing {
  if (Math.abs(k - 1) < 1e-3 || sheet !== ctl.sheetId) return d;
  const f = frameOf(ctl, d);
  return placed(ctl, d, { ...f, h: f.h * k });
}

/**
 * Store a retouch when the panel closes: the final rendering as a new picture, the original and
 * the recipe kept on the drawing for the .xlsx. `null`: nothing left of the recipe, back to the
 * original.
 */
export async function retouchPicture(ctl: SheetController, session: SheetSession, oid: string, r: RetouchResult | null) {
  if (ctl.readOnlyFlag) return;
  const found = ctl.doc.drawingById(oid);
  if (!found?.drawing.media) return;
  const orig = found.drawing.orig ?? found.drawing.media;
  if (!r) {
    if (!found.drawing.orig) return;
    const mime = session.media.index.get(orig)?.mime ?? mimeOf(orig);
    ctl.doc.updateDrawing(found.sheet, found.index, ({ recipe: _r, orig: _o, ...d }) => ({ ...d, media: orig, mime }));
    return;
  }
  const path = await session.addPicture(r.blob);
  const now = ctl.doc.drawingById(oid);
  if (!now) return;
  // A crop changes the shape: keep the width, scale the height by the change of proportions.
  const k = r.height / r.width / (r.before.height / r.before.width);
  ctl.doc.updateDrawing(now.sheet, now.index, (d) => reshaped(ctl, now.sheet, { ...d, media: path, mime: r.blob.type, recipe: r.recipe, orig }, k));
}

/** « Remplacer »: another file in the same frame (same width, its own proportions); a retouch does not carry over. */
export async function replacePicture(ctl: SheetController, session: SheetSession, index: number, file: File) {
  if (ctl.readOnlyFlag) return;
  const before = ctl.doc.drawings(ctl.sheetId)[index];
  if (!before) return;
  const oid = ctl.doc.drawingId(ctl.sheetId, index);
  const path = await session.addPicture(file);
  const bmp = await createImageBitmap(file);
  const ratio = bmp.height / bmp.width;
  bmp.close();
  const now = oid ? ctl.doc.drawingById(oid) : null;
  if (!now) return;
  const f = frameOf(ctl, now.drawing);
  ctl.doc.updateDrawing(now.sheet, now.index, ({ recipe: _r, orig: _o, ...d }) => reshaped(ctl, now.sheet, { ...d, media: path, mime: file.type }, (f.w * ratio) / f.h));
}

export function setPictureAlt(ctl: SheetController, index: number, descr: string) {
  if (ctl.readOnlyFlag) return;
  ctl.doc.updateDrawing(ctl.sheetId, index, ({ descr: _d, ...d }) => (descr ? { ...d, descr } : d));
}

const mimeOf = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext ?? 'png'}`;
};
