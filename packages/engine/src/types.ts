/** What the editor shell adapts to (Figma 08 · Coquille adaptative). */
export type FileKind = 'document' | 'slides' | 'spreadsheet' | 'pdf' | 'image' | 'note' | 'unsupported';

/** Lightweight, serialisable preview: what a paper shows on the desk. */
export type Preview =
  | { kind: 'document'; blocks: Array<{ type: 'heading' | 'paragraph'; text: string }>; pageCount?: number; wordCount?: number }
  | { kind: 'slides'; slides: Array<{ title: string; body?: string }> }
  | { kind: 'spreadsheet'; sheets: string[]; rows: string[][] }
  | { kind: 'pdf'; pageCount: number; scanned: boolean; title?: string }
  | { kind: 'image'; width: number; height: number; url?: string }
  | { kind: 'note'; text: string }
  | { kind: 'unsupported' };

export interface ImportResult {
  kind: FileKind;
  title: string;
  /** Opened read-only first (PDF, scans): the shell offers "Convertir pour modifier" (06). */
  readOnly: boolean;
  /** Why it is read-only, shown on the paper. */
  reason?: string;
  preview: Preview;
  /** Engine that produced it, for debugging and capability checks. */
  engine: string;
}

export interface ImportProgress {
  /** 0–1, or null when indeterminate. */
  value: number | null;
  /** e.g. "Lecture du fichier", "Conversion en document modifiable". */
  stage: string;
}

export interface ImportRequest {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * A document-processing engine. Implementations may be plain JS (the preview
 * engine) or WASM (oeldocx-rs, oelimg-rs). Engines run inside a Web Worker, so
 * they must not touch the DOM.
 */
export interface DocumentEngine {
  id: string;
  kinds: FileKind[];
  import(req: ImportRequest, onProgress: (p: ImportProgress) => void): Promise<ImportResult>;
  /** Optional round-trip: serialise back to the original format. */
  export?(handle: unknown, format: string): Promise<Uint8Array>;
}
