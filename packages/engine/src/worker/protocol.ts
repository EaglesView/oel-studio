import type { ImportProgress, ImportResult } from '../types';

export type ToWorker = { id: number; op: 'import'; name: string; type: string; bytes: Uint8Array };

export type FromWorker =
  | { id: number; op: 'progress'; progress: ImportProgress }
  | { id: number; op: 'result'; result: ImportResult }
  | { id: number; op: 'error'; message: string };
