/**
 * Shapes exchanged with the oeldocx-rs codec (`docx_to_pm` / `pm_to_docx`).
 * Keep in sync with `oeldocx_rs/src/ooxml/{mod,read}.rs`.
 */

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface PMDoc extends PMNode {
  type: 'doc';
  content: PMNode[];
}

/** Page geometry in twips (1/1440 in). */
export interface PageSetup {
  width: number;
  height: number;
  orient: 'portrait' | 'landscape';
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
  gutter: number;
  titlePg: boolean;
  /** Raw final sectPr, patched on export. */
  sectPr: string | null;
  background: string | null;
}

export interface DocStyle {
  id: string;
  name: string;
  kind: 'paragraph' | 'character';
  /** normal, title, subtitle, heading1…heading9, listParagraph, hyperlink… */
  role: string | null;
  basedOn: string | null;
  isDefault: boolean;
  quick: boolean;
  hidden: boolean;
  outline: number | null;
  numId: number | null;
}

export interface ListLevel {
  fmt: string;
  text: string;
  start: number;
  indLeft: number | null;
  hanging: number | null;
  font: string | null;
}

export interface NumberingDefs {
  nums: Record<string, { abstractId: number; restart: boolean; levels: ListLevel[] }>;
  maxNumId: number;
  maxAbstractId: number;
}

export type SyntheticListKind = 'bullet' | 'decimal' | 'check' | 'checked';

export type HeaderFooterKind = 'default' | 'first' | 'even';

export interface StoryPart {
  /** Package part (`word/header1.xml`), absent for new ones. */
  part?: string;
  doc: PMDoc;
}

/** Output of `docx_to_pm`, after `JSON.parse`. */
export interface DocxJson {
  version: number;
  doc: PMDoc;
  notes: { footnote: Record<string, PMDoc>; endnote: Record<string, PMDoc> };
  headers: Partial<Record<HeaderFooterKind, StoryPart>>;
  footers: Partial<Record<HeaderFooterKind, StoryPart>>;
  page: PageSetup;
  styles: DocStyle[];
  stylesCss: string;
  defaults: { fontFamily: string; fontSize: string };
  numbering: NumberingDefs;
  title: string | null;
  media: Array<{ path: string; mime: string }>;
}

/** What `pm_to_docx` needs (DocxJson minus the render-only fields). */
export interface ExportJson {
  doc: PMDoc;
  notes: DocxJson['notes'];
  headers: DocxJson['headers'];
  footers: DocxJson['footers'];
  page: PageSetup;
  numbering: { synthetic: Array<{ numId: number; kind: SyntheticListKind }> };
}

export interface MediaFile {
  path: string;
  mime: string;
  bytes: Uint8Array;
}

export const DEFAULT_PAGE: PageSetup = {
  width: 12240,
  height: 15840,
  orient: 'portrait',
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
  header: 720,
  footer: 720,
  gutter: 0,
  titlePg: false,
  sectPr: null,
  background: null,
};

export const TWIPS_PER_PX = 15;
export const twipsToPx = (tw: number) => tw / TWIPS_PER_PX;
export const pxToTwips = (px: number) => Math.round(px * TWIPS_PER_PX);
export const EMU_PER_PX = 9525;
