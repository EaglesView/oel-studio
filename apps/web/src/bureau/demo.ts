/**
 * The demo Bureau a new desk starts with (plan solo MVP, S-4): the files of `fixtures/demo`
 * imported for real, and two live links — the workbook's chart drawn on slide 3 of the deck,
 * the desk's logo image shown in the document — so a first visit shows every editor, threads
 * and a note. Seeded once per desk (the saved desk keeps it, « Réinitialiser la démo » redoes it).
 */
import sheetUrl from '../../../../fixtures/demo/Chronos — tours de piste.xlsx?url';
import deckUrl from '../../../../fixtures/demo/Bienvenue dans le Bureau.pptx?url';
import docUrl from '../../../../fixtures/demo/À propos du Bureau.docx?url';
import logoUrl from '../../../../fixtures/demo/logo.png?url';
import { chartName } from '@oel/charts';
import type { LinkResolver } from '../links/resolver';
import { importInto } from './importFiles';
import { sheetSessionFor } from './sheets';
import { queueThumbnail } from './thumbnails';
import { PAPER_SIZE, type Bureau, type Paper, type PaperKind } from './model';

/** Bumped when the demo changes (`meta.demoVersion` on the saved desk). */
export const DEMO_VERSION = 1;

const ID = { sheet: 'demo-tableur', deck: 'demo-presentation', doc: 'demo-document', logo: 'demo-logo', note: 'demo-note' } as const;

/** The deck's chart that becomes the workbook's linked chart (named by `make_demo.py`). */
const DECK_CHART = 'Graphique du tableur';
/** The document's logo (python-docx's first picture) that becomes the desk image's linked copy. */
const DOC_LOGO = 'word/media/image1.png';

const FILES: Array<{ id: string; kind: PaperKind; url: string; name: string; x: number; y: number; rotation: number }> = [
  { id: ID.sheet, kind: 'spreadsheet', url: sheetUrl, name: 'Chronos — tours de piste.xlsx', x: 100, y: 150, rotation: -0.6 },
  { id: ID.deck, kind: 'slides', url: deckUrl, name: 'Bienvenue dans le Bureau.pptx', x: 660, y: 120, rotation: 1 },
  { id: ID.logo, kind: 'image', url: logoUrl, name: 'logo.png', x: 720, y: 480, rotation: 2 },
  { id: ID.doc, kind: 'document', url: docUrl, name: 'À propos du Bureau.docx', x: 1260, y: 110, rotation: -1 },
];

const NOTE_TEXT = 'Modifiez un temps dans l’onglet Tours : le graphique de la diapo 3 se met à jour.';

/** The papers of a new demo desk, waiting for their files (`seedDemo` imports them). */
export function demoPapers(): Paper[] {
  const now = Date.now();
  const files: Paper[] = FILES.map((f) => ({
    id: f.id,
    kind: f.kind,
    title: f.name.replace(/\.[^.]+$/, ''),
    x: f.x,
    y: f.y,
    ...PAPER_SIZE[f.kind],
    rotation: f.rotation,
    data: { preview: { kind: 'unsupported' }, status: { state: 'importing', progress: 0, stage: 'Lecture du fichier' }, fileName: f.name, updatedAt: now },
  }));
  const sheet = files[0]!;
  const note: Paper = {
    id: ID.note,
    kind: 'note',
    title: 'Note',
    x: sheet.x + 300,
    y: sheet.y + 230,
    ...PAPER_SIZE.note,
    rotation: -3,
    attach: { to: ID.sheet, dx: 300, dy: 230 },
    data: { preview: { kind: 'note', text: NOTE_TEXT }, status: { state: 'ready' }, updatedAt: now },
  };
  return [...files, note];
}

const seeded = new WeakSet<Bureau>();

/** Import the demo files into their papers, then link the chart and the logo. Once per desk. */
export async function seedDemo(store: Bureau, links: LinkResolver): Promise<void> {
  if (seeded.has(store)) return;
  seeded.add(store);
  const imported = await Promise.allSettled(
    FILES.map(async (f) => {
      const blob = await fetch(f.url).then((r) => r.blob());
      const file = new File([blob], f.name, { type: blob.type });
      const p = store.node(f.id) as Paper | undefined;
      if (p && f.kind === 'image') store.update(f.id, { data: { ...p.data, imageUrl: URL.createObjectURL(file) } }, { history: false });
      await importInto(store, f.id, file);
    }),
  );
  imported.forEach((r, i) => {
    if (r.status === 'fulfilled') return;
    const f = FILES[i]!;
    const p = store.node(f.id) as Paper | undefined;
    if (p) store.update(f.id, { data: { ...p.data, status: { state: 'error', reason: String((r.reason as Error)?.message ?? r.reason) } } }, { history: false });
  });

  await linkChart(store, links).catch((e) => console.warn('Démo : graphique non lié', e));
  await links.createLink({ kind: 'image', sourcePaperId: ID.logo, name: 'logo.png' }, ID.doc, { kind: 'document', where: 'replace', path: DOC_LOGO }, 'picture').catch((e) => console.warn('Démo : logo non lié', e));
  // The copies changed the deck and the document: draw them again.
  queueThumbnail(store, ID.deck);
  queueThumbnail(store, ID.doc);
}

/** « Résultats »'s chart → slide 3, in place of the deck's own chart. */
async function linkChart(store: Bureau, links: LinkResolver) {
  const paper = store.node(ID.sheet) as Paper | undefined;
  if (!paper?.data.docId) throw new Error('classeur non importé');
  const s = await sheetSessionFor(paper, () => {});
  const sheetId = s.sheet.sheetIdByName('Résultats');
  if (!sheetId) throw new Error('onglet « Résultats » introuvable');
  const index = s.sheet.drawings(sheetId).findIndex((d) => !!d.chart);
  const spec = s.sheet.drawings(sheetId)[index]?.chart;
  const chartId = index >= 0 ? s.sheet.drawingId(sheetId, index) : null;
  if (!spec || !chartId) throw new Error('graphique introuvable');
  await links.createLink({ sourcePaperId: ID.sheet, sheetId, chartId, name: chartName(spec), spec }, ID.deck, { kind: 'slides', where: 'replace', name: DECK_CHART }, 'chart');
}
