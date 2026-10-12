import { useEffect, useState } from 'react';
import { Button, DialogOverlay, Select, SelectItem, SheetDialog } from '@oel/emboss';
import { OPEN_FONTS, chooseFont, fontChoices, type FontReport, type FontSpec } from '@oel/fonts';
import { tr } from '@oel/i18n';

const AUTO = '__auto';

export interface FontsDialogProps {
  /** The file's fonts (for each one's automatic look-alike). */
  fonts: FontSpec[];
  /** Fonts of the file that are neither embedded nor installed, from `loadFonts`. */
  report: FontReport;
  isOpen: boolean;
  onClose: () => void;
  /** A choice changed: the editor may lay out its text again. */
  onChange?: () => void;
}

/**
 * « Polices manquantes »: the file's fonts this machine cannot show, each
 * with the font it is drawn with and a sample, and a menu to pick another
 * open font. The choice only changes the screen (in this browser); the
 * file keeps its fonts on export.
 */
export function FontsDialog({ fonts, report, isOpen, onClose, onChange }: FontsDialogProps) {
  const names = [...report.substituted.map((f) => f.name), ...report.missing];
  const [choices, setChoices] = useState(fontChoices);
  useEffect(() => void (isOpen && setChoices(fontChoices())), [isOpen]);

  const pick = async (name: string, key: string) => {
    const family = key === AUTO ? null : key;
    setChoices((c) => {
      const next = { ...c };
      if (family) next[name] = family;
      else delete next[name];
      return next;
    });
    await chooseFont(name, family);
    onChange?.();
  };

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Polices manquantes', 'Missing fonts')} width={560} actions={(close) => <Button onPress={close}>{tr('Fermer', 'Close')}</Button>}>
        <p className="oel-fonts__intro">
          {tr('Ces polices ne sont ni intégrées au fichier ni installées sur cet appareil. Choisissez avec quelle police les afficher : seul l’affichage change, le fichier garde ses polices à l’export.', 'These fonts are neither embedded in the file nor installed on this device. Choose which font shows them: only the display changes, the file keeps its fonts on export.')}
        </p>
        <ul className="oel-fonts">
          {names.map((name) => {
            const auto = fonts.find((f) => f.name === name)?.substitute;
            return (
              <li key={name} className="oel-fonts__row">
                <div className="oel-fonts__font">
                  <strong>{name}</strong>
                  {/* Drawn with whatever stands in for the font now. */}
                  <span className="oel-fonts__sample" style={{ fontFamily: [name, auto].filter(Boolean).map((n) => `"${n!.replace(/"/g, '')}"`).concat('sans-serif').join(', ') }} aria-hidden>
                    {tr('Portez ce vieux whisky au juge blond 123', 'The quick brown fox jumps over the lazy dog 123')}
                  </span>
                </div>
                <Select aria-label={tr(`Afficher ${name} avec`, `Show ${name} with`)} className="oel-fonts__pick" selectedKey={choices[name] ?? AUTO} onSelectionChange={(k) => void pick(name, String(k))}>
                  {[
                    <SelectItem key={AUTO} id={AUTO}>
                      {auto ? tr(`Automatique (${auto})`, `Automatic (${auto})`) : tr('Automatique (police par défaut)', 'Automatic (default font)')}
                    </SelectItem>,
                    ...OPEN_FONTS.map((f) => (
                      <SelectItem key={f} id={f}>
                        {f}
                      </SelectItem>
                    )),
                  ]}
                </Select>
              </li>
            );
          })}
        </ul>
      </SheetDialog>
    </DialogOverlay>
  );
}
