import EngineWorker from '@oel/engine/worker?worker';
import { EngineHost, MAX_IMPORT_BYTES, detectKind, stripExtension, type ImportResult } from '@oel/engine';
import { toast } from '@oel/emboss';
import type { Vec } from '@oel/desk';
import { PAPER_SIZE, uid, type Bureau, type Paper, type PaperKind } from './model';
import type { ArrivalRules } from './Chrome';

let host: EngineHost | null = null;

/** One engine worker per tab, created on first import. */
export function engineHost(): EngineHost {
  host ??= new EngineHost(() => new EngineWorker());
  return host;
}

const toPaperKind = (k: ImportResult['kind']): PaperKind => (k === 'unsupported' ? 'file' : k);

/**
 * B8 · Déposer des fichiers. Files land fanned out where they were dropped,
 * each showing its own state (converting with progress, read-only, ready);
 * a toast summarises the result.
 */
export async function importFiles(store: Bureau, files: File[], at: Vec | null, rules: ArrivalRules, announce: (m: string) => void) {
  const accepted = files.filter((f) => f.size <= MAX_IMPORT_BYTES);
  const tooBig = files.length - accepted.length;
  if (tooBig) toast({ title: `${tooBig} fichier${tooBig > 1 ? 's' : ''} ignoré${tooBig > 1 ? 's' : ''}`, description: 'Taille maximale : 100 Mo.', tone: 'warning' });
  if (!accepted.length) return;

  const origin = at ?? store.viewCenter();
  const papers: Paper[] = accepted.map((file, i) => {
    const kind = toPaperKind(detectKind(file));
    const size = PAPER_SIZE[kind];
    let x = origin.x - size.w / 2 + i * 36;
    let y = origin.y - size.h / 2 + i * 24;
    if (rules.sortByType) {
      const same = store.nodes.filter((n) => n.kind === kind);
      const b = store.bounds(same.map((n) => n.id));
      if (b) {
        x = b.x + b.w + 48 + i * 24;
        y = b.y + i * 24;
      }
    }
    return {
      id: uid('import'),
      kind,
      title: stripExtension(file.name),
      x,
      y,
      w: size.w,
      h: size.h,
      rotation: (i % 2 ? 1 : -1) * (1 + (i % 3)),
      data: {
        preview: { kind: 'unsupported' },
        status: { state: 'importing', progress: 0, stage: 'Lecture du fichier' },
        comments: [],
        editor: 'JB',
        fileName: file.name,
        imageUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
      },
    };
  });

  store.add(papers);
  announce(`${papers.length} fichier${papers.length > 1 ? 's' : ''} en cours d’import`);

  const results = await Promise.allSettled(
    accepted.map(async (file, i) => {
      const paper = papers[i]!;
      const result = await engineHost().import(file, (p) => {
        const current = store.node(paper.id);
        if (!current) return;
        store.update(paper.id, { data: { ...current.data, status: { state: 'importing', progress: p.value, stage: p.stage } } }, { history: false });
      });
      const current = store.node(paper.id);
      if (!current) return result;
      const kind = toPaperKind(result.kind);
      const size = PAPER_SIZE[kind];
      const scanned = result.preview.kind === 'pdf' && result.preview.scanned;
      store.update(
        paper.id,
        {
          kind,
          title: result.title,
          ...(kind !== current.kind ? { w: size.w, h: size.h } : {}),
          data: {
            ...current.data,
            preview: result.preview,
            status: result.readOnly ? { state: 'readonly', reason: result.reason ?? 'Lecture seule.' } : { state: 'ready' },
            stamp: scanned ? { label: 'À vérifier', tone: 'danger' } : current.data.stamp,
          },
        },
        { history: false },
      );
      return result;
    }),
  );

  const ok = results.filter((r): r is PromiseFulfilledResult<ImportResult> => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.length - ok.length;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const p = papers[i]!;
      const cur = store.node(p.id);
      if (cur) store.update(p.id, { data: { ...cur.data, status: { state: 'error', reason: String(r.reason?.message ?? r.reason) } } }, { history: false });
    }
  });
  const readOnly = ok.filter((r) => r.readOnly).length;
  const parts = [readOnly && `${readOnly} en lecture seule`, failed && `${failed} erreur${failed > 1 ? 's' : ''}`].filter(Boolean);
  toast({
    title: `${ok.length} fichier${ok.length > 1 ? 's' : ''} ajouté${ok.length > 1 ? 's' : ''}`,
    description: parts.length ? parts.join(' · ') : 'Prêts à modifier.',
    tone: failed ? 'danger' : readOnly ? 'warning' : 'success',
  });
}

/**
 * 06 · Côte à côte: "Convertir pour modifier" puts an editable version next to
 * the read-only original, joined by a thread.
 *
 * The PDF → document engine does not exist yet, so the progress here is
 * simulated and the new document says so. Replace `simulate` with an
 * `engineHost().convert(...)` call when the WASM converter lands.
 */
export function convertToEditable(store: Bureau, id: string, announce: (m: string) => void) {
  const src = store.node(id) as Paper | undefined;
  if (!src) return;
  const size = PAPER_SIZE.document;
  const doc: Paper = {
    id: uid('conv'),
    kind: 'document',
    title: `${src.title} (modifiable)`,
    x: src.x + src.w + 80,
    y: src.y - 40,
    w: size.w,
    h: size.h,
    rotation: 0,
    data: {
      preview: { kind: 'document', blocks: [] },
      status: { state: 'importing', progress: 0, stage: 'Conversion en document modifiable' },
      comments: [],
      editor: 'JB',
    },
  };
  store.add([doc]);
  store.setLinks([...store.getState().links, { id: uid('l'), from: id, to: doc.id, label: 'Version modifiable', state: 'fresh' }], 'Lien de conversion');
  announce('Conversion en document modifiable');

  let progress = 0;
  const simulate = setInterval(() => {
    progress = Math.min(1, progress + 0.12);
    const cur = store.node(doc.id);
    if (!cur) return clearInterval(simulate);
    if (progress < 1) {
      store.update(doc.id, { data: { ...cur.data, status: { state: 'importing', progress, stage: 'Conversion en document modifiable' } } }, { history: false });
      return;
    }
    clearInterval(simulate);
    store.update(
      doc.id,
      {
        data: {
          ...cur.data,
          status: { state: 'ready' },
          stamp: { label: 'À vérifier', tone: 'warning' },
          preview: {
            kind: 'document',
            blocks: [
              { type: 'heading', text: src.title },
              { type: 'paragraph', text: 'Conversion simulée : le moteur PDF → document (WASM) remplira cette page avec le texte et la mise en forme de l’original.' },
            ],
          },
        },
      },
      { history: false },
    );
    toast({ title: 'Version modifiable prête', description: 'Vérifiez les passages signalés avant d’exporter.', tone: 'success' });
  }, 220);
}
