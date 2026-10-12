import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Dialog } from 'react-aria-components';
import { Badge, Button, Checkbox, DialogOverlay, Popover, Radio, RadioGroup, Select, SelectItem, SheetDialog, TextField, toast } from '@oel/emboss';
import { a1, colName, parseRange, parseSqref, rangeA1 } from '../model/a1';
import type { CondFormat, CsvDialect, Validation } from '../model/types';
import { current } from '../grid/selection';
import { NUMBER_FORMATS, type SheetController } from './controller';
import { tr } from '@oel/i18n';

interface Controlled {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Find & replace (Ctrl+F / Ctrl+H)
// ---------------------------------------------------------------------------

export function FindBar({ ctl, replace, onClose }: { ctl: SheetController; replace: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [by, setBy] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [formulas, setFormulas] = useState(false);
  const [all, setAll] = useState(false);
  const [i, setI] = useState(-1);
  const opts = { matchCase, whole, formulas, allSheets: all };
  const hits = useMemo(() => ctl.find(q, opts), [q, matchCase, whole, formulas, all, ctl.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (d: 1 | -1) => {
    if (!hits.length) return;
    const n = (i + d + hits.length) % hits.length;
    setI(n);
    const h = hits[n]!;
    ctl.setSheet(h.sheet);
    ctl.select({ ranges: [{ r0: h.r, c0: h.c, r1: h.r, c1: h.c }], active: { r: h.r, c: h.c }, anchor: { r: h.r, c: h.c } });
  };
  return (
    <div className="oel-findbar" role="search" aria-label={replace ? tr('Rechercher et remplacer', 'Find and replace') : tr('Rechercher', 'Find')} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <TextField aria-label={tr('Rechercher', 'Find')} placeholder={tr('Rechercher', 'Find')} value={q} onChange={(v) => (setQ(v), setI(-1))} autoFocus onKeyDown={(e) => e.key === 'Enter' && go(e.shiftKey ? -1 : 1)} />
      <span className="oel-findbar__count" role="status">{q ? (hits.length ? tr(`${i < 0 ? 0 : i + 1} sur ${hits.length}`, `${i < 0 ? 0 : i + 1} of ${hits.length}`) : tr('Aucun résultat', 'No results')) : ''}</span>
      <Button size="icon-sm" variant="ghost" leadingIcon="chevron-up" aria-label={tr('Précédent', 'Previous')} onPress={() => go(-1)} />
      <Button size="icon-sm" variant="ghost" leadingIcon="chevron-down" aria-label={tr('Suivant', 'Next')} onPress={() => go(1)} />
      {replace && (
        <>
          <TextField aria-label={tr('Remplacer par', 'Replace with')} placeholder={tr('Remplacer par', 'Replace with')} value={by} onChange={setBy} />
          <Button
            size="sm"
            variant="secondary"
            isDisabled={ctl.readOnlyFlag || i < 0}
            onPress={() => {
              const h = hits[i];
              if (h && ctl.replace(q, by, opts, h)) go(1);
            }}
          >
            {tr('Remplacer', 'Replace')}
          </Button>
          <Button size="sm" isDisabled={ctl.readOnlyFlag || !hits.length} onPress={() => toast({ title: tr(`${ctl.replace(q, by, opts)} cellule(s) remplacée(s)`, `${ctl.replace(q, by, opts)} cell(s) replaced`), tone: 'success' })}>
            {tr('Tout remplacer', 'Replace all')}
          </Button>
        </>
      )}
      <Checkbox isSelected={matchCase} onChange={setMatchCase}>{tr('Respecter la casse', 'Match case')}</Checkbox>
      <Checkbox isSelected={whole} onChange={setWhole}>{tr('Cellule entière', 'Whole cell')}</Checkbox>
      <Checkbox isSelected={formulas} onChange={setFormulas}>{tr('Dans les formules', 'In formulas')}</Checkbox>
      <Checkbox isSelected={all} onChange={setAll}>{tr('Toutes les feuilles', 'All sheets')}</Checkbox>
      <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label={tr('Fermer la recherche', 'Close the search')} onPress={onClose} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Format cells (Ctrl+1): number format code
// ---------------------------------------------------------------------------

export function FormatCellsDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const [code, setCode] = useState('General');
  useEffect(() => void (isOpen && setCode(ctl.activeStyle.numFmt)), [isOpen, ctl]);
  const save = () => {
    ctl.setNumFmt(code.trim() || 'General');
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Format des nombres', 'Number format')} width={520} actions={() => <Button onPress={save}>{tr('Appliquer', 'Apply')}</Button>}>
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), save())}>
          <div className="oel-fmtlist" role="listbox" aria-label={tr('Formats courants', 'Common formats')}>
            {NUMBER_FORMATS.map((f) => (
              <button key={f.id} type="button" role="option" aria-selected={code === f.code} className={`oel-fmtlist__item${code === f.code ? ' is-on' : ''}`} onClick={() => setCode(f.code)}>
                <span>{f.label}</span>
                <span className="oel-numfmt__ex">{f.example}</span>
              </button>
            ))}
          </div>
          <TextField
            label={tr('Code de format (Excel)', 'Format code (Excel)')}
            value={code}
            onChange={setCode}
            description={tr('Exemples : 0.00 · #,##0 &quot;$&quot; · 0.0% · yyyy-mm-dd · [Red]-0.00 · @ (texte). Le code est enregistré tel quel dans le fichier.', 'Examples: 0.00 · #,##0 &quot;$&quot; · 0.0% · yyyy-mm-dd · [Red]-0.00 · @ (text). The code is saved as is in the file.')}
          />
          <button type="submit" hidden />
        </form>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Sort range
// ---------------------------------------------------------------------------

export function SortDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const rg = useMemo(() => {
    const c = current(ctl.sel);
    return c.r0 === c.r1 && c.c0 === c.c1 ? ctl.currentRegion() : c;
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const [header, setHeader] = useState(true);
  const [keys, setKeys] = useState<Array<{ col: number; desc: boolean }>>([{ col: rg.c0, desc: false }]);
  useEffect(() => {
    if (isOpen) {
      setKeys([{ col: Math.max(rg.c0, Math.min(rg.c1, ctl.sel.active.c)), desc: false }]);
      setHeader(ctl.view(rg.r0, rg.c0).kind === 's' && ctl.view(rg.r0 + 1, rg.c0).kind !== 's');
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = Array.from({ length: Math.min(rg.c1 - rg.c0 + 1, 200) }, (_, i) => rg.c0 + i);
  const labelOf = (c: number) => (header && ctl.view(rg.r0, c).text ? `${ctl.view(rg.r0, c).text} (${colName(c)})` : tr(`Colonne ${colName(c)}`, `Column ${colName(c)}`));
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title={tr(`Trier la plage ${rangeA1(rg)}`, `Sort the range ${rangeA1(rg)}`)}
        width={520}
        actions={() => (
          <Button
            onPress={() => {
              ctl.sort(keys, { header, range: rg });
              onClose();
            }}
          >
            {tr('Trier', 'Sort')}
          </Button>
        )}
      >
        <div className="oel-form">
          <Checkbox isSelected={header} onChange={setHeader}>{tr('La première ligne contient des en-têtes', 'The first row holds headers')}</Checkbox>
          {keys.map((k, i) => (
            <div key={i} className="oel-form__row">
              <span className="oel-form__label">{i === 0 ? tr('Trier par', 'Sort by') : tr('Puis par', 'Then by')}</span>
              <Select aria-label={tr('Colonne', 'Column')} selectedKey={String(k.col)} onSelectionChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, col: Number(v) } : x)))}>
                {cols.map((c) => (
                  <SelectItem key={c} id={String(c)}>
                    {labelOf(c)}
                  </SelectItem>
                ))}
              </Select>
              <Select aria-label={tr('Ordre', 'Order')} selectedKey={k.desc ? 'desc' : 'asc'} onSelectionChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, desc: v === 'desc' } : x)))}>
                <SelectItem id="asc">A → Z, croissant</SelectItem>
                <SelectItem id="desc">{tr('Z → A, décroissant', 'Z → A, descending')}</SelectItem>
              </Select>
              {i > 0 && <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label={tr('Retirer ce critère', 'Remove this criterion')} onPress={() => setKeys(keys.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {keys.length < 3 && (
            <Button size="sm" variant="ghost" leadingIcon="plus" onPress={() => setKeys([...keys, { col: cols.find((c) => !keys.some((k) => k.col === c)) ?? rg.c0, desc: false }])}>
              {tr('Ajouter un critère', 'Add a criterion')}
            </Button>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Data validation
// ---------------------------------------------------------------------------

const VALIDATION_KINDS: Array<[string, string]> = [
  ['list', tr('Liste de choix', 'List of choices')],
  ['whole', tr('Nombre entier', 'Whole number')],
  ['decimal', tr('Nombre décimal', 'Decimal')],
  ['date', 'Date'],
  ['textLength', tr('Longueur du texte', 'Text length')],
  ['custom', tr('Formule personnalisée', 'Custom formula')],
];

const OPERATORS: Array<[string, string]> = [
  ['between', 'entre'],
  ['notBetween', tr('pas entre', 'not between')],
  ['equal', tr('égal à', 'equal to')],
  ['notEqual', tr('différent de', 'not equal to')],
  ['greaterThan', tr('supérieur à', 'greater than')],
  ['lessThan', tr('inférieur à', 'less than')],
  ['greaterThanOrEqual', tr('supérieur ou égal à', 'greater than or equal to')],
  ['lessThanOrEqual', tr('inférieur ou égal à', 'less than or equal to')],
];

export function ValidationDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const sqref = rangeA1(current(ctl.sel));
  const existing = ctl.doc.validations(ctl.sheetId).find((v) => parseSqref(v.sqref).some((r) => r.r0 <= ctl.sel.active.r && ctl.sel.active.r <= r.r1 && r.c0 <= ctl.sel.active.c && ctl.sel.active.c <= r.c1));
  const [v, setV] = useState<Validation>({ sqref, kind: 'list', formula1: '', allowBlank: true });
  useEffect(() => {
    if (isOpen) setV(existing ? { ...existing } : { sqref, kind: 'list', formula1: '', allowBlank: true, operator: 'between' });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const listText = v.kind === 'list' && v.formula1?.startsWith('"') ? v.formula1.slice(1, -1) : (v.formula1 ?? '');
  const save = () => {
    const others = ctl.doc.validations(ctl.sheetId).filter((x) => x !== existing && x.sqref !== existing?.sqref);
    const f1 = v.kind === 'list' && listText && !/^[=$A-Za-z]/.test(listText.trim()) ? `"${listText.replace(/"/g, '')}"` : v.kind === 'list' ? listText.replace(/^=/, '') : v.formula1?.replace(/^=/, '');
    ctl.doc.setValidations(ctl.sheetId, [...others, { ...v, sqref: existing?.sqref ?? sqref, formula1: f1, ...(v.kind === 'list' || v.kind === 'custom' ? { operator: undefined } : {}) }]);
    onClose();
  };
  const remove = () => {
    ctl.doc.setValidations(ctl.sheetId, ctl.doc.validations(ctl.sheetId).filter((x) => x.sqref !== existing?.sqref));
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title={tr(`Validation des données · ${existing?.sqref ?? sqref}`, `Data validation · ${existing?.sqref ?? sqref}`)}
        width={520}
        actions={() => (
          <>
            {existing && (
              <Button variant="ghost" onPress={remove}>
                {tr('Supprimer la règle', 'Delete the rule')}
              </Button>
            )}
            <Button onPress={save}>{tr('Enregistrer', 'Save')}</Button>
          </>
        )}
      >
        <div className="oel-form">
          <Select label={tr('Autoriser', 'Allow')} selectedKey={v.kind} onSelectionChange={(k) => setV({ ...v, kind: String(k) })}>
            {VALIDATION_KINDS.map(([id, label]) => (
              <SelectItem key={id} id={id}>
                {label}
              </SelectItem>
            ))}
          </Select>
          {v.kind === 'list' ? (
            <TextField label={tr('Choix', 'Choices')} value={listText} onChange={(t) => setV({ ...v, formula1: t })} description={tr('Séparés par des virgules (Oui,Non), ou une plage : =$A$1:$A$5', 'Separated by commas (Yes,No), or a range: =$A$1:$A$5')} />
          ) : v.kind === 'custom' ? (
            <TextField label={tr('Formule (vraie quand la valeur est acceptée)', 'Formula (true when the value is accepted)')} value={v.formula1 ?? ''} onChange={(t) => setV({ ...v, formula1: t })} description="Par exemple : =LEN(A1)<=10" />
          ) : (
            <>
              <Select label={tr('Condition', 'Condition')} selectedKey={v.operator ?? 'between'} onSelectionChange={(k) => setV({ ...v, operator: String(k) })}>
                {OPERATORS.map(([id, label]) => (
                  <SelectItem key={id} id={id}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
              <TextField label={v.operator === 'between' || v.operator === 'notBetween' || !v.operator ? 'Minimum' : tr('Valeur', 'Value')} value={v.formula1 ?? ''} onChange={(t) => setV({ ...v, formula1: t })} />
              {(v.operator === 'between' || v.operator === 'notBetween' || !v.operator) && <TextField label="Maximum" value={v.formula2 ?? ''} onChange={(t) => setV({ ...v, formula2: t })} />}
            </>
          )}
          <Checkbox isSelected={!!v.allowBlank} onChange={(b) => setV({ ...v, allowBlank: b })}>{tr('Accepter les cellules vides', 'Accept empty cells')}</Checkbox>
          <TextField label={tr('Message si la valeur est refusée', 'Message if the value is refused')} value={v.error ?? ''} onChange={(t) => setV({ ...v, error: t || undefined })} />
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

/** Choices of a list validation for a cell (inline list or a range on the sheet). */
export function listChoices(ctl: SheetController, r: number, c: number): string[] | null {
  const v = ctl.doc.validations(ctl.sheetId).find((x) => x.kind === 'list' && parseSqref(x.sqref).some((rg) => rg.r0 <= r && r <= rg.r1 && rg.c0 <= c && c <= rg.c1));
  if (!v?.formula1) return null;
  const f = v.formula1.trim();
  if (f.startsWith('"')) return f.slice(1, -1).split(',').map((s) => s.trim());
  const rg = parseRange(f.replace(/^=/, '').split('!').pop()!);
  if (!rg) return null;
  const out: string[] = [];
  for (let rr = rg.r0; rr <= Math.min(rg.r1, rg.r0 + 500); rr++) for (let cc = rg.c0; cc <= Math.min(rg.c1, rg.c0 + 20); cc++) {
    const t = ctl.view(rr, cc).text;
    if (t) out.push(t);
  }
  return out;
}

/** Check a typed value against the cell's validation; returns the refusal message, or null. */
export function validate(ctl: SheetController, r: number, c: number, text: string): string | null {
  const v = ctl.doc.validations(ctl.sheetId).find((x) => parseSqref(x.sqref).some((rg) => rg.r0 <= r && r <= rg.r1 && rg.c0 <= c && c <= rg.c1));
  if (!v || v.kind === 'none' || v.kind === 'custom') return null;
  if (text === '') return v.allowBlank ? null : v.error ?? tr('Cette cellule ne peut pas être vide.', 'This cell can’t be empty.');
  const refuse = v.error || tr('La valeur ne respecte pas la règle de validation de cette cellule.', 'The value doesn’t follow this cell’s validation rule.');
  if (v.kind === 'list') {
    const choices = listChoices(ctl, r, c);
    return choices && !choices.some((x) => x.toLowerCase() === text.trim().toLowerCase()) ? refuse : null;
  }
  const num = (s?: string) => (s == null || s === '' ? NaN : Number(s.replace(/^=/, '')));
  const n = v.kind === 'textLength' ? text.length : Number(text.replace(',', '.'));
  if (Number.isNaN(n) || (v.kind === 'whole' && !Number.isInteger(n))) return refuse;
  const a = num(v.formula1);
  const b = num(v.formula2);
  const ok = (() => {
    switch (v.operator ?? 'between') {
      case 'between': return n >= a && n <= b;
      case 'notBetween': return n < a || n > b;
      case 'equal': return n === a;
      case 'notEqual': return n !== a;
      case 'greaterThan': return n > a;
      case 'lessThan': return n < a;
      case 'greaterThanOrEqual': return n >= a;
      case 'lessThanOrEqual': return n <= a;
      default: return true;
    }
  })();
  return ok || (v.kind === 'date') ? null : refuse;
}

// ---------------------------------------------------------------------------
// Conditional formatting
// ---------------------------------------------------------------------------

const CF_OPS: Array<[string, string]> = [
  ['greaterThan', tr('Supérieur à', 'Greater than')],
  ['lessThan', tr('Inférieur à', 'Less than')],
  ['between', tr('Entre', 'Between')],
  ['equal', tr('Égal à', 'Equal to')],
  ['notEqual', tr('Différent de', 'Not equal to')],
  ['greaterThanOrEqual', tr('Supérieur ou égal à', 'Greater than or equal to')],
  ['lessThanOrEqual', tr('Inférieur ou égal à', 'Less than or equal to')],
];

const CF_STYLES: Array<{ id: string; label: string; fill: string; color: string }> = [
  { id: 'red', label: tr('Rouge clair, texte rouge foncé', 'Light red, dark red text'), fill: '#FFC7CE', color: '#9C0006' },
  { id: 'yellow', label: tr('Jaune, texte brun', 'Yellow, brown text'), fill: '#FFEB9C', color: '#9C5700' },
  { id: 'green', label: tr('Vert clair, texte vert foncé', 'Light green, dark green text'), fill: '#C6EFCE', color: '#006100' },
  { id: 'blue', label: tr('Bleu clair', 'Light blue'), fill: '#DDEBF7', color: '#1F4E79' },
];

export function CondFormatDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const sqref = rangeA1(current(ctl.sel));
  const [kind, setKind] = useState<'cellIs' | 'colorScale' | 'dataBar' | 'containsText'>('cellIs');
  const [op, setOp] = useState('greaterThan');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [look, setLook] = useState('red');
  const list = ctl.doc.condFormats(ctl.sheetId);
  const add = () => {
    const priority = Math.max(0, ...list.flatMap((c) => c.rules.map((r) => r.priority))) + 1;
    const style = CF_STYLES.find((s) => s.id === look)!;
    const dxfs = ctl.doc.doc.getArray<import('../model/types').CellStyle>('dxfs');
    const dxf = () => {
      dxfs.push([{ numFmt: 'General', font: { color: { css: style.color, rgb: `FF${style.color.slice(1)}` } }, fill: { css: style.fill, rgb: `FF${style.fill.slice(1)}` }, border: {}, align: {}, locked: true }]);
      return dxfs.length - 1;
    };
    const lit = (s: string) => (/^-?\d+([.,]\d+)?$/.test(s.trim()) ? s.trim().replace(',', '.') : `"${s.replace(/"/g, '""')}"`);
    let cf: CondFormat;
    if (kind === 'colorScale') cf = { sqref, rules: [{ kind, formulas: [], priority, colors: [{ css: '#F8696B' }, { css: '#FFEB84' }, { css: '#63BE7B' }] }] };
    else if (kind === 'dataBar') cf = { sqref, rules: [{ kind, formulas: [], priority, colors: [{ css: '#638EC6' }] }] };
    else if (kind === 'containsText') {
      const top = a1(current(ctl.sel).r0, current(ctl.sel).c0);
      cf = { sqref, rules: [{ kind, operator: 'containsText', formulas: [`NOT(ISERROR(SEARCH(${lit(a)},${top})))`], dxf: dxf(), priority, colors: [] }] };
    } else cf = { sqref, rules: [{ kind, operator: op, formulas: op === 'between' ? [lit(a), lit(b)] : [lit(a)], dxf: dxf(), priority, colors: [] }] };
    ctl.doc.setCondFormats(ctl.sheetId, [...list, cf]);
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr(`Mise en forme conditionnelle · ${sqref}`, `Conditional formatting · ${sqref}`)} width={560} actions={() => <Button onPress={add}>{tr('Ajouter la règle', 'Add the rule')}</Button>}>
        <div className="oel-form">
          <RadioGroup label={tr('Type de règle', 'Rule type')} value={kind} onChange={(k) => setKind(k as typeof kind)}>
            <Radio value="cellIs">{tr('Valeur de la cellule', 'Cell value')}</Radio>
            <Radio value="containsText">{tr('Texte qui contient', 'Text that contains')}</Radio>
            <Radio value="colorScale">{tr('Échelle de couleurs (rouge → vert)', 'Colour scale (red → green)')}</Radio>
            <Radio value="dataBar">{tr('Barres de données', 'Data bars')}</Radio>
          </RadioGroup>
          {kind === 'cellIs' && (
            <div className="oel-form__row">
              <Select aria-label={tr('Condition', 'Condition')} selectedKey={op} onSelectionChange={(k) => setOp(String(k))}>
                {CF_OPS.map(([id, label]) => (
                  <SelectItem key={id} id={id}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
              <TextField aria-label={tr('Valeur', 'Value')} value={a} onChange={setA} />
              {op === 'between' && <TextField aria-label={tr('Et', 'And')} value={b} onChange={setB} />}
            </div>
          )}
          {kind === 'containsText' && <TextField label={tr('Texte', 'Text')} value={a} onChange={setA} />}
          {(kind === 'cellIs' || kind === 'containsText') && (
            <Select label={tr('Mise en forme', 'Formatting')} selectedKey={look} onSelectionChange={(k) => setLook(String(k))}>
              {CF_STYLES.map((s) => (
                <SelectItem key={s.id} id={s.id} textValue={s.label}>
                  <span className="oel-cfpreview" style={{ background: s.fill, color: s.color }}>{s.label}</span>
                </SelectItem>
              ))}
            </Select>
          )}
          {list.length > 0 && (
            <div className="oel-cflist">
              <h3>{tr('Règles de la feuille', 'Sheet rules')}</h3>
              <ul>
                {list.map((cf, i) => (
                  <li key={i}>
                    <span>{cf.sqref}</span>
                    <span>{cf.rules.map((r) => ruleLabel(r.kind, r.operator)).join(', ')}</span>
                    <Button size="icon-sm" variant="ghost" leadingIcon="trash" aria-label={tr('Supprimer cette règle', 'Delete this rule')} onPress={() => ctl.doc.setCondFormats(ctl.sheetId, list.filter((_, j) => j !== i))} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

const ruleLabel = (kind: string, op?: string) =>
  ({ cellIs: tr(`Valeur ${CF_OPS.find(([id]) => id === op)?.[1].toLowerCase() ?? ''}`, `Value ${CF_OPS.find(([id]) => id === op)?.[1].toLowerCase() ?? ''}`), colorScale: tr('Échelle de couleurs', 'Colour scale'), dataBar: tr('Barres de données', 'Data bars'), iconSet: tr('Jeu d’icônes (conservé)', 'Icon set (kept)'), expression: tr('Formule (conservée)', 'Formula (kept)'), containsText: tr('Texte qui contient', 'Text that contains') })[kind] ?? tr(`${kind} (conservée)`, `${kind} (kept)`);

// ---------------------------------------------------------------------------
// Named ranges
// ---------------------------------------------------------------------------

export function NamesDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  useEffect(() => {
    if (isOpen) setRef(`${quote(ctl.props.name)}!${rangeA1(current(ctl.sel)).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = ctl.doc.names().filter((n) => !n.name.startsWith('_xlnm.'));
  const add = () => {
    if (!/^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) || /^[A-Za-z]{1,3}\d+$/.test(name)) return toast({ title: tr('Nom invalide', 'Invalid name'), description: tr('Commencez par une lettre ; pas d’espace ; pas un nom de cellule (A1).', 'Start with a letter; no spaces; not a cell name (A1).'), tone: 'warning' });
    ctl.doc.setName(name, ref);
    setName('');
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Plages nommées', 'Named ranges')} width={560} actions={() => <Button onPress={onClose}>OK</Button>}>
        <div className="oel-form">
          <ul className="oel-names">
            {names.map((n) => (
              <li key={`${n.scope ?? ''}|${n.name}`}>
                <strong>{n.name}</strong>
                <code>{n.formula}</code>
                {n.scope && <Badge tone="neutral">{ctl.doc.props(n.scope).name}</Badge>}
                <Button size="icon-sm" variant="ghost" leadingIcon="trash" aria-label={tr(`Supprimer ${n.name}`, `Delete ${n.name}`)} isDisabled={ctl.readOnlyFlag} onPress={() => ctl.doc.deleteName(n.name, n.scope)} />
              </li>
            ))}
            {!names.length && <li className="oel-panel__empty">{tr('Aucune plage nommée.', 'No named ranges.')}</li>}
          </ul>
          {!ctl.readOnlyFlag && (
            <div className="oel-form__row">
              <TextField label={tr('Nom', 'Name')} value={name} onChange={setName} />
              <TextField label={tr('Fait référence à', 'Refers to')} value={ref} onChange={setRef} />
              <Button onPress={add}>{tr('Ajouter', 'Add')}</Button>
            </div>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

const quote = (n: string) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

// ---------------------------------------------------------------------------
// Link (Ctrl+K)
// ---------------------------------------------------------------------------

export function LinkDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const at = ctl.sel.active;
  const existing = ctl.doc.hyperlinks(ctl.sheetId).find((h) => h.ref === a1(at.r, at.c));
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    if (!isOpen) return;
    setUrl(existing?.target ?? existing?.location ?? '');
    setText(ctl.view(at.r, at.c).text);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    const others = ctl.doc.hyperlinks(ctl.sheetId).filter((h) => h.ref !== a1(at.r, at.c));
    const internal = /^[^/:]+!/.test(url) || /^#/.test(url);
    const target = internal ? undefined : /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    ctl.doc.doc.transact(() => {
      ctl.doc.setHyperlinks(ctl.sheetId, url ? [...others, { ref: a1(at.r, at.c), ...(internal ? { location: url.replace(/^#/, '') } : { target }) }] : others);
      if (text && text !== ctl.view(at.r, at.c).text) ctl.doc.setInput(ctl.sheetId, at.r, at.c, text);
      else if (!ctl.view(at.r, at.c).text && url) ctl.doc.setInput(ctl.sheetId, at.r, at.c, url);
      // Excel's « Lien hypertexte » look.
      if (url) ctl.doc.formatRange(ctl.sheetId, { r0: at.r, c0: at.c, r1: at.r, c1: at.c }, (s) => ({ ...s, font: { ...s.font, color: { css: '#0563C1', theme: 10 }, underline: 'single' } }));
    });
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Lien', 'Link')} width={460} actions={() => <Button onPress={save}>{url ? tr('Appliquer', 'Apply') : tr('Retirer le lien', 'Remove the link')}</Button>}>
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), save())}>
          <TextField label={tr('Texte', 'Text')} value={text} onChange={setText} />
          <TextField label={tr('Adresse', 'Address')} value={url} onChange={setUrl} autoFocus description={tr('Une page web (https://…), un courriel (mailto:…) ou une cellule (Feuille1!A1).', 'A web page (https://…), an email (mailto:…) or a cell (Sheet1!A1).')} />
          <button type="submit" hidden />
        </form>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// CSV settings
// ---------------------------------------------------------------------------

export function CsvDialog({ ctl, isOpen, onClose }: Controlled & { ctl: SheetController }) {
  const meta = ctl.doc.doc.getMap<unknown>('meta');
  const cur = (meta.get('csv') as CsvDialect | undefined) ?? { delimiter: ',', encoding: 'utf-8', bom: true, lineEnding: '\r\n' };
  const [d, setD] = useState<CsvDialect>(cur);
  useEffect(() => void (isOpen && setD(cur)), [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title={tr('Paramètres CSV', 'CSV settings')}
        width={460}
        actions={() => (
          <Button
            onPress={() => {
              meta.set('csv', d);
              onClose();
            }}
          >
            {tr('Enregistrer', 'Save')}
          </Button>
        )}
      >
        <div className="oel-form">
          <Select label={tr('Séparateur', 'Separator')} selectedKey={d.delimiter} onSelectionChange={(k) => setD({ ...d, delimiter: String(k), decimalComma: k === ';' ? d.decimalComma : false })}>
            <SelectItem id=",">{tr('Virgule ( , )', 'Comma ( , )')}</SelectItem>
            <SelectItem id=";">{tr('Point-virgule ( ; ) — Excel en français', 'Semicolon ( ; ) — Excel in French')}</SelectItem>
            <SelectItem id={'\t'}>{tr('Tabulation', 'Tab')}</SelectItem>
            <SelectItem id="|">{tr('Barre verticale ( | )', 'Vertical bar ( | )')}</SelectItem>
          </Select>
          <Select label={tr('Encodage', 'Encoding')} selectedKey={d.encoding} onSelectionChange={(k) => setD({ ...d, encoding: String(k) })}>
            <SelectItem id="utf-8">{tr('UTF-8 (recommandé)', 'UTF-8 (recommended)')}</SelectItem>
            <SelectItem id="windows-1252">{tr('Windows-1252 (ancien Excel)', 'Windows-1252 (old Excel)')}</SelectItem>
          </Select>
          {d.encoding === 'utf-8' && <Checkbox isSelected={d.bom} onChange={(b) => setD({ ...d, bom: b })}>{tr('Marque d’ordre (BOM) — Excel reconnaît alors les accents', 'Byte order mark (BOM) — Excel then reads accents')}</Checkbox>}
          <Checkbox isSelected={!!d.decimalComma} onChange={(b) => setD({ ...d, decimalComma: b })} isDisabled={d.delimiter === ','}>{tr('Virgule décimale (1234,50)', 'Decimal comma (1234,50)')}</Checkbox>
          <Select label={tr('Fins de ligne', 'Line endings')} selectedKey={d.lineEnding} onSelectionChange={(k) => setD({ ...d, lineEnding: String(k) })}>
            <SelectItem id={'\r\n'}>Windows (CRLF)</SelectItem>
            <SelectItem id={'\n'}>Unix, macOS (LF)</SelectItem>
          </Select>
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Floating menus at a point (filter checklist, validation list)
// ---------------------------------------------------------------------------

function AnchoredPopover({ at, onClose, label, children }: { at: { x: number; y: number }; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={ref} className="oel-anchor" style={{ left: at.x, top: at.y }} aria-hidden />
      <Popover triggerRef={ref as RefObject<HTMLSpanElement>} isOpen onOpenChange={(o) => !o && onClose()} placement="bottom start" showArrow={false}>
        <Dialog className="oel-popover-dialog" aria-label={label}>
          {children}
        </Dialog>
      </Popover>
    </>
  );
}

export function FilterMenu({ ctl, col, at, onClose }: { ctl: SheetController; col: number; at: { x: number; y: number }; onClose: () => void }) {
  const values = useMemo(() => ctl.filterValues(col), [ctl, col]);
  const f = ctl.doc.filter(ctl.sheetId);
  const active = f?.columns.find((c) => c.col === col);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(active ? [...active.values, ...(active.blank ? [''] : [])] : values.map((v) => v.text)));
  const [q, setQ] = useState('');
  const range = f ? parseRange(f.ref) : null;
  const shown = values.filter((v) => v.text.toLowerCase().includes(q.toLowerCase()));
  return (
    <AnchoredPopover at={at} onClose={onClose} label={tr('Filtre de la colonne', 'Column filter')}>
      <div className="oel-filtermenu">
        <div className="oel-filtermenu__sort">
          <Button size="sm" variant="ghost" leadingIcon="sort-asc" onPress={() => (range && ctl.sort([{ col: range.c0 + col, desc: false }], { header: true, range }), onClose())}>{tr('Trier A → Z', 'Sort A → Z')}</Button>
          <Button size="sm" variant="ghost" leadingIcon="sort-desc" onPress={() => (range && ctl.sort([{ col: range.c0 + col, desc: true }], { header: true, range }), onClose())}>{tr('Trier Z → A', 'Sort Z → A')}</Button>
        </div>
        <TextField aria-label={tr('Chercher une valeur', 'Search for a value')} placeholder={tr('Chercher', 'Search')} value={q} onChange={setQ} />
        <div className="oel-filtermenu__actions">
          <button type="button" onClick={() => setChecked(new Set(values.map((v) => v.text)))}>{tr('Tout sélectionner', 'Select all')}</button>
          <button type="button" onClick={() => setChecked(new Set())}>{tr('Effacer', 'Clear')}</button>
        </div>
        <ul className="oel-filtermenu__list">
          {shown.map((v) => (
            <li key={v.text}>
              <Checkbox
                isSelected={checked.has(v.text)}
                onChange={(on) => {
                  const next = new Set(checked);
                  if (on) next.add(v.text);
                  else next.delete(v.text);
                  setChecked(next);
                }}
              >
                {v.text || '(Vides)'} <span className="oel-filtermenu__n">{v.count}</span>
              </Checkbox>
            </li>
          ))}
        </ul>
        <div className="oel-filtermenu__foot">
          <Button size="sm" variant="ghost" onPress={() => (ctl.setFilterColumn(col, null), onClose())}>{tr('Retirer le filtre', 'Remove the filter')}</Button>
          <Button size="sm" onPress={() => (ctl.setFilterColumn(col, checked.size === values.length ? null : [...checked]), onClose())}>OK</Button>
        </div>
      </div>
    </AnchoredPopover>
  );
}

export function ValidationList({ ctl, at, onClose }: { ctl: SheetController; at: { x: number; y: number }; onClose: () => void }) {
  const { r, c } = ctl.sel.active;
  const choices = listChoices(ctl, r, c) ?? [];
  return (
    <AnchoredPopover at={at} onClose={onClose} label={tr('Choix de la liste', 'List choices')}>
      <ul className="oel-validlist" role="listbox" aria-label={tr('Choix', 'Choices')}>
        {choices.map((ch) => (
          <li key={ch}>
            <button
              type="button"
              role="option"
              aria-selected={ctl.view(r, c).text === ch}
              autoFocus={ctl.view(r, c).text === ch}
              onClick={() => {
                ctl.doc.setInput(ctl.sheetId, r, c, ch);
                onClose();
              }}
            >
              {ch}
            </button>
          </li>
        ))}
      </ul>
    </AnchoredPopover>
  );
}

// ---------------------------------------------------------------------------
// Preserved content (« Conservé »)
// ---------------------------------------------------------------------------

export function PreservedNote({ items }: { items: Array<{ kind: string; label: string }> }) {
  return (
    <div className="oel-preserved">
      <p>{tr('Le fichier contient des éléments que l’éditeur ne modifie pas encore. Ils sont gardés tels quels et réécrits à l’identique à l’export .xlsx :', 'The file holds elements the editor can’t edit yet. They are kept as they are and written back identically on .xlsx export:')}</p>
      <ul>
        {items.map((p) => (
          <li key={p.kind}>{p.label}</li>
        ))}
      </ul>
      <p className="oel-preserved__note">{tr('Les graphiques suivent les lignes et colonnes insérées ; les tableaux croisés gardent leurs plages d’origine : si vous insérez des lignes au-dessus de leurs données, vérifiez-les dans Excel.', 'Charts follow inserted rows and columns; pivot tables keep their original ranges: if you insert rows above their data, check them in Excel.')}</p>
    </div>
  );
}
