/**
 * The bar over a selected picture of the sheet (Figma L3): Retoucher · Recadrer · Remplacer ·
 * Texte alternatif.
 */
import type { CSSProperties } from 'react';
import { Toolbar } from '@oel/emboss';
import { PictureTools, RETOUCHABLE, pickImageFile } from '@oel/img/ui';
import type { Drawing } from '../model/types';
import type { SheetController } from './controller';
import { setPictureAlt } from './pictures';

export function PictureBar({ ctl, index, drawing, style }: { ctl: SheetController; index: number; drawing: Drawing; style: CSSProperties }) {
  const tools = ctl.pictures;
  const noRetouch = !tools?.retouch ? 'La retouche n’est pas disponible ici.' : !RETOUCHABLE.test(drawing.mime ?? '') ? 'Les images vectorielles ne se retouchent pas.' : undefined;
  return (
    <div className="oel-chart-bar" style={style} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Toolbar aria-label="Image">
        <PictureTools
          readOnly={ctl.readOnlyFlag ? 'Lecture seule' : undefined}
          noRetouch={noRetouch}
          onRetouch={(crop) => tools?.retouch?.(index, crop)}
          onReplace={tools ? () => pickImageFile((f) => tools.replace(index, f)) : undefined}
          alt={drawing.descr ?? ''}
          onAlt={(t) => setPictureAlt(ctl, index, t)}
        />
      </Toolbar>
    </div>
  );
}
