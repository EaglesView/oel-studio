import type { DocumentEngine, FileKind, ImportResult, Preview } from '../types';

/**
 * Adapter for WASM engines built with wasm-bindgen (oeldocx-rs, oelimg-rs).
 *
 * The module is loaded lazily inside the worker the first time a matching
 * file arrives, so the editor shell never pays for engines it does not use.
 *
 *   import init, { DocxController } from 'oeldocx-rs';
 *   registry.register(createOeldocxEngine(() => import('oeldocx-rs')));
 */
export interface WasmEngineSpec<M> {
  id: string;
  kinds: FileKind[];
  /** Dynamic import of the wasm-bindgen package (its default export is `init`). */
  load: () => Promise<M & { default?: (input?: unknown) => Promise<unknown> }>;
  run: (mod: M, bytes: Uint8Array, name: string) => Promise<Omit<ImportResult, 'engine'>> | Omit<ImportResult, 'engine'>;
}

export function createWasmEngine<M>(spec: WasmEngineSpec<M>): DocumentEngine {
  let ready: Promise<M> | null = null;
  return {
    id: spec.id,
    kinds: spec.kinds,
    async import(req, onProgress) {
      onProgress({ value: null, stage: 'Chargement du moteur' });
      ready ??= spec.load().then(async (mod) => {
        if (typeof mod.default === 'function') await mod.default();
        return mod;
      });
      const mod = await ready;
      onProgress({ value: 0.5, stage: 'Conversion en document modifiable' });
      const result = await spec.run(mod, req.bytes, req.name);
      onProgress({ value: 1, stage: 'Prêt' });
      return { ...result, engine: spec.id };
    },
  };
}

/** Shape of the parts of oeldocx-rs's `DocxController` this adapter relies on. */
interface OeldocxModule {
  DocxController: new () => {
    load(bytes: Uint8Array, filename?: string | null): unknown;
    free(): void;
  };
}

/**
 * oeldocx-rs adapter. `DocxController.load` returns its `EditorState`; the
 * mapping below only assumes it exposes paragraphs with text, and must be
 * aligned with the crate's state struct when it is wired in.
 */
export function createOeldocxEngine(load: () => Promise<OeldocxModule>): DocumentEngine {
  return createWasmEngine<OeldocxModule>({
    id: 'oeldocx-rs',
    kinds: ['document'],
    load: load as WasmEngineSpec<OeldocxModule>['load'],
    run(mod, bytes, name) {
      const ctrl = new mod.DocxController();
      try {
        const state = ctrl.load(bytes, name) as { paragraphs?: Array<{ text?: string; style?: string }> };
        const blocks = (state.paragraphs ?? [])
          .filter((p) => p.text)
          .slice(0, 40)
          .map((p) => ({ type: /heading|titre/i.test(p.style ?? '') ? ('heading' as const) : ('paragraph' as const), text: p.text! }));
        const preview: Preview = { kind: 'document', blocks };
        return { kind: 'document', title: name.replace(/\.[^.]+$/, ''), readOnly: false, preview };
      } finally {
        ctrl.free();
      }
    },
  });
}
