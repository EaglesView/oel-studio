/** The deck JSON contract, generated from `crates/oel-pptx` (ts-rs). */
export type {
  BodyProps,
  Borders,
  Bullet,
  Crop,
  CustomGeometry,
  Deck,
  DeckFont,
  Element,
  ElementKind,
  Frame,
  GeomPath,
  Geometry,
  GradientStop,
  Guide,
  Layout,
  Level,
  Line,
  LineEnd,
  Look,
  NamedColor,
  Paint,
  Para,
  ParaProps,
  PathCmd,
  Picture,
  Placeholder,
  Preserved,
  Run,
  RunProps,
  Shadow,
  Slide,
  Source,
  Spacing,
  SrcRef,
  Table,
  TableCell,
  TableRow,
  TextBody,
  ThemeInfo,
} from '@oel/engine/generated/oelpptx';

/** EMU per point: the editor draws slides in points (1 CSS px = 1 pt before zoom). */
export const EMU_PER_PT = 12700;
export const pt = (emu: number) => emu / EMU_PER_PT;
export const emu = (points: number) => Math.round(points * EMU_PER_PT);

/** A picture file of the deck. */
export interface MediaFile {
  path: string;
  mime: string;
  bytes: Uint8Array;
}
