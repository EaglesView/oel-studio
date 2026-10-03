import { useState } from 'react';
import { Radio as RACRadio, RadioGroup as RACRadioGroup } from 'react-aria-components';
import { Button, DialogOverlay, Icon, Select, SelectItem, SheetDialog, type IconName } from '@oel/emboss';
import { blankForm, formFromColumns, registrationTemplate } from '../model/create';
import type { FormDef } from '../model/types';
import type { SheetRef } from './LinkSheetDialog';

export interface NewFormResult {
  form: FormDef;
  /** « À partir d’un tableur »: link the responses to that same sheet. */
  linkTo: SheetRef | null;
}

type Start = 'blank' | 'sheet' | 'template';

/**
 * E2 · 1 « Nouveau formulaire »: three starts — blank, from a spreadsheet's
 * columns (one question per column, type guessed), or a template.
 */
export function NewFormDialog({
  sheets,
  isOpen,
  onOpenChange,
  onCreate,
  initialSheetId,
  organiser = '',
}: {
  sheets: SheetRef[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (r: NewFormResult) => void;
  /** « Créer un formulaire » from a selected spreadsheet. */
  initialSheetId?: string | null;
  organiser?: string;
}) {
  const [start, setStart] = useState<Start>(initialSheetId ? 'sheet' : 'blank');
  const [sheetId, setSheetId] = useState<string | null>(initialSheetId ?? sheets[0]?.id ?? null);
  const sheet = sheets.find((s) => s.id === sheetId) ?? null;

  const options: Array<{ id: Start; icon: IconName; title: string; desc: string; disabled?: boolean }> = [
    { id: 'blank', icon: 'input', title: 'Formulaire vide', desc: 'Une première question « Texte court »' },
    { id: 'sheet', icon: 'table', title: 'À partir d’un tableur', desc: sheet ? `${sheet.title} › ${sheet.tab}` : 'Aucun tableur sur le bureau', disabled: !sheets.length },
    { id: 'template', icon: 'form', title: 'Modèle · Inscription', desc: 'Nom, courriel, choix, date' },
  ];

  const create = () => {
    if (start === 'sheet' && sheet) {
      onCreate({ form: formFromColumns(sheet.rows, `Formulaire · ${sheet.title}`, organiser), linkTo: sheet });
    } else if (start === 'template') {
      onCreate({ form: registrationTemplate(organiser), linkTo: null });
    } else {
      onCreate({ form: blankForm('Formulaire sans titre', organiser), linkTo: null });
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title="Nouveau formulaire"
        width={640}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              Annuler
            </Button>
            <Button
              variant="primary"
              isDisabled={start === 'sheet' && !sheet}
              onPress={() => {
                create();
                close();
              }}
            >
              Créer
            </Button>
          </>
        )}
      >
        <div className="forms-dialog">
          <p>Partir de zéro, des colonnes d’un tableur (une question par colonne), ou d’un modèle.</p>
          <RACRadioGroup aria-label="Point de départ" value={start} onChange={(v) => setStart(v as Start)} className="forms-starts" orientation="horizontal">
            {options.map((o) => (
              <RACRadio key={o.id} value={o.id} isDisabled={o.disabled} className="forms-start">
                <span className="forms-start__icon" aria-hidden>
                  <Icon name={o.icon} size={24} />
                </span>
                <strong>{o.title}</strong>
                <span>{o.desc}</span>
              </RACRadio>
            ))}
          </RACRadioGroup>
          {start === 'sheet' && sheets.length > 1 && (
            <Select label="Tableur" selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
              {sheets.map((s) => (
                <SelectItem key={s.id} id={s.id} icon="table">
                  {`${s.title} › ${s.tab}`}
                </SelectItem>
              ))}
            </Select>
          )}
          {start === 'sheet' && sheet && (
            <p className="emb-field__helper">
              {Math.max(0, (sheet.rows[0] ?? []).filter((h) => h.trim()).length)} colonnes → autant de questions. Les réponses iront dans ce même tableur.
            </p>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}
