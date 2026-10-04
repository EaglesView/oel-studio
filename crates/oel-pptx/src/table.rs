//! Tables (`a:tbl` in a graphic frame): cells with their text, and the look
//! of the table style (`ppt/tableStyles.xml`) resolved per cell like
//! PowerPoint does — whole table, banded rows/columns, then first/last
//! row/column — under the cell's own properties.

use crate::model::{Borders, Line, Paint, Table, TableCell, TableRow};
use crate::text;
use crate::theme::{ColorCtx, merge_line, num};
use oel_opc::xml::{XDocument, XElement};

fn on(v: Option<&str>) -> bool {
    matches!(v, Some("1" | "true" | "on"))
}

/// Table-style parts that apply to a cell, weakest first.
fn parts_for<'s>(style: &'s XElement, flags: &Flags, r: usize, c: usize, rows: usize, cols: usize) -> Vec<&'s XElement> {
    let mut out = Vec::new();
    let mut push = |name: &str| {
        if let Some(p) = style.child_local(name) {
            out.push(p);
        }
    };
    push("wholeTbl");
    if flags.band_row {
        let k = r - usize::from(flags.first_row);
        if !(flags.first_row && r == 0) && !(flags.last_row && r == rows - 1) {
            push(if k % 2 == 0 { "band1H" } else { "band2H" });
        }
    }
    if flags.band_col {
        let k = c - usize::from(flags.first_col);
        if !(flags.first_col && c == 0) && !(flags.last_col && c == cols - 1) {
            push(if k % 2 == 0 { "band1V" } else { "band2V" });
        }
    }
    if flags.last_col && c == cols - 1 {
        push("lastCol");
    }
    if flags.first_col && c == 0 {
        push("firstCol");
    }
    if flags.last_row && r == rows - 1 {
        push("lastRow");
    }
    if flags.first_row && r == 0 {
        push("firstRow");
    }
    out
}

struct Flags {
    first_row: bool,
    first_col: bool,
    last_row: bool,
    last_col: bool,
    band_row: bool,
    band_col: bool,
}

/// A border of a table-style part (`a:left`, `a:insideH`…): `a:ln` or `a:lnRef`.
fn style_border(part: &XElement, side: &str, cc: &ColorCtx) -> Option<Line> {
    let b = part.child_local("tcStyle")?.child_local("tcBdr")?.child_local(side)?;
    if let Some(ln) = b.child_local("ln") {
        return Some(cc.line(ln));
    }
    let r = b.child_local("lnRef")?;
    let (cc2, style) = cc.style_ref(r, &cc.theme.line_styles, &[])?;
    Some(cc2.line(style))
}

fn style_fill(part: &XElement, cc: &ColorCtx) -> Option<Paint> {
    let s = part.child_local("tcStyle")?;
    if let Some(f) = s.child_local("fill") {
        return f.elements().find_map(|e| cc.paint(e, &|_| None));
    }
    let r = s.child_local("fillRef")?;
    let (cc2, style) = cc.style_ref(r, &cc.theme.fill_styles, &cc.theme.bg_fill_styles)?;
    cc2.paint(style, &|_| None)
}

/// Turn a table-style part's `a:tcTxStyle` into a list-style layer (`a:lvl1pPr/a:defRPr`).
fn text_layer(part: &XElement, cc: &ColorCtx) -> Option<XElement> {
    let t = part.child_local("tcTxStyle")?;
    let mut rpr = XElement::new("a:defRPr");
    if let Some(b) = t.attr("b") {
        rpr.set_attr("b", if b == "on" { "1" } else { "0" });
    }
    if let Some(i) = t.attr("i") {
        rpr.set_attr("i", if i == "on" { "1" } else { "0" });
    }
    let color = t.elements().filter(|e| e.local() != "fontRef" && e.local() != "font").find_map(|e| cc.rgba(e)).or_else(|| t.child_local("fontRef").and_then(|f| cc.child_rgba(f)));
    if let Some(c) = color {
        rpr.children.push(oel_opc::xml::XNode::Element(XElement::new("a:solidFill").with_child(XElement::new("a:srgbClr").with_attr("val", c.to_hex()))));
    }
    if let Some(face) = t.child_local("fontRef").and_then(|f| f.attr("idx")) {
        let tf = if face == "major" { "+mj-lt" } else { "+mn-lt" };
        rpr.children.push(oel_opc::xml::XNode::Element(XElement::new("a:latin").with_attr("typeface", tf)));
    }
    let lvl = XElement::new("a:lvl1pPr").with_child(rpr);
    Some(XElement::new("a:lstStyle").with_child(lvl))
}

pub fn read_table(
    tbl: &XElement,
    default_style: Option<&XElement>,
    styles: Option<&XDocument>,
    cc: &ColorCtx,
    typeface: &dyn Fn(&str) -> String,
    link: &dyn Fn(&str) -> Option<String>,
) -> Table {
    let pr = tbl.child_local("tblPr");
    let flags = Flags {
        first_row: on(pr.and_then(|p| p.attr("firstRow"))),
        first_col: on(pr.and_then(|p| p.attr("firstCol"))),
        last_row: on(pr.and_then(|p| p.attr("lastRow"))),
        last_col: on(pr.and_then(|p| p.attr("lastCol"))),
        band_row: on(pr.and_then(|p| p.attr("bandRow"))),
        band_col: on(pr.and_then(|p| p.attr("bandCol"))),
    };
    let style_id = pr.and_then(|p| p.child_local("tableStyleId")).map(|s| s.text_content().trim().to_string());
    let style = styles.and_then(|d| {
        let id = style_id.clone().or_else(|| d.root.attr("def").map(String::from))?;
        d.root.children_local("tblStyle").find(|s| s.attr("styleId") == Some(id.as_str())).cloned()
    });
    let table_fill = pr.and_then(|p| p.elements().find(|e| crate::theme::is_fill(e.local()))).and_then(|f| cc.paint(f, &|_| None));

    let cols: Vec<i64> = tbl.child_local("tblGrid").into_iter().flat_map(|g| g.children_local("gridCol")).map(|c| num(c, "w").unwrap_or(0.0) as i64).collect();
    let row_els: Vec<&XElement> = tbl.children_local("tr").collect();
    let (nrows, ncols) = (row_els.len(), cols.len().max(1));
    let rows = row_els
        .iter()
        .enumerate()
        .map(|(r, tr)| {
            let cells = tr
                .children_local("tc")
                .enumerate()
                .map(|(c, tc)| {
                    let parts = style.as_ref().map(|s| parts_for(s, &flags, r, c.min(ncols - 1), nrows, ncols)).unwrap_or_default();
                    let tcpr = tc.child_local("tcPr");
                    // Fill: table style parts, then the table's own, then the cell's.
                    let mut fill = None;
                    for p in &parts {
                        if let Some(f) = style_fill(p, cc) {
                            fill = Some(f);
                        }
                    }
                    if table_fill.is_some() {
                        fill = table_fill.clone();
                    }
                    if let Some(f) = tcpr.and_then(|p| p.elements().find(|e| crate::theme::is_fill(e.local()))).and_then(|f| cc.paint(f, &|_| None)) {
                        fill = Some(f);
                    }
                    // Borders: outer edges from left/right/top/bottom, inner ones from insideH/insideV.
                    let mut borders = Borders::default();
                    for p in &parts {
                        // Each part covers a region: the whole table, one row (first/last
                        // row, row bands) or one column; its outer borders are the region's.
                        let (row_region, col_region) = match p.local() {
                            "firstRow" | "lastRow" | "band1H" | "band2H" => (true, false),
                            "firstCol" | "lastCol" | "band1V" | "band2V" => (false, true),
                            _ => (false, false),
                        };
                        let left = c == 0 || col_region;
                        let right = c + 1 >= ncols || col_region;
                        let top = r == 0 || row_region;
                        let bottom = r + 1 >= nrows || row_region;
                        let side = |outer: &str, inner: &str, is_outer: bool| style_border(p, if is_outer { outer } else { inner }, cc);
                        borders.l = merge_line(borders.l.take(), side("left", "insideV", left).as_ref());
                        borders.r = merge_line(borders.r.take(), side("right", "insideV", right).as_ref());
                        borders.t = merge_line(borders.t.take(), side("top", "insideH", top).as_ref());
                        borders.b = merge_line(borders.b.take(), side("bottom", "insideH", bottom).as_ref());
                    }
                    if let Some(p) = tcpr {
                        for (name, slot) in [("lnL", &mut borders.l), ("lnR", &mut borders.r), ("lnT", &mut borders.t), ("lnB", &mut borders.b)] {
                            if let Some(ln) = p.child_local(name) {
                                *slot = merge_line(slot.take(), Some(&cc.line(ln)));
                            }
                        }
                    }
                    // Text: presentation defaults, the style's text, the cell's list style.
                    let layers_owned: Vec<XElement> = parts.iter().filter_map(|p| text_layer(p, cc)).collect();
                    let tx = tc.child_local("txBody");
                    let mut layers: Vec<&XElement> = default_style.into_iter().collect();
                    layers.extend(layers_owned.iter());
                    if let Some(l) = tx.and_then(|t| t.child_local("lstStyle")) {
                        layers.push(l);
                    }
                    let levels = text::levels(&layers, None, usize::MAX, text::level_count(tx, false), cc, typeface);
                    let mut body = text::body_props(&tx.and_then(|t| t.child_local("bodyPr")).into_iter().collect::<Vec<_>>());
                    let mar = |k: &str, d: i64| tcpr.and_then(|p| num(p, k)).map(|v| v as i64).unwrap_or(d);
                    (body.l, body.r, body.t, body.b) = (mar("marL", 91_440), mar("marR", 91_440), mar("marT", 45_720), mar("marB", 45_720));
                    body.anchor = tcpr.and_then(|p| p.attr("anchor")).unwrap_or("t").to_string();
                    let paras = tx.map(|t| text::paras(t, cc, link)).unwrap_or_default();
                    TableCell {
                        text: text::text_body(body, levels, paras, None),
                        grid_span: num(tc, "gridSpan").map(|v| v as u32).unwrap_or(1).max(1),
                        row_span: num(tc, "rowSpan").map(|v| v as u32).unwrap_or(1).max(1),
                        h_merge: on(tc.attr("hMerge")),
                        v_merge: on(tc.attr("vMerge")),
                        fill,
                        borders,
                    }
                })
                .collect();
            TableRow { h: num(tr, "h").unwrap_or(0.0) as i64, cells }
        })
        .collect();
    Table { cols, rows }
}
