import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Dialog } from 'react-aria-components';
import { Badge, Button, Checkbox, DialogOverlay, Popover, Radio, RadioGroup, Select, SelectItem, SheetDialog, TextField, toast } from '@oel/emboss';
import { a1, colName, parseRange, parseSqref, rangeA1 } from '../model/a1';
import type { CondFormat, CsvDialect, Validation } from '../model/types';
import { current } from '../grid/selection';
import { NUMBER_FORMATS, type SheetController } from './controller';

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
    <div className="oel-findbar" role="search" aria-label={replace ? 'Rechercher et remplacer' : 'Rechercher'} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <TextField aria-label="Rechercher" placeholder="Rechercher" value={q} onChange={(v) => (setQ(v), setI(-1))} autoFocus onKeyDown={(e) => e.key === 'Enter' && go(e.shiftKey ? -1 : 1)} />
      <span className="oel-findbar__count" role="status">{q ? (hits.length ? `${i < 0 ? 0 : i + 1} sur ${hits.length}` : 'Aucun résultat') : ''}</span>
      <Button size="icon-sm" variant="ghost" leadingIcon="chevron-up" aria-label="Précédent" onPress={() => go(-1)} />
      <Button size="icon-sm" variant="ghost" leadingIcon="chevron-down" aria-label="Suivant" onPress={() => go(1)} />
      {replace && (
        <>
          <TextField aria-label="Remplacer par" placeholder="Remplacer par" value={by} onChange={setBy} />
          <Button
            size="sm"
            variant="secondary"
            isDisabled={ctl.readOnlyFlag || i < 0}
            onPress={() => {
              const h = hits[i];
              if (h && ctl.replace(q, by, opts, h)) go(1);
            }}
          >
            Remplacer
          </Button>
          <Button size="sm" isDisabled={ctl.readOnlyFlag || !hits.length} onPress={() => toast({ title: `${ctl.replace(q, by, opts)} cellule(s) remplacée(s)`, tone: 'success' })}>
            Tout remplacer
          </Button>
        </>
      )}
      <Checkbox isSelected={matchCase} onChange={setMatchCase}>Respecter la casse</Checkbox>
      <Checkbox isSelected={whole} onChange={setWhole}>Cellule entière</Checkbox>
      <Checkbox isSelected={formulas} onChange={setFormulas}>Dans les formules</Checkbox>
      <Checkbox isSelected={all} onChange={setAll}>Toutes les feuilles</Checkbox>
      <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer la recherche" onPress={onClose} />
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
      <SheetDialog title="Format des nombres" width={520} actions={() => <Button onPress={save}>Appliquer</Button>}>
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), save())}>
          <div className="oel-fmtlist" role="listbox" aria-label="Formats courants">
            {NUMBER_FORMATS.map((f) => (
              <button key={f.id} type="button" role="option" aria-selected={code === f.code} className={`oel-fmtlist__item${code === f.code ? ' is-on' : ''}`} onClick={() => setCode(f.code)}>
                <span>{f.label}</span>
                <span className="oel-numfmt__ex">{f.example}</span>
              </button>
            ))}
          </div>
          <TextField
            label="Code de format (Excel)"
            value={code}
            onChange={setCode}
            description="Exemples : 0.00 · #,##0 &quot;$&quot; · 0.0% · yyyy-mm-dd · [Red]-0.00 · @ (texte). Le code est enregistré tel quel dans le fichier."
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
  const labelOf = (c: number) => (header && ctl.view(rg.r0, c).text ? `${ctl.view(rg.r0, c).text} (${colName(c)})` : `Colonne ${colName(c)}`);
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title={`Trier la plage ${rangeA1(rg)}`}
        width={520}
        actions={() => (
          <Button
            onPress={() => {
              ctl.sort(keys, { header, range: rg });
              onClose();
            }}
          >
            Trier
          </Button>
        )}
      >
        <div className="oel-form">
          <Checkbox isSelected={header} onChange={setHeader}>La première ligne contient des en-têtes</Checkbox>
          {keys.map((k, i) => (
            <div key={i} className="oel-form__row">
              <span className="oel-form__label">{i === 0 ? 'Trier par' : 'Puis par'}</span>
              <Select aria-label="Colonne" selectedKey={String(k.col)} onSelectionChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, col: Number(v) } : x)))}>
                {cols.map((c) => (
                  <SelectItem key={c} id={String(c)}>
                    {labelOf(c)}
                  </SelectItem>
                ))}
              </Select>
              <Select aria-label="Ordre" selectedKey={k.desc ? 'desc' : 'asc'} onSelectionChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, desc: v === 'desc' } : x)))}>
                <SelectItem id="asc">A → Z, croissant</SelectItem>
                <SelectItem id="desc">Z → A, décroissant</SelectItem>
              </Select>
              {i > 0 && <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Retirer ce critère" onPress={() => setKeys(keys.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {keys.length < 3 && (
            <Button size="sm" variant="ghost" leadingIcon="plus" onPress={() => setKeys([...keys, { col: cols.find((c) => !keys.some((k) => k.col === c)) ?? rg.c0, desc: false }])}>
              Ajouter un critère
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
  ['list', 'Liste de choix'],
  ['whole', 'Nombre entier'],
  ['decimal', 'Nombre décimal'],
  ['date', 'Date'],
  ['textLength', 'Longueur du texte'],
  ['custom', 'Formule personnalisée'],
];

const OPERATORS: Array<[string, string]> = [
  ['between', 'entre'],
  ['notBetween', 'pas entre'],
  ['equal', 'égal à'],
  ['notEqual', 'différent de'],
  ['greaterThan', 'supérieur à'],
  ['lessThan', 'inférieur à'],
  ['greaterThanOrEqual', 'supérieur ou égal à'],
  ['lessThanOrEqual', 'inférieur ou égal à'],
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
        title={`Validation des données · ${existing?.sqref ?? sqref}`}
        width={520}
        actions={() => (
          <>
            {existing && (
              <Button variant="ghost" onPress={remove}>
                Supprimer la règle
              </Button>
            )}
            <Button onPress={save}>Enregistrer</Button>
          </>
        )}
      >
        <div className="oel-form">
          <Select label="Autoriser" selectedKey={v.kind} onSelectionChange={(k) => setV({ ...v, kind: String(k) })}>
            {VALIDATION_KINDS.map(([id, label]) => (
              <SelectItem key={id} id={id}>
                {label}
              </SelectItem>
            ))}
          </Select>
          {v.kind === 'list' ? (
            <TextField label="Choix" value={listText} onChange={(t) => setV({ ...v, formula1: t })} description="Séparés par des virgules (Oui,Non), ou une plage : =$A$1:$A$5" />
          ) : v.kind === 'custom' ? (
            <TextField label="Formule (vraie quand la valeur est acceptée)" value={v.formula1 ?? ''} onChange={(t) => setV({ ...v, formula1: t })} description="Par exemple : =LEN(A1)<=10" />
          ) : (
            <>
              <Select label="Condition" selectedKey={v.operator ?? 'between'} onSelectionChange={(k) => setV({ ...v, operator: String(k) })}>
                {OPERATORS.map(([id, label]) => (
                  <SelectItem key={id} id={id}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
              <TextField label={v.operator === 'between' || v.operator === 'notBetween' || !v.operator ? 'Minimum' : 'Valeur'} value={v.formula1 ?? ''} onChange={(t) => setV({ ...v, formula1: t })} />
              {(v.operator === 'between' || v.operator === 'notBetween' || !v.operator) && <TextField label="Maximum" value={v.formula2 ?? ''} onChange={(t) => setV({ ...v, formula2: t })} />}
            </>
          )}
          <Checkbox isSelected={!!v.allowBlank} onChange={(b) => setV({ ...v, allowBlank: b })}>Accepter les cellules vides</Checkbox>
          <TextField label="Message si la valeur est refusée" value={v.error ?? ''} onChange={(t) => setV({ ...v, error: t || undefined })} />
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
  if (text === '') return v.allowBlank ? null : v.error ?? 'Cette cellule ne peut pas être vide.';
  const refuse = v.error || 'La valeur ne respecte pas la règle de validation de cette cellule.';
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
  ['greaterThan', 'Supérieur à'],
  ['lessThan', 'Inférieur à'],
  ['between', 'Entre'],
  ['equal', 'Égal à'],
  ['notEqual', 'Différent de'],
  ['greaterThanOrEqual', 'Supérieur ou égal à'],
  ['lessThanOrEqual', 'Inférieur ou égal à'],
];

const CF_STYLES: Array<{ id: string; label: string; fill: string; color: string }> = [
  { id: 'red', label: 'Rouge clair, texte rouge foncé', fill: '#FFC7CE', color: '#9C0006' },
  { id: 'yellow', label: 'Jaune, texte brun', fill: '#FFEB9C', color: '#9C5700' },
  { id: 'green', label: 'Vert clair, texte vert foncé', fill: '#C6EFCE', color: '#006100' },
  { id: 'blue', label: 'Bleu clair', fill: '#DDEBF7', color: '#1F4E79' },
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
      <SheetDialog title={`Mise en forme conditionnelle · ${sqref}`} width={560} actions={() => <Button onPress={add}>Ajouter la règle</Button>}>
        <div className="oel-form">
          <RadioGroup label="Type de règle" value={kind} onChange={(k) => setKind(k as typeof kind)}>
            <Radio value="cellIs">Valeur de la cellule</Radio>
            <Radio value="containsText">Texte qui contient</Radio>
            <Radio value="colorScale">Échelle de couleurs (rouge → vert)</Radio>
            <Radio value="dataBar">Barres de données</Radio>
          </RadioGroup>
          {kind === 'cellIs' && (
            <div className="oel-form__row">
              <Select aria-label="Condition" selectedKey={op} onSelectionChange={(k) => setOp(String(k))}>
                {CF_OPS.map(([id, label]) => (
                  <SelectItem key={id} id={id}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
              <TextField aria-label="Valeur" value={a} onChange={setA} />
              {op === 'between' && <TextField aria-label="Et" value={b} onChange={setB} />}
            </div>
          )}
          {kind === 'containsText' && <TextField label="Texte" value={a} onChange={setA} />}
          {(kind === 'cellIs' || kind === 'containsText') && (
            <Select label="Mise en forme" selectedKey={look} onSelectionChange={(k) => setLook(String(k))}>
              {CF_STYLES.map((s) => (
                <SelectItem key={s.id} id={s.id} textValue={s.label}>
                  <span className="oel-cfpreview" style={{ background: s.fill, color: s.color }}>{s.label}</span>
                </SelectItem>
              ))}
            </Select>
          )}
          {list.length > 0 && (
            <div className="oel-cflist">
              <h3>Règles de la feuille</h3>
              <ul>
                {list.map((cf, i) => (
                  <li key={i}>
                    <span>{cf.sqref}</span>
                    <span>{cf.rules.map((r) => ruleLabel(r.kind, r.operator)).join(', ')}</span>
                    <Button size="icon-sm" variant="ghost" leadingIcon="trash" aria-label="Supprimer cette règle" onPress={() => ctl.doc.setCondFormats(ctl.sheetId, list.filter((_, j) => j !== i))} />
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
  ({ cellIs: `Valeur ${CF_OPS.find(([id]) => id === op)?.[1].toLowerCase() ?? ''}`, colorScale: 'Échelle de couleurs', dataBar: 'Barres de données', iconSet: 'Jeu d’icônes (conservé)', expression: 'Formule (conservée)', containsText: 'Texte qui contient' })[kind] ?? `${kind} (conservée)`;

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
    if (!/^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) || /^[A-Za-z]{1,3}\d+$/.test(name)) return toast({ title: 'Nom invalide', description: 'Commencez par une lettre ; pas d’espace ; pas un nom de cellule (A1).', tone: 'warning' });
    ctl.doc.setName(name, ref);
    setName('');
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title="Plages nommées" width={560} actions={() => <Button onPress={onClose}>OK</Button>}>
        <div className="oel-form">
          <ul className="oel-names">
            {names.map((n) => (
              <li key={`${n.scope ?? ''}|${n.name}`}>
                <strong>{n.name}</strong>
                <code>{n.formula}</code>
                {n.scope && <Badge tone="neutral">{ctl.doc.props(n.scope).name}</Badge>}
                <Button size="icon-sm" variant="ghost" leadingIcon="trash" aria-label={`Supprimer ${n.name}`} isDisabled={ctl.readOnlyFlag} onPress={() => ctl.doc.deleteName(n.name, n.scope)} />
              </li>
            ))}
            {!names.length && <li className="oel-panel__empty">Aucune plage nommée.</li>}
          </ul>
          {!ctl.readOnlyFlag && (
            <div className="oel-form__row">
              <TextField label="Nom" value={name} onChange={setName} />
              <TextField label="Fait référence à" value={ref} onChange={setRef} />
              <Button onPress={add}>Ajouter</Button>
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
      <SheetDialog title="Lien" width={460} actions={() => <Button onPress={save}>{url ? 'Appliquer' : 'Retirer le lien'}</Button>}>
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), save())}>
          <TextField label="Texte" value={text} onChange={setText} />
          <TextField label="Adresse" value={url} onChange={setUrl} autoFocus description="Une page web (https://…), un courriel (mailto:…) ou une cellule (Feuille1!A1)." />
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
        title="Paramètres CSV"
        width={460}
        actions={() => (
          <Button
            onPress={() => {
              meta.set('csv', d);
              onClose();
            }}
          >
            Enregistrer
          </Button>
        )}
      >
        <div className="oel-form">
          <Select label="Séparateur" selectedKey={d.delimiter} onSelectionChange={(k) => setD({ ...d, delimiter: String(k), decimalComma: k === ';' ? d.decimalComma : false })}>
            <SelectItem id=",">Virgule ( , )</SelectItem>
            <SelectItem id=";">Point-virgule ( ; ) — Excel en français</SelectItem>
            <SelectItem id={'\t'}>Tabulation</SelectItem>
            <SelectItem id="|">Barre verticale ( | )</SelectItem>
          </Select>
          <Select label="Encodage" selectedKey={d.encoding} onSelectionChange={(k) => setD({ ...d, encoding: String(k) })}>
            <SelectItem id="utf-8">UTF-8 (recommandé)</SelectItem>
            <SelectItem id="windows-1252">Windows-1252 (ancien Excel)</SelectItem>
          </Select>
          {d.encoding === 'utf-8' && <Checkbox isSelected={d.bom} onChange={(b) => setD({ ...d, bom: b })}>Marque d’ordre (BOM) — Excel reconnaît alors les accents</Checkbox>}
          <Checkbox isSelected={!!d.decimalComma} onChange={(b) => setD({ ...d, decimalComma: b })} isDisabled={d.delimiter === ','}>Virgule décimale (1234,50)</Checkbox>
          <Select label="Fins de ligne" selectedKey={d.lineEnding} onSelectionChange={(k) => setD({ ...d, lineEnding: String(k) })}>
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
    <AnchoredPopover at={at} onClose={onClose} label="Filtre de la colonne">
      <div className="oel-filtermenu">
        <div className="oel-filtermenu__sort">
          <Button size="sm" variant="ghost" leadingIcon="sort-asc" onPress={() => (range && ctl.sort([{ col: range.c0 + col, desc: false }], { header: true, range }), onClose())}>Trier A → Z</Button>
          <Button size="sm" variant="ghost" leadingIcon="sort-desc" onPress={() => (range && ctl.sort([{ col: range.c0 + col, desc: true }], { header: true, range }), onClose())}>Trier Z → A</Button>
        </div>
        <TextField aria-label="Chercher une valeur" placeholder="Chercher" value={q} onChange={setQ} />
        <div className="oel-filtermenu__actions">
          <button type="button" onClick={() => setChecked(new Set(values.map((v) => v.text)))}>Tout sélectionner</button>
          <button type="button" onClick={() => setChecked(new Set())}>Effacer</button>
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
          <Button size="sm" variant="ghost" onPress={() => (ctl.setFilterColumn(col, null), onClose())}>Retirer le filtre</Button>
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
    <AnchoredPopover at={at} onClose={onClose} label="Choix de la liste">
      <ul className="oel-validlist" role="listbox" aria-label="Choix">
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
      <p>Le fichier contient des éléments que l’éditeur ne modifie pas encore. Ils sont gardés tels quels et réécrits à l’identique à l’export .xlsx :</p>
      <ul>
        {items.map((p) => (
          <li key={p.kind}>{p.label}</li>
        ))}
      </ul>
      <p className="oel-preserved__note">Les graphiques suivent les lignes et colonnes insérées ; les tableaux croisés gardent leurs plages d’origine : si vous insérez des lignes au-dessus de leurs données, vérifiez-les dans Excel.</p>
    </div>
  );
}
