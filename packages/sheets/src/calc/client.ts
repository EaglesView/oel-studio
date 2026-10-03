/**
 * Keeps the calc worker in step with the Y.Doc and caches what the grid shows.
 *
 * Cell edits (local or remote) become input diffs; anything that moves cells
 * or renames what formulas point at (rows, columns, sheets, names) rebuilds
 * the engine from the Y.Doc — the Y.Doc is the source of truth, and IronCalc's
 * own row/column moves re-type text cells. Results arrive asynchronously; the
 * grid repaints on `subscribe`.
 */
import type * as Y from 'yjs';
import { rangeA1, type Range } from '../model/a1';
import type { CellInput, CellOut } from '../model/types';
import { cellMap, type SheetDoc, type YCell } from '../model/ydoc';
import type { FromCalc, ToCalc } from './protocol';

/** A worker, or anything that speaks the same messages (tests). */
export interface CalcPort {
  postMessage(m: ToCalc): void;
  onmessage: ((e: MessageEvent<FromCalc>) => void) | null;
  terminate?(): void;
}

const KEY_STRIDE = 16_384;
const key = (r: number, c: number) => r * KEY_STRIDE + c;

export class CalcClient {
  private seq = 0;
  private cache = new Map<number, Map<number, CellOut>>();
  private listeners = new Set<() => void>();
  private waiting = new Map<number, (m: FromCalc) => void>();
  private inputs = new Map<string, CellInput>();
  private flushQueued = false;
  private reloadQueued = false;
  /** The rebuild in progress (load + viewport refetch), if any. */
  private reloading: Promise<void> = Promise.resolve();
  private viewports = new Map<number, Range>();
  private onTx = (tr: Y.Transaction) => this.observe(tr);
  /** Bumped on every cache change. */
  version = 0;
  loading = true;
  error: string | null = null;
  lastLoadMs = 0;

  constructor(
    readonly sheet: SheetDoc,
    private port: CalcPort,
  ) {
    port.onmessage = (e) => this.receive(e.data);
    sheet.doc.on('afterTransaction', this.onTx);
    this.reload();
  }

  // ----- reading ---------------------------------------------------------

  get(sheetIndex: number, r: number, c: number): CellOut | undefined {
    return this.cache.get(sheetIndex)?.get(key(r, c));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** The grid's visible area: values are fetched for it (with a margin). */
  setViewport(sheetIndex: number, range: Range) {
    const margin = { r0: Math.max(0, range.r0 - 20), c0: Math.max(0, range.c0 - 5), r1: range.r1 + 40, c1: range.c1 + 10 };
    const prev = this.viewports.get(sheetIndex);
    if (prev && prev.r0 <= range.r0 && prev.c0 <= range.c0 && prev.r1 >= range.r1 && prev.c1 >= range.c1) return;
    this.viewports.set(sheetIndex, margin);
    void this.fetch(sheetIndex, margin);
  }

  /** Fetch values outside the viewport (ranges a conditional format scales over). */
  prefetch(sheetIndex: number, range: Range) {
    void this.fetch(sheetIndex, { r0: range.r0, c0: range.c0, r1: Math.min(range.r1, range.r0 + 20_000), c1: Math.min(range.c1, range.c0 + 500) });
  }

  /** Formula completion from the engine's parser (function names, ranges…). */
  completion(sheetIndex: number, r: number, c: number, formula: string, cursor: number): Promise<unknown> {
    return this.request({ op: 'completion', seq: 0, sheet: sheetIndex, r, c, formula, cursor }).then((m) => (m.op === 'completion' ? m.result : null));
  }

  /** Read parts of the original .xlsx (drawing images) in the worker. */
  media(original: Uint8Array, paths: string[]): Promise<Array<{ path: string; bytes: Uint8Array }>> {
    return this.request({ op: 'media', seq: 0, original, paths }).then((m) => (m.op === 'media' ? m.files : []));
  }

  /** Resolves when the engine has caught up with every edit sent so far. */
  async settled(): Promise<void> {
    // Let queued reloads and flushes start, then wait for all of them.
    await Promise.resolve();
    await this.reloading;
    this.flush();
    await this.request({ op: 'values', seq: 0, sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 });
  }

  // ----- keeping in step ---------------------------------------------------

  private observe(tr: Y.Transaction) {
    let structural = false;
    const names = new Map<unknown, string>();
    for (const [name, type] of this.sheet.doc.share) names.set(type, name);
    for (const [type, keys] of tr.changed) {
      const name = names.get(type);
      if (!name) continue;
      if (name === 'sheets' || name === 'names' || name.startsWith('rows:') || name.startsWith('cols:')) structural = true;
      else if (name.startsWith('sheet:') && keys.has('name')) structural = true;
      else if (name.startsWith('x:') && keys.has('tables')) structural = true;
      else if (name === 'meta' && keys.has('seeded')) structural = true;
      else if (name.startsWith('cells:')) {
        const sheetId = name.slice(6);
        const si = this.sheet.sheetIds().indexOf(sheetId);
        if (si < 0) continue;
        const map = cellMap(this.sheet.doc, sheetId);
        for (const k of keys) {
          if (k == null) continue;
          const i = k.indexOf(':');
          const r = this.sheet.rowIndex(sheetId, k.slice(0, i));
          const c = this.sheet.colIndex(sheetId, k.slice(i + 1));
          if (r == null || c == null) continue;
          this.inputs.set(`${si}:${r}:${c}`, this.input(si, sheetId, r, c, map.get(k)));
        }
      }
    }
    if (structural) this.reload();
    else if (this.inputs.size) this.queueFlush();
  }

  private input(si: number, sheetId: string, r: number, c: number, cell: YCell | undefined): CellInput {
    const fmt = this.sheet.style(cell?.s ?? 0).numFmt;
    if (!cell) return { sheet: si, r, c };
    if (cell.f) {
      const f = this.sheet.formulaText(sheetId, cell)!;
      const a = cell.aw && cell.ah ? rangeA1({ r0: r, c0: c, r1: r + cell.ah - 1, c1: c + cell.aw - 1 }) : undefined;
      return { sheet: si, r, c, f, ...(a ? { a } : {}), fmt };
    }
    return { sheet: si, r, c, ...(cell.t ? { t: cell.t } : {}), ...(cell.v != null ? { v: cell.v } : {}), fmt };
  }

  private queueFlush() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  private flush() {
    this.flushQueued = false;
    if (!this.inputs.size) return;
    const inputs = [...this.inputs.values()];
    this.inputs.clear();
    void this.request({ op: 'apply', seq: 0, inputs });
  }

  /** Rebuild the engine from the Y.Doc (batched to one per tick). */
  reload() {
    if (this.reloadQueued) return;
    this.reloadQueued = true;
    const previous = this.reloading;
    this.reloading = new Promise<void>((resolve) =>
      queueMicrotask(async () => {
        this.reloadQueued = false;
        this.inputs.clear();
        if (!this.sheet.sheetIds().length) return resolve();
        this.loading = true;
        const json = JSON.stringify(this.sheet.toWorkbook());
        await previous;
        await this.request({ op: 'load', seq: 0, json });
        this.cache.clear();
        await Promise.all([...this.viewports].map(([si, vp]) => this.fetch(si, vp)));
        resolve();
      }),
    );
  }

  private fetch(sheetIndex: number, r: Range) {
    return this.request({ op: 'values', seq: 0, sheet: sheetIndex, ...r });
  }

  private request(m: ToCalc): Promise<FromCalc> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(seq, resolve);
      this.port.postMessage({ ...m, seq } as ToCalc);
    });
  }

  private receive(m: FromCalc) {
    this.waiting.get(m.seq)?.(m);
    this.waiting.delete(m.seq);
    switch (m.op) {
      case 'loaded':
        this.loading = false;
        this.error = null;
        this.lastLoadMs = m.ms;
        break;
      case 'applied':
        for (const [si, o] of m.cells) {
          const sheet = this.sheetCache(si);
          if ('empty' in o) sheet.delete(key(o.r, o.c));
          else sheet.set(key(o.r, o.c), o);
        }
        for (const [si, o] of m.changed) this.sheetCache(si).set(key(o.r, o.c), o);
        break;
      case 'values': {
        const sheet = this.sheetCache(m.sheet);
        for (const k of [...sheet.keys()]) {
          const r = Math.floor(k / KEY_STRIDE);
          const c = k % KEY_STRIDE;
          if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) sheet.delete(k);
        }
        for (const o of m.cells) sheet.set(key(o.r, o.c), o);
        break;
      }
      case 'error':
        this.error = m.message;
        this.loading = false;
        break;
      default:
        return;
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  private sheetCache(si: number) {
    let s = this.cache.get(si);
    if (!s) this.cache.set(si, (s = new Map()));
    return s;
  }

  dispose() {
    this.sheet.doc.off('afterTransaction', this.onTx);
    this.port.onmessage = null;
    this.port.terminate?.();
    this.listeners.clear();
  }
}
