import { detectKind } from './detect';
import type { DocumentEngine, ExportRequest, FileKind, ImportProgress, ImportRequest, ImportResult } from './types';

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

  async export(req: ExportRequest): Promise<Uint8Array> {
    const engine = this.engines.find((e) => e.export && e.kinds.includes(req.kind));
    if (!engine?.export) throw new Error(`Aucun moteur ne sait écrire « ${req.format} »`);
    return engine.export(req);
  }

  async create(kind: FileKind, title: string): Promise<ImportResult> {
    const engine = this.engines.find((e) => e.create && e.kinds.includes(kind));
    if (!engine?.create) throw new Error('Aucun moteur ne sait créer ce type de fichier');
    return engine.create(kind, title);
  }
}
