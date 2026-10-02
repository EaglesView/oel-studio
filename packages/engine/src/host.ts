import { previewEngine } from './engines/preview';
import { EngineRegistry } from './registry';
import type { ImportProgress, ImportResult } from './types';
import type { FromWorker, ToWorker } from './worker/protocol';

type Pending = { resolve: (r: ImportResult) => void; reject: (e: Error) => void; onProgress: (p: ImportProgress) => void };

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

  constructor(createWorker?: () => Worker) {
    if (createWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = createWorker();
        this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
        this.worker.onerror = (e) => this.failAll(new Error(e.message || 'Erreur du moteur'));
      } catch {
        this.worker = null;
      }
    }
    if (!this.worker) this.local = new EngineRegistry().register(previewEngine);
  }

  async import(file: File, onProgress: (p: ImportProgress) => void = () => {}): Promise<ImportResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (this.local) return this.local.import({ name: file.name, type: file.type, bytes }, onProgress);
    const id = ++this.seq;
    return new Promise<ImportResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const msg: ToWorker = { id, op: 'import', name: file.name, type: file.type, bytes };
      this.worker!.postMessage(msg, [bytes.buffer]);
    });
  }

  private onMessage(m: FromWorker) {
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.op === 'progress') p.onProgress(m.progress);
    else {
      this.pending.delete(m.id);
      if (m.op === 'result') p.resolve(m.result);
      else p.reject(new Error(m.message));
    }
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
