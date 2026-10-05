//! The workbook JSON exchanged with `@oel/sheets` (camelCase on the wire).
//!
//! Rule of the codec: what we model is plain fields; what we only carry is
//! kept as raw XML next to them and written back as it came. Rows and
//! columns are 0-based here (the editor's convention); the XML is 1-based.

use serde::{Deserialize, Serialize};

/// Value kind of a cell on the wire (`Cell.t`, `CellOut.t`). TypeScript only:
/// Rust keeps the letter as a string.
#[cfg(feature = "ts")]
#[derive(ts_rs::TS)]
#[ts(export, export_to = "oelxlsx/", rename_all = "lowercase")]
pub enum CellType {
    N,
    S,
    B,
    E,
}

/// A literal cell value on the wire (`Cell.v`). TypeScript only: Rust keeps a `serde_json::Value`.
#[cfg(feature = "ts")]
#[derive(ts_rs::TS)]
#[ts(export, export_to = "oelxlsx/", untagged)]
pub enum CellValue {
    Number(f64),
    Text(String),
    Bool(bool),
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub sheets: Vec<Sheet>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub names: Vec<DefinedName>,
    /// Cell formats. The index is the style id: for an imported file it is the
    /// original `cellXfs` index; styles added while editing are appended.
    pub styles: Vec<CellStyle>,
    /// How many of `styles` came from the file (written back untouched).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub base_styles: usize,
    /// Differential formats used by conditional formatting (`dxfs`).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub dxfs: Vec<CellStyle>,
    /// Parts we keep but do not edit (charts, pivots, macros…), for the UI.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub preserved: Vec<Preserved>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub date1904: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub active_sheet: usize,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csv: Option<CsvDialect>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/"))]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    New,
    Xlsx,
    Csv,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CsvDialect {
    /// `,` `;` or `\t`.
    pub delimiter: String,
    /// `utf-8` or `windows-1252`.
    pub encoding: String,
    pub bom: bool,
    /// `\r\n` or `\n`.
    pub line_ending: String,
    /// Numbers written `1234,5` (French Excel with `;` lists).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub decimal_comma: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    /// Stable id. Imported sheets use their part path; new ones get `new-…`.
    pub id: String,
    pub name: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub state: SheetState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<Color>,
    #[serde(default)]
    pub cells: Vec<Cell>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub cols: Vec<ColInfo>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub rows: Vec<RowInfo>,
    /// Character widths, as Excel stores them.
    #[serde(default = "default_col_width")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub default_col_width: f64,
    /// Points.
    #[serde(default = "default_row_height")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub default_row_height: f64,
    /// A1 ranges (`A15:C15`).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub merges: Vec<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub frozen_rows: u32,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub frozen_cols: u32,
    #[serde(default = "default_zoom")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub zoom: u32,
    #[serde(default = "yes")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_grid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter: Option<AutoFilter>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub validations: Vec<Validation>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub cond_formats: Vec<CondFormat>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hyperlinks: Vec<Hyperlink>,
    /// Cell notes (legacy comments). Read-only in this version: the parts are
    /// preserved, the text is shown.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub notes: Vec<Note>,
    /// Structured tables (`Table1[Col]` in formulas). The part is kept as it
    /// came; only its range is written back when rows were added or removed.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub tables: Vec<Table>,
    /// Pictures, shapes and charts drawn over the grid. Read-only: the drawing
    /// part is written back untouched.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub drawings: Vec<Drawing>,
}

pub fn default_col_width() -> f64 {
    8.43
}
pub fn default_row_height() -> f64 {
    15.0
}
fn default_zoom() -> u32 {
    100
}
fn yes() -> bool {
    true
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/"))]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SheetState {
    #[default]
    Visible,
    Hidden,
    VeryHidden,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub r: u32,
    pub c: u32,
    /// Value kind: `n` number, `s` text, `b` boolean, `e` error; absent = empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<CellType>"))]
    pub t: Option<String>,
    /// The literal value, or a formula's cached result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<CellValue>"))]
    pub v: Option<serde_json::Value>,
    /// Formula text without the leading `=`, English, with `_xlfn.` prefixes removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    /// Array-formula range (`E1:E3`) when the cell is an array formula's anchor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub s: u32,
    /// Raw `<si>` children of a rich-text shared string, written back while the text is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich: Option<String>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColInfo {
    /// 0-based, inclusive.
    pub min: u32,
    pub max: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub outline: u8,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowInfo {
    pub r: u32,
    /// Points; `None` = default height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub outline: u8,
}

fn is_zero_u8(n: &u8) -> bool {
    *n == 0
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefinedName {
    pub name: String,
    /// Sheet id when the name is local to a sheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    pub formula: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hidden: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Color {
    /// `#RRGGBB` as displayed (theme and tint resolved).
    pub css: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgb: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tint: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed: Option<u32>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    /// Excel number-format code (`General`, `0.00%`, `yyyy-mm-dd`…).
    #[serde(default = "general")]
    pub num_fmt: String,
    #[serde(default)]
    pub font: Font,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(default)]
    pub border: Border,
    #[serde(default)]
    pub align: Align,
    #[serde(default = "yes")]
    pub locked: bool,
}

pub fn general() -> String {
    "General".into()
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Font {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub bold: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub italic: bool,
    /// `single`, `double`, `singleAccounting`, `doubleAccounting`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub strike: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// `superscript` / `subscript`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Border {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSide>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BorderSide {
    /// `thin`, `medium`, `thick`, `dashed`, `dotted`, `double`, `hair`…
    pub style: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Align {
    /// `left`, `center`, `right`, `fill`, `justify`, `centerContinuous`, `distributed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<String>,
    /// `top`, `center`, `bottom` (default), `justify`, `distributed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub wrap: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub indent: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub rotation: u32,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub shrink: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoFilter {
    #[serde(rename = "ref")]
    pub range: String,
    /// The original `<autoFilter>` element (filterColumn criteria), when unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    /// Criteria set in the editor: column offset → values to show.
    #[serde(default)]
    pub columns: Vec<FilterColumn>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumn {
    pub col: u32,
    pub values: Vec<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub blank: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Validation {
    pub sqref: String,
    /// `list`, `whole`, `decimal`, `date`, `time`, `textLength`, `custom`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula2: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub allow_blank: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// The original element; modelled attributes and formulas are overlaid on write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CondFormat {
    pub sqref: String,
    pub rules: Vec<CondRule>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CondRule {
    /// `cellIs`, `expression`, `colorScale`, `dataBar`, `iconSet`, `top10`,
    /// `aboveAverage`, `duplicateValues`, `containsText`…
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator: Option<String>,
    #[serde(default)]
    pub formulas: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf: Option<u32>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub stop: bool,
    /// colorScale / dataBar colours, low → high.
    #[serde(default)]
    pub colors: Vec<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hyperlink {
    #[serde(rename = "ref")]
    pub range: String,
    /// External address (`https://…`, `mailto:`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// In-workbook location (`Feuil2!A1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub r: u32,
    pub c: u32,
    pub author: String,
    pub text: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preserved {
    /// `chart`, `pivot`, `table`, `image`, `macro`, `slicer`, `form`, `external`, `other`.
    pub kind: String,
    pub count: u32,
    /// French label for the « Conservé » panel.
    pub label: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    /// The table part (`xl/tables/table1.xml`), empty for tables made in the editor.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub part: String,
    /// The name formulas use (`displayName`).
    pub name: String,
    /// A1 range, header and totals rows included.
    #[serde(rename = "ref")]
    pub range: String,
    #[serde(default = "one")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub header_rows: u32,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub totals_rows: u32,
    /// Column names, left to right.
    pub columns: Vec<String>,
    /// `TableStyleMedium2`…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

fn one() -> u32 {
    1
}

/// Where a corner of a drawing sits: a cell and an offset inside it (EMU, 914400 per inch).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrawingMarker {
    pub r: u32,
    pub c: u32,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub dx: i64,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub dy: i64,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Drawing {
    /// `picture`, `shape`, `chart` or `other` (groups, connectors, controls).
    pub kind: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descr: Option<String>,
    /// Top-left corner.
    pub from: DrawingMarker,
    /// Bottom-right corner (two-cell anchors); otherwise `cx`/`cy` give the size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<DrawingMarker>,
    /// Size in EMU: for drawings that do not size with cells (`oneCell`,
    /// `absolute`), the size they keep when columns or rows are resized.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub cx: i64,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub cy: i64,
    /// Package path of the image (`xl/media/image1.png`); the SVG version when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    /// Shape fill and outline, CSS.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    /// Shape geometry (`rect`, `ellipse`, `roundRect`…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geom: Option<String>,
    /// Text of a shape (paragraphs joined by new lines).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Clockwise rotation, degrees.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub rot: f64,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub flip_h: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub flip_v: bool,
    /// Excel's « move and size with cells » setting (`twoCell`, `oneCell`, `absolute`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_as: Option<String>,
    /// The chart of a `chart` drawing. chartEx references (`_xlchart.v1.N`) are
    /// replaced by the ranges their defined names stand for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chart: Option<oelchart::ChartSpec>,
    /// Position of the anchor in the sheet's drawing part (absent for drawings made in the editor).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<u32>,
}
