import { useMemo, useState } from 'react';
import { Button, DialogOverlay, Radio, RadioGroup, Select, SelectItem, SheetDialog } from '@oel/emboss';
import { questionsOf } from '../model/create';
import { colLetter, proposeColumns, RECEIVED_HEADER, FILES_HEADER } from '../model/sheet';
import type { FormDef } from '../model/types';

/** A spreadsheet the host can offer (desk papers in the Bureau). */
export interface SheetRef {
  id: string;
  title: string;
  /** First tab name, used in labels (« Inscriptions »). */
  tab: string;
  rows: string[][];
}

export interface LinkChoice {
  target: { kind: 'new'; title: string } | { kind: 'existing'; sheet: SheetRef };
  /** questionId → column index chosen by the organiser. */
  columns: Record<string, number>;
}

/**
 * E2 · 3 « Lier à un tableur ». New spreadsheet or a sheet of an existing one.
 * The question → column mapping is visible and editable; « Reçu le » is added
 * on its own. « Plus tard » keeps building without a sheet (publishing will ask).
 */
export function LinkSheetDialog({
  form,
  sheets,
  isOpen,
  onOpenChange,
  onLink,
  reason,
}: {
  form: FormDef;
  sheets: SheetRef[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (choice: LinkChoice) => void;
  /** Shown above the choices, e.g. when publishing needs a sheet. */
  reason?: string;
}) {
  const [mode, setMode] = useState<'new' | 'existing'>(sheets.length && form.link ? 'existing' : 'new');
  const [sheetId, setSheetId] = useState<string | null>(form.link?.sheetId ?? sheets[0]?.id ?? null);
  const sheet = sheets.find((s) => s.id === sheetId) ?? null;
  const header = mode === 'existing' ? (sheet?.rows[0] ?? []) : [];
  const proposal = useMemo(() => proposeColumns(form, header), [form, header]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const newTitle = `${form.title || 'Formulaire'} — réponses`;

  const mapped = proposal.columns.map((c) => ({ ...c, column: overrides[c.questionId] ?? c.column }));
  const reserved = [proposal.receivedColumn, ...(proposal.filesColumn != null ? [proposal.filesColumn] : [])];
  const clash = (() => {
    const seen = new Map<number, string>();
    for (const c of mapped) {
      if (seen.has(c.column) || reserved.includes(c.column)) return c.column;
      seen.set(c.column, c.questionId);
    }
    return null;
  })();
  const width = Math.max(header.length, ...mapped.map((c) => c.column + 1), ...reserved.map((r) => r + 1)) + 2;
  const qs = new Map(questionsOf(form).map((q) => [q.id, q]));

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title="Où vont les réponses ?"
        width={560}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              Plus tard
            </Button>
            <Button
              variant="primary"
              leadingIcon="link"
              isDisabled={clash != null || (mode === 'existing' && !sheet)}
              onPress={() => {
                onLink({
                  target: mode === 'new' || !sheet ? { kind: 'new', title: newTitle } : { kind: 'existing', sheet },
                  columns: Object.fromEntries(mapped.map((c) => [c.questionId, c.column])),
                });
                close();
              }}
            >
              Lier
            </Button>
          </>
        )}
      >
        <div className="forms-dialog">
          {reason && <p className="forms-dialog__reason">{reason}</p>}
          <p>Chaque réponse devient une ligne ; chaque question, une colonne. Le lien apparaît comme un fil sur le bureau.</p>
          <RadioGroup aria-label="Destination des réponses" value={mode} onChange={(v) => setMode(v as 'new' | 'existing')}>
            <Radio value="new">Nouveau tableur « {newTitle} »</Radio>
            <Radio value="existing" isDisabled={!sheets.length}>
              Une feuille d’un tableur existant{!sheets.length ? ' (aucun tableur sur le bureau)' : ''}
            </Radio>
          </RadioGroup>
          {mode === 'existing' && sheets.length > 0 && (
            <Select label="Tableur et feuille" selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
              {sheets.map((s) => (
                <SelectItem key={s.id} id={s.id} icon="table">
                  {`${s.title} › ${s.tab}`}
                </SelectItem>
              ))}
            </Select>
          )}
          <table className="forms-map">
            <caption className="emb-visually-hidden">Correspondance question → colonne</caption>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Colonne</th>
              </tr>
            </thead>
            <tbody>
              {mapped.map((c) => (
                <tr key={c.questionId}>
                  <th scope="row">{qs.get(c.questionId)?.title || 'Question sans titre'}</th>
                  <td>
                    <Select
                      aria-label={`Colonne pour « ${qs.get(c.questionId)?.title} »`}
                      selectedKey={String(c.column)}
                      onSelectionChange={(k) => setOverrides((o) => ({ ...o, [c.questionId]: Number(k) }))}
                      isInvalid={clash === c.column}
                    >
                      {Array.from({ length: width }, (_, i) => (
                        <SelectItem key={i} id={String(i)}>
                          {`${colLetter(i)} · ${header[i] || (i === c.column ? c.header : 'nouvelle colonne')}`}
                        </SelectItem>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
              <tr className="is-auto">
                <th scope="row">(automatique)</th>
                <td>
                  {colLetter(proposal.receivedColumn)} · {RECEIVED_HEADER}
                </td>
              </tr>
              {proposal.filesColumn != null && (
                <tr className="is-auto">
                  <th scope="row">(fichiers joints)</th>
                  <td>
                    {colLetter(proposal.filesColumn)} · {FILES_HEADER}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {clash != null && (
            <p className="emb-field__error" role="alert">
              Deux éléments ne peuvent pas partager la colonne {colLetter(clash)}. Choisissez une autre colonne.
            </p>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}
