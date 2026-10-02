import { detectKind } from './detect';
import type { DocumentEngine, ImportProgress, ImportRequest, ImportResult } from './types';

/**
 * Picks the engine for a file. Engines registered later win, so a WASM engine
 * registered after the JS preview engine takes over the kinds it handles.
 */
export class EngineRegistry {
  private engines: DocumentEngine[] = [];

  register(engine: DocumentEngine): this {
    this.engines.unshift(engine);
    return this;
  }

  pick(req: Pick<ImportRequest, 'name' | 'type' | 'bytes'>): DocumentEngine | undefined {
    const kind = detectKind(req, req.bytes.subarray(0, 16));
    return this.engines.find((e) => e.kinds.includes(kind)) ?? this.engines[this.engines.length - 1];
  }

  async import(req: ImportRequest, onProgress: (p: ImportProgress) => void = () => {}): Promise<ImportResult> {
    const engine = this.pick(req);
    if (!engine) throw new Error('Aucun moteur enregistré');
    return engine.import(req, onProgress);
  }
}
