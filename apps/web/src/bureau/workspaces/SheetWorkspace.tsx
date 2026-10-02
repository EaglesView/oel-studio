import { useRef, useState, type KeyboardEvent } from 'react';
import { Toolbar, ToolbarSeparator, ToolButton, Badge } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';

const COLS = 5;
const MIN_ROWS = 12;
const colName = (i: number) => String.fromCharCode(65 + i);
const nf = new Intl.NumberFormat('fr-CA');
const ENGINE_LATER = 'Arrive avec le moteur de tableurs (WASM).';

/**
 * 03 · Grille: headers and row numbers are debossed gutters, the formula bar is
 * two input wells. A real grid (role="grid") with arrow-key cell navigation;
 * Enter or F2 edits a cell, Échap cancels, typing starts editing.
 */
export function SheetWorkspace({ paper, onDraft }: WorkspaceProps) {
  const initial = paper.data.preview.kind === 'spreadsheet' ? paper.data.preview.rows : [];
  const sheets = paper.data.preview.kind === 'spreadsheet' ? paper.data.preview.sheets : ['Feuille 1'];
  const [rows, setRows] = useState<string[][]>(() => {
    const r = initial.map((row) => Array.from({ length: COLS }, (_, i) => row[i] ?? ''));
    while (r.length < MIN_ROWS) r.push(Array(COLS).fill(''));
    return r;
  });
  const [cell, setCell] = useState({ r: 1, c: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  const value = rows[cell.r]?.[cell.c] ?? '';
  const setValue = (r: number, c: number, v: string) => {
    const next = rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row));
    setRows(next);
    onDraft({ kind: 'spreadsheet', sheets, rows: next.filter((row) => row.some(Boolean)) });
  };

  const focusCell = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(COLS - 1, c));
    setCell({ r: nr, c: nc });
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-cell="${nr}-${nc}"]`)?.focus());
  };

  const commit = () => {
    if (editing != null) setValue(cell.r, cell.c, editing);
    setEditing(null);
  };

  const onCellKey = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    if (editing != null) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); focusCell(r + 1, c); }
      else if (e.key === 'Tab') { e.preventDefault(); commit(); focusCell(r, c + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); focusCell(r, c); }
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (m) { e.preventDefault(); focusCell(r + m[0], c + m[1]); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setEditing(rows[r]?.[c] ?? ''); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setValue(r, c, ''); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setEditing(e.key); }
  };

  const nums = rows.slice(1).map((r) => Number((r[1] ?? '').replace(/\s/g, '').replace(',', '.'))).filter((n) => Number.isFinite(n) && n !== 0);
  const total = nums.reduce((a, b) => a + b, 0);

  return (
    <div className="ws ws--sheet">
      <div className="ws__ribbon">
        <Toolbar aria-label="Outils du tableur">
          <ToolButton icon="sum" label="Somme automatique" shortcut={['Alt', '=']} value={`${nf.format(total)} $`} description="Somme de la colonne B." />
          <ToolButton icon="table" label="Format nombre" unavailableReason={ENGINE_LATER} />
          <ToolButton icon="chart" label="Graphique" unavailableReason={ENGINE_LATER} />
          <ToolbarSeparator />
          <ToolButton icon="link" label="Lier à une diapo" description="Crée un fil de liaison Budget → diapo." />
        </Toolbar>
      </div>

      <div className="ws__stage ws__stage--sheet">
        <div className="formula-bar">
          <span className="formula-bar__name emb-well" aria-label="Cellule active">{colName(cell.c)}{cell.r + 1}</span>
          <input
            className="formula-bar__input emb-well"
            aria-label={`Contenu de ${colName(cell.c)}${cell.r + 1}`}
            value={editing ?? value}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commit(); focusCell(cell.r + 1, cell.c); }
              if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); focusCell(cell.r, cell.c); }
            }}
            onBlur={commit}
          />
        </div>
        <div className="grid-scroll">
          <table ref={gridRef} role="grid" aria-label={`${paper.title}, feuille ${sheets[0]}`} aria-rowcount={rows.length + 1} aria-colcount={COLS + 1} className="grid">
            <thead>
              <tr role="row">
                <th role="columnheader" aria-hidden className="grid__corner" />
                {Array.from({ length: COLS }, (_, c) => (
                  <th role="columnheader" key={c} scope="col">{colName(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr role="row" key={r}>
                  <th role="rowheader" scope="row">{r + 1}</th>
                  {row.map((v, c) => {
                    const active = cell.r === r && cell.c === c;
                    const isNum = v !== '' && Number.isFinite(Number(v));
                    return (
                      <td
                        role="gridcell"
                        key={c}
                        data-cell={`${r}-${c}`}
                        tabIndex={active ? 0 : -1}
                        aria-selected={active}
                        aria-label={`${colName(c)}${r + 1}${v ? `, ${v}` : ', vide'}`}
                        className={`grid__cell${active ? ' is-active' : ''}${isNum ? ' is-num' : ''}`}
                        onFocus={() => !active && setCell({ r, c })}
                        onKeyDown={(e) => onCellKey(e, r, c)}
                        onDoubleClick={() => { setCell({ r, c }); setEditing(v); }}
                      >
                        {active && editing != null ? (
                          <input
                            className="grid__editor"
                            autoFocus
                            aria-label={`Modifier ${colName(c)}${r + 1}`}
                            value={editing}
                            onChange={(e) => setEditing(e.target.value)}
                            onBlur={commit}
                          />
                        ) : isNum ? (
                          nf.format(Number(v))
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sheet-tabs" role="presentation">
          {sheets.map((s, i) => (
            <Badge key={s} tone={i === 0 ? 'accent' : 'neutral'} dot={false}>{s}</Badge>
          ))}
          <span className="sheet-tabs__summary" role="status">
            Somme : {nf.format(total)} $ · Moyenne : {nums.length ? nf.format(Math.round(total / nums.length)) : 0} $ · {nums.length} valeurs
          </span>
        </div>
      </div>

      <Inspector title="Cellule">
        <InspectorRow label="Adresse" value={`${colName(cell.c)}${cell.r + 1}`} />
        <InspectorRow label="Valeur" value={value || '—'} />
        <InspectorRow label="Type" value={value === '' ? 'Vide' : Number.isFinite(Number(value)) ? 'Nombre' : 'Texte'} />
      </Inspector>
    </div>
  );
}
