/** What the editor shell adapts to (Figma 08 · Coquille adaptative). */
export type FileKind = 'document' | 'slides' | 'spreadsheet' | 'pdf' | 'image' | 'note' | 'unsupported';

/** Size of a document's first page, in twips (the desk paper takes its shape). */
export interface PageSize {
  width: number;
  height: number;
}

/** Lightweight, serialisable preview: what a paper shows on the desk. */
export type Preview =
  | { kind: 'document'; blocks: Array<{ type: 'heading' | 'paragraph'; text: string }>; pageCount?: number; wordCount?: number; page?: PageSize }
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
  /**
   * Full editable content when the engine has one (e.g. `DocxPayload` from
   * oeldocx-rs). Opaque to the shell: handed to the matching editor.
   */
  payload?: unknown;
}

/** oeldocx-rs import result: editor JSON (as text), images, and the original file for round trips. */
export interface DocxPayload {
  format: 'oeldocx-pm@2';
  json: string;
  media: Array<{ path: string; mime: string; bytes: Uint8Array }>;
  original: Uint8Array | null;
}

/** oelxlsx-rs import result: the workbook JSON (as text) and the original .xlsx for round trips. */
export interface WorkbookPayload {
  format: 'oelxlsx-workbook@1';
  json: string;
  /** The original .xlsx; null for CSV (its dialect is in the JSON). */
  original: Uint8Array | null;
}

/** Serialise editor content back to a file format. */
export interface ExportRequest {
  kind: FileKind;
  /** Target format, e.g. `docx`. */
  format: string;
  /** Engine-specific content (for docx: `{ json, original, media }`). */
  data: unknown;
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
  /** Narrower than `kinds`: the files this engine opens (others of the kind fall back to the next engine). */
  accepts?(name: string): boolean;
  import(req: ImportRequest, onProgress: (p: ImportProgress) => void): Promise<ImportResult>;
  /** Optional round trip: serialise editor content back to a file. */
  export?(req: ExportRequest): Promise<Uint8Array>;
  /** Optional: a new, empty editable file of this kind (same shape as an import). */
  create?(kind: FileKind, title: string): Promise<ImportResult>;
}
