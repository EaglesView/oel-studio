/**
 * The workbook JSON exchanged with oel-xlsx (`crates/oel-xlsx/src/model.rs`) and
 * the calc worker's shapes (`engine.rs`). Generated from Rust by `npm run gen:types`:
 * change the Rust type, not these. Rows and columns are 0-based; ranges are A1 strings.
 */
import type { CellStyle } from '@oel/engine/generated/oelxlsx';

export type {
  Align,
  AutoFilter,
  Border,
  BorderSide,
  Cell,
  CellInput,
  CellOut,
  CellStyle,
  CellType,
  CellValue,
  ColInfo,
  Color,
  CondFormat,
  CondRule,
  CsvDialect,
  DefinedName,
  Drawing,
  DrawingMarker,
  FilterColumn,
  Font,
  Hyperlink,
  Note,
  Preserved,
  RowInfo,
  Sheet,
  SheetState,
  Source,
  Structural,
  Table,
  Validation,
  Workbook,
} from '@oel/engine/generated/oelxlsx';

export const DEFAULT_STYLE: CellStyle = { numFmt: 'General', font: {}, border: {}, align: {}, locked: true };
export const DEFAULT_COL_WIDTH = 8.43;
export const DEFAULT_ROW_HEIGHT = 15;
