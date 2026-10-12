import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@oel/emboss';
import { a1, rangeA1 } from '../model/a1';
import { current } from '../grid/selection';
import type { SheetController } from './controller';
import { tr } from '@oel/i18n';

/**
 * Name box + formula bar (C3 · 1–2): the name box shows the active cell or
 * the selection and goes to whatever is typed in it; the formula input edits
 * the same text as the cell (typing in either shows in both).
 */
export function FormulaBar({ ctl, onFocusGrid }: { ctl: SheetController; onFocusGrid: () => void }) {
  const rg = current(ctl.sel);
  const multi = rg.r0 !== rg.r1 || rg.c0 !== rg.c1;
  const nameShown = ctl.edit?.point ? rangeA1({ r0: ctl.edit.point.anchor.r, c0: ctl.edit.point.anchor.c, r1: ctl.edit.point.at.r, c1: ctl.edit.point.at.c }) : multi && !ctl.edit ? rangeA1(rg) : a1(ctl.sel.active.r, ctl.sel.active.c);
  const [name, setName] = useState(nameShown);
  const [nameFocus, setNameFocus] = useState(false);
  useEffect(() => void (!nameFocus && setName(nameShown)), [nameShown, nameFocus]);
  const input = useRef<HTMLInputElement>(null);
  const edit = ctl.edit;
  const value = edit ? edit.text : ctl.doc.inputText(ctl.sheetId, ctl.sel.active.r, ctl.sel.active.c);

  useEffect(() => {
    const el = input.current;
    if (el && edit?.where === 'bar' && document.activeElement === el && el.selectionStart !== edit.cursor) el.setSelectionRange(edit.cursor, edit.cursor);
  });

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!ctl.edit) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const mod = e.ctrlKey || e.metaKey;
      ctl.commitEdit(mod ? null : 'down', { all: mod && !e.shiftKey, array: mod && e.shiftKey });
      onFocusGrid();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      ctl.commitEdit(e.shiftKey ? 'left' : 'right');
      onFocusGrid();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      ctl.cancelEdit();
      onFocusGrid();
    } else if (e.key === 'F4') {
      e.preventDefault();
      ctl.cycleRef();
    }
  };

  return (
    <div className="oel-formulabar">
      <input
        className="oel-formulabar__name emb-well"
        aria-label={tr('Zone Nom : cellule active, ou aller à une référence', 'Name box: active cell, or go to a reference')}
        value={name}
        onFocus={(e) => (setNameFocus(true), e.currentTarget.select())}
        onBlur={() => setNameFocus(false)}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (ctl.goTo(name)) onFocusGrid();
            else setName(nameShown);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setName(nameShown);
            onFocusGrid();
          }
        }}
      />
      <span className="oel-formulabar__fx" aria-hidden>
        <Icon name="function" size={16} />
      </span>
      <input
        ref={input}
        className="oel-formulabar__input emb-well"
        aria-label={tr(`Contenu de ${a1(ctl.sel.active.r, ctl.sel.active.c)}`, `Contents of ${a1(ctl.sel.active.r, ctl.sel.active.c)}`)}
        readOnly={ctl.readOnlyFlag}
        spellCheck={false}
        value={value}
        onFocus={(e) => {
          if (ctl.readOnlyFlag) return;
          if (!ctl.edit) {
            ctl.editSheet = ctl.sheetId;
            ctl.startEdit(undefined, 'bar');
          } else if (ctl.edit.where !== 'bar') {
            ctl.edit = { ...ctl.edit, where: 'bar' };
            ctl.bump();
          }
          const pos = e.currentTarget.selectionStart ?? value.length;
          requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
        }}
        onChange={(e) => ctl.setEditText(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => {
          const t = e.currentTarget;
          if (ctl.edit && ctl.edit.where === 'bar' && t.selectionStart != null && t.selectionStart !== ctl.edit.cursor) {
            ctl.edit = { ...ctl.edit, cursor: t.selectionStart, point: null };
            ctl.bump();
          }
        }}
        onKeyDown={onKey}
      />
    </div>
  );
}
