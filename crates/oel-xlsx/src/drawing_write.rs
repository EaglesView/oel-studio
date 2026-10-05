//! Drawings and charts made or changed in the editor → the sheet's drawing part.
//!
//! The drawing part is rewritten only when something changed: a chart was
//! added, edited, moved or removed, or a picture moved. Anchors keep their
//! original XML (`src` = position in the part) with only their position patched;
//! untouched chart parts are not rewritten. Edited and new charts are written
//! by `oelchart::write_chart`, with caches filled from the recalculated cells.

use crate::drawing::{REL_DRAWING, read_drawings};
use crate::model::{Cell, Drawing, DrawingMarker, Sheet, Workbook};
use crate::refs::{col_index, parse_range};
use oel_opc::package::{Package, relative_target, resolve_target};
use oel_opc::xml::{XDocument, XElement, XNode};
use oelchart::{ChartSpec, DataRef};

pub const CT_DRAWING: &str = "application/vnd.openxmlformats-officedocument.drawing+xml";
const NS_XDR: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_C: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";

/// Write the sheet's drawings if they changed. Returns the relationship id of
/// a drawing part created for a sheet that had none (the worksheet needs `<drawing r:id>`).
pub fn write_drawings(pkg: &mut Package, sheet_part: &str, sheet: &Sheet, wb: &Workbook, theme: &[String], fonts: &(Option<String>, Option<String>)) -> Option<String> {
    // The drawings as the importer gives them (sizes of fixed drawings follow the grid).
    let mut probe = Sheet { drawings: read_drawings(pkg, sheet_part, theme, fonts), ..sheet.clone() };
    crate::drawing::fix_sizes(&mut probe);
    let original = probe.drawings;
    if original == sheet.drawings {
        return None;
    }
    let existing = pkg.rels(sheet_part).into_iter().find(|r| r.rel_type == REL_DRAWING);
    let (part, new_rel) = match &existing {
        Some(r) => (resolve_target(sheet_part, &r.target), None),
        None => {
            if sheet.drawings.is_empty() {
                return None;
            }
            let part = (1..).map(|n| format!("xl/drawings/drawing{n}.xml")).find(|p| !pkg.has(p)).unwrap();
            let doc = XDocument::parse(&format!(r#"<xdr:wsDr xmlns:xdr="{NS_XDR}" xmlns:a="{NS_A}" xmlns:r="{NS_R}"/>"#)).expect("static XML");
            pkg.set_xml(&part, &doc);
            pkg.ensure_override(&part, CT_DRAWING);
            let id = pkg.add_rel(sheet_part, REL_DRAWING, &relative_target(sheet_part, &part), false);
            (part, Some(id))
        }
    };
    let Some(mut doc) = pkg.get_xml(&part) else { return new_rel };
    let old_anchors: Vec<XElement> = doc.root.elements().cloned().collect();
    let mut anchors: Vec<XNode> = Vec::new();
    let mut next_id = 1000 + old_anchors.len() as u32;
    let mut kept_charts: Vec<String> = Vec::new();
    for d in &sheet.drawings {
        let orig = d.src.and_then(|i| original.iter().find(|o| o.src == Some(i)));
        let mut anchor = match d.src.and_then(|i| old_anchors.get(i as usize)) {
            Some(a) => a.clone(),
            None if d.kind == "chart" && d.chart.is_some() => {
                next_id += 1;
                let Some(a) = new_chart_anchor(pkg, &part, d, wb, &sheet.name, next_id) else { continue };
                a
            }
            // Pictures and shapes are only made by the importer; a new one without XML is dropped.
            None => continue,
        };
        if let (Some(o), Some(spec)) = (orig, &d.chart) {
            if !spec.part.is_empty() {
                kept_charts.push(spec.part.clone());
            }
            if o.chart.as_ref() != Some(spec) && !spec.ex && !spec.part.is_empty() {
                let mut spec = spec.clone();
                fill_caches(&mut spec, wb, &sheet.name);
                pkg.set(&spec.part, oelchart::write_chart(&spec, None).into_bytes());
            }
        }
        if orig.map(|o| o.from != d.from || o.to != d.to || o.cx != d.cx || o.cy != d.cy || o.edit_as != d.edit_as).unwrap_or(false) {
            place(&mut anchor, d);
        }
        anchors.push(XNode::Element(anchor));
    }
    // Charts whose anchor was removed: drop their part and relationship.
    for o in &original {
        if let Some(c) = &o.chart {
            if !c.part.is_empty() && !kept_charts.contains(&c.part) && !sheet.drawings.iter().any(|d| d.chart.as_ref().map(|x| x.part == c.part).unwrap_or(false)) {
                drop_part(pkg, &part, &c.part);
            }
        }
    }
    doc.root.children = anchors;
    pkg.set_xml(&part, &doc);
    new_rel
}

fn marker_el(tag: &str, m: &DrawingMarker) -> XElement {
    let t = |name: &str, v: String| {
        let mut e = XElement::new(&format!("xdr:{name}"));
        e.children.push(XNode::Text(v));
        e
    };
    XElement::new(&format!("xdr:{tag}")).with_child(t("col", m.c.to_string())).with_child(t("colOff", m.dx.to_string())).with_child(t("row", m.r.to_string())).with_child(t("rowOff", m.dy.to_string()))
}

/// Patch the position of an existing anchor (kept prefix and element order).
fn place(anchor: &mut XElement, d: &Drawing) {
    let prefix = anchor.prefix().map(String::from);
    let fix = |mut e: XElement| {
        rename(&mut e, prefix.as_deref());
        e
    };
    for c in anchor.elements_mut() {
        match c.local() {
            "from" => *c = fix(marker_el("from", &d.from)),
            "to" => {
                if let Some(to) = &d.to {
                    *c = fix(marker_el("to", to));
                }
            }
            "ext" if d.cx > 0 && d.cy > 0 => {
                c.set_attr("cx", d.cx.to_string());
                c.set_attr("cy", d.cy.to_string());
            }
            _ => {}
        }
    }
    if anchor.local() == "twoCellAnchor" {
        match d.edit_as.as_deref() {
            Some("oneCell") | Some("absolute") => anchor.set_attr("editAs", d.edit_as.clone().unwrap()),
            _ => anchor.remove_attr("editAs"),
        }
    }
}

/// `xdr:col` → `<prefix>:col` (or `col` in a default-namespace part) throughout.
fn rename(e: &mut XElement, prefix: Option<&str>) {
    let local = e.local().to_string();
    e.name = match prefix {
        Some(p) => format!("{p}:{local}"),
        None => local,
    };
    for c in e.elements_mut() {
        rename(c, prefix);
    }
}

fn new_chart_anchor(pkg: &mut Package, drawing_part: &str, d: &Drawing, wb: &Workbook, sheet_name: &str, id: u32) -> Option<XElement> {
    let mut spec = d.chart.clone()?;
    fill_caches(&mut spec, wb, sheet_name);
    let chart_part = oelchart::next_chart_part(pkg, "xl/charts");
    pkg.set(&chart_part, oelchart::write_chart(&spec, None).into_bytes());
    pkg.ensure_override(&chart_part, oelchart::read::CT_CHART);
    let rid = pkg.add_rel(drawing_part, oelchart::read::REL_CHART, &relative_target(drawing_part, &chart_part), false);
    let to = d.to.unwrap_or(DrawingMarker { r: d.from.r + 15, c: d.from.c + 8, dx: 0, dy: 0 });
    let m = |tag: &str, m: &DrawingMarker| format!("<xdr:{tag}><xdr:col>{}</xdr:col><xdr:colOff>{}</xdr:colOff><xdr:row>{}</xdr:row><xdr:rowOff>{}</xdr:rowOff></xdr:{tag}>", m.c, m.dx, m.r, m.dy);
    let name = if d.name.is_empty() { format!("Graphique {}", id - 1000) } else { d.name.clone() };
    let mut esc = String::new();
    oel_opc::xml::escape_attr(&name, &mut esc);
    let edit = match d.edit_as.as_deref() {
        Some(v @ ("oneCell" | "absolute")) => format!(r#" editAs="{v}""#),
        _ => String::new(),
    };
    let xml = format!(
        r#"<xdr:twoCellAnchor xmlns:xdr="{NS_XDR}" xmlns:a="{NS_A}" xmlns:r="{NS_R}"{edit}>{}{}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{id}" name="{esc}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="{NS_C}"><c:chart xmlns:c="{NS_C}" r:id="{rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>"#,
        m("from", &d.from),
        m("to", &to),
    );
    XDocument::parse(&xml).ok().map(|d| d.root)
}

fn drop_part(pkg: &mut Package, owner: &str, part: &str) {
    let rel = pkg.rels(owner).into_iter().find(|r| resolve_target(owner, &r.target) == part);
    if let Some(r) = rel {
        let path = oel_opc::package::rels_path(owner);
        if let Some(mut doc) = pkg.get_xml(&path) {
            doc.root.children.retain(|n| !matches!(n, XNode::Element(e) if e.attr("Id") == Some(r.id.as_str())));
            pkg.set_xml(&path, &doc);
        }
    }
    let chart_rels = oel_opc::package::rels_path(part);
    pkg.parts.retain(|(n, _)| n != part && n != &chart_rels);
    let mut ct = pkg.content_types();
    let pn = format!("/{part}");
    ct.root.children.retain(|n| !matches!(n, XNode::Element(e) if e.local() == "Override" && e.attr("PartName") == Some(pn.as_str())));
    pkg.set_xml("[Content_Types].xml", &ct);
}

/// A chart reference (`'Budget'!$B$2:$B$8`) → sheet and 0-based range.
fn split_ref(f: &str, own: &str) -> Option<(String, crate::refs::Range)> {
    let f = f.trim().trim_start_matches('=');
    let (sheet, area) = match f.rsplit_once('!') {
        Some((s, a)) => (s.trim_matches('\'').replace("''", "'"), a),
        None => (own.to_string(), f),
    };
    let area = area.replace('$', "");
    let r = parse_range(&area).or_else(|| {
        // Single cell.
        let col: String = area.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
        let row: u32 = area[col.len()..].parse().ok()?;
        let c = col_index(&col)?;
        Some(crate::refs::Range { r0: row - 1, c0: c, r1: row - 1, c1: c })
    })?;
    Some((sheet, r))
}

fn cells_of<'a>(wb: &'a Workbook, sheet: &str) -> Option<&'a [Cell]> {
    wb.sheets.iter().find(|s| s.name == sheet).map(|s| s.cells.as_slice())
}

fn fill(d: &mut DataRef, wb: &Workbook, own: &str, numeric: bool) {
    let Some(f) = &d.f else { return };
    let Some((sheet, r)) = split_ref(f, own) else { return };
    let Some(cells) = cells_of(wb, &sheet) else { return };
    let mut num = Vec::new();
    let mut txt = Vec::new();
    for row in r.r0..=r.r1 {
        for col in r.c0..=r.c1 {
            let c = cells.iter().find(|c| c.r == row && c.c == col);
            let v = c.and_then(|c| c.v.as_ref());
            num.push(v.and_then(|v| v.as_f64()));
            txt.push(v.map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
                other => other.to_string(),
            }));
        }
    }
    d.count = num.len() as u32;
    if numeric {
        d.num = num;
        d.str.clear();
    } else {
        d.str = txt;
        d.num.clear();
    }
}

/// Fill a chart's caches (and series names) from the workbook's cell values.
pub fn fill_caches(spec: &mut ChartSpec, wb: &Workbook, own_sheet: &str) {
    for g in &mut spec.groups {
        let xy = g.kind == "scatter" || g.kind == "bubble";
        for s in &mut g.series {
            if let Some(c) = &mut s.cat {
                let numeric = xy || (c.str.is_empty() && !c.num.is_empty());
                fill(c, wb, own_sheet, numeric);
            }
            if let Some(v) = &mut s.val {
                fill(v, wb, own_sheet, true);
            }
            if let Some(v) = &mut s.size {
                fill(v, wb, own_sheet, true);
            }
            if let Some(f) = &s.name_ref {
                let mut d = DataRef { f: Some(f.clone()), ..Default::default() };
                fill(&mut d, wb, own_sheet, false);
                if let Some(Some(n)) = d.str.first() {
                    s.name = Some(n.clone());
                }
            }
        }
    }
}
