/**
 * The tools of the bar over a selected picture in Slides and Sheets (Figma L3): Retoucher ·
 * Recadrer · Remplacer · Texte alternatif. The host puts them in its own bar (alone, or after
 * the link tools of a linked copy).
 */
import { useState } from 'react';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { Button, Popover, TextField, ToolButton } from '@oel/emboss';

export interface PictureToolsProps {
  /** Why nothing can be changed (« Lecture seule »). */
  readOnly?: string;
  /** Why the picture can't be retouched here (no image engine, vector picture…); absent: it can. */
  noRetouch?: string;
  onRetouch: (crop: boolean) => void;
  /** Absent: the host can't replace this picture. */
  onReplace?: () => void;
  alt: string;
  onAlt: (alt: string) => void;
}

export function PictureTools(p: PictureToolsProps) {
  const retouch = p.readOnly ?? p.noRetouch;
  return (
    <>
      <ToolButton icon="palette" label="Retoucher" showLabel unavailableReason={retouch} onPress={() => p.onRetouch(false)} />
      <ToolButton icon="crop" label="Recadrer" unavailableReason={retouch} onPress={() => p.onRetouch(true)} />
      {p.onReplace && <ToolButton icon="refresh" label="Remplacer" unavailableReason={p.readOnly} onPress={p.onReplace} />}
      <DialogTrigger>
        <ToolButton icon="text-block" label="Texte alternatif" unavailableReason={p.readOnly} />
        <Popover placement="bottom">
          <Dialog className="oel-popover-dialog oel-alt-dialog" aria-label="Texte alternatif">{({ close }) => <AltForm alt={p.alt} onSave={(t) => (p.onAlt(t), close())} />}</Dialog>
        </Popover>
      </DialogTrigger>
    </>
  );
}

function AltForm({ alt, onSave }: { alt: string; onSave: (alt: string) => void }) {
  const [text, setText] = useState(alt);
  return (
    // Rendered in a portal but inside the bar's React tree: its mouse guards must not reach the form.
    <form
      className="oel-alt-form"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text.trim());
      }}
    >
      <TextField label="Texte alternatif" multiline rows={3} value={text} onChange={setText} autoFocus description="Décrit l’image pour les lecteurs d’écran." />
      <Button type="submit" size="sm">
        Enregistrer
      </Button>
    </form>
  );
}

/** Asks for a picture file (« Remplacer »). */
export function pickImageFile(onFile: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
  input.onchange = () => input.files?.[0] && onFile(input.files[0]);
  input.click();
}
