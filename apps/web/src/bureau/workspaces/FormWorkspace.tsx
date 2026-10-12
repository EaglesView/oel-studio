import { useState, useSyncExternalStore } from 'react';
import { FormBuilder, blankForm, type FormDef } from '@oel/forms';
import '@oel/forms/styles.css';
import type { WorkspaceProps } from '../OpenSheet';
import { formsBackend } from '../../forms/backend';
import { createResponseSheet, ensureFormThread, sheetRefs, writeHeaders } from '../forms';
import { blankTitle, type Paper } from '../model';

/**
 * E1 · Constructeur inside the open sheet. Level 2 (ouvert sur place) hides
 * the outline; level 3 (plein écran) is the full anatomy. Edits go straight to
 * the paper (no draft): the builder is the form's only editor.
 */
export function FormWorkspace({ paper, level, store, onOpenPaper }: WorkspaceProps) {
  // Spreadsheets on the desk, live (linking, choices from a range, quotas).
  const sheetsKey = useSyncExternalStore(
    (cb) => store!.subscribe(cb),
    () => JSON.stringify(sheetRefs(store!).map((s) => [s.id, s.title, s.rows])),
  );
  void sheetsKey;
  const sheets = sheetRefs(store!);
  // Papers are created with their form; the fallback only covers an older desk.
  const [fallback] = useState(() => blankForm(paper.title));
  const form: FormDef = paper.data.form ?? fallback;

  const onChange = (next: FormDef) => {
    const cur = store!.node(paper.id) as Paper | undefined;
    if (!cur) return;
    const prev = cur.data.form;
    // The desk sync owns the response → row map; never overwrite it with an older copy.
    const link = next.link && prev?.link && prev.link.sheetId === next.link.sheetId ? { ...next.link, rows: prev.link.rows } : next.link;
    const merged = { ...next, link };
    store!.update(paper.id, { title: merged.title.trim() || blankTitle('form'), data: { ...cur.data, form: merged } }, { history: false });
    if (link?.sheetId !== prev?.link?.sheetId || link?.tab !== prev?.link?.tab) ensureFormThread(store!, paper.id, link);
    if (link && JSON.stringify(link.columns) !== JSON.stringify(prev?.link?.columns)) writeHeaders(store!, link);
  };

  return (
    <div className="ws ws--form">
      <FormBuilder
        form={form}
        onChange={onChange}
        backend={formsBackend()}
        sheets={sheets}
        onCreateSheet={(title, header) => createResponseSheet(store!, paper.id, title, header)}
        onOpenSheet={(id) => onOpenPaper?.(id)}
        compact={level === 2}
      />
    </div>
  );
}
