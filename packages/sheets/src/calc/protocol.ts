import type { CellInput, CellOut } from '../model/types';

/** Main thread → calc worker. */
export type ToCalc =
  | { op: 'load'; seq: number; json: string }
  | { op: 'apply'; seq: number; inputs: CellInput[] }
  | { op: 'values'; seq: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { op: 'completion'; seq: number; sheet: number; r: number; c: number; formula: string; cursor: number }
  /** Parts of the original .xlsx (drawing images), read without the main thread unzipping it. */
  | { op: 'media'; seq: number; original: Uint8Array; paths: string[] };

/** Calc worker → main thread. `seq` echoes the request. */
export type FromCalc =
  | { op: 'loaded'; seq: number; ms: number }
  /** After `apply`: the edited cells and every formula whose result changed. */
  | { op: 'applied'; seq: number; cells: Array<[number, CellOut | { r: number; c: number; empty: true }]>; changed: Array<[number, CellOut]>; errors: string[] }
  | { op: 'values'; seq: number; sheet: number; r0: number; c0: number; r1: number; c1: number; cells: CellOut[] }
  | { op: 'completion'; seq: number; result: unknown }
  | { op: 'media'; seq: number; files: Array<{ path: string; bytes: Uint8Array }> }
  | { op: 'error'; seq: number; message: string };
