//! [`ChartSpec`] → `c:chartSpace` XML.
//!
//! Used for charts made in the editor and for charts the user edited. A chart
//! the editor did not touch is never rewritten: the hosts compare the spec
//! with the one read from the original part and copy the part when they match.
//! Caches (`numCache`/`strCache`) are always written so that Office and
//! LibreOffice show the values without recalculating.

use crate::model::*;
use oel_opc::color::Rgba;
use oel_opc::xml::{escape_attr, escape_text};
use std::fmt::Write as _;

const NS: &str = r#"xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

/// Serialize a classic chart. chartEx specs (`spec.ex`) are not written: the host keeps their part.
/// `external_data` is the relationship id of an embedded workbook (pptx/docx charts).
pub fn write_chart(spec: &ChartSpec, external_data: Option<&str>) -> String {
    let palette = if spec.palette.is_empty() { OFFICE_ACCENTS.iter().map(|c| c.to_string()).collect() } else { spec.palette.clone() };
    let mut w = W(String::with_capacity(8192), palette);
    w.0.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    let _ = write!(w.0, "<c:chartSpace {NS}>");
    w.val("c:date1904", "0");
    w.val("c:roundedCorners", if spec.rounded { "1" } else { "0" });
    if let Some(s) = spec.style {
        w.val("c:style", &s.to_string());
    }
    w.open("c:chart");
    if let Some(t) = &spec.title {
        w.title(t);
    }
    w.val("c:autoTitleDeleted", if spec.auto_title_deleted { "1" } else { "0" });
    if let Some(v) = &spec.view3d {
        w.open("c:view3D");
        w.opt_num("c:rotX", v.rot_x);
        w.opt_num("c:hPercent", v.h_percent);
        w.opt_num("c:rotY", v.rot_y);
        w.opt_num("c:depthPercent", v.depth_percent);
        if let Some(r) = v.r_ang_ax {
            w.val("c:rAngAx", if r { "1" } else { "0" });
        }
        w.opt_num("c:perspective", v.perspective);
        w.close("c:view3D");
    }
    for (tag, s) in [("c:floor", &spec.floor), ("c:sideWall", &spec.side_wall), ("c:backWall", &spec.back_wall)] {
        if let Some(s) = s {
            w.open(tag);
            w.val("c:thickness", "0");
            w.sp_pr(s);
            w.close(tag);
        }
    }
    w.open("c:plotArea");
    w.layout(spec.plot_layout.as_ref());
    for g in &spec.groups {
        w.group(g);
    }
    for a in &spec.axes {
        w.axis(a);
    }
    if let Some(t) = &spec.data_table {
        w.open("c:dTable");
        w.val("c:showHorzBorder", b(t.horz));
        w.val("c:showVertBorder", b(t.vert));
        w.val("c:showOutline", b(t.outline));
        w.val("c:showKeys", b(t.keys));
        w.close("c:dTable");
    }
    if let Some(s) = &spec.plot {
        w.sp_pr(s);
    }
    w.close("c:plotArea");
    if let Some(l) = &spec.legend {
        w.open("c:legend");
        w.val("c:legendPos", l.pos.as_deref().unwrap_or("r"));
        for d in &l.deleted {
            w.open("c:legendEntry");
            w.val("c:idx", &d.to_string());
            w.val("c:delete", "1");
            w.close("c:legendEntry");
        }
        w.layout(l.layout.as_ref());
        w.val("c:overlay", b(l.overlay));
        if let Some(s) = &l.shape {
            w.sp_pr(s);
        }
        if let Some(t) = &l.text {
            w.tx_pr(t);
        }
        w.close("c:legend");
    }
    w.val("c:plotVisOnly", b(spec.plot_vis_only));
    w.val("c:dispBlanksAs", spec.disp_blanks_as.as_deref().unwrap_or("gap"));
    w.close("c:chart");
    if let Some(s) = &spec.space {
        w.sp_pr(s);
    }
    if let Some(t) = &spec.text {
        w.tx_pr(t);
    }
    if let Some(id) = external_data {
        let _ = write!(w.0, r#"<c:externalData r:id="{id}"><c:autoUpdate val="0"/></c:externalData>"#);
    }
    w.0.push_str("</c:chartSpace>");
    w.0
}

fn b(v: bool) -> &'static str {
    if v { "1" } else { "0" }
}

fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e15 { format!("{}", v as i64) } else { format!("{v}") }
}

/// Office 2013+ default accents, used when the chart has no palette of its own.
const OFFICE_ACCENTS: [&str; 6] = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];

/// The XML being built, and the automatic colours written out explicitly
/// (LibreOffice draws series without colours as invisible).
struct W(String, Vec<String>);

impl W {
    fn open(&mut self, tag: &str) {
        let _ = write!(self.0, "<{tag}>");
    }
    fn close(&mut self, tag: &str) {
        let _ = write!(self.0, "</{tag}>");
    }
    fn val(&mut self, tag: &str, v: &str) {
        self.0.push('<');
        self.0.push_str(tag);
        self.0.push_str(" val=\"");
        escape_attr(v, &mut self.0);
        self.0.push_str("\"/>");
    }
    fn opt_num(&mut self, tag: &str, v: Option<f64>) {
        if let Some(v) = v {
            self.val(tag, &fmt_num(v));
        }
    }
    fn text(&mut self, tag: &str, s: &str) {
        let _ = write!(self.0, "<{tag}>");
        escape_text(s, &mut self.0);
        let _ = write!(self.0, "</{tag}>");
    }

    fn color(&mut self, css: &str) {
        let Some(c) = Rgba::from_css(css) else { return };
        if c.a < 0.999 {
            let _ = write!(self.0, r#"<a:srgbClr val="{}"><a:alpha val="{}"/></a:srgbClr>"#, c.to_hex(), (c.a * 100_000.0).round() as i64);
        } else {
            let _ = write!(self.0, r#"<a:srgbClr val="{}"/>"#, c.to_hex());
        }
    }

    fn fill(&mut self, f: &Fill) {
        match f.kind.as_str() {
            "none" => self.0.push_str("<a:noFill/>"),
            "gradient" if !f.stops.is_empty() => {
                self.0.push_str("<a:gradFill rotWithShape=\"1\"><a:gsLst>");
                for s in &f.stops {
                    let _ = write!(self.0, r#"<a:gs pos="{}">"#, (s.pos * 100_000.0).round() as i64);
                    self.color(&s.color);
                    self.0.push_str("</a:gs>");
                }
                self.0.push_str("</a:gsLst>");
                match &f.path {
                    Some(p) => {
                        let _ = write!(self.0, r#"<a:path path="{p}"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>"#);
                    }
                    None => {
                        let _ = write!(self.0, r#"<a:lin ang="{}" scaled="0"/>"#, (f.angle.unwrap_or(0.0) * 60_000.0).round() as i64);
                    }
                }
                self.0.push_str("</a:gradFill>");
            }
            "pattern" => {
                let _ = write!(self.0, r#"<a:pattFill prst="{}"><a:fgClr>"#, f.pattern.as_deref().unwrap_or("pct50"));
                self.color(f.color.as_deref().unwrap_or("#000000"));
                self.0.push_str("</a:fgClr><a:bgClr>");
                self.color(f.bg.as_deref().unwrap_or("#FFFFFF"));
                self.0.push_str("</a:bgClr></a:pattFill>");
            }
            _ => {
                if let Some(c) = &f.color {
                    self.0.push_str("<a:solidFill>");
                    self.color(c);
                    self.0.push_str("</a:solidFill>");
                }
            }
        }
    }

    fn ln(&mut self, l: &Line) {
        self.0.push_str("<a:ln");
        if let Some(wd) = l.width {
            let _ = write!(self.0, r#" w="{}""#, (wd * 12_700.0).round() as i64);
        }
        self.0.push('>');
        if l.none {
            self.0.push_str("<a:noFill/>");
        } else if let Some(c) = &l.color {
            self.0.push_str("<a:solidFill>");
            self.color(c);
            self.0.push_str("</a:solidFill>");
        }
        if let Some(d) = &l.dash {
            let _ = write!(self.0, r#"<a:prstDash val="{d}"/>"#);
        }
        self.0.push_str("</a:ln>");
    }

    fn sp_pr(&mut self, s: &Shape) {
        self.0.push_str("<c:spPr>");
        if let Some(f) = &s.fill {
            self.fill(f);
        }
        if let Some(l) = &s.line {
            self.ln(l);
        }
        if s.shadow {
            self.0.push_str(r#"<a:effectLst><a:outerShdw blurRad="38100" dist="19050" dir="5400000" algn="t" rotWithShape="0"><a:prstClr val="black"><a:alpha val="35000"/></a:prstClr></a:outerShdw></a:effectLst>"#);
        }
        self.0.push_str("</c:spPr>");
    }

    fn rpr(&mut self, tag: &str, t: &TextStyle) {
        let _ = write!(self.0, "<{tag}");
        if let Some(s) = t.size {
            let _ = write!(self.0, r#" sz="{}""#, (s * 100.0).round() as i64);
        }
        if let Some(v) = t.bold {
            let _ = write!(self.0, r#" b="{}""#, b(v));
        }
        if let Some(v) = t.italic {
            let _ = write!(self.0, r#" i="{}""#, b(v));
        }
        self.0.push('>');
        if let Some(c) = &t.color {
            self.0.push_str("<a:solidFill>");
            self.color(c);
            self.0.push_str("</a:solidFill>");
        }
        if let Some(f) = &t.font {
            self.0.push_str("<a:latin typeface=\"");
            escape_attr(f, &mut self.0);
            self.0.push_str("\"/>");
        }
        let _ = write!(self.0, "</{tag}>");
    }

    fn body_pr(&mut self, t: Option<&TextStyle>) {
        match t.and_then(|t| t.rot) {
            Some(r) => {
                let _ = write!(self.0, r#"<a:bodyPr rot="{}" vert="horz"/>"#, (r * 60_000.0).round() as i64);
            }
            None => self.0.push_str("<a:bodyPr/>"),
        }
    }

    fn tx_pr(&mut self, t: &TextStyle) {
        self.0.push_str("<c:txPr>");
        self.body_pr(Some(t));
        self.0.push_str("<a:lstStyle/><a:p><a:pPr>");
        self.rpr("a:defRPr", t);
        self.0.push_str("</a:pPr><a:endParaRPr lang=\"fr-CA\"/></a:p></c:txPr>");
    }

    fn title(&mut self, t: &Title) {
        self.open("c:title");
        if let Some(f) = &t.f {
            self.0.push_str("<c:tx><c:strRef>");
            self.text("c:f", f);
            if let Some(txt) = &t.text {
                self.0.push_str("<c:strCache><c:ptCount val=\"1\"/><c:pt idx=\"0\">");
                self.text("c:v", txt);
                self.0.push_str("</c:pt></c:strCache>");
            }
            self.0.push_str("</c:strRef></c:tx>");
        } else if let Some(txt) = &t.text {
            self.0.push_str("<c:tx><c:rich>");
            self.body_pr(t.style.as_ref());
            self.0.push_str("<a:lstStyle/>");
            let style = t.style.clone().unwrap_or_default();
            for line in txt.split('\n') {
                self.0.push_str("<a:p><a:pPr>");
                self.rpr("a:defRPr", &style);
                self.0.push_str("</a:pPr><a:r>");
                self.rpr("a:rPr", &style);
                self.text("a:t", line);
                self.0.push_str("</a:r></a:p>");
            }
            self.0.push_str("</c:rich></c:tx>");
        }
        self.layout(t.layout.as_ref());
        self.val("c:overlay", b(t.overlay));
        if let Some(s) = &t.shape {
            self.sp_pr(s);
        }
        if t.text.is_none() || t.f.is_some() {
            if let Some(st) = &t.style {
                self.tx_pr(st);
            }
        }
        self.close("c:title");
    }

    fn layout(&mut self, l: Option<&Layout>) {
        let Some(l) = l else {
            self.0.push_str("<c:layout/>");
            return;
        };
        self.0.push_str("<c:layout><c:manualLayout>");
        if l.inner {
            self.val("c:layoutTarget", "inner");
        }
        self.val("c:xMode", "edge");
        self.val("c:yMode", "edge");
        self.val("c:x", &fmt_num(l.x));
        self.val("c:y", &fmt_num(l.y));
        self.opt_num("c:w", l.w);
        self.opt_num("c:h", l.h);
        self.0.push_str("</c:manualLayout></c:layout>");
    }

    fn data_ref(&mut self, tag: &str, d: &DataRef, numeric: bool) {
        self.open(tag);
        let n = d.count.max(d.num.len() as u32).max(d.str.len() as u32);
        if numeric {
            match &d.f {
                Some(f) => {
                    self.0.push_str("<c:numRef>");
                    self.text("c:f", f);
                    self.0.push_str("<c:numCache>");
                }
                None => self.0.push_str("<c:numLit>"),
            }
            self.text("c:formatCode", d.format.as_deref().unwrap_or("General"));
            self.val("c:ptCount", &n.to_string());
            for (i, v) in d.num.iter().enumerate() {
                if let Some(v) = v {
                    let _ = write!(self.0, r#"<c:pt idx="{i}"><c:v>{}</c:v></c:pt>"#, fmt_num(*v));
                }
            }
            self.0.push_str(if d.f.is_some() { "</c:numCache></c:numRef>" } else { "</c:numLit>" });
        } else if d.levels.len() > 1 && d.f.is_some() {
            self.0.push_str("<c:multiLvlStrRef>");
            self.text("c:f", d.f.as_deref().unwrap_or_default());
            self.0.push_str("<c:multiLvlStrCache>");
            self.val("c:ptCount", &n.to_string());
            for lvl in &d.levels {
                self.0.push_str("<c:lvl>");
                self.pts(lvl);
                self.0.push_str("</c:lvl>");
            }
            self.0.push_str("</c:multiLvlStrCache></c:multiLvlStrRef>");
        } else {
            match &d.f {
                Some(f) => {
                    self.0.push_str("<c:strRef>");
                    self.text("c:f", f);
                    self.0.push_str("<c:strCache>");
                }
                None => self.0.push_str("<c:strLit>"),
            }
            self.val("c:ptCount", &n.to_string());
            self.pts(&d.str);
            self.0.push_str(if d.f.is_some() { "</c:strCache></c:strRef>" } else { "</c:strLit>" });
        }
        self.close(tag);
    }

    fn pts(&mut self, v: &[Option<String>]) {
        for (i, s) in v.iter().enumerate() {
            if let Some(s) = s {
                let _ = write!(self.0, r#"<c:pt idx="{i}">"#);
                self.text("c:v", s);
                self.0.push_str("</c:pt>");
            }
        }
    }

    fn marker(&mut self, m: &Marker) {
        self.open("c:marker");
        if let Some(s) = &m.symbol {
            self.val("c:symbol", s);
        }
        self.opt_num("c:size", m.size);
        if let Some(s) = &m.shape {
            self.sp_pr(s);
        }
        self.close("c:marker");
    }

    fn labels(&mut self, l: &DataLabels) {
        self.open("c:dLbls");
        for p in &l.points {
            self.open("c:dLbl");
            self.val("c:idx", &p.idx.to_string());
            if p.delete {
                self.val("c:delete", "1");
            } else if let Some(t) = &p.text {
                self.0.push_str("<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>");
                self.text("a:t", t);
                self.0.push_str("</a:r></a:p></c:rich></c:tx>");
                self.flags(l);
            }
            self.close("c:dLbl");
        }
        if l.delete {
            self.val("c:delete", "1");
        } else {
            if let Some(f) = &l.num_fmt {
                self.0.push_str("<c:numFmt formatCode=\"");
                escape_attr(f, &mut self.0);
                self.0.push_str("\" sourceLinked=\"0\"/>");
            }
            if let Some(s) = &l.shape {
                self.sp_pr(s);
            }
            if let Some(t) = &l.text {
                self.tx_pr(t);
            }
            if let Some(p) = &l.pos {
                self.val("c:dLblPos", p);
            }
            self.flags(l);
            if let Some(s) = &l.separator {
                self.text("c:separator", s);
            }
        }
        self.close("c:dLbls");
    }

    fn flags(&mut self, l: &DataLabels) {
        self.val("c:showLegendKey", b(l.show_key));
        self.val("c:showVal", b(l.show_val));
        self.val("c:showCatName", b(l.show_cat));
        self.val("c:showSerName", b(l.show_ser));
        self.val("c:showPercent", b(l.show_pct));
        self.val("c:showBubbleSize", b(l.show_bubble));
    }

    fn series(&mut self, g: &Group, s: &Series) {
        let xy = matches!(g.kind.as_str(), "scatter" | "bubble");
        self.open("c:ser");
        self.val("c:idx", &s.idx.to_string());
        self.val("c:order", &s.order.to_string());
        if let Some(f) = &s.name_ref {
            self.0.push_str("<c:tx><c:strRef>");
            self.text("c:f", f);
            if let Some(n) = &s.name {
                self.0.push_str("<c:strCache><c:ptCount val=\"1\"/><c:pt idx=\"0\">");
                self.text("c:v", n);
                self.0.push_str("</c:pt></c:strCache>");
            }
            self.0.push_str("</c:strRef></c:tx>");
        } else if let Some(n) = &s.name {
            self.0.push_str("<c:tx>");
            self.text("c:v", n);
            self.0.push_str("</c:tx>");
        }
        let auto = self.1[(s.idx as usize) % self.1.len().max(1)].clone();
        let lined = matches!(g.kind.as_str(), "line" | "scatter" | "stock") || (g.kind == "radar" && g.radar_style.as_deref() != Some("filled"));
        let auto_shape = || {
            if lined {
                Shape { line: Some(Line { color: Some(auto.clone()), width: Some(2.25), ..Default::default() }), ..Default::default() }
            } else {
                Shape { fill: Some(Fill { kind: "solid".into(), color: Some(auto.clone()), ..Default::default() }), ..Default::default() }
            }
        };
        let vary = g.vary_colors && matches!(g.kind.as_str(), "pie" | "doughnut" | "ofPie");
        match &s.shape {
            Some(sp) if sp.fill.is_some() || sp.line.is_some() || vary => self.sp_pr(sp),
            _ if g.kind == "stock" => {}
            Some(sp) if vary => self.sp_pr(sp),
            _ if !vary => self.sp_pr(&auto_shape()),
            _ => {}
        }
        if matches!(g.kind.as_str(), "bar") && s.invert_if_negative {
            self.val("c:invertIfNegative", "1");
        } else if g.kind == "bar" {
            self.val("c:invertIfNegative", "0");
        }
        if matches!(g.kind.as_str(), "line" | "scatter" | "radar") {
            match &s.marker {
                Some(m) if m.shape.is_some() || m.symbol.as_deref() == Some("none") => self.marker(m),
                m => {
                    // Markers in the series colour, as Office writes them.
                    let mut m = m.clone().unwrap_or_default();
                    let wants = g.markers || matches!(g.scatter_style.as_deref(), Some("lineMarker") | Some("marker") | Some("smoothMarker")) || g.radar_style.as_deref() == Some("marker") || m.symbol.is_some();
                    if wants {
                        m.symbol.get_or_insert_with(|| "circle".into());
                        m.size.get_or_insert(5.0);
                        m.shape = Some(Shape { fill: Some(Fill { kind: "solid".into(), color: Some(auto.clone()), ..Default::default() }), line: Some(Line { color: Some(auto.clone()), width: Some(0.75), ..Default::default() }), ..Default::default() });
                    } else {
                        m.symbol = Some("none".into());
                    }
                    self.marker(&m);
                }
            }
        }
        if let Some(e) = s.explosion {
            if matches!(g.kind.as_str(), "pie" | "doughnut" | "ofPie") {
                self.val("c:explosion", &fmt_num(e));
            }
        }
        let n = s.val.as_ref().map(|v| v.count.max(v.num.len() as u32)).unwrap_or(0);
        let mut points = s.points.clone();
        if vary {
            for i in 0..n {
                if !points.iter().any(|p| p.idx == i && p.shape.as_ref().map(|x| x.fill.is_some()).unwrap_or(false)) {
                    let color = self.1[(i as usize) % self.1.len().max(1)].clone();
                    let fill = Some(Fill { kind: "solid".into(), color: Some(color), ..Default::default() });
                    let line = Some(Line { color: Some("#FFFFFF".into()), width: Some(0.75), ..Default::default() });
                    match points.iter_mut().find(|p| p.idx == i) {
                        Some(p) => p.shape = Some(Shape { fill, line, ..p.shape.clone().unwrap_or_default() }),
                        None => points.push(DataPoint { idx: i, shape: Some(Shape { fill, line, ..Default::default() }), ..Default::default() }),
                    }
                }
            }
            points.sort_by_key(|p| p.idx);
        }
        for p in &points {
            self.open("c:dPt");
            self.val("c:idx", &p.idx.to_string());
            if g.kind == "bar" {
                self.val("c:invertIfNegative", b(p.invert_if_negative.unwrap_or(false)));
            }
            if let Some(m) = &p.marker {
                self.marker(m);
            }
            if g.kind == "bubble" {
                self.val("c:bubble3D", "0");
            }
            if let Some(e) = p.explosion {
                self.val("c:explosion", &fmt_num(e));
            }
            if let Some(sp) = &p.shape {
                self.sp_pr(sp);
            }
            self.close("c:dPt");
        }
        if let Some(l) = &s.labels {
            self.labels(l);
        }
        for t in &s.trendlines {
            self.open("c:trendline");
            if let Some(n) = &t.name {
                self.text("c:name", n);
            }
            if let Some(l) = &t.line {
                self.0.push_str("<c:spPr>");
                self.ln(l);
                self.0.push_str("</c:spPr>");
            }
            self.val("c:trendlineType", &t.kind);
            if t.kind == "poly" {
                self.val("c:order", &t.order.unwrap_or(2).to_string());
            }
            if t.kind == "movingAvg" {
                self.val("c:period", &t.period.unwrap_or(2).to_string());
            }
            self.opt_num("c:forward", t.forward);
            self.opt_num("c:backward", t.backward);
            self.opt_num("c:intercept", t.intercept);
            self.val("c:dispRSqr", b(t.disp_r2));
            self.val("c:dispEq", b(t.disp_eq));
            self.close("c:trendline");
        }
        for e in &s.err_bars {
            self.open("c:errBars");
            if let Some(d) = &e.dir {
                self.val("c:errDir", d);
            }
            self.val("c:errBarType", &e.bar_type);
            self.val("c:errValType", &e.val_type);
            self.val("c:noEndCap", b(e.no_end_cap));
            if let Some(p) = &e.plus {
                self.data_ref("c:plus", p, true);
            }
            if let Some(m) = &e.minus {
                self.data_ref("c:minus", m, true);
            }
            self.opt_num("c:val", e.val);
            if let Some(l) = &e.line {
                self.0.push_str("<c:spPr>");
                self.ln(l);
                self.0.push_str("</c:spPr>");
            }
            self.close("c:errBars");
        }
        let numeric_cat = |d: &DataRef| d.str.is_empty() && d.levels.is_empty() && !d.num.is_empty();
        if let Some(c) = &s.cat {
            self.data_ref(if xy { "c:xVal" } else { "c:cat" }, c, numeric_cat(c));
        }
        if let Some(v) = &s.val {
            self.data_ref(if xy { "c:yVal" } else { "c:val" }, v, true);
        }
        if g.kind == "bubble" {
            if let Some(sz) = &s.size {
                self.data_ref("c:bubbleSize", sz, true);
            }
            self.val("c:bubble3D", b(g.three_d));
        }
        if matches!(g.kind.as_str(), "line" | "scatter") {
            self.val("c:smooth", b(s.smooth));
        }
        self.close("c:ser");
    }

    fn group(&mut self, g: &Group) {
        let tag = format!("c:{}{}Chart", g.kind, if g.three_d { "3D" } else { "" });
        self.open(&tag);
        match g.kind.as_str() {
            "bar" => {
                self.val("c:barDir", g.bar_dir.as_deref().unwrap_or("col"));
                self.val("c:grouping", g.grouping.as_deref().unwrap_or("clustered"));
            }
            "line" | "area" => self.val("c:grouping", g.grouping.as_deref().unwrap_or("standard")),
            "scatter" => self.val("c:scatterStyle", g.scatter_style.as_deref().unwrap_or("lineMarker")),
            "radar" => self.val("c:radarStyle", g.radar_style.as_deref().unwrap_or("marker")),
            "ofPie" => self.val("c:ofPieType", g.of_pie_type.as_deref().unwrap_or("pie")),
            "surface" => self.val("c:wireframe", b(g.wireframe)),
            _ => {}
        }
        if !matches!(g.kind.as_str(), "stock" | "surface") {
            self.val("c:varyColors", b(g.vary_colors));
        }
        for s in &g.series {
            self.series(g, s);
        }
        if let Some(l) = &g.labels {
            self.labels(l);
        }
        if let Some(s) = &g.drop_lines {
            self.open("c:dropLines");
            self.sp_pr(s);
            self.close("c:dropLines");
        }
        if let Some(s) = &g.hi_low_lines {
            self.open("c:hiLowLines");
            self.sp_pr(s);
            self.close("c:hiLowLines");
        }
        if let Some(u) = &g.up_down_bars {
            self.open("c:upDownBars");
            self.val("c:gapWidth", &fmt_num(u.gap_width.unwrap_or(150.0)));
            for (tag, s) in [("c:upBars", &u.up), ("c:downBars", &u.down)] {
                self.open(tag);
                if let Some(s) = s {
                    self.sp_pr(s);
                }
                self.close(tag);
            }
            self.close("c:upDownBars");
        }
        match g.kind.as_str() {
            "bar" => {
                self.val("c:gapWidth", &fmt_num(g.gap_width.unwrap_or(150.0)));
                if !g.three_d {
                    if let Some(o) = g.overlap.or(matches!(g.grouping.as_deref(), Some("stacked") | Some("percentStacked")).then_some(100.0)) {
                        self.val("c:overlap", &fmt_num(o));
                    }
                } else {
                    self.opt_num("c:gapDepth", g.gap_depth);
                    self.val("c:shape", g.shape.as_deref().unwrap_or("box"));
                }
                if let Some(s) = &g.ser_lines {
                    self.open("c:serLines");
                    self.sp_pr(s);
                    self.close("c:serLines");
                }
            }
            "line" if !g.three_d => self.val("c:marker", b(g.markers)),
            "line" | "area" if g.three_d => self.opt_num("c:gapDepth", g.gap_depth),
            "pie" if !g.three_d => self.val("c:firstSliceAng", &fmt_num(g.first_slice_ang.unwrap_or(0.0))),
            "doughnut" => {
                self.val("c:firstSliceAng", &fmt_num(g.first_slice_ang.unwrap_or(0.0)));
                self.val("c:holeSize", &fmt_num(g.hole_size.unwrap_or(50.0)));
            }
            "ofPie" => {
                self.val("c:gapWidth", &fmt_num(g.gap_width.unwrap_or(100.0)));
                if let Some(t) = &g.split_type {
                    self.val("c:splitType", t);
                }
                self.opt_num("c:splitPos", g.split_pos);
                self.val("c:secondPieSize", &fmt_num(g.second_pie_size.unwrap_or(75.0)));
                if let Some(s) = &g.ser_lines {
                    self.open("c:serLines");
                    self.sp_pr(s);
                    self.close("c:serLines");
                }
            }
            "bubble" => {
                self.val("c:bubbleScale", &fmt_num(g.bubble_scale.unwrap_or(100.0)));
                self.val("c:showNegBubbles", b(g.show_neg_bubbles));
                if let Some(s) = &g.size_represents {
                    self.val("c:sizeRepresents", s);
                }
            }
            _ => {}
        }
        for id in &g.axis_ids {
            self.val("c:axId", &id.to_string());
        }
        self.close(&tag);
    }

    fn axis(&mut self, a: &Axis) {
        let tag = format!("c:{}Ax", a.kind);
        self.open(&tag);
        self.val("c:axId", &a.id.to_string());
        self.open("c:scaling");
        self.opt_num("c:logBase", a.log_base);
        self.val("c:orientation", if a.reverse { "maxMin" } else { "minMax" });
        self.opt_num("c:max", a.max);
        self.opt_num("c:min", a.min);
        self.close("c:scaling");
        self.val("c:delete", b(a.delete));
        self.val("c:axPos", a.pos.as_deref().unwrap_or(if a.kind == "val" { "l" } else { "b" }));
        for (tag, g) in [("c:majorGridlines", &a.major_grid), ("c:minorGridlines", &a.minor_grid)] {
            if let Some(g) = g {
                self.open(tag);
                if g.fill.is_some() || g.line.is_some() {
                    self.sp_pr(g);
                }
                self.close(tag);
            }
        }
        if let Some(t) = &a.title {
            self.title(t);
        }
        if let Some(f) = &a.num_fmt {
            self.0.push_str("<c:numFmt formatCode=\"");
            escape_attr(f, &mut self.0);
            let _ = write!(self.0, "\" sourceLinked=\"{}\"/>", b(a.source_linked));
        }
        self.val("c:majorTickMark", a.major_tick.as_deref().unwrap_or("none"));
        self.val("c:minorTickMark", a.minor_tick.as_deref().unwrap_or("none"));
        self.val("c:tickLblPos", a.tick_lbl_pos.as_deref().unwrap_or("nextTo"));
        if let Some(s) = &a.shape {
            self.sp_pr(s);
        }
        if let Some(t) = &a.text {
            self.tx_pr(t);
        }
        if let Some(c) = a.cross_ax {
            self.val("c:crossAx", &c.to_string());
        }
        match a.crosses_at {
            Some(v) => self.val("c:crossesAt", &fmt_num(v)),
            None => self.val("c:crosses", a.crosses.as_deref().unwrap_or("autoZero")),
        }
        match a.kind.as_str() {
            "val" => {
                self.val("c:crossBetween", a.cross_between.as_deref().unwrap_or("between"));
                self.opt_num("c:majorUnit", a.major_unit);
                self.opt_num("c:minorUnit", a.minor_unit);
                if let Some(u) = &a.disp_units {
                    self.0.push_str("<c:dispUnits>");
                    if u.parse::<f64>().is_ok() {
                        self.val("c:custUnit", u);
                    } else {
                        self.val("c:builtInUnit", u);
                    }
                    self.0.push_str("</c:dispUnits>");
                }
            }
            "cat" => {
                self.val("c:auto", "1");
                self.val("c:lblAlgn", "ctr");
                self.val("c:lblOffset", "100");
                if let Some(s) = a.tick_lbl_skip {
                    self.val("c:tickLblSkip", &s.to_string());
                }
                self.val("c:noMultiLvlLbl", "0");
            }
            "date" => {
                self.val("c:auto", "1");
                self.val("c:lblOffset", "100");
                if let Some(u) = &a.base_time_unit {
                    self.val("c:baseTimeUnit", u);
                }
                self.opt_num("c:majorUnit", a.major_unit);
                self.opt_num("c:minorUnit", a.minor_unit);
            }
            _ => {}
        }
        self.close(&tag);
    }
}
