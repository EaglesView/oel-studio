/**
 * TEMPORARY: the sample papers « Communiqué » and « Lancement » are replaced
 * by real files from `fixtures/` at startup, so every visit exercises the
 * import → editor → thumbnail path on genuine Word and PowerPoint files.
 * Remove (with the call in BureauApp) when the desk is persisted.
 */
import complexTemplate from '../../../../fixtures/docx/complex_template.docx?url';
import presentation1 from '../../../../fixtures/pptx/Presentation 1.pptx?url';
import type { Bureau, Paper } from './model';
import { importInto } from './importFiles';

const FIXTURES: Array<{ paperId: string; url: string; name: string }> = [
  { paperId: 'communique', url: complexTemplate, name: 'complex_template.docx' },
  { paperId: 'lancement', url: presentation1, name: 'Presentation 1.pptx' },
];

const seeded = new WeakSet<Bureau>();

export function seedFixtures(store: Bureau) {
  if (seeded.has(store)) return;
  seeded.add(store);
  for (const f of FIXTURES) {
    const paper = store.node(f.paperId) as Paper | undefined;
    if (!paper) continue;
    store.update(f.paperId, { data: { ...paper.data, eyebrow: undefined, status: { state: 'importing', progress: 0, stage: 'Lecture du fichier' } } }, { history: false });
    void fetch(f.url)
      .then((r) => r.blob())
      .then((b) => importInto(store, f.paperId, new File([b], f.name, { type: b.type })))
      .catch((e: Error) => {
        const cur = store.node(f.paperId) as Paper | undefined;
        if (cur) store.update(f.paperId, { data: { ...cur.data, status: { state: 'error', reason: e.message } } }, { history: false });
      });
  }
}
