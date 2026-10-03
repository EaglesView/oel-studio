import { previewEngine } from './engines/preview';
import { EngineRegistry } from './registry';
import type { ExportRequest, FileKind, ImportProgress, ImportResult } from './types';
import type { FromWorker, ToWorker } from './worker/protocol';

type Pending = { resolve: (r: never) => void; reject: (e: Error) => void; onProgress?: (p: ImportProgress) => void };

/** Distributes Omit over a union, so each worker message keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Main-thread facade. Heavy work (parsing, WASM conversion) runs in a Web
 * Worker so the desk stays responsive; falls back to the main thread when
 * workers are unavailable (tests, SSR).
 */
export class EngineHost {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private local: EngineRegistry | null = null;

  constructor(createWorker?: () => Worker, localRegistry?: () => EngineRegistry) {
    if (createWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = createWorker();
        this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
        this.worker.onerror = (e) => this.failAll(new Error(e.message || 'Erreur du moteur'));
      } catch {
        this.worker = null;
      }
    }
    if (!this.worker) this.local = localRegistry?.() ?? new EngineRegistry().register(previewEngine);
  }

  private send<T>(msg: WithoutId<ToWorker>, transfer: Transferable[] = [], onProgress?: (p: ImportProgress) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: never) => void, reject, onProgress });
      this.worker!.postMessage({ ...msg, id } as ToWorker, transfer);
    });
  }

  async import(file: File, onProgress: (p: ImportProgress) => void = () => {}): Promise<ImportResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (this.local) return this.local.import({ name: file.name, type: file.type, bytes }, onProgress);
    return this.send<ImportResult>({ op: 'import', name: file.name, type: file.type, bytes }, [bytes.buffer], onProgress);
  }

  /** Serialise editor content back to a file (e.g. .docx through oeldocx-rs). */
  async export(req: ExportRequest): Promise<Uint8Array> {
    if (this.local) return this.local.export(req);
    return this.send<Uint8Array>({ op: 'export', req });
  }

  /** A new, empty editable file of this kind. */
  async create(kind: FileKind, title = ''): Promise<ImportResult> {
    if (this.local) return this.local.create(kind, title);
    return this.send<ImportResult>({ op: 'create', kind, title });
  }

  private onMessage(m: FromWorker) {
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.op === 'progress') {
      p.onProgress?.(m.progress);
      return;
    }
    this.pending.delete(m.id);
    if (m.op === 'result') p.resolve(m.result as never);
    else if (m.op === 'bytes') p.resolve(m.bytes as never);
    else p.reject(new Error(m.message));
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  dispose() {
    this.worker?.terminate();
    this.failAll(new Error('Moteur arrêté'));
  }
}
