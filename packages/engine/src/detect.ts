import type { FileKind } from './types';

const BY_EXTENSION: Record<string, FileKind> = {
  docx: 'document', doc: 'document', odt: 'document', rtf: 'document', txt: 'document', md: 'document',
  pptx: 'slides', pptm: 'slides', ppsx: 'slides', potx: 'slides', ppt: 'slides', odp: 'slides', key: 'slides',
  xlsx: 'spreadsheet', xlsm: 'spreadsheet', xls: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', heic: 'image',
};

export const KIND_LABEL: Record<FileKind, string> = {
  document: 'Document',
  slides: 'Présentation',
  spreadsheet: 'Tableur',
  pdf: 'PDF',
  image: 'Image',
  note: 'Note',
  unsupported: 'Fichier',
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/**
 * Decide which workspace a file opens in. Magic bytes win over the extension
 * for the formats where a mislabelled file is common (PDF, images).
 */
export function detectKind(file: { name: string; type?: string }, head?: Uint8Array): FileKind {
  if (head && head.length >= 4) {
    if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
    if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image'; // PNG
    if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image'; // JPEG
    if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image'; // GIF
    if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && head[8] === 0x57) return 'image'; // RIFF…WEBP
  }
  const byExt = BY_EXTENSION[extensionOf(file.name)];
  if (byExt) return byExt;
  const t = file.type ?? '';
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('text/')) return 'document';
  return 'unsupported';
}

export const ACCEPTED_EXTENSIONS = Object.keys(BY_EXTENSION).map((e) => `.${e}`);
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // "100 Mo max" (B8)
