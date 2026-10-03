//! The workbook JSON exchanged with `@oel/sheets` (camelCase on the wire).
//!
//! Rule of the codec: what we model is plain fields; what we only carry is
//! kept as raw XML next to them and written back as it came. Rows and
//! columns are 0-based here (the editor's convention); the XML is 1-based.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub sheets: Vec<Sheet>,
    #[serde(default)]
    pub names: Vec<DefinedName>,
    /// Cell formats. The index is the style id: for an imported file it is the
    /// original `cellXfs` index; styles added while editing are appended.
    pub styles: Vec<CellStyle>,
    /// How many of `styles` came from the file (written back untouched).
    #[serde(default)]
    pub base_styles: usize,
    /// Differential formats used by conditional formatting (`dxfs`).
    #[serde(default)]
    pub dxfs: Vec<CellStyle>,
    /// Parts we keep but do not edit (charts, pivots, macros…), for the UI.
    #[serde(default)]
    pub preserved: Vec<Preserved>,
    #[serde(default)]
    pub date1904: bool,
    #[serde(default)]
    pub active_sheet: usize,
    #[serde(default)]
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csv: Option<CsvDialect>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    New,
    Xlsx,
    Csv,
}

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
    pub decimal_comma: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    /// Stable id. Imported sheets use their part path; new ones get `new-…`.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub state: SheetState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<Color>,
    #[serde(default)]
    pub cells: Vec<Cell>,
    #[serde(default)]
    pub cols: Vec<ColInfo>,
    #[serde(default)]
    pub rows: Vec<RowInfo>,
    /// Character widths, as Excel stores them.
    #[serde(default = "default_col_width")]
    pub default_col_width: f64,
    /// Points.
    #[serde(default = "default_row_height")]
    pub default_row_height: f64,
    /// A1 ranges (`A15:C15`).
    #[serde(default)]
    pub merges: Vec<String>,
    #[serde(default)]
    pub frozen_rows: u32,
    #[serde(default)]
    pub frozen_cols: u32,
    #[serde(default = "default_zoom")]
    pub zoom: u32,
    #[serde(default = "yes")]
    pub show_grid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter: Option<AutoFilter>,
    #[serde(default)]
    pub validations: Vec<Validation>,
    #[serde(default)]
    pub cond_formats: Vec<CondFormat>,
    #[serde(default)]
    pub hyperlinks: Vec<Hyperlink>,
    /// Cell notes (legacy comments). Read-only in this version: the parts are
    /// preserved, the text is shown.
    #[serde(default)]
    pub notes: Vec<Note>,
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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SheetState {
    #[default]
    Visible,
    Hidden,
    VeryHidden,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub r: u32,
    pub c: u32,
    /// Value kind: `n` number, `s` text, `b` boolean, `e` error; absent = empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<String>,
    /// The literal value, or a formula's cached result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<serde_json::Value>,
    /// Formula text without the leading `=`, English, with `_xlfn.` prefixes removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    /// Array-formula range (`E1:E3`) when the cell is an array formula's anchor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub s: u32,
    /// Raw `<si>` children of a rich-text shared string, written back while the text is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich: Option<String>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColInfo {
    /// 0-based, inclusive.
    pub min: u32,
    pub max: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub outline: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowInfo {
    pub r: u32,
    /// Points; `None` = default height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub outline: u8,
}

fn is_zero_u8(n: &u8) -> bool {
    *n == 0
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefinedName {
    pub name: String,
    /// Sheet id when the name is local to a sheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    pub formula: String,
    #[serde(default)]
    pub hidden: bool,
}

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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Font {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// `single`, `double`, `singleAccounting`, `doubleAccounting`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<String>,
    #[serde(default)]
    pub strike: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// `superscript` / `subscript`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
}

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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BorderSide {
    /// `thin`, `medium`, `thick`, `dashed`, `dotted`, `double`, `hair`…
    pub style: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
}

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
    pub wrap: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub indent: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rotation: u32,
    #[serde(default)]
    pub shrink: bool,
}

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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumn {
    pub col: u32,
    pub values: Vec<String>,
    #[serde(default)]
    pub blank: bool,
}

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
    pub allow_blank: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// The original element; modelled attributes and formulas are overlaid on write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CondFormat {
    pub sqref: String,
    pub rules: Vec<CondRule>,
}

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
    pub stop: bool,
    /// colorScale / dataBar colours, low → high.
    #[serde(default)]
    pub colors: Vec<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub r: u32,
    pub c: u32,
    pub author: String,
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preserved {
    /// `chart`, `pivot`, `table`, `image`, `macro`, `slicer`, `form`, `external`, `other`.
    pub kind: String,
    pub count: u32,
    /// French label for the « Conservé » panel.
    pub label: String,
}
