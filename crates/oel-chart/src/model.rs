//! `ChartSpec`: a DrawingML chart as the editors see it (camelCase on the wire).
//!
//! It mirrors `c:chartSpace` (and `cx:chartSpace` for the Office 2016 charts)
//! closely enough to draw every Office chart type and to write a chart back:
//! plot area groups (several groups = a combo chart), series with their
//! references and cached values, axes, legend, titles, 3-D view. Colours are
//! resolved to CSS at read time; `palette` holds the automatic series colours.

use serde::{Deserialize, Serialize};

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_true(b: &bool) -> bool {
    *b
}

fn yes() -> bool {
    true
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChartSpec {
    /// Package path of the chart part (`xl/charts/chart1.xml`); empty for a chart made in the editor.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub part: String,
    /// An Office 2016+ chart (`cx:chartSpace`: treemap, sunburst, waterfall, histogram…).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub ex: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<Title>,
    /// The file says « no automatic title » (single-series charts otherwise show the series name).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub auto_title_deleted: bool,
    /// Plot area groups, back to front. Several groups make a combination chart.
    pub groups: Vec<Group>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub axes: Vec<Axis>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend: Option<Legend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_table: Option<DataTable>,
    /// Plot only visible cells (Excel's default).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub plot_vis_only: bool,
    /// Empty cells: `gap`, `zero` or `span` (connect with a line).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disp_blanks_as: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view3d: Option<View3D>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floor: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side_wall: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub back_wall: Option<Shape>,
    /// Chart area (`chartSpace/spPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<Shape>,
    /// Plot area (`plotArea/spPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot: Option<Shape>,
    /// Manual position of the plot area, fractions of the chart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_layout: Option<Layout>,
    /// Default text (`chartSpace/txPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextStyle>,
    /// Automatic series colours, in order (theme accents and their variations).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub palette: Vec<String>,
    /// Theme fonts the chart's `+mn-lt` / `+mj-lt` stand for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Legacy chart style (`c:style`, 1–48) or the `cs:chartStyle` id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub rounded: bool,
    /// Image to show instead (region maps, which need geographic data we do not have).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

/// One plot area group: `barChart`, `lineChart`, `pieChart`… (or, for chartEx, one layout).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// `bar`, `line`, `pie`, `doughnut`, `ofPie`, `area`, `scatter`, `bubble`, `radar`, `stock`,
    /// `surface`; chartEx: `clusteredColumn` (histogram), `paretoLine`, `boxWhisker`, `treemap`,
    /// `sunburst`, `waterfall`, `funnel`, `regionMap`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub three_d: bool,
    /// `col` or `bar` (bar charts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bar_dir: Option<String>,
    /// `clustered`, `stacked`, `percentStacked`, `standard`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouping: Option<String>,
    /// One colour per point (pies, single-series bars set to vary).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub vary_colors: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_depth: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overlap: Option<f64>,
    /// 3-D bar shape: `box`, `cylinder`, `cone`, `coneToMax`, `pyramid`, `pyramidToMax`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hole_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_slice_ang: Option<f64>,
    /// `pie` or `bar` (pie of pie / bar of pie).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub of_pie_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_pos: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub second_pie_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bubble_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_neg_bubbles: bool,
    /// `area` or `w` (bubble size stands for the area or the width).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_represents: Option<String>,
    /// `standard`, `marker`, `filled`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radar_style: Option<String>,
    /// `lineMarker`, `line`, `marker`, `smooth`, `smoothMarker`, `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scatter_style: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub wireframe: bool,
    /// Line charts: draw markers (`c:marker val="1"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub markers: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hi_low_lines: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drop_lines: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ser_lines: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub up_down_bars: Option<UpDownBars>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<DataLabels>,
    /// Axes this group is plotted against (category/x first, then value/y, then series).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub axis_ids: Vec<u32>,
    pub series: Vec<Series>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub idx: u32,
    pub order: u32,
    /// Series name (cached text or literal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Cell the name comes from (`'Budget'!B1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_ref: Option<String>,
    /// Categories; X values for scatter and bubble charts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cat: Option<DataRef>,
    /// Values; Y values for scatter and bubble charts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val: Option<DataRef>,
    /// Bubble sizes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<DataRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<Marker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub points: Vec<DataPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<DataLabels>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub trendlines: Vec<Trendline>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub err_bars: Vec<ErrBars>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub smooth: bool,
    /// Pie explosion, percent of the radius.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explosion: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub invert_if_negative: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub hidden: bool,
    /// chartEx layout properties.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ex: Option<ExProps>,
}

/// A reference to cells and the values cached in the file.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataRef {
    /// Formula (`'Budget'!$B$2:$B$5`); absent for literals.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    /// Number format of the cached numbers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    /// Cached numbers by point index (`null` = empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub num: Vec<Option<f64>>,
    /// Cached text by point index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub str: Vec<Option<String>>,
    /// Multi-level categories, innermost level first (Excel's order).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub levels: Vec<Vec<Option<String>>>,
    /// Number of points.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub count: u32,
}

/// Fill and outline of a chart element (`c:spPr`).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub shadow: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fill {
    /// `none`, `solid`, `gradient`, `pattern`, `picture`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Gradient stops (position 0–1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub stops: Vec<Stop>,
    /// Linear gradient angle, degrees (0 = left to right).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    /// Radial gradients (`circle`, `rect`, `shape`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Pattern preset and its background colour (foreground is `color`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    /// Picture fill: package path of the image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/"))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Stop {
    pub pos: f64,
    pub color: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    /// `a:ln/a:noFill`.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub none: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Width in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// `solid`, `dash`, `sysDot`, `lgDash`…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    /// `circle`, `square`, `diamond`, `triangle`, `x`, `star`, `dot`, `dash`, `plus`, `picture`, `none`, `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    /// Size in points (2–72).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
}

/// Formatting of a single point (`c:dPt`).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataPoint {
    pub idx: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explosion: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<Marker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invert_if_negative: Option<bool>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataLabels {
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub delete: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_val: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_cat: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_ser: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_pct: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_bubble: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub show_key: bool,
    /// `ctr`, `inEnd`, `inBase`, `outEnd`, `bestFit`, `l`, `r`, `t`, `b`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_fmt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub separator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    /// Per-point overrides: a deleted label or custom text.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub points: Vec<PointLabel>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PointLabel {
    pub idx: u32,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub delete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trendline {
    /// `linear`, `exp`, `log`, `poly`, `power`, `movingAvg`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forward: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backward: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intercept: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub disp_eq: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub disp_r2: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrBars {
    /// `x` or `y`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    /// `both`, `plus`, `minus`.
    pub bar_type: String,
    /// `fixedVal`, `percentage`, `stdDev`, `stdErr`, `cust`.
    pub val_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub no_end_cap: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plus: Option<DataRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minus: Option<DataRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpDownBars {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub up: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub down: Option<Shape>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub id: u32,
    /// `cat`, `val`, `date`, `ser`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub delete: bool,
    /// `l`, `r`, `t`, `b`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_ax: Option<u32>,
    /// `autoZero`, `min`, `max`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crosses: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crosses_at: Option<f64>,
    /// `between` (bars sit between ticks) or `midCat`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_between: Option<String>,
    /// `orientation val="maxMin"`.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub reverse: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major_unit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minor_unit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_fmt: Option<String>,
    /// Number format follows the source cells.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub source_linked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major_grid: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minor_grid: Option<Shape>,
    /// `nextTo`, `low`, `high`, `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tick_lbl_pos: Option<String>,
    /// `out`, `in`, `cross`, `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major_tick: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minor_tick: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<Title>,
    /// The axis line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextStyle>,
    /// `hundreds`, `thousands`, …, `percentage` (chartEx), or a custom divisor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disp_units: Option<String>,
    /// Date axes: `days`, `months`, `years`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_time_unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tick_lbl_skip: Option<u32>,
    /// Gap between categories in chartEx (`catScaling gapWidth`, fraction).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<f64>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Legend {
    /// `r`, `l`, `t`, `b`, `tr`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub overlay: bool,
    /// Legend entries removed by the user (entry index).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub deleted: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Title {
    /// Rich text flattened to plain text (lines separated by `\n`); absent = automatic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Title linked to a cell (`=Budget!$A$1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub overlay: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<TextStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    /// Points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Text rotation, degrees (axis labels, axis titles).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot: Option<f64>,
}

/// Manual layout, fractions of the chart area (`c:manualLayout`, `edge` mode).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    /// The box is the inner plot area (without tick labels).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub inner: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct View3D {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r_ang_ax: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perspective: Option<f64>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataTable {
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub horz: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub vert: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub outline: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub keys: bool,
}

/// chartEx series properties (`cx:layoutPr` and series attributes).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelchart/", optional_fields))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExProps {
    /// Index of the series this one belongs to (Pareto line → its columns).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<u32>,
    /// Histogram: `aggregation` (one bar per category) or binning.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub aggregation: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underflow: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overflow: Option<f64>,
    /// Waterfall: points shown as totals.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub subtotals: Vec<u32>,
    /// Treemap: `none`, `banner`, `overlapping`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_label: Option<String>,
    /// Box and whisker: `exclusive` or `inclusive`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quartile: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub mean_line: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub mean_marker: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub outliers: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
    pub non_outliers: bool,
}
