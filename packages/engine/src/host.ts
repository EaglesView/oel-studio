import { previewEngine } from './engines/preview';
import { EngineRegistry } from './registry';
import type { ExportRequest, FileKind, ImportProgress, ImportResult } from './types';
import type { FromWorker, ToWorker } from './worker/protocol';
import { messages } from '@oel/i18n';

/** Each request keeps its message, so it can be sent again to a fresh worker. */
type Pending = { msg: ToWorker; resolve: (r: never) => void; reject: (e: Error) => void; onProgress?: (p: ImportProgress) => void };

/** Distributes Omit over a union, so each worker message keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

const t = messages(
  {
    engine: 'Erreur du moteur',
    stopped: 'Moteur arrêté',
    crashed: (name: string) => `Le moteur n’a pas pu lire « ${name} » : le fichier est peut-être endommagé.`,
    crashedExport: 'Le moteur s’est arrêté pendant l’enregistrement du fichier. Réessayez ; si le problème revient, exportez le bureau.',
  },
  {
    engine: 'Engine error',
    stopped: 'Engine stopped',
    crashed: (name) => `The engine could not read “${name}”: the file may be damaged.`,
    crashedExport: 'The engine stopped while saving the file. Try again; if it happens again, export the desk.',
  },
);

/**
 * Main-thread facade. Heavy work (parsing, WASM conversion) runs in a Web
 * Worker so the desk stays responsive; falls back to the main thread when
 * workers are unavailable (tests, SSR).
 *
 * A Rust panic traps the WASM instance and leaves it a little broken each time (in a test, the 68th trap made the
 * next good file fail), so after a trap the worker is replaced and the requests still waiting in it go to the
 * new one.
 */
export class EngineHost {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private local: EngineRegistry | null = null;

  constructor(
    private readonly createWorker?: () => Worker,
    localRegistry?: () => EngineRegistry,
  ) {
    if (createWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = this.start(createWorker);
      } catch {
        this.worker = null;
      }
    }
    if (!this.worker) this.local = localRegistry?.() ?? new EngineRegistry().register(previewEngine);
  }

  private start(createWorker: () => Worker): Worker {
    const worker = createWorker();
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    worker.onerror = (e) => this.failAll(new Error(e.message || t.engine));
    return worker;
  }

  /** A fresh worker in place of one whose WASM trapped; requests it still held are sent again. */
  private restart() {
    this.worker?.terminate();
    try {
      this.worker = this.start(this.createWorker!);
    } catch {
      this.worker = null;
      this.failAll(new Error(t.stopped));
      return;
    }
    for (const p of this.pending.values()) this.worker.postMessage(p.msg);
  }

  private send<T>(msg: WithoutId<ToWorker>, onProgress?: (p: ImportProgress) => void): Promise<T> {
    const id = ++this.seq;
    const full = { ...msg, id } as ToWorker;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { msg: full, resolve: resolve as (r: never) => void, reject, onProgress });
      if (this.worker) this.worker.postMessage(full);
      else reject(new Error(t.stopped));
    });
  }

  async import(file: File, onProgress: (p: ImportProgress) => void = () => {}): Promise<ImportResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (this.local) return this.local.import({ name: file.name, type: file.type, bytes }, onProgress);
    // Copied, not transferred: the request may have to go to a new worker (see `restart`).
    return this.send<ImportResult>({ op: 'import', name: file.name, type: file.type, bytes }, onProgress);
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
    else if (m.fatal) {
      // The raw message is « unreachable »: say what happened instead.
      p.reject(new Error(p.msg.op === 'import' ? t.crashed(p.msg.name) : p.msg.op === 'export' ? t.crashedExport : t.engine));
      this.restart();
    } else p.reject(new Error(m.message));
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error(t.stopped));
  }
}
