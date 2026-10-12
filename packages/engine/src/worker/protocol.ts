import type { ExportRequest, FileKind, ImportProgress, ImportResult } from '../types';

export type ToWorker =
  | { id: number; op: 'import'; name: string; type: string; bytes: Uint8Array }
  | { id: number; op: 'export'; req: ExportRequest }
  | { id: number; op: 'create'; kind: FileKind; title: string };

export type FromWorker =
  | { id: number; op: 'progress'; progress: ImportProgress }
  | { id: number; op: 'result'; result: ImportResult }
  | { id: number; op: 'bytes'; bytes: Uint8Array }
  | { id: number; op: 'error'; message: string };
