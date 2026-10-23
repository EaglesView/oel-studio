//! Chart part (`c:chartSpace` or `cx:chartSpace`) → [`ChartSpec`].
//!
//! Element names are matched by local name, so the default-namespace charts
//! written by openpyxl read like Excel's `c:`-prefixed ones.

use crate::model::*;
use oel_opc::color::{Rgba, child_color, color_of};
use oel_opc::package::{Package, resolve_target};
use oel_opc::xml::XElement;

pub const REL_CHART: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
pub const REL_CHART_EX: &str = "http://schemas.microsoft.com/office/2014/relationships/chartEx";
pub const REL_CHART_STYLE: &str = "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
pub const REL_CHART_COLORS: &str = "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";
pub const REL_PACKAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
pub const CT_CHART: &str = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
pub const URI_CHART: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
pub const URI_CHART_EX: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";

/// What the host knows about its theme.
pub struct Theme<'a> {
    /// Scheme colour name (`accent1`, `tx1`, `bg1`, `dk1`…) → `RRGGBB`.
    pub scheme: &'a dyn Fn(&str) -> Option<String>,
    /// Theme body font (`+mn-lt`).
    pub minor_font: Option<String>,
    /// Theme heading font (`+mj-lt`).
    pub major_font: Option<String>,
}

/// The chart part a `graphicData` points to (`c:chart r:id` / `cx:chart r:id`), resolved against `owner`.
pub fn chart_part(pkg: &Package, owner: &str, graphic_data: &XElement) -> Option<String> {
    let chart = graphic_data.elements().find(|e| e.local() == "chart")?;
    let id = chart.attrs.iter().find(|(k, _)| k.ends_with(":id") || k == "id").map(|(_, v)| v.as_str())?;
    let rel = pkg.rels(owner).into_iter().find(|r| r.id == id && !r.external)?;
    let path = resolve_target(owner, &rel.target);
    pkg.has(&path).then_some(path)
}

/// Read a chart part. `None` when the part is missing or is not a chart.
pub fn read_chart(pkg: &Package, part: &str, theme: &Theme) -> Option<ChartSpec> {
    let doc = pkg.get_xml(part)?;
    if doc.root.local() != "chartSpace" {
        return None;
    }
    let ctx = Ctx { pkg, part, theme };
    let mut spec = if doc.root.child_local("chartData").is_some() { ctx.chart_ex(&doc.root) } else { ctx.chart(&doc.root) };
    spec.part = part.to_string();
    spec.palette = ctx.palette();
    spec.font = theme.minor_font.clone();
    Some(spec)
}

struct Ctx<'a> {
    pkg: &'a Package,
    part: &'a str,
    theme: &'a Theme<'a>,
}

fn val<'a>(e: &'a XElement, child: &str) -> Option<&'a str> {
    e.child_local(child).and_then(|c| c.attr("val"))
}

fn num(e: &XElement, child: &str) -> Option<f64> {
    val(e, child).and_then(|v| v.trim().trim_end_matches('%').parse().ok())
}

/// An axis id. The schema says unsigned, but python-pptx and others write negative ones
/// (`-2113994440`): kept as the same 32 bits, so every id stays distinct.
fn ax_id(v: &str) -> Option<u32> {
    let v = v.trim();
    v.parse::<u32>().ok().or_else(|| v.parse::<i64>().ok().map(|n| n as u32))
}

/// `<c:x val="1"/>`: present without `val` means true (CT_Boolean default).
fn flag(e: &XElement, child: &str) -> Option<bool> {
    e.child_local(child).map(|c| !matches!(c.attr("val"), Some("0") | Some("false")))
}

fn attr_f(e: &XElement, k: &str) -> Option<f64> {
    e.attr(k).and_then(|v| v.trim().parse().ok())
}

impl Ctx<'_> {
    fn scheme(&self, name: &str) -> Option<String> {
        let mapped = match name {
            "tx1" => "dk1",
            "bg1" => "lt1",
            "tx2" => "dk2",
            "bg2" => "lt2",
            n => n,
        };
        (self.theme.scheme)(name).or_else(|| (self.theme.scheme)(mapped))
    }

    fn fill_color(&self, fill: &XElement) -> Option<String> {
        child_color(fill, &|n| self.scheme(n)).map(|c| c.to_css())
    }

    fn font(&self, face: &str) -> Option<String> {
        match face {
            "+mn-lt" | "+mn-ea" | "+mn-cs" => self.theme.minor_font.clone(),
            "+mj-lt" | "+mj-ea" | "+mj-cs" => self.theme.major_font.clone(),
            f if !f.is_empty() => Some(f.to_string()),
            _ => None,
        }
    }

    // ---------------------------------------------------------------- shapes

    fn shape(&self, sp_pr: Option<&XElement>) -> Option<Shape> {
        let sp = sp_pr?;
        let mut s = Shape::default();
        for c in sp.elements() {
            match c.local() {
                "noFill" | "solidFill" | "gradFill" | "pattFill" | "blipFill" => s.fill = self.fill(c),
                "ln" => s.line = self.line(c),
                "effectLst" => s.shadow = c.child_local("outerShdw").is_some(),
                _ => {}
            }
        }
        Some(s)
    }

    fn fill(&self, f: &XElement) -> Option<Fill> {
        let mut out = Fill { kind: String::new(), ..Default::default() };
        match f.local() {
            "noFill" => out.kind = "none".into(),
            "solidFill" => {
                out.kind = "solid".into();
                out.color = self.fill_color(f);
            }
            "gradFill" => {
                out.kind = "gradient".into();
                if let Some(list) = f.child_local("gsLst") {
                    for gs in list.children_local("gs") {
                        if let Some(color) = self.fill_color(gs) {
                            out.stops.push(Stop { pos: attr_f(gs, "pos").unwrap_or(0.0) / 100_000.0, color });
                        }
                    }
                }
                out.color = out.stops.first().map(|s| s.color.clone());
                if let Some(lin) = f.child_local("lin") {
                    out.angle = Some(attr_f(lin, "ang").unwrap_or(0.0) / 60_000.0);
                } else if let Some(p) = f.child_local("path") {
                    out.path = p.attr("path").map(String::from);
                }
            }
            "pattFill" => {
                out.kind = "pattern".into();
                out.pattern = f.attr("prst").map(String::from);
                out.color = f.child_local("fgClr").and_then(|c| self.fill_color(c));
                out.bg = f.child_local("bgClr").and_then(|c| self.fill_color(c));
            }
            "blipFill" => {
                out.kind = "picture".into();
                out.media = f.child_local("blip").and_then(|b| self.media(b));
            }
            _ => return None,
        }
        Some(out)
    }

    fn media(&self, blip: &XElement) -> Option<String> {
        let id = blip.attrs.iter().find(|(k, _)| k.ends_with(":embed")).map(|(_, v)| v.as_str())?;
        let rel = self.pkg.rels(self.part).into_iter().find(|r| r.id == id)?;
        Some(resolve_target(self.part, &rel.target))
    }

    fn line(&self, ln: &XElement) -> Option<Line> {
        let mut l = Line { width: attr_f(ln, "w").map(|w| w / 12_700.0), ..Default::default() };
        for c in ln.elements() {
            match c.local() {
                "noFill" => l.none = true,
                "solidFill" => l.color = self.fill_color(c),
                "gradFill" => l.color = c.child_local("gsLst").and_then(|g| g.children_local("gs").next()).and_then(|gs| self.fill_color(gs)),
                "prstDash" => l.dash = c.attr("val").map(String::from),
                _ => {}
            }
        }
        Some(l)
    }

    // ------------------------------------------------------------------ text

    /// Style of `c:txPr` / `c:tx/c:rich`: the first run properties found.
    fn text_style(&self, body: Option<&XElement>) -> Option<TextStyle> {
        let body = body?;
        let mut t = TextStyle::default();
        if let Some(bp) = body.child_local("bodyPr") {
            t.rot = attr_f(bp, "rot").map(|r| r / 60_000.0);
        }
        let rpr = body.children_local("p").find_map(|p| {
            p.child_local("pPr").and_then(|pp| pp.child_local("defRPr")).or_else(|| p.children_local("r").find_map(|r| r.child_local("rPr"))).or_else(|| p.child_local("endParaRPr"))
        });
        if let Some(r) = rpr {
            t.size = attr_f(r, "sz").map(|s| s / 100.0);
            t.bold = r.attr("b").map(|b| b == "1" || b == "true");
            t.italic = r.attr("i").map(|b| b == "1" || b == "true");
            t.color = r.child_local("solidFill").and_then(|f| self.fill_color(f));
            t.font = r.child_local("latin").and_then(|l| l.attr("typeface")).and_then(|f| self.font(f));
        }
        (t != TextStyle::default()).then_some(t)
    }

    fn rich_text(rich: &XElement) -> String {
        rich.children_local("p")
            .map(|p| p.elements().filter(|e| matches!(e.local(), "r" | "fld")).filter_map(|r| r.child_local("t")).map(|t| t.text_content()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn title(&self, t: Option<&XElement>) -> Option<Title> {
        let t = t?;
        let mut out = Title { overlay: flag(t, "overlay").unwrap_or(false), layout: layout(t.child_local("layout")), shape: self.shape(t.child_local("spPr")), ..Default::default() };
        if let Some(tx) = t.child_local("tx") {
            if let Some(rich) = tx.child_local("rich") {
                let s = Self::rich_text(rich);
                out.text = (!s.is_empty()).then_some(s);
                out.style = self.text_style(Some(rich));
            } else if let Some(r) = tx.child_local("strRef") {
                out.f = r.child_local("f").map(|f| f.text_content());
                out.text = r.child_local("strCache").and_then(|c| c.children_local("pt").next()).and_then(|p| p.child_local("v")).map(|v| v.text_content());
            } else if let Some(data) = tx.child_local("txData") {
                out.f = data.child_local("f").map(|f| f.text_content());
                out.text = data.child_local("v").map(|v| v.text_content());
            }
        }
        if out.style.is_none() {
            out.style = self.text_style(t.child_local("txPr"));
        }
        Some(out)
    }

    // ------------------------------------------------------------------ data

    fn data_ref(&self, e: Option<&XElement>) -> Option<DataRef> {
        let e = e?;
        let mut d = DataRef::default();
        let inner = e.elements().next()?;
        match inner.local() {
            "numRef" | "numLit" => {
                d.f = inner.child_local("f").map(|f| f.text_content());
                let cache = if inner.local() == "numLit" { Some(inner) } else { inner.child_local("numCache") };
                if let Some(c) = cache {
                    d.format = c.child_local("formatCode").map(|f| f.text_content());
                    d.count = point_count(c.child_local("ptCount").and_then(|p| p.attr("val")));
                    d.num = fill(d.count, c.children_local("pt").map(|pt| (pt.attr("idx"), pt.child_local("v").and_then(|v| v.text_content().trim().parse::<f64>().ok()))));
                }
            }
            "strRef" | "strLit" => {
                d.f = inner.child_local("f").map(|f| f.text_content());
                let cache = if inner.local() == "strLit" { Some(inner) } else { inner.child_local("strCache") };
                if let Some(c) = cache {
                    d.count = point_count(c.child_local("ptCount").and_then(|p| p.attr("val")));
                    d.str = pts(c, d.count);
                }
            }
            "multiLvlStrRef" => {
                d.f = inner.child_local("f").map(|f| f.text_content());
                if let Some(c) = inner.child_local("multiLvlStrCache") {
                    d.count = point_count(c.child_local("ptCount").and_then(|p| p.attr("val")));
                    d.levels = c.children_local("lvl").map(|l| pts(l, d.count)).collect();
                    d.str = d.levels.first().cloned().unwrap_or_default();
                }
            }
            _ => return None,
        }
        Some(d)
    }

    fn marker(&self, m: Option<&XElement>) -> Option<Marker> {
        let m = m?;
        Some(Marker { symbol: val(m, "symbol").map(String::from), size: num(m, "size"), shape: self.shape(m.child_local("spPr")) })
    }

    fn labels(&self, l: Option<&XElement>) -> Option<DataLabels> {
        let l = l?;
        let mut d = DataLabels {
            delete: flag(l, "delete").unwrap_or(false),
            show_val: flag(l, "showVal").unwrap_or(false),
            show_cat: flag(l, "showCatName").unwrap_or(false),
            show_ser: flag(l, "showSerName").unwrap_or(false),
            show_pct: flag(l, "showPercent").unwrap_or(false),
            show_bubble: flag(l, "showBubbleSize").unwrap_or(false),
            show_key: flag(l, "showLegendKey").unwrap_or(false),
            pos: val(l, "dLblPos").map(String::from),
            num_fmt: l.child_local("numFmt").and_then(|n| n.attr("formatCode")).map(String::from),
            separator: l.child_local("separator").map(|s| s.text_content()),
            text: self.text_style(l.child_local("txPr")),
            shape: self.shape(l.child_local("spPr")),
            points: Vec::new(),
        };
        for p in l.children_local("dLbl") {
            let idx = num(p, "idx").unwrap_or(0.0) as u32;
            let text = p.child_local("tx").and_then(|t| t.child_local("rich")).map(Self::rich_text);
            d.points.push(PointLabel { idx, delete: flag(p, "delete").unwrap_or(false), text });
        }
        Some(d)
    }

    fn series(&self, s: &XElement) -> Series {
        let mut out = Series { idx: num(s, "idx").unwrap_or(0.0) as u32, order: num(s, "order").unwrap_or(0.0) as u32, ..Default::default() };
        if let Some(tx) = s.child_local("tx") {
            if let Some(r) = tx.child_local("strRef") {
                out.name_ref = r.child_local("f").map(|f| f.text_content());
                out.name = r.child_local("strCache").and_then(|c| c.children_local("pt").next()).and_then(|p| p.child_local("v")).map(|v| v.text_content());
            } else if let Some(v) = tx.child_local("v") {
                out.name = Some(v.text_content());
            }
        }
        out.shape = self.shape(s.child_local("spPr"));
        out.marker = self.marker(s.child_local("marker"));
        out.cat = self.data_ref(s.child_local("cat").or_else(|| s.child_local("xVal")));
        out.val = self.data_ref(s.child_local("val").or_else(|| s.child_local("yVal")));
        out.size = self.data_ref(s.child_local("bubbleSize"));
        out.smooth = flag(s, "smooth").unwrap_or(false);
        out.explosion = num(s, "explosion");
        out.invert_if_negative = flag(s, "invertIfNegative").unwrap_or(false);
        out.labels = self.labels(s.child_local("dLbls"));
        for p in s.children_local("dPt") {
            out.points.push(DataPoint {
                idx: num(p, "idx").unwrap_or(0.0) as u32,
                shape: self.shape(p.child_local("spPr")),
                explosion: num(p, "explosion"),
                marker: self.marker(p.child_local("marker")),
                invert_if_negative: flag(p, "invertIfNegative"),
            });
        }
        for t in s.children_local("trendline") {
            out.trendlines.push(Trendline {
                kind: val(t, "trendlineType").unwrap_or("linear").to_string(),
                name: t.child_local("name").map(|n| n.text_content()),
                order: num(t, "order").map(|v| v as u32),
                period: num(t, "period").map(|v| v as u32),
                forward: num(t, "forward"),
                backward: num(t, "backward"),
                intercept: num(t, "intercept"),
                disp_eq: flag(t, "dispEq").unwrap_or(false),
                disp_r2: flag(t, "dispRSqr").unwrap_or(false),
                line: t.child_local("spPr").and_then(|sp| sp.child_local("ln")).and_then(|l| self.line(l)),
            });
        }
        for e in s.children_local("errBars") {
            out.err_bars.push(ErrBars {
                dir: val(e, "errDir").map(String::from),
                bar_type: val(e, "errBarType").unwrap_or("both").to_string(),
                val_type: val(e, "errValType").unwrap_or("fixedVal").to_string(),
                val: num(e, "val"),
                no_end_cap: flag(e, "noEndCap").unwrap_or(false),
                plus: self.data_ref(e.child_local("plus")),
                minus: self.data_ref(e.child_local("minus")),
                line: e.child_local("spPr").and_then(|sp| sp.child_local("ln")).and_then(|l| self.line(l)),
            });
        }
        out
    }

    // ----------------------------------------------------------------- chart

    fn chart(&self, root: &XElement) -> ChartSpec {
        let mut spec = ChartSpec { plot_vis_only: true, ..Default::default() };
        spec.rounded = flag(root, "roundedCorners").unwrap_or(false);
        spec.style = num(root, "style").map(|v| v as u32).or_else(|| {
            root.child_local("AlternateContent").and_then(|ac| ac.child_local("Choice").or_else(|| ac.child_local("Fallback"))).and_then(|c| num(c, "style")).map(|v| if v > 100.0 { v as u32 - 100 } else { v as u32 })
        });
        spec.space = self.shape(root.child_local("spPr"));
        spec.text = self.text_style(root.child_local("txPr"));
        let Some(chart) = root.child_local("chart") else { return spec };
        spec.title = self.title(chart.child_local("title"));
        spec.auto_title_deleted = flag(chart, "autoTitleDeleted").unwrap_or(false);
        spec.plot_vis_only = flag(chart, "plotVisOnly").unwrap_or(true);
        spec.disp_blanks_as = val(chart, "dispBlanksAs").map(String::from);
        if let Some(v) = chart.child_local("view3D") {
            spec.view3d = Some(View3D {
                rot_x: num(v, "rotX"),
                rot_y: num(v, "rotY"),
                depth_percent: num(v, "depthPercent"),
                h_percent: num(v, "hPercent"),
                r_ang_ax: flag(v, "rAngAx"),
                perspective: num(v, "perspective"),
            });
        }
        spec.floor = chart.child_local("floor").and_then(|f| self.shape(f.child_local("spPr")));
        spec.side_wall = chart.child_local("sideWall").and_then(|f| self.shape(f.child_local("spPr")));
        spec.back_wall = chart.child_local("backWall").and_then(|f| self.shape(f.child_local("spPr")));
        if let Some(l) = chart.child_local("legend") {
            spec.legend = Some(Legend {
                pos: val(l, "legendPos").map(String::from).or(Some("r".into())),
                overlay: flag(l, "overlay").unwrap_or(false),
                deleted: l.children_local("legendEntry").filter(|e| flag(e, "delete") == Some(true)).filter_map(|e| num(e, "idx")).map(|v| v as u32).collect(),
                layout: layout(l.child_local("layout")),
                text: self.text_style(l.child_local("txPr")),
                shape: self.shape(l.child_local("spPr")),
            });
        }
        let Some(pa) = chart.child_local("plotArea") else { return spec };
        spec.plot = self.shape(pa.child_local("spPr"));
        spec.plot_layout = layout(pa.child_local("layout"));
        if let Some(t) = pa.child_local("dTable") {
            spec.data_table = Some(DataTable {
                horz: flag(t, "showHorzBorder").unwrap_or(false),
                vert: flag(t, "showVertBorder").unwrap_or(false),
                outline: flag(t, "showOutline").unwrap_or(false),
                keys: flag(t, "showKeys").unwrap_or(false),
            });
        }
        for g in pa.elements() {
            let name = g.local();
            if let Some(kind) = name.strip_suffix("Chart") {
                spec.groups.push(self.group(g, kind));
            } else if matches!(name, "catAx" | "valAx" | "dateAx" | "serAx") {
                spec.axes.push(self.axis(g, &name[..name.len() - 2]));
            }
        }
        spec
    }

    fn group(&self, g: &XElement, kind: &str) -> Group {
        let three_d = kind.ends_with("3D");
        let mut out = Group { kind: kind.trim_end_matches("3D").to_string(), three_d, ..Default::default() };
        out.bar_dir = val(g, "barDir").map(String::from);
        out.grouping = val(g, "grouping").map(String::from);
        out.vary_colors = flag(g, "varyColors").unwrap_or(false);
        out.gap_width = num(g, "gapWidth");
        out.gap_depth = num(g, "gapDepth");
        out.overlap = num(g, "overlap");
        out.shape = val(g, "shape").map(String::from);
        out.hole_size = num(g, "holeSize");
        out.first_slice_ang = num(g, "firstSliceAng");
        out.of_pie_type = val(g, "ofPieType").map(String::from);
        out.split_type = val(g, "splitType").map(String::from);
        out.split_pos = num(g, "splitPos");
        out.second_pie_size = num(g, "secondPieSize");
        out.bubble_scale = num(g, "bubbleScale");
        out.show_neg_bubbles = flag(g, "showNegBubbles").unwrap_or(false);
        out.size_represents = val(g, "sizeRepresents").map(String::from);
        out.radar_style = val(g, "radarStyle").map(String::from);
        out.scatter_style = val(g, "scatterStyle").map(String::from);
        out.wireframe = flag(g, "wireframe").unwrap_or(false);
        out.markers = flag(g, "marker").unwrap_or(false);
        out.hi_low_lines = g.child_local("hiLowLines").map(|h| self.shape(h.child_local("spPr")).unwrap_or_default());
        out.drop_lines = g.child_local("dropLines").map(|h| self.shape(h.child_local("spPr")).unwrap_or_default());
        out.ser_lines = g.child_local("serLines").map(|h| self.shape(h.child_local("spPr")).unwrap_or_default());
        out.up_down_bars = g.child_local("upDownBars").map(|u| UpDownBars {
            gap_width: num(u, "gapWidth"),
            up: u.child_local("upBars").and_then(|b| self.shape(b.child_local("spPr"))),
            down: u.child_local("downBars").and_then(|b| self.shape(b.child_local("spPr"))),
        });
        out.labels = self.labels(g.child_local("dLbls"));
        out.axis_ids = g.children_local("axId").filter_map(|a| a.attr("val")).filter_map(ax_id).collect();
        out.series = g.children_local("ser").map(|s| self.series(s)).collect();
        out
    }

    fn axis(&self, a: &XElement, kind: &str) -> Axis {
        let scaling = a.child_local("scaling");
        Axis {
            id: val(a, "axId").and_then(ax_id).unwrap_or(0),
            kind: kind.to_string(),
            delete: flag(a, "delete").unwrap_or(false),
            pos: val(a, "axPos").map(String::from),
            cross_ax: val(a, "crossAx").and_then(ax_id),
            crosses: val(a, "crosses").map(String::from),
            crosses_at: num(a, "crossesAt"),
            cross_between: val(a, "crossBetween").map(String::from),
            reverse: scaling.and_then(|s| val(s, "orientation")) == Some("maxMin"),
            min: scaling.and_then(|s| num(s, "min")),
            max: scaling.and_then(|s| num(s, "max")),
            log_base: scaling.and_then(|s| num(s, "logBase")),
            major_unit: num(a, "majorUnit"),
            minor_unit: num(a, "minorUnit"),
            num_fmt: a.child_local("numFmt").and_then(|n| n.attr("formatCode")).map(String::from),
            source_linked: a.child_local("numFmt").and_then(|n| n.attr("sourceLinked")).map(|v| v == "1").unwrap_or(false),
            major_grid: a.child_local("majorGridlines").map(|g| self.shape(g.child_local("spPr")).unwrap_or_default()),
            minor_grid: a.child_local("minorGridlines").map(|g| self.shape(g.child_local("spPr")).unwrap_or_default()),
            tick_lbl_pos: val(a, "tickLblPos").map(String::from),
            major_tick: val(a, "majorTickMark").map(String::from),
            minor_tick: val(a, "minorTickMark").map(String::from),
            title: self.title(a.child_local("title")),
            shape: self.shape(a.child_local("spPr")),
            text: self.text_style(a.child_local("txPr")),
            disp_units: a.child_local("dispUnits").and_then(|d| val(d, "builtInUnit").map(String::from).or_else(|| val(d, "custUnit").map(String::from))),
            base_time_unit: val(a, "baseTimeUnit").map(String::from),
            tick_lbl_skip: num(a, "tickLblSkip").map(|v| v as u32),
            gap_width: None,
        }
    }

    // --------------------------------------------------------------- chartEx

    fn chart_ex(&self, root: &XElement) -> ChartSpec {
        let mut spec = ChartSpec { ex: true, plot_vis_only: true, ..Default::default() };
        spec.space = self.shape(root.child_local("spPr"));
        spec.text = self.text_style(root.child_local("txPr"));
        // Data blocks: id → (dimension type → reference).
        let mut data: Vec<(String, Vec<(String, DataRef)>)> = Vec::new();
        if let Some(cd) = root.child_local("chartData") {
            for d in cd.children_local("data") {
                let id = d.attr("id").unwrap_or_default().to_string();
                let mut dims = Vec::new();
                for dim in d.elements() {
                    let ty = dim.attr("type").unwrap_or_default().to_string();
                    let mut r = DataRef { f: dim.child_local("f").map(|f| f.text_content()), ..Default::default() };
                    let lvls: Vec<&XElement> = dim.children_local("lvl").collect();
                    if dim.local() == "numDim" {
                        if let Some(l) = lvls.first() {
                            r.format = l.attr("formatCode").map(String::from);
                            r.count = point_count(l.attr("ptCount"));
                            r.num = fill(r.count, l.children_local("pt").map(|pt| (pt.attr("idx"), pt.text_content().trim().parse().ok())));
                        }
                    } else {
                        for l in &lvls {
                            let count = point_count(l.attr("ptCount"));
                            r.count = r.count.max(count);
                            r.levels.push(fill(count, l.children_local("pt").map(|pt| (pt.attr("idx"), Some(pt.text_content())))));
                        }
                        r.str = r.levels.first().cloned().unwrap_or_default();
                        if r.levels.len() < 2 {
                            r.levels.clear();
                        }
                    }
                    dims.push((ty, r));
                }
                data.push((id, dims));
            }
        }
        let Some(chart) = root.child_local("chart") else { return spec };
        spec.title = self.title(chart.child_local("title"));
        if let Some(l) = chart.child_local("legend") {
            spec.legend = Some(Legend { pos: l.attr("pos").map(String::from).or(Some("t".into())), overlay: l.attr("overlay") == Some("1"), text: self.text_style(l.child_local("txPr")), ..Default::default() });
        }
        let Some(pa) = chart.child_local("plotArea") else { return spec };
        let region = pa.child_local("plotAreaRegion");
        spec.plot = region.and_then(|r| r.child_local("plotSurface")).and_then(|p| self.shape(p.child_local("spPr")));
        for (n, s) in region.into_iter().flat_map(|r| r.children_local("series")).enumerate() {
            let kind = s.attr("layoutId").unwrap_or("clusteredColumn").to_string();
            let mut ser = Series { idx: n as u32, order: n as u32, hidden: s.attr("hidden") == Some("1"), ..Default::default() };
            if let Some(td) = s.child_local("tx").and_then(|t| t.child_local("txData")) {
                ser.name_ref = td.child_local("f").map(|f| f.text_content());
                ser.name = td.child_local("v").map(|v| v.text_content());
            }
            ser.shape = self.shape(s.child_local("spPr"));
            for p in s.children_local("dataPt") {
                ser.points.push(DataPoint { idx: attr_f(p, "idx").unwrap_or(0.0) as u32, shape: self.shape(p.child_local("spPr")), ..Default::default() });
            }
            if let Some(dl) = s.child_local("dataLabels") {
                let vis = dl.child_local("visibility");
                let on = |k: &str| vis.and_then(|v| v.attr(k)).map(|v| v == "1").unwrap_or(false);
                ser.labels = Some(DataLabels {
                    show_val: on("value"),
                    show_cat: on("categoryName"),
                    show_ser: on("seriesName"),
                    pos: dl.attr("pos").map(String::from),
                    num_fmt: dl.child_local("numFmt").and_then(|n| n.attr("formatCode")).map(String::from),
                    text: self.text_style(dl.child_local("txPr")),
                    ..Default::default()
                });
            }
            if let Some(id) = s.child_local("dataId").and_then(|d| d.attr("val")) {
                if let Some((_, dims)) = data.iter().find(|(i, _)| i == id) {
                    for (ty, r) in dims {
                        match ty.as_str() {
                            "cat" | "x" => ser.cat = Some(r.clone()),
                            "val" | "y" => ser.val = Some(r.clone()),
                            "size" => ser.size = Some(r.clone()),
                            _ => {}
                        }
                    }
                }
            }
            let mut ex = ExProps { owner: s.attr("ownerIdx").and_then(|v| v.parse().ok()), ..Default::default() };
            if let Some(lp) = s.child_local("layoutPr") {
                ex.aggregation = lp.child_local("aggregation").is_some();
                if let Some(b) = lp.child_local("binning") {
                    ex.bin_count = b.child_local("binCount").and_then(|c| c.attr("val")).and_then(|v| v.parse().ok());
                    ex.bin_size = b.child_local("binSize").and_then(|c| attr_f(c, "val"));
                    ex.underflow = attr_f(b, "underflow");
                    ex.overflow = attr_f(b, "overflow");
                }
                ex.subtotals = lp.child_local("subtotals").map(|st| st.children_local("idx").filter_map(|i| i.attr("val")).filter_map(|v| v.parse().ok()).collect()).unwrap_or_default();
                ex.parent_label = lp.child_local("parentLabelLayout").and_then(|p| p.attr("val")).map(String::from);
                ex.quartile = lp.child_local("statistics").and_then(|p| p.attr("quartileMethod")).map(String::from);
                if let Some(v) = lp.child_local("visibility") {
                    let on = |k: &str| v.attr(k).map(|x| x == "1").unwrap_or(false);
                    ex.mean_line = on("meanLine");
                    ex.mean_marker = on("meanMarker");
                    ex.outliers = on("outliers");
                    ex.non_outliers = on("nonoutliers");
                }
            }
            ser.ex = Some(ex);
            let axis_ids = s.children_local("axisId").filter_map(|a| a.attr("val")).filter_map(|v| v.parse().ok()).collect();
            spec.groups.push(Group { kind, axis_ids, series: vec![ser], ..Default::default() });
        }
        for a in pa.children_local("axis") {
            let cat = a.child_local("catScaling");
            let vs = a.child_local("valScaling");
            spec.axes.push(Axis {
                id: attr_f(a, "id").unwrap_or(0.0) as u32,
                kind: if cat.is_some() { "cat" } else { "val" }.into(),
                delete: a.attr("hidden") == Some("1"),
                min: vs.and_then(|v| attr_f(v, "min")),
                max: vs.and_then(|v| attr_f(v, "max")),
                major_unit: vs.and_then(|v| attr_f(v, "majorUnit")),
                gap_width: cat.and_then(|c| attr_f(c, "gapWidth")),
                num_fmt: a.child_local("numFmt").and_then(|n| n.attr("formatCode")).map(String::from),
                major_grid: a.child_local("majorGridlines").map(|g| self.shape(g.child_local("spPr")).unwrap_or_default()),
                minor_grid: a.child_local("minorGridlines").map(|g| self.shape(g.child_local("spPr")).unwrap_or_default()),
                tick_lbl_pos: if a.child_local("tickLabels").is_some() { None } else { Some("none".into()) },
                title: self.title(a.child_local("title")),
                shape: self.shape(a.child_local("spPr")),
                text: self.text_style(a.child_local("txPr")),
                disp_units: a.child_local("units").and_then(|u| u.attr("unit")).map(String::from),
                ..Default::default()
            });
        }
        spec
    }

    // --------------------------------------------------------------- palette

    /// Automatic series colours: the chart's colour style part when there is one
    /// (`cs:colorStyle`), else Office's default (accents 1–6, then darker and lighter variations).
    fn palette(&self) -> Vec<String> {
        let accents: Vec<Rgba> = (1..=6).filter_map(|i| self.scheme(&format!("accent{i}")).and_then(|h| Rgba::from_hex(&h))).collect();
        let part = self.pkg.rels(self.part).into_iter().find(|r| r.rel_type == REL_CHART_COLORS).map(|r| resolve_target(self.part, &r.target));
        if let Some(doc) = part.and_then(|p| self.pkg.get_xml(&p)) {
            let base: Vec<Rgba> = doc.root.elements().filter(|e| e.local() != "variation").filter_map(|e| color_of(e, &|n| self.scheme(n))).collect();
            let variations: Vec<&XElement> = doc.root.children_local("variation").collect();
            if !base.is_empty() {
                return expand(&base, &variations);
            }
        }
        if accents.is_empty() {
            return Vec::new();
        }
        // Office's default « colorful palette 1 » variations.
        let default = oel_opc::xml::XDocument::parse(DEFAULT_VARIATIONS).expect("static XML");
        let variations: Vec<&XElement> = default.root.children_local("variation").collect();
        expand(&accents, &variations)
    }
}

const DEFAULT_VARIATIONS: &str = r#"<v xmlns:a="a"><variation/><variation><a:lumMod val="60000"/></variation><variation><a:lumMod val="80000"/><a:lumOff val="20000"/></variation><variation><a:lumMod val="80000"/></variation><variation><a:lumMod val="60000"/><a:lumOff val="40000"/></variation><variation><a:lumMod val="50000"/></variation></v>"#;

fn expand(base: &[Rgba], variations: &[&XElement]) -> Vec<String> {
    let mut out = Vec::new();
    let vs: Vec<Option<&XElement>> = if variations.is_empty() { vec![None] } else { variations.iter().map(|v| Some(*v)).collect() };
    for v in vs {
        for c in base {
            out.push(match v {
                Some(v) => c.transform(v).to_css(),
                None => c.to_css(),
            });
        }
    }
    out
}

fn pts(c: &XElement, count: u32) -> Vec<Option<String>> {
    fill(count, c.children_local("pt").map(|pt| (pt.attr("idx"), pt.child_local("v").map(|x| x.text_content()))))
}

/// Most points a cached series keeps: Excel's row count, the most one series can reference. Counts and indexes
/// come from the file, so they are clamped before anything is allocated from them (a crafted `idx` asked for 100 GB).
pub const MAX_POINTS: u32 = 1 << 20;

/// A declared `ptCount`, at most `MAX_POINTS`.
fn point_count(v: Option<&str>) -> u32 {
    v.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0).min(MAX_POINTS as u64) as u32
}

/// `count` slots, each point's value at its `idx`; a point at or past `MAX_POINTS` is dropped. Indexes are read as
/// `u64` so 32-bit WASM and 64-bit builds agree on what is too big.
fn fill<'a, T: Clone>(count: u32, points: impl Iterator<Item = (Option<&'a str>, Option<T>)>) -> Vec<Option<T>> {
    let mut v = vec![None; count as usize];
    for (idx, value) in points {
        let i = idx.and_then(|i| i.parse::<u64>().ok()).unwrap_or(0);
        if i >= MAX_POINTS as u64 {
            continue;
        }
        let i = i as usize;
        if i >= v.len() {
            v.resize(i + 1, None);
        }
        v[i] = value;
    }
    v
}

fn layout(l: Option<&XElement>) -> Option<Layout> {
    let m = l?.child_local("manualLayout")?;
    let edge = |k: &str| val(m, k).unwrap_or("factor") == "edge";
    if !edge("xMode") || !edge("yMode") {
        return None;
    }
    Some(Layout { x: num(m, "x")?, y: num(m, "y")?, w: num(m, "w"), h: num(m, "h"), inner: val(m, "layoutTarget") == Some("inner") })
}
