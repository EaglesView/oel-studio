//! The deck JSON exchanged with `@oel/slides` (camelCase on the wire).
//!
//! Rule of the codec: what the editor can change is an *explicit* value (it is
//! `None` when the file inherits it); what PowerPoint would inherit from the
//! layout, the master, the theme or the shape style is resolved once here for
//! display (`look`, `levels`, a placeholder's box…). The writer compares the
//! explicit values with what it reads from the original part and patches only
//! what changed: everything else in the part stays as it was.
//!
//! Lengths are EMU (914 400 per inch, 12 700 per point), font sizes points,
//! angles degrees, colours CSS (`#RRGGBB` or `rgba(…)`).

use serde::{Deserialize, Serialize};

/// Payload layout version; bump with `PAYLOAD_FORMATS.deck` in `@oel/engine`.
pub const FORMAT_VERSION: u32 = 1;

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub format_version: u32,
    /// Slide size (EMU).
    pub width: i64,
    pub height: i64,
    pub slides: Vec<Slide>,
    /// Layouts of every master, in master order (the « Disposition » menu).
    pub layouts: Vec<Layout>,
    pub theme: ThemeInfo,
    /// Text levels of a plain text box (the presentation's `defaultTextStyle`), for new shapes.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub text_defaults: Vec<Level>,
    /// Fonts the deck uses, with their open substitutes.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub fonts: Vec<DeckFont>,
    /// What the file holds that the editor keeps but does not edit (animations, charts…).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub preserved: Vec<Preserved>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The deck has a notes master: speaker notes can be written for any slide.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub notes_master: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    New,
    Pptx,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    /// Heading font (`+mj-lt`).
    pub major: String,
    /// Body font (`+mn-lt`).
    pub minor: String,
    /// Scheme colours in the order of PowerPoint's colour picker (`dk1`, `lt1`, `dk2`, `lt2`, `accent1`…).
    pub colors: Vec<NamedColor>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct NamedColor {
    pub name: String,
    pub color: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeckFont {
    pub name: String,
    /// Self-hosted open font standing in for it (`Carlito` for Calibri…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub substitute: Option<String>,
    /// CSS `font-family` stack: the font, its local and web substitutes, a generic family.
    pub css: String,
    /// Faces embedded in the file (`p:embeddedFontLst`), unwrapped, among the media.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub embedded: Vec<EmbeddedFace>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct EmbeddedFace {
    /// Media path of the unwrapped font (`ppt/fonts/font1-regular.ttf`); the package keeps its `.fntdata`.
    pub path: String,
    pub weight: u16,
    pub italic: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Preserved {
    /// `animations`, `transitions`, `charts`, `smartart`, `media`, `ole`, `comments`, `macros`, `ink`.
    pub kind: String,
    /// fr-CA label (« Animations »).
    pub label: String,
    pub count: u32,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// Part name (`ppt/slideLayouts/slideLayout1.xml`).
    pub id: String,
    pub name: String,
    /// Master part.
    pub master: String,
    /// Background (layout's, else master's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<Paint>,
    /// What the layout draws under every slide: the master's shapes (unless the
    /// layout hides them) then the layout's own, placeholders excluded.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub decorations: Vec<Element>,
    /// The layout's placeholders, resolved, for new slides and empty-placeholder prompts.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub placeholders: Vec<Element>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    /// Stable id: the part name for an imported slide; any unique string for new ones.
    pub id: String,
    /// The original part this slide was read from (copies keep their source's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    /// Layout part.
    pub layout: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hidden: bool,
    /// The slide's own background (`None` = the layout's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<Paint>,
    /// The slide hides its layout's and master's shapes (`showMasterSp="0"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hide_decorations: bool,
    pub elements: Vec<Element>,
    /// Speaker notes, paragraphs separated by `\n`.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub notes: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ElementKind {
    #[default]
    Shape,
    Picture,
    Group,
    Connector,
    Table,
    /// Chart (see `Element::chart`), SmartArt, embedded object…: kept as is.
    Graphic,
    /// Anything else in the shape tree (ink, content parts…): kept, not drawn.
    Other,
}

/// Where an element came from: its part and its position among the shape tree's elements.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SrcRef {
    pub part: String,
    pub index: u32,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    /// Unique within the slide.
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<SrcRef>,
    pub kind: ElementKind,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub name: String,
    /// Alternative text.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub descr: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ph: Option<Placeholder>,
    /// Box on the slide (or in the parent group's child space), EMU.
    pub x: i64,
    pub y: i64,
    pub cx: i64,
    pub cy: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub rot: f64,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub flip_h: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub flip_v: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geom: Option<Geometry>,
    /// Explicit fill (`None` = inherited, see `look`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Paint>,
    /// Explicit outline, field by field (`None` fields are inherited).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
    /// What the element inherits (placeholder chain, shape style, theme), for display.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub look: Look,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextBody>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<Picture>,
    /// Group members, in the group's child space (`childFrame`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub children: Vec<Element>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_frame: Option<Frame>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<Table>,
    /// Drawn but not editable (graphic frames, markup-compatibility blocks…).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub locked: bool,
    /// What a locked element is (« Graphique », « SmartArt »…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// A chart frame's chart (drawn by @oel/charts; the chart part is kept as is).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chart: Option<oelchart::ChartSpec>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hidden: bool,
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Placeholder {
    /// `title`, `ctrTitle`, `subTitle`, `body`, `obj`, `pic`, `tbl`, `chart`, `dt`, `ftr`, `sldNum`…
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idx: Option<u32>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Frame {
    pub x: i64,
    pub y: i64,
    pub cx: i64,
    pub cy: i64,
}

/// A shape guide (`<a:gd name fmla>`), also used for adjust values.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Guide {
    pub name: String,
    pub fmla: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", tag = "type"))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Geometry {
    /// A preset shape (`rect`, `roundRect`, `ellipse`…) and its adjust values.
    Preset {
        prst: String,
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
        av: Vec<Guide>,
    },
    /// A freeform, written back as it was read.
    Custom(CustomGeometry),
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CustomGeometry {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub av: Vec<Guide>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub gd: Vec<Guide>,
    pub paths: Vec<GeomPath>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct GeomPath {
    /// Path coordinate space (defaults to the shape's size).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    /// `norm`, `none`, `lighten`, `lightenLess`, `darken`, `darkenLess`.
    pub fill: String,
    pub stroke: bool,
    pub cmds: Vec<PathCmd>,
}

/// Path commands; coordinates are numbers or guide names, as in the file.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", tag = "t"))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "t")]
pub enum PathCmd {
    M { x: String, y: String },
    L { x: String, y: String },
    /// Cubic Bézier: two control points then the end point (`[x1, y1, x2, y2, x, y]`).
    C { p: Vec<String> },
    /// Quadratic Bézier (`[x1, y1, x, y]`).
    Q { p: Vec<String> },
    /// Arc from the current point (`wR`, `hR`, `stAng`, `swAng`).
    A { wr: String, hr: String, st: String, sw: String },
    Z,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", tag = "type"))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Paint {
    None,
    Solid {
        color: String,
    },
    Gradient {
        /// Linear angle in degrees (0 = left to right, clockwise).
        angle: f64,
        /// `circle`, `rect`, `shape` for a path gradient; `None` for linear.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts", ts(optional))]
        path: Option<String>,
        stops: Vec<GradientStop>,
    },
    Image {
        /// Media part (`ppt/media/image1.png`).
        media: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts", ts(optional))]
        crop: Option<Crop>,
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
        tile: bool,
    },
    Pattern {
        prst: String,
        fg: String,
        bg: String,
    },
    /// The parent group's fill.
    Group,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct GradientStop {
    /// 0–1.
    pub pos: f64,
    pub color: String,
}

/// Fractions of the image cut from each side (negative = padding).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Crop {
    pub l: f64,
    pub t: f64,
    pub r: f64,
    pub b: f64,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paint: Option<Paint>,
    /// EMU.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    /// `solid`, `dash`, `dot`, `lgDash`, `sysDash`…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<String>,
    /// `flat`, `rnd`, `sq`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<LineEnd>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tail: Option<LineEnd>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct LineEnd {
    /// `none`, `triangle`, `stealth`, `diamond`, `oval`, `arrow`.
    #[serde(rename = "type")]
    pub kind: String,
    /// `sm`, `med`, `lg`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub len: Option<String>,
}

/// Inherited appearance, for display only (never written).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Look {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Paint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
    /// Effective outer or inner shadow (explicit or from the theme's effect style).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<Shadow>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Shadow {
    pub color: String,
    /// EMU.
    pub blur: i64,
    pub dist: i64,
    /// Degrees.
    pub dir: f64,
    pub inner: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Picture {
    /// Media part; empty for an empty picture placeholder.
    pub media: String,
    pub mime: String,
    /// SVG version of the same picture (`asvg:svgBlip`), preferred for display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub svg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Crop>,
    /// Opacity 0–1 (`alphaModFix`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha: Option<f64>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextBody {
    pub body: BodyProps,
    /// Inherited paragraph and run defaults per outline level (index = `lvl`); the
    /// last one applies to deeper levels.
    pub levels: Vec<Level>,
    pub paras: Vec<Para>,
    /// The layout's prompt (« Cliquez pour ajouter un titre ») for an empty placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

/// Effective text-box properties (`a:bodyPr` through the placeholder chain).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BodyProps {
    /// `t`, `ctr`, `b`.
    pub anchor: String,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub anchor_ctr: bool,
    /// Insets, EMU.
    pub l: i64,
    pub t: i64,
    pub r: i64,
    pub b: i64,
    pub wrap: bool,
    /// `none`, `norm` (shrink text), `shape` (grow the shape).
    pub autofit: String,
    /// Shrink applied by PowerPoint with `norm` (1 = none).
    pub font_scale: f64,
    pub line_reduction: f64,
    /// `horz`, `vert`, `vert270`…
    pub vert: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u32>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Spacing {
    /// Percent of the line (1 = single).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pct: Option<f64>,
    /// Points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pts: Option<f64>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bullet {
    /// `none`, `char`, `auto` (numbered).
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub char: Option<String>,
    /// `arabicPeriod`, `alphaLcParenR`… for `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Relative size (1 = the text's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
}

/// Inherited defaults for one outline level.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    pub size: f64,
    /// Typeface as written (`+mn-lt` = the theme's body font).
    pub font: String,
    pub color: String,
    pub bold: bool,
    pub italic: bool,
    /// `none`, `sng`, `dbl`…
    pub underline: String,
    pub strike: String,
    /// `none`, `all`, `small`.
    pub caps: String,
    /// Letter spacing, points.
    pub spacing: f64,
    /// `l`, `ctr`, `r`, `just`, `dist`.
    pub align: String,
    pub mar_l: i64,
    pub indent: i64,
    pub line: Spacing,
    pub before: Spacing,
    pub after: Spacing,
    pub bullet: Bullet,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Para {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub lvl: u8,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub props: ParaProps,
    pub runs: Vec<Run>,
    /// `a:endParaRPr` (gives an empty paragraph its height).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub end: RunProps,
}

/// Explicit paragraph properties (`a:pPr`); `None` = inherited from the level.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParaProps {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mar_l: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Spacing>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<Spacing>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<Spacing>,
    /// Explicit bullet: only the fields the paragraph sets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bullet: Option<Bullet>,
    /// The original `a:pPr`, so what is not modelled survives an edit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xml: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    /// `text`, `br` (line break), `field` (slide number, date…).
    pub kind: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub text: String,
    /// Field type (`slidenum`, `datetime1`…) and id, for `field`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub props: RunProps,
}

/// Explicit run properties (`a:rPr`); `None` = inherited.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunProps {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strike: Option<String>,
    /// Points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Latin typeface (`+mj-lt` / `+mn-lt` = theme fonts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Superscript/subscript offset, percent (30 = superscript).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caps: Option<String>,
    /// Letter spacing, points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    /// Hyperlink target (display only; the link itself lives in `xml`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// The original `a:rPr`, so what is not modelled survives an edit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xml: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Table {
    /// Column widths, EMU.
    pub cols: Vec<i64>,
    pub rows: Vec<TableRow>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TableRow {
    pub h: i64,
    pub cells: Vec<TableCell>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableCell {
    pub text: TextBody,
    #[serde(default = "one", skip_serializing_if = "is_one")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub grid_span: u32,
    #[serde(default = "one", skip_serializing_if = "is_one")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub row_span: u32,
    /// Covered by a merge from the left / from above.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub h_merge: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub v_merge: bool,
    /// Effective fill and borders (cell properties over the table style), display only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Paint>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub borders: Borders,
}

fn one() -> u32 {
    1
}

fn is_one(v: &u32) -> bool {
    *v == 1
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelpptx/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Borders {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub l: Option<Line>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r: Option<Line>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<Line>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<Line>,
}

/// One media part of the package (pictures, backgrounds, SVGs).
pub struct Media {
    pub path: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// An import: the deck and the media it shows.
pub struct Imported {
    pub deck: Deck,
    pub media: Vec<Media>,
}
