import type { DocumentEngine, DocxPayload, ExportRequest, FileKind, ImportResult, Preview } from '../types';

/**
 * Adapter for WASM engines built with wasm-bindgen (oeldocx-rs, oelimg-rs).
 *
 * The module is loaded lazily inside the worker the first time a matching
 * file arrives, so the editor shell never pays for engines it does not use.
 */
export interface WasmEngineSpec<M> {
  id: string;
  kinds: FileKind[];
  /** Dynamic import of the wasm-bindgen package (its default export is `init`). */
  load: () => Promise<M & { default?: (input?: unknown) => Promise<unknown> }>;
  run: (mod: M, bytes: Uint8Array, name: string) => Promise<Omit<ImportResult, 'engine'>> | Omit<ImportResult, 'engine'>;
  export?: (mod: M, req: ExportRequest) => Promise<Uint8Array> | Uint8Array;
  create?: (mod: M, kind: FileKind, title: string) => Promise<Omit<ImportResult, 'engine'>> | Omit<ImportResult, 'engine'>;
}

export function createWasmEngine<M>(spec: WasmEngineSpec<M>): DocumentEngine {
  let ready: Promise<M> | null = null;
  const module = () =>
    (ready ??= spec.load().then(async (mod) => {
      if (typeof mod.default === 'function') await mod.default();
      return mod;
    }));
  return {
    id: spec.id,
    kinds: spec.kinds,
    async import(req, onProgress) {
      onProgress({ value: null, stage: 'Chargement du moteur' });
      const mod = await module();
      onProgress({ value: 0.5, stage: 'Conversion en document modifiable' });
      const result = await spec.run(mod, req.bytes, req.name);
      onProgress({ value: 1, stage: 'Prêt' });
      return { ...result, engine: spec.id };
    },
    export: spec.export ? async (req) => spec.export!(await module(), req) : undefined,
    create: spec.create ? async (kind, title) => ({ ...(await spec.create!(await module(), kind, title)), engine: spec.id }) : undefined,
  };
}

/** The parts of the oeldocx-rs wasm package this adapter uses. */
export interface OeldocxModule {
  docx_to_pm(bytes: Uint8Array): { json: string; media: Array<{ path: string; mime: string; bytes: Uint8Array }> };
  new_document_pm(): { json: string; media: Array<{ path: string; mime: string; bytes: Uint8Array }> };
  pm_to_docx(json: string, original: Uint8Array | null | undefined, media: Array<{ path: string; bytes: Uint8Array }>): Uint8Array;
}

interface PMish {
  type?: string;
  text?: string;
  attrs?: { outline?: number | null };
  content?: PMish[];
}

const text = (n: PMish): string => (n.text ?? '') + (n.content ?? []).map(text).join(n.type === 'tableRow' ? ' ' : '');

/** Desk preview from the codec's ProseMirror JSON (first blocks as text). */
function previewOf(doc: PMish): Preview {
  const blocks: Array<{ type: 'heading' | 'paragraph'; text: string }> = [];
  let words = 0;
  const visit = (n: PMish) => {
    if (n.type === 'paragraph') {
      const t = text(n).replace(/\s+/g, ' ').trim();
      words += t.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (blocks.length < 40) blocks.push({ type: n.attrs?.outline != null ? 'heading' : 'paragraph', text: t });
      return;
    }
    (n.content ?? []).forEach(visit);
  };
  visit(doc);
  return { kind: 'document', blocks, wordCount: words, pageCount: Math.max(1, Math.ceil(words / 450)) };
}

/**
 * oeldocx-rs: lossless DOCX ↔ editor JSON. Imports carry a `DocxPayload`
 * (editor JSON + images + the original file) for `@oel/docs`; exports write
 * the edited JSON back into a copy of the original package.
 */
export function createOeldocxEngine(load: () => Promise<unknown>): DocumentEngine {
  return createWasmEngine<OeldocxModule>({
    id: 'oeldocx-rs',
    kinds: ['document'],
    load: load as WasmEngineSpec<OeldocxModule>['load'],
    run(mod, bytes, name) {
      if (!/\.(docx|docm|dotx)$/i.test(name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        throw new Error('Format non pris en charge par le moteur DOCX');
      }
      const out = mod.docx_to_pm(bytes);
      const json = JSON.parse(out.json) as { doc: PMish; title?: string | null };
      const payload: DocxPayload = { format: 'oeldocx-pm@1', json: out.json, media: out.media, original: bytes };
      return { kind: 'document', title: json.title?.trim() || name.replace(/\.[^.]+$/, ''), readOnly: false, preview: previewOf(json.doc), payload };
    },
    export(mod, req) {
      if (req.format !== 'docx') throw new Error(`Format d’export inconnu : ${req.format}`);
      const d = req.data as { json: unknown; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> };
      return mod.pm_to_docx(JSON.stringify(d.json), d.original ?? undefined, d.media ?? []);
    },
    create(mod, _kind, title) {
      const out = mod.new_document_pm();
      const payload: DocxPayload = { format: 'oeldocx-pm@1', json: out.json, media: out.media, original: null };
      return { kind: 'document', title: title || 'Document sans titre', readOnly: false, preview: { kind: 'document', blocks: [], wordCount: 0, pageCount: 1 }, payload };
    },
  });
}
