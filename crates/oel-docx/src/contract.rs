//! The JSON contract between this codec and `@oel/docs`.
//!
//! The reader builds its JSON with `json!` for speed of iteration; these types
//! are the declared shape of that JSON. [`check`] holds the reader to it (run on
//! every fixture by `tests/contract.rs`), and `npm run gen:types` exports the
//! same types to TypeScript (`packages/engine/src/generated/oeldocx/`) together
//! with [`VOCABULARY`], which `packages/docs/test/schema.test.ts` compares with
//! the Tiptap schema. Renaming a field here breaks both sides.
//!
//! Optional values are `null` on the wire (the reader always writes the key),
//! except where a field is marked `optional` for TypeScript.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// ProseMirror JSON
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", rename = "PMMark"))]
#[serde(deny_unknown_fields)]
pub struct PmMark {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>", optional))]
    pub attrs: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", rename = "PMNode", optional_fields))]
#[serde(deny_unknown_fields)]
pub struct PmNode {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub attrs: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<PmNode>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marks: Option<Vec<PmMark>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
pub enum DocTag {
    #[default]
    #[serde(rename = "doc")]
    Doc,
}

/// A story: the body, a header/footer or a note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", rename = "PMDoc"))]
#[serde(deny_unknown_fields)]
pub struct PmDoc {
    #[serde(rename = "type")]
    pub kind: DocTag,
    pub content: Vec<PmNode>,
}

// ---------------------------------------------------------------------------
// Envelope: what `docx_to_pm` returns and `pm_to_docx` takes
// ---------------------------------------------------------------------------

/// Output of `docx_to_pm` / `new_document_pm` (the `json` string, parsed).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocxJson {
    pub version: u32,
    pub doc: PmDoc,
    pub notes: Notes,
    /// Headers and footers, keyed by story id (one per package part; several
    /// sections may reference the same story).
    pub stories: BTreeMap<String, StoryPart>,
    /// Document order. Every section but the last ends at the paragraph whose
    /// `section` attr names it; the last one (id `body`) is the body's final `sectPr`.
    pub sections: Vec<Section>,
    pub settings: DocSettings,
    /// Page colour (`w:background`), `#RRGGBB`.
    pub background: Option<String>,
    /// Fonts the document names, with the open substitute the editor loads and embedded faces.
    pub fonts: Vec<DocFont>,
    pub styles: Vec<DocStyle>,
    pub styles_css: String,
    pub defaults: Defaults,
    pub numbering: NumberingDefs,
    pub title: Option<String>,
    pub media: Vec<MediaRef>,
}

/// What `pm_to_docx` reads (DocxJson minus the render-only fields). Built by the editor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase")]
pub struct ExportJson {
    pub doc: PmDoc,
    pub notes: Notes,
    pub stories: BTreeMap<String, StoryPart>,
    pub sections: Vec<Section>,
    pub background: Option<String>,
    pub numbering: ExportNumbering,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct Notes {
    pub footnote: BTreeMap<String, PmDoc>,
    pub endnote: BTreeMap<String, PmDoc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum HeaderFooterKind {
    Default,
    First,
    Even,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum StorySide {
    Header,
    Footer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct StoryPart {
    /// Package part (`word/header1.xml`), absent for new ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub part: Option<String>,
    pub side: StorySide,
    pub doc: PmDoc,
}

/// One section (`w:sectPr`). Header/footer slots hold only the section's own
/// references; Word's inheritance from earlier sections is computed by the editor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    /// `s1`, `s2`… on import (random for sections made in the editor); `body` for the last.
    pub id: String,
    pub page: PageSetup,
    pub kind: SectionKind,
    pub title_pg: bool,
    pub pg_num: PageNumbering,
    pub cols: Columns,
    pub headers: HeaderFooterRefs,
    pub footers: HeaderFooterRefs,
    /// The raw `w:sectPr` element, written back as is while the values above are
    /// unchanged, else patched where they changed.
    pub sect_pr: Option<String>,
}

/// How a section starts (`w:type`).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase")]
pub enum SectionKind {
    #[default]
    NextPage,
    Continuous,
    EvenPage,
    OddPage,
    NextColumn,
}

/// `w:pgNumType`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageNumbering {
    /// `decimal`, `lowerRoman`, `upperRoman`, `lowerLetter`, `upperLetter`, `decimalZero`…
    pub fmt: String,
    /// Restart at this number; `null` continues from the previous section.
    pub start: Option<i64>,
}

/// `w:cols` (twips).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Columns {
    pub num: i64,
    pub space: i64,
    pub equal_width: bool,
}

/// Story ids referenced by a section, per kind.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", optional_fields))]
#[serde(deny_unknown_fields)]
pub struct HeaderFooterRefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub even: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocFont {
    pub name: String,
    /// Open font standing in when `name` is not installed (self-hosted by the editor).
    pub substitute: Option<String>,
    /// Faces embedded in the file, de-obfuscated, among the media.
    pub embedded: Vec<EmbeddedFace>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddedFace {
    pub path: String,
    pub weight: u16,
    pub italic: bool,
}

/// Document settings the layout needs (from the related settings part; read only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocSettings {
    pub even_and_odd_headers: bool,
    /// Twips.
    pub default_tab_stop: i64,
    pub mirror_margins: bool,
}

/// Page geometry of a section, in twips (1/1440 in).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageSetup {
    pub width: i64,
    pub height: i64,
    pub orient: Orient,
    pub top: i64,
    pub right: i64,
    pub bottom: i64,
    pub left: i64,
    pub header: i64,
    pub footer: i64,
    pub gutter: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum Orient {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocStyle {
    pub id: String,
    pub name: String,
    pub kind: StyleKind,
    /// normal, title, subtitle, heading1…heading9, listParagraph, hyperlink…
    pub role: Option<String>,
    pub based_on: Option<String>,
    pub is_default: bool,
    pub quick: bool,
    pub hidden: bool,
    pub outline: Option<u8>,
    pub num_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum StyleKind {
    Paragraph,
    Character,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Defaults {
    pub font_family: String,
    pub font_size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NumberingDefs {
    pub nums: BTreeMap<String, NumDef>,
    pub max_num_id: i64,
    pub max_abstract_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NumDef {
    pub abstract_id: i64,
    pub restart: bool,
    pub levels: Vec<ListLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListLevel {
    pub fmt: String,
    pub text: String,
    pub start: i64,
    pub ind_left: Option<i64>,
    pub hanging: Option<i64>,
    pub font: Option<String>,
}

/// Lists created in the editor, written as new `w:num` definitions on export.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
pub struct ExportNumbering {
    pub synthetic: Vec<SyntheticList>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase")]
pub struct SyntheticList {
    pub num_id: i64,
    pub kind: SyntheticListKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum SyntheticListKind {
    Bullet,
    Decimal,
    Check,
    Checked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct MediaRef {
    pub path: String,
    pub mime: String,
}

// ---------------------------------------------------------------------------
// Node and mark attrs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParagraphAttrs {
    /// Raw `w:pPr` children, written back while the modelled attrs below are unchanged.
    #[serde(rename = "pPr")]
    pub p_pr: Option<String>,
    pub style_id: Option<String>,
    pub align: Option<Align>,
    pub spacing: Option<Spacing>,
    pub ind: Option<Indent>,
    pub num_id: Option<i64>,
    pub ilvl: i64,
    pub outline: Option<u8>,
    /// Display-only CSS for what the editor renders but does not edit.
    pub css: Option<String>,
    /// Id of the section that ends at this paragraph (it carries that `w:sectPr`).
    pub section: Option<String>,
    /// `w:framePr`, display-only (kept in `pPr`).
    pub frame: Option<Frame>,
    pub checked: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Left,
    Center,
    Right,
    Justify,
}

/// `w:spacing`, in twips; only the attributes present in the file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", optional_fields))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spacing {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<i64>,
    /// `auto`, `exact`, `atLeast`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_rule: Option<String>,
}

/// `w:ind`, in twips; only the attributes present in the file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", optional_fields))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Indent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_line: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hanging: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableAttrs {
    #[serde(rename = "tblPr")]
    pub tbl_pr: Option<String>,
    /// `w:gridCol` widths, twips.
    pub grid: Vec<i64>,
    pub style_id: Option<String>,
    /// Display-only CSS (width, alignment, indent) resolved from the table and its style.
    pub css: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableRowAttrs {
    #[serde(rename = "trPr")]
    pub tr_pr: Option<String>,
    #[serde(rename = "tblPrEx")]
    pub tbl_pr_ex: Option<String>,
    pub header: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableCellAttrs {
    pub colspan: u32,
    pub rowspan: u32,
    /// Pixels, one per spanned grid column.
    pub colwidth: Option<Vec<i64>>,
    /// `#RRGGBB`.
    pub background: Option<String>,
    pub valign: Option<String>,
    #[serde(rename = "tcPr")]
    pub tc_pr: Option<String>,
    /// Display-only CSS (borders, conditional shading and text, margins) resolved
    /// from the table style, its conditional formats and the cell's own properties.
    pub css: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageAttrs {
    /// `media:<path>` for package images; resolved to a URL by the editor.
    pub src: Option<String>,
    pub path: Option<String>,
    pub rid: Option<String>,
    /// EMU.
    pub cx: Option<i64>,
    pub cy: Option<i64>,
    pub alt: String,
    pub title: String,
    pub floating: bool,
    /// The original run, written back while the image is unchanged.
    pub xml: Option<String>,
    /// Editor-only id of a linked picture (`@oel/links`, plan I-3): what a link points at.
    /// Always null from the reader; the writer ignores it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub oid: Option<String>,
}

/// A floating object (`wp:anchor`): picture, shape, text box or group, drawn on
/// a layer over or under the page. The run is written back as `xml` while the
/// position, size and description are unchanged.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorAttrs {
    pub kind: AnchorKind,
    pub position: AnchorPosition,
    /// Size, EMU.
    pub cx: i64,
    pub cy: i64,
    pub behind_doc: bool,
    /// `none`, `square`, `tight`, `through`, `topAndBottom`.
    pub wrap: String,
    /// `bothSides`, `left`, `right`, `largest`.
    pub wrap_side: Option<String>,
    /// Distance from wrapped text, EMU.
    pub dist: Edges,
    /// Stacking order (`relativeHeight`).
    pub z: i64,
    pub shape: ShapeLook,
    /// Members of a group, positioned in the group's box.
    pub children: Vec<GroupChild>,
    pub xml: String,
    pub alt: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum AnchorKind {
    Picture,
    #[default]
    Shape,
    Textbox,
    Group,
}

/// `wp:positionH` / `wp:positionV`: an offset (EMU) or an alignment, from a reference.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorPosition {
    /// `page`, `margin`, `column`, `character`, `leftMargin`, `rightMargin`, `insideMargin`, `outsideMargin`.
    pub rel_h: String,
    pub h: Option<i64>,
    /// `left`, `center`, `right`, `inside`, `outside`.
    pub align_h: Option<String>,
    /// `page`, `margin`, `paragraph`, `line`, `topMargin`, `bottomMargin`, `insideMargin`, `outsideMargin`.
    pub rel_v: String,
    pub v: Option<i64>,
    /// `top`, `center`, `bottom`, `inside`, `outside`.
    pub align_v: Option<String>,
}

/// Four lengths (EMU).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct Edges {
    pub t: i64,
    pub b: i64,
    pub l: i64,
    pub r: i64,
}

/// How a shape or picture looks, resolved to CSS by the codec (theme colours included).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShapeLook {
    /// Preset geometry (`rect`, `ellipse`, `roundRect`, `triangle`, `line`…); custom geometry → `null` (bounding box).
    pub geometry: Option<String>,
    /// Degrees, clockwise.
    pub rotation: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    /// CSS background (`#RRGGBB`, `rgba(…)`, `linear-gradient(…)`); `null` = no fill.
    pub fill: Option<String>,
    /// CSS border (`1pt solid #RRGGBB`); `null` = no line.
    pub line: Option<String>,
    pub picture: Option<PictureFill>,
    pub text: Option<TextBox>,
}

/// A picture, or a shape filled with one.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PictureFill {
    pub path: String,
    /// `media:<path>`, resolved to a URL by the editor.
    pub src: String,
    /// Tiled instead of stretched.
    pub tile: bool,
    /// `a:srcRect` crop, fractions of the picture cut from each edge.
    pub crop: Option<Crop>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct Crop {
    pub l: f64,
    pub t: f64,
    pub r: f64,
    pub b: f64,
}

/// Text inside a shape (`w:txbxContent`), read like the body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextBox {
    pub doc: PmDoc,
    /// Insets, EMU.
    pub insets: Edges,
    /// Vertical anchoring: `t`, `ctr`, `b`.
    pub anchor: String,
}

/// One shape of a group, in the group's box (EMU from its top left).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupChild {
    pub x: i64,
    pub y: i64,
    pub cx: i64,
    pub cy: i64,
    pub shape: ShapeLook,
}

/// `w:framePr` (twips), display-only.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/", optional_fields))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    /// `auto`, `around`, `none`, `notBeside`, `through`, `tight`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h_anchor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v_anchor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x_align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y_align: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteRefAttrs {
    pub kind: NoteKind,
    pub id: String,
    #[serde(rename = "rPr")]
    pub r_pr: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    #[default]
    Footnote,
    Endnote,
}

/// Inline content the editor does not model, kept as XML.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OoxmlInlineAttrs {
    pub xml: String,
    pub label: String,
    pub hidden: bool,
    /// Field code (`PAGE`, `TOC`, `NOTENUM`…) when the XML is part of a field.
    pub field: Option<String>,
    /// A chart drawing: its chart (the XML and the chart part are written back as they came).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub chart: Option<oelchart::ChartSpec>,
    /// Chart size, EMU.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub cx: Option<i64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub cy: Option<i64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub floating: Option<bool>,
    /// Editor-only id of a chart made in the editor (a linked copy, `@oel/links`): what a link points at.
    /// Always null from the reader; the writer ignores it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub oid: Option<String>,
}

/// Block content the editor does not model, kept as XML.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OoxmlBlockAttrs {
    pub xml: String,
    pub label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SdtBlockAttrs {
    #[serde(rename = "sdtPr")]
    pub sdt_pr: Option<String>,
    #[serde(rename = "sdtEndPr")]
    pub sdt_end_pr: Option<String>,
    pub gallery: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct LinkAttrs {
    pub href: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(deny_unknown_fields)]
pub struct HighlightAttrs {
    /// `#RRGGBB`.
    pub color: Option<String>,
}

/// Run properties: the modelled ones, plus the raw `w:rPr`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oeldocx/"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextStyleAttrs {
    pub font_family: Option<String>,
    /// `11pt`.
    pub font_size: Option<String>,
    /// `#RRGGBB`.
    pub color: Option<String>,
    #[serde(rename = "rPr")]
    pub r_pr: Option<String>,
    #[serde(rename = "rStyle")]
    pub r_style: Option<String>,
}

// ---------------------------------------------------------------------------
// Vocabulary and conformance
// ---------------------------------------------------------------------------

/// Every node and mark the codec reads or writes, with its attrs type (if any).
pub const NODES: &[&str] = &[
    "doc", "paragraph", "text", "hardBreak", "tab", "pageBreak", "image", "anchor", "noteRef", "ooxmlInline", "ooxmlBlock", "sdtBlock", "table", "tableRow", "tableCell",
];
pub const MARKS: &[&str] = &["bold", "italic", "underline", "strike", "subscript", "superscript", "highlight", "textStyle", "link"];

fn keys_of<T: Default + Serialize>() -> Vec<String> {
    match serde_json::to_value(T::default()) {
        Ok(Value::Object(m)) => m.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

/// Attr keys of a node or mark (empty for those without attrs).
pub fn attr_keys(name: &str) -> Vec<String> {
    match name {
        "paragraph" => keys_of::<ParagraphAttrs>(),
        "image" => keys_of::<ImageAttrs>(),
        "anchor" => keys_of::<AnchorAttrs>(),
        "noteRef" => keys_of::<NoteRefAttrs>(),
        "ooxmlInline" => keys_of::<OoxmlInlineAttrs>(),
        "ooxmlBlock" => keys_of::<OoxmlBlockAttrs>(),
        "sdtBlock" => keys_of::<SdtBlockAttrs>(),
        "table" => keys_of::<TableAttrs>(),
        "tableRow" => keys_of::<TableRowAttrs>(),
        "tableCell" => keys_of::<TableCellAttrs>(),
        "link" => keys_of::<LinkAttrs>(),
        "highlight" => keys_of::<HighlightAttrs>(),
        "textStyle" => keys_of::<TextStyleAttrs>(),
        _ => Vec::new(),
    }
}

/// `{ nodes: { name: [attr…] }, marks: { name: [attr…] } }`, for the TypeScript side.
pub fn vocabulary() -> Value {
    let table = |names: &[&str]| -> Map<String, Value> {
        names.iter().map(|n| (n.to_string(), Value::from(attr_keys(n)))).collect()
    };
    serde_json::json!({ "nodes": table(NODES), "marks": table(MARKS) })
}

fn check_attrs<T: for<'de> Deserialize<'de>>(attrs: &Value) -> Result<(), String> {
    serde_json::from_value::<T>(attrs.clone()).map(|_| ()).map_err(|e| e.to_string())
}

fn check_typed(name: &str, attrs: Option<&Map<String, Value>>) -> Result<(), String> {
    let expected = attr_keys(name);
    let Some(attrs) = attrs else {
        return if expected.is_empty() { Ok(()) } else { Err(format!("{name}: attrs missing")) };
    };
    let mut got: Vec<&String> = attrs.keys().collect();
    let mut want: Vec<&String> = expected.iter().collect();
    got.sort();
    want.sort();
    if got != want {
        return Err(format!("{name}: attrs {got:?}, contract says {want:?}"));
    }
    let v = Value::Object(attrs.clone());
    match name {
        "paragraph" => check_attrs::<ParagraphAttrs>(&v),
        "image" => check_attrs::<ImageAttrs>(&v),
        "anchor" => {
            // Text boxes hold stories of their own: check them too.
            let a: AnchorAttrs = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
            let texts = std::iter::once(&a.shape).chain(a.children.iter().map(|c| &c.shape)).filter_map(|s| s.text.as_ref());
            for t in texts {
                t.doc.content.iter().try_for_each(check_node)?;
            }
            Ok(())
        }
        "noteRef" => check_attrs::<NoteRefAttrs>(&v),
        "ooxmlInline" => check_attrs::<OoxmlInlineAttrs>(&v),
        "ooxmlBlock" => check_attrs::<OoxmlBlockAttrs>(&v),
        "sdtBlock" => check_attrs::<SdtBlockAttrs>(&v),
        "table" => check_attrs::<TableAttrs>(&v),
        "tableRow" => check_attrs::<TableRowAttrs>(&v),
        "tableCell" => check_attrs::<TableCellAttrs>(&v),
        "link" => check_attrs::<LinkAttrs>(&v),
        "highlight" => check_attrs::<HighlightAttrs>(&v),
        "textStyle" => check_attrs::<TextStyleAttrs>(&v),
        _ => Ok(()),
    }
    .map_err(|e| format!("{name}: {e}"))
}

fn check_node(n: &PmNode) -> Result<(), String> {
    if !NODES.contains(&n.kind.as_str()) {
        return Err(format!("node `{}` is not in the contract", n.kind));
    }
    check_typed(&n.kind, n.attrs.as_ref())?;
    for m in n.marks.iter().flatten() {
        if !MARKS.contains(&m.kind.as_str()) {
            return Err(format!("mark `{}` is not in the contract", m.kind));
        }
        check_typed(&m.kind, m.attrs.as_ref())?;
    }
    n.content.iter().flatten().try_for_each(check_node)
}

/// Checks reader output (`DocxJson`) against the contract: envelope fields,
/// node and mark names, and each attrs object's exact keys and value types.
pub fn check(json: &Value) -> Result<(), String> {
    let d: DocxJson = serde_json::from_value(json.clone()).map_err(|e| format!("envelope: {e}"))?;
    let stories = std::iter::once(&d.doc)
        .chain(d.notes.footnote.values())
        .chain(d.notes.endnote.values())
        .chain(d.stories.values().map(|s| &s.doc));
    for doc in stories {
        doc.content.iter().try_for_each(check_node)?;
    }
    check_sections(&d)
}

/// Sections: unique ids, `body` last, every break names an earlier section,
/// every header/footer reference names a story of the right side.
fn check_sections(d: &DocxJson) -> Result<(), String> {
    let ids: Vec<&str> = d.sections.iter().map(|s| s.id.as_str()).collect();
    if ids.last() != Some(&"body") {
        return Err(format!("sections: the last section must be `body`, got {ids:?}"));
    }
    let unique: std::collections::BTreeSet<&str> = ids.iter().copied().collect();
    if unique.len() != ids.len() {
        return Err(format!("sections: duplicate ids {ids:?}"));
    }
    let mut breaks = Vec::new();
    fn walk<'a>(n: &'a PmNode, out: &mut Vec<&'a str>) {
        if let Some(id) = n.attrs.as_ref().and_then(|a| a.get("section")).and_then(Value::as_str) {
            out.push(id);
        }
        n.content.iter().flatten().for_each(|c| walk(c, out));
    }
    d.doc.content.iter().for_each(|n| walk(n, &mut breaks));
    if breaks != ids[..ids.len() - 1] {
        return Err(format!("sections: breaks in the body {breaks:?} do not match sections {ids:?}"));
    }
    for s in &d.sections {
        for (side, refs) in [(StorySide::Header, &s.headers), (StorySide::Footer, &s.footers)] {
            for id in [&refs.default, &refs.first, &refs.even].into_iter().flatten() {
                match d.stories.get(id) {
                    Some(story) if story.side == side => {}
                    _ => return Err(format!("section {}: reference to missing {side:?} story `{id}`", s.id)),
                }
            }
        }
    }
    Ok(())
}

#[cfg(all(test, feature = "ts"))]
mod ts_export {
    /// Named like ts-rs's own tests so `npm run gen:types` picks it up.
    #[test]
    fn export_bindings_vocabulary() {
        let dir = std::path::PathBuf::from(std::env::var("TS_RS_EXPORT_DIR").unwrap_or_else(|_| "bindings".into())).join("oeldocx");
        std::fs::create_dir_all(&dir).unwrap();
        let body = serde_json::to_string_pretty(&super::vocabulary()).unwrap();
        let ts = format!(
            "// Generated from crates/oel-docx/src/contract.rs. Do not edit.\n\n/** Nodes and marks the codec reads and writes, with their attr names. */\nexport const CODEC_VOCABULARY: {{ nodes: Record<string, string[]>; marks: Record<string, string[]> }} = {body};\n"
        );
        std::fs::write(dir.join("vocabulary.ts"), ts).unwrap();
    }
}
