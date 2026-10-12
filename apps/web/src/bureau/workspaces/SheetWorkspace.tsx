import { useEffect, useState } from 'react';
import { SheetsEditor, toPreview, type SheetSession } from '@oel/sheets';
import '@oel/sheets/styles.css';
import '@oel/img/styles.css';
import { createImageWorker } from '../images';
import type { WorkspaceProps } from '../OpenSheet';
import { identity } from '../docs';
import { createCalcWorker, exportSheet, sheetSessionFor } from '../sheets';
import { activeLinks } from '../../links/resolver';
import { features } from '../../edition';
import { tr } from '@oel/i18n';

/**
 * 03 · Grille (C3 · Tableur): the spreadsheet editor (@oel/sheets) on a
 * collaborative, offline-capable workbook — IronCalc computes in a worker,
 * imported .xlsx keep their original package so export writes back what the
 * editor does not touch (charts, pivots, macros…). Compact at level 2
 * (ouvert sur place), with menus, tabs and history at level 3 (plein écran).
 */
export function SheetWorkspace({ paper, level, onDraft, registerFlush, onPatch, onExpand, onReduce, onBureau }: WorkspaceProps) {
  const [session, setSession] = useState<SheetSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    sheetSessionFor(paper, (docId) => onPatch?.({ data: { ...paper.data, docId } }))
      .then((s) => alive && setSession(s))
      .catch((e: Error) => alive && setError(e.message));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  // On close, the desk thumbnail is rebuilt from the workbook itself (typed values; formulas show their result next time).
  useEffect(() => {
    registerFlush(() => (session ? toPreview(session.sheet, (si, r, c) => session.sheet.inputText(session.sheet.sheetIds()[si]!, r, c).replace(/^=.*/, '')) : null));
  }, [session, registerFlush]);

  if (error) return <p className="workspace-empty">{tr('Impossible d’ouvrir le classeur :', 'Could not open the workbook:')} {error}</p>;
  if (!session) return <p className="workspace-empty">{tr('Ouverture du classeur…', 'Opening the workbook…')}</p>;
  return (
    <div className={`ws ws--sheets ws--sheets-${level === 3 ? 'full' : 'sheet'}`}>
      <SheetsEditor
        session={session}
        variant={level === 3 ? 'full' : 'sheet'}
        title={paper.title}
        identity={identity()}
        collab={features.collab}
        createCalcWorker={createCalcWorker}
        createImageWorker={createImageWorker}
        onTitleChange={(title) => onPatch?.({ title })}
        onPreview={(p) => onDraft(p)}
        exportFile={exportSheet}
        onBureau={onBureau}
        onExpand={onExpand}
        onReduce={onReduce}
        onLinkChart={activeLinks() ? (chart) => activeLinks()?.setUi({ dialog: { ...chart, sourcePaperId: paper.id } }) : undefined}
        onLinkRange={activeLinks() ? (r) => activeLinks()?.setUi({ dialog: { kind: 'range', sourcePaperId: paper.id, sheetId: r.sheetId, ids: r.ids, name: r.label } }) : undefined}
      />
    </div>
  );
}
