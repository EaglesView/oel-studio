import EngineWorker from '@oel/engine/worker?worker';
import { EngineHost, MAX_IMPORT_BYTES, detectKind, stripExtension, type ImportResult } from '@oel/engine';
import { toast } from '@oel/emboss';
import type { Vec } from '@oel/desk';
import { PAPER_SIZE, paperSizeFor, uid, type Bureau, type Paper, type PaperKind } from './model';
import type { ArrivalRules } from './Chrome';
import { createDocFromPayload } from './docs';
import { createSheetFromPayload } from './sheets';
import { createSlidesFromPayload } from './slides';
import { originals } from '@oel/img';
import { queueThumbnail } from './thumbnails';

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
        editor: 'JB',
        updatedAt: Date.now(),
        fileName: file.name,
        imageUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
      },
    };
  });

  store.add(papers);
  announce(`${papers.length} fichier${papers.length > 1 ? 's' : ''} en cours d’import`);

  const results = await Promise.allSettled(accepted.map((file, i) => importInto(store, papers[i]!.id, file)));

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

/** Read a file into an existing paper (its id, place and links stay): progress, then preview, editor session and thumbnail. */
export async function importInto(store: Bureau, paperId: string, file: File): Promise<ImportResult> {
  const result = await engineHost().import(file, (p) => {
    const current = store.node(paperId);
    if (!current) return;
    store.update(paperId, { data: { ...current.data, status: { state: 'importing', progress: p.value, stage: p.stage } } }, { history: false });
  });
  // Without a shared file the paper still shows its preview; opening it then starts from that preview.
  const noSession = (e: unknown) => (console.warn('Fichier partagé non créé', result.title, e), undefined);
  let docId: string | undefined;
  if (result.kind === 'document' && result.payload) docId = await createDocFromPayload(result.payload, result.title).catch(noSession);
  if (result.kind === 'spreadsheet' && result.payload) docId = await createSheetFromPayload(result.payload, result.title).catch(noSession);
  if (result.kind === 'slides' && result.payload) docId = await createSlidesFromPayload(result.payload, result.title).catch(noSession);
  const current = store.node(paperId);
  if (!current) return result;
  const kind = toPaperKind(result.kind);
  // Pictures keep their original, untouched, by content hash: the atelier's recipes apply to it.
  const original = kind === 'image' ? (await originals().put(file).catch(() => null))?.hash : undefined;
  const size = paperSizeFor(kind, result.preview);
  const scanned = result.preview.kind === 'pdf' && result.preview.scanned;
  store.update(
    paperId,
    {
      kind,
      title: result.title,
      ...(kind !== current.kind || size.w !== current.w || size.h !== current.h ? { w: size.w, h: size.h } : {}),
      data: {
        ...current.data,
        ...(docId ? { docId } : {}),
        ...(original ? { image: { ...current.data.image, original } } : {}),
        preview: result.preview,
        status: result.readOnly ? { state: 'readonly', reason: result.reason ?? 'Lecture seule.' } : { state: 'ready' },
        stamp: scanned ? { label: 'À vérifier', tone: 'danger' } : current.data.stamp,
      },
    },
    { history: false },
  );
  if (docId) queueThumbnail(store, paperId);
  return result;
}
