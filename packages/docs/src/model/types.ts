/**
 * Shapes exchanged with the oel-docx codec (`docx_to_pm` / `pm_to_docx`).
 * Generated from `crates/oel-docx/src/contract.rs` by `npm run gen:types`:
 * change the Rust type, not these.
 */
import type { PageSetup } from '@oel/engine/generated/oeldocx';

export type {
  Columns,
  DocSettings,
  DocStyle,
  DocxJson,
  ExportJson,
  HeaderFooterKind,
  HeaderFooterRefs,
  HighlightAttrs,
  ImageAttrs,
  Indent,
  LinkAttrs,
  ListLevel,
  NoteRefAttrs,
  NumberingDefs,
  OoxmlBlockAttrs,
  OoxmlInlineAttrs,
  PMDoc,
  PMMark,
  PMNode,
  PageNumbering,
  PageSetup,
  ParagraphAttrs,
  SdtBlockAttrs,
  Section,
  SectionKind,
  Spacing,
  StoryPart,
  StorySide,
  SyntheticListKind,
  TableAttrs,
  TableCellAttrs,
  TableRowAttrs,
  TextStyleAttrs,
} from '@oel/engine/generated/oeldocx';

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
};

export const TWIPS_PER_PX = 15;
export const twipsToPx = (tw: number) => tw / TWIPS_PER_PX;
export const pxToTwips = (px: number) => Math.round(px * TWIPS_PER_PX);
export const EMU_PER_PX = 9525;
