/**
 * The calc worker's message handling, independent of where it runs: the web
 * worker passes the browser WASM build, tests pass the Node build.
 */
import type { CellOut } from '../model/types';
import type { FromCalc, ToCalc } from './protocol';
import { tr } from '@oel/i18n';

export interface WasmCalcLike {
  apply(inputs: string): string;
  evaluate(): string;
  values(sheet: number, r0: number, c0: number, r1: number, c1: number): string;
  completion(sheet: number, r: number, c: number, formula: string, cursor: number): string;
  free(): void;
}

export interface PartsLike {
  part(path: string): Uint8Array | undefined;
  free(): void;
}

export function createCalcHandler(make: (json: string) => WasmCalcLike, ready: Promise<unknown> = Promise.resolve(), openParts?: (bytes: Uint8Array) => PartsLike) {
  let calc: WasmCalcLike | null = null;
  return async (m: ToCalc): Promise<FromCalc> => {
    try {
      await ready;
      switch (m.op) {
        case 'load': {
          const t = performance.now();
          calc?.free();
          calc = null;
          calc = make(m.json);
          return { op: 'loaded', seq: m.seq, ms: Math.round(performance.now() - t) };
        }
        case 'apply': {
          if (!calc) throw new Error(tr('moteur non chargé', 'engine not loaded'));
          const errors = JSON.parse(calc.apply(JSON.stringify(m.inputs))) as string[];
          const changed = JSON.parse(calc.evaluate()) as Array<[number, CellOut]>;
          const cells = m.inputs.map((i): [number, CellOut | { r: number; c: number; empty: true }] => {
            const [o] = JSON.parse(calc!.values(i.sheet, i.r, i.c, i.r, i.c)) as CellOut[];
            return [i.sheet, o ?? { r: i.r, c: i.c, empty: true }];
          });
          return { op: 'applied', seq: m.seq, cells, changed, errors };
        }
        case 'values': {
          const cells = calc ? (JSON.parse(calc.values(m.sheet, m.r0, m.c0, m.r1, m.c1)) as CellOut[]) : [];
          return { op: 'values', seq: m.seq, sheet: m.sheet, r0: m.r0, c0: m.c0, r1: m.r1, c1: m.c1, cells };
        }
        case 'completion':
          return { op: 'completion', seq: m.seq, result: calc ? JSON.parse(calc.completion(m.sheet, m.r, m.c, m.formula, m.cursor)) : null };
        case 'media': {
          const files: Array<{ path: string; bytes: Uint8Array }> = [];
          if (!openParts) return { op: 'media', seq: m.seq, files };
          const pkg = openParts(m.original);
          try {
            for (const path of m.paths) {
              const bytes = pkg.part(path);
              if (bytes) files.push({ path, bytes });
            }
          } finally {
            pkg.free();
          }
          return { op: 'media', seq: m.seq, files };
        }
      }
    } catch (err) {
      return { op: 'error', seq: m.seq, message: err instanceof Error ? err.message : String(err) };
    }
  };
}
