import { useState } from 'react';
import { Radio as RACRadio, RadioGroup as RACRadioGroup } from 'react-aria-components';
import { Button, DialogOverlay, Icon, Select, SelectItem, SheetDialog, type IconName } from '@oel/emboss';
import { blankForm, formFromColumns, registrationTemplate } from '../model/create';
import type { FormDef } from '../model/types';
import type { SheetRef } from './LinkSheetDialog';
import { tr } from '@oel/i18n';

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
    { id: 'blank', icon: 'input', title: tr('Formulaire vide', 'Blank form'), desc: tr('Une première question « Texte court »', 'A first “Short text” question') },
    { id: 'sheet', icon: 'table', title: tr('À partir d’un tableur', 'From a spreadsheet'), desc: sheet ? `${sheet.title} › ${sheet.tab}` : tr('Aucun tableur sur le bureau', 'No spreadsheet on the desk'), disabled: !sheets.length },
    { id: 'template', icon: 'form', title: tr('Modèle · Inscription', 'Template · Registration'), desc: tr('Nom, courriel, choix, date', 'Name, email, choice, date') },
  ];

  const create = () => {
    if (start === 'sheet' && sheet) {
      onCreate({ form: formFromColumns(sheet.rows, tr(`Formulaire · ${sheet.title}`, `Form · ${sheet.title}`), organiser), linkTo: sheet });
    } else if (start === 'template') {
      onCreate({ form: registrationTemplate(organiser), linkTo: null });
    } else {
      onCreate({ form: blankForm(tr('Formulaire sans titre', 'Untitled form'), organiser), linkTo: null });
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title={tr('Nouveau formulaire', 'New form')}
        width={640}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              {tr('Annuler', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              isDisabled={start === 'sheet' && !sheet}
              onPress={() => {
                create();
                close();
              }}
            >
              {tr('Créer', 'Create')}
            </Button>
          </>
        )}
      >
        <div className="forms-dialog">
          <p>{tr('Partir de zéro, des colonnes d’un tableur (une question par colonne), ou d’un modèle.', 'Start from scratch, from a spreadsheet’s columns (one question per column), or from a template.')}</p>
          <RACRadioGroup aria-label={tr('Point de départ', 'Starting point')} value={start} onChange={(v) => setStart(v as Start)} className="forms-starts" orientation="horizontal">
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
            <Select label={tr('Tableur', 'Spreadsheet')} selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
              {sheets.map((s) => (
                <SelectItem key={s.id} id={s.id} icon="table">
                  {`${s.title} › ${s.tab}`}
                </SelectItem>
              ))}
            </Select>
          )}
          {start === 'sheet' && sheet && (
            <p className="emb-field__helper">
              {tr(`${Math.max(0, (sheet.rows[0] ?? []).filter((h) => h.trim()).length)} colonnes → autant de questions. Les réponses iront dans ce même tableur.`, `${Math.max(0, (sheet.rows[0] ?? []).filter((h) => h.trim()).length)} columns → as many questions. The responses will go to this same spreadsheet.`)}
            </p>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}
