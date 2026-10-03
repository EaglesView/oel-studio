/**
 * The workbook JSON exchanged with oelxlsx-rs (`src/model.rs` there).
 * Rows and columns are 0-based; ranges are A1 strings.
 */

export type CellType = 'n' | 's' | 'b' | 'e';
export type CellValue = number | string | boolean;

export interface Color {
  /** `#RRGGBB` as displayed (theme and tint resolved). */
  css: string;
  rgb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
}

export interface Font {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  strike?: boolean;
  color?: Color;
  vertAlign?: string;
}

export interface BorderSide {
  style: string;
  color?: Color;
}

export interface Border {
  left?: BorderSide;
  right?: BorderSide;
  top?: BorderSide;
  bottom?: BorderSide;
}

export interface Align {
  h?: string;
  v?: string;
  wrap?: boolean;
  indent?: number;
  rotation?: number;
  shrink?: boolean;
}

export interface CellStyle {
  numFmt: string;
  font: Font;
  fill?: Color;
  border: Border;
  align: Align;
  locked: boolean;
}

export interface Cell {
  r: number;
  c: number;
  t?: CellType;
  v?: CellValue;
  /** Formula without `=`. */
  f?: string;
  /** Array-formula range when this cell anchors one. */
  a?: string;
  s?: number;
  rich?: string;
}

export interface ColInfo {
  min: number;
  max: number;
  width?: number;
  hidden?: boolean;
  style?: number;
  outline?: number;
}

export interface RowInfo {
  r: number;
  height?: number;
  hidden?: boolean;
  style?: number;
  outline?: number;
}

export interface FilterColumn {
  col: number;
  values: string[];
  blank?: boolean;
}

export interface AutoFilter {
  ref: string;
  raw?: string;
  columns: FilterColumn[];
}

export interface Validation {
  sqref: string;
  kind: string;
  operator?: string;
  formula1?: string;
  formula2?: string;
  allowBlank?: boolean;
  error?: string;
  prompt?: string;
  raw?: string;
}

export interface CondRule {
  kind: string;
  operator?: string;
  formulas: string[];
  dxf?: number;
  priority: number;
  stop?: boolean;
  colors: Color[];
  raw?: string;
}

export interface CondFormat {
  sqref: string;
  rules: CondRule[];
}

export interface Hyperlink {
  ref: string;
  target?: string;
  location?: string;
  tooltip?: string;
  display?: string;
}

export interface Note {
  r: number;
  c: number;
  author: string;
  text: string;
}

export type SheetState = 'visible' | 'hidden' | 'veryHidden';

export interface Sheet {
  id: string;
  name: string;
  state?: SheetState;
  tabColor?: Color;
  cells: Cell[];
  cols?: ColInfo[];
  rows?: RowInfo[];
  defaultColWidth?: number;
  defaultRowHeight?: number;
  merges?: string[];
  frozenRows?: number;
  frozenCols?: number;
  zoom?: number;
  showGrid?: boolean;
  autoFilter?: AutoFilter;
  validations?: Validation[];
  condFormats?: CondFormat[];
  hyperlinks?: Hyperlink[];
  notes?: Note[];
}

export interface DefinedName {
  name: string;
  /** Sheet id when local to a sheet. */
  scope?: string;
  formula: string;
  hidden?: boolean;
}

export interface Preserved {
  kind: string;
  count: number;
  label: string;
}

export interface CsvDialect {
  delimiter: string;
  encoding: string;
  bom: boolean;
  lineEnding: string;
  decimalComma?: boolean;
}

export type Source = 'new' | 'xlsx' | 'csv';

export interface Workbook {
  sheets: Sheet[];
  names?: DefinedName[];
  styles: CellStyle[];
  baseStyles?: number;
  dxfs?: CellStyle[];
  preserved?: Preserved[];
  date1904?: boolean;
  activeSheet?: number;
  source?: Source;
  csv?: CsvDialect;
}

/** A computed cell from the engine. */
export interface CellOut {
  r: number;
  c: number;
  t: CellType;
  v: CellValue | null;
  /** As displayed with the number format. */
  text: string;
}

/** One input change sent to the engine (0-based). */
export interface CellInput {
  sheet: number;
  r: number;
  c: number;
  f?: string;
  t?: CellType;
  v?: CellValue;
  a?: string;
  fmt?: string;
}

export type Structural =
  | { op: 'insertRows' | 'deleteRows' | 'insertCols' | 'deleteCols'; sheet: number; at: number; count: number }
  | { op: 'addSheet'; name: string; index: number }
  | { op: 'deleteSheet'; sheet: number }
  | { op: 'renameSheet'; sheet: number; name: string };

export const DEFAULT_STYLE: CellStyle = { numFmt: 'General', font: {}, border: {}, align: {}, locked: true };
export const DEFAULT_COL_WIDTH = 8.43;
export const DEFAULT_ROW_HEIGHT = 15;
