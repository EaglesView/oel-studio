//! [`Workbook`] JSON + original package → `.xlsx`.
//!
//! Only what the editor models is regenerated: each worksheet's cells and
//! layout elements (in their schema position inside the *original*
//! `<worksheet>`), the shared strings, appended styles, and the workbook's
//! sheet list and names; drawings and charts only when the editor changed them
//! (`drawing_write`). Every other part — pivots, theme, macros — and every
//! unmodelled worksheet child is written back untouched.

use crate::model::*;
use crate::read::{REL_CALC_CHAIN, REL_SHARED_STRINGS, REL_STYLES, REL_WORKSHEET, rel_id_attr, workbook_part, workbook_rel_target};
use crate::refs::{a1, add_future_prefixes, parse_range};
use crate::styles::{append_styles, color_el, fmt_num};
use oel_opc::package::{Package, REL_HYPERLINK, rels_path, relative_target, resolve_target};
use oel_opc::xml::{XDocument, XElement, XNode};
use std::collections::HashMap;

const CT_WORKSHEET: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const CT_SHARED_STRINGS: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const NS_MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// CT_Worksheet child order (ECMA-376 §18.3.1.99).
const WS_ORDER: &[&str] = &[
    "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter", "sortState",
    "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup",
    "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "drawingHF",
    "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst",
];

/// CT_Workbook child order (§18.2.27).
const WB_ORDER: &[&str] = &[
    "fileVersion", "fileSharing", "workbookPr", "workbookProtection", "bookViews", "sheets", "functionGroups", "externalReferences", "definedNames", "calcPr", "oleSize",
    "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst",
];

/// Replace every child with this local name by `new` (in order), placed where the schema wants it.
fn put(parent: &mut XElement, order: &[&str], name: &str, new: Vec<XElement>) {
    let prefix = parent.prefix().map(String::from);
    let first_existing = parent.children.iter().position(|n| matches!(n, XNode::Element(e) if e.local() == name));
    parent.children.retain(|n| !matches!(n, XNode::Element(e) if e.local() == name));
    let pos = first_existing.unwrap_or_else(|| {
        let rank = order.iter().position(|n| *n == name).unwrap_or(order.len());
        parent
            .children
            .iter()
            .position(|n| matches!(n, XNode::Element(e) if order.iter().position(|o| *o == e.local()).map(|r| r > rank).unwrap_or(false)))
            .unwrap_or(parent.children.len())
    });
    for (i, mut e) in new.into_iter().enumerate() {
        e.apply_prefix(prefix.as_deref());
        parent.children.insert((pos + i).min(parent.children.len()), XNode::Element(e));
    }
}

fn parse_el(xml: &str) -> Option<XElement> {
    XDocument::parse(xml).ok().map(|d| d.root)
}

fn text_el(name: &str, text: &str) -> XElement {
    let mut e = XElement::new(name);
    e.children.push(XNode::Text(text.to_string()));
    e
}

fn number_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
            Some(f) => format!("{f}"),
            None => n.to_string(),
        },
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Bool(b) => (if *b { "1" } else { "0" }).into(),
        _ => "0".into(),
    }
}

/// The shared-string table being rebuilt.
#[derive(Default)]
struct Sst {
    items: Vec<XElement>,
    index: HashMap<(String, Option<String>), usize>,
    count: usize,
}

impl Sst {
    fn add(&mut self, text: &str, rich: Option<&str>) -> usize {
        self.count += 1;
        // Rich runs are kept only while they still spell the cell's text.
        let rich = rich.filter(|r| {
            parse_el(&format!("<si xmlns=\"{NS_MAIN}\">{r}</si>")).map(|si| si.children_local("r").filter_map(|r| r.child_local("t")).map(|t| t.text_content()).collect::<String>() == text).unwrap_or(false)
        });
        let key = (text.to_string(), rich.map(String::from));
        if let Some(i) = self.index.get(&key) {
            return *i;
        }
        let si = match rich.and_then(|r| parse_el(&format!("<si xmlns=\"{NS_MAIN}\">{r}</si>"))) {
            Some(mut si) => {
                si.attrs.clear();
                si
            }
            None => {
                let mut t = text_el("t", text);
                if text.starts_with(char::is_whitespace) || text.ends_with(char::is_whitespace) || text.contains('\n') {
                    t.set_attr("xml:space", "preserve");
                }
                XElement::new("si").with_child(t)
            }
        };
        self.items.push(si);
        self.index.insert(key, self.items.len() - 1);
        self.items.len() - 1
    }

    fn to_doc(&self) -> XDocument {
        let mut root = XElement::new("sst").with_attr("xmlns", NS_MAIN).with_attr("count", self.count.to_string()).with_attr("uniqueCount", self.items.len().to_string());
        root.children = self.items.iter().cloned().map(XNode::Element).collect();
        XDocument { prolog: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n".into(), root }
    }
}

fn cell_el(cell: &Cell, sst: &mut Sst) -> XElement {
    let mut c = XElement::new("c").with_attr("r", a1(cell.r, cell.c));
    if cell.s != 0 {
        c.set_attr("s", cell.s.to_string());
    }
    let t = cell.t.as_deref();
    if let Some(f) = &cell.f {
        let mut fe = text_el("f", &add_future_prefixes(f));
        if let Some(a) = &cell.a {
            fe.set_attr("t", "array");
            fe.set_attr("ref", a.clone());
        }
        match t {
            Some("s") => c.set_attr("t", "str"),
            Some("b") => c.set_attr("t", "b"),
            Some("e") => c.set_attr("t", "e"),
            _ => {}
        }
        c.children.push(XNode::Element(fe));
        if let Some(v) = &cell.v {
            let text = match t {
                Some("s") | Some("e") => v.as_str().map(String::from).unwrap_or_else(|| v.to_string()),
                _ => number_text(v),
            };
            c.children.push(XNode::Element(text_el("v", &text)));
        }
        return c;
    }
    match (t, &cell.v) {
        (Some("s"), Some(v)) => {
            let text = v.as_str().map(String::from).unwrap_or_else(|| v.to_string());
            c.set_attr("t", "s");
            let i = sst.add(&text, cell.rich.as_deref());
            c.children.push(XNode::Element(text_el("v", &i.to_string())));
        }
        (Some("b"), Some(v)) => {
            c.set_attr("t", "b");
            c.children.push(XNode::Element(text_el("v", if v.as_bool().unwrap_or(false) { "1" } else { "0" })));
        }
        (Some("e"), Some(v)) => {
            c.set_attr("t", "e");
            c.children.push(XNode::Element(text_el("v", v.as_str().unwrap_or("#N/A"))));
        }
        (Some("n"), Some(v)) => c.children.push(XNode::Element(text_el("v", &number_text(v)))),
        _ => {}
    }
    c
}

fn sheet_data(sheet: &Sheet, sst: &mut Sst) -> XElement {
    let mut cells: Vec<&Cell> = sheet.cells.iter().collect();
    cells.sort_by_key(|c| (c.r, c.c));
    let infos: HashMap<u32, &RowInfo> = sheet.rows.iter().map(|r| (r.r, r)).collect();
    let mut rows: Vec<u32> = cells.iter().map(|c| c.r).chain(sheet.rows.iter().map(|r| r.r)).collect();
    rows.sort_unstable();
    rows.dedup();
    let mut sd = XElement::new("sheetData");
    let mut ci = 0;
    for r in rows {
        let mut row = XElement::new("row").with_attr("r", (r + 1).to_string());
        if let Some(info) = infos.get(&r) {
            if let Some(s) = info.style {
                row.set_attr("s", s.to_string());
                row.set_attr("customFormat", "1");
            }
            if let Some(h) = info.height {
                row.set_attr("ht", fmt_num(h));
                row.set_attr("customHeight", "1");
            }
            if info.hidden {
                row.set_attr("hidden", "1");
            }
            if info.outline > 0 {
                row.set_attr("outlineLevel", info.outline.to_string());
            }
        }
        while ci < cells.len() && cells[ci].r == r {
            row.children.push(XNode::Element(cell_el(cells[ci], sst)));
            ci += 1;
        }
        sd.children.push(XNode::Element(row));
    }
    sd
}

fn cols_el(sheet: &Sheet) -> Option<XElement> {
    if sheet.cols.is_empty() {
        return None;
    }
    let mut cols = XElement::new("cols");
    let mut list = sheet.cols.clone();
    list.sort_by_key(|c| c.min);
    for c in list {
        let mut e = XElement::new("col").with_attr("min", (c.min + 1).to_string()).with_attr("max", (c.max + 1).to_string());
        e.set_attr("width", fmt_num(c.width.unwrap_or(sheet.default_col_width)));
        if let Some(s) = c.style {
            e.set_attr("style", s.to_string());
        }
        if c.hidden {
            e.set_attr("hidden", "1");
        }
        if c.width.is_some() {
            e.set_attr("customWidth", "1");
        }
        if c.outline > 0 {
            e.set_attr("outlineLevel", c.outline.to_string());
        }
        cols.children.push(XNode::Element(e));
    }
    Some(cols)
}

fn dimension(sheet: &Sheet) -> String {
    if sheet.cells.is_empty() {
        return "A1".into();
    }
    let (mut r0, mut c0, mut r1, mut c1) = (u32::MAX, u32::MAX, 0, 0);
    for c in &sheet.cells {
        r0 = r0.min(c.r);
        c0 = c0.min(c.c);
        r1 = r1.max(c.r);
        c1 = c1.max(c.c);
    }
    crate::refs::Range { r0, c0, r1, c1 }.to_a1()
}

fn update_sheet_views(ws: &mut XElement, sheet: &Sheet, selected: bool) {
    if ws.child_local("sheetViews").is_none() {
        put(ws, WS_ORDER, "sheetViews", vec![XElement::new("sheetViews").with_child(XElement::new("sheetView").with_attr("workbookViewId", "0"))]);
    }
    let prefix = ws.prefix().map(String::from);
    let views = ws.child_local_mut("sheetViews").unwrap();
    if views.child_local("sheetView").is_none() {
        let mut v = XElement::new("sheetView").with_attr("workbookViewId", "0");
        v.apply_prefix(prefix.as_deref());
        views.children.push(XNode::Element(v));
    }
    let view = views.child_local_mut("sheetView").unwrap();
    if sheet.show_grid {
        if view.attr("showGridLines").is_some() {
            view.set_attr("showGridLines", "1");
        }
    } else {
        view.set_attr("showGridLines", "0");
    }
    if sheet.zoom != 100 || view.attr("zoomScale").is_some() {
        view.set_attr("zoomScale", sheet.zoom.to_string());
    }
    // Several selected tabs open as a group in Excel: only the active sheet is.
    if selected {
        view.set_attr("tabSelected", "1");
    } else {
        view.remove_attr("tabSelected");
    }
    let current = view.child_local("pane").filter(|p| matches!(p.attr("state"), Some("frozen") | Some("frozenSplit"))).map(|p| {
        (p.attr("ySplit").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) as u32, p.attr("xSplit").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) as u32)
    });
    if current == Some((sheet.frozen_rows, sheet.frozen_cols)) || (current.is_none() && sheet.frozen_rows == 0 && sheet.frozen_cols == 0) {
        return;
    }
    // Frozen panes changed: rebuild the pane and a single selection for it.
    view.children.retain(|n| !matches!(n, XNode::Element(e) if e.local() == "pane" || e.local() == "selection"));
    let (fr, fc) = (sheet.frozen_rows, sheet.frozen_cols);
    if fr > 0 || fc > 0 {
        let active = match (fr > 0, fc > 0) {
            (true, true) => "bottomRight",
            (true, false) => "bottomLeft",
            _ => "topRight",
        };
        let mut pane = XElement::new("pane");
        if fc > 0 {
            pane.set_attr("xSplit", fc.to_string());
        }
        if fr > 0 {
            pane.set_attr("ySplit", fr.to_string());
        }
        pane.set_attr("topLeftCell", a1(fr, fc));
        pane.set_attr("activePane", active);
        pane.set_attr("state", "frozen");
        let mut sel = XElement::new("selection").with_attr("pane", active).with_attr("activeCell", a1(fr, fc)).with_attr("sqref", a1(fr, fc));
        pane.apply_prefix(prefix.as_deref());
        sel.apply_prefix(prefix.as_deref());
        view.children.insert(0, XNode::Element(sel));
        view.children.insert(0, XNode::Element(pane));
    }
}

fn update_sheet_pr(ws: &mut XElement, sheet: &Sheet) {
    match &sheet.tab_color {
        Some(c) => {
            if ws.child_local("sheetPr").is_none() {
                put(ws, WS_ORDER, "sheetPr", vec![XElement::new("sheetPr")]);
            }
            let prefix = ws.prefix().map(String::from);
            let pr = ws.child_local_mut("sheetPr").unwrap();
            pr.children.retain(|n| !matches!(n, XNode::Element(e) if e.local() == "tabColor"));
            let mut tc = color_el("tabColor", c);
            tc.apply_prefix(prefix.as_deref());
            // tabColor is the first child of sheetPr.
            pr.children.insert(0, XNode::Element(tc));
        }
        None => {
            if let Some(pr) = ws.child_local_mut("sheetPr") {
                pr.children.retain(|n| !matches!(n, XNode::Element(e) if e.local() == "tabColor"));
            }
        }
    }
}

fn auto_filter_el(af: &AutoFilter) -> XElement {
    if af.columns.is_empty() {
        if let Some(mut raw) = af.raw.as_deref().and_then(parse_el) {
            raw.set_attr("ref", af.range.clone());
            return raw;
        }
    }
    let mut e = XElement::new("autoFilter").with_attr("ref", af.range.clone());
    for col in &af.columns {
        let mut filters = XElement::new("filters");
        if col.blank {
            filters.set_attr("blank", "1");
        }
        for v in &col.values {
            filters.children.push(XNode::Element(XElement::new("filter").with_attr("val", v.clone())));
        }
        e.children.push(XNode::Element(XElement::new("filterColumn").with_attr("colId", col.col.to_string()).with_child(filters)));
    }
    e
}

fn cond_format_el(cf: &CondFormat) -> XElement {
    let mut e = XElement::new("conditionalFormatting").with_attr("sqref", cf.sqref.clone());
    for rule in &cf.rules {
        let mut r = rule.raw.as_deref().and_then(parse_el).unwrap_or_else(|| XElement::new("cfRule"));
        r.attrs.retain(|(k, _)| !k.starts_with("xmlns"));
        r.set_attr("type", rule.kind.clone());
        r.set_attr("priority", rule.priority.max(1).to_string());
        match &rule.operator {
            Some(op) => r.set_attr("operator", op.clone()),
            None => r.remove_attr("operator"),
        }
        match rule.dxf {
            Some(d) => r.set_attr("dxfId", d.to_string()),
            None => r.remove_attr("dxfId"),
        }
        if rule.stop {
            r.set_attr("stopIfTrue", "1");
        } else {
            r.remove_attr("stopIfTrue");
        }
        // CT_CfRule: formula* come first, then colorScale/dataBar/iconSet, extLst.
        let at = r.children.iter().position(|n| matches!(n, XNode::Element(x) if x.local() == "formula"));
        r.children.retain(|n| !matches!(n, XNode::Element(x) if x.local() == "formula"));
        let at = at.unwrap_or(0).min(r.children.len());
        for (i, f) in rule.formulas.iter().enumerate() {
            r.children.insert(at + i, XNode::Element(text_el("formula", &add_future_prefixes(f))));
        }
        if rule.raw.is_none() && (rule.kind == "colorScale" || rule.kind == "dataBar") && !rule.colors.is_empty() {
            let mut scale = XElement::new(&rule.kind);
            let n = if rule.kind == "dataBar" { 2 } else { rule.colors.len().max(2) };
            let kinds = if n == 3 { vec!["min", "percentile", "max"] } else { vec!["min", "max"] };
            for k in &kinds {
                let mut cfvo = XElement::new("cfvo").with_attr("type", *k);
                if *k == "percentile" {
                    cfvo.set_attr("val", "50");
                }
                scale.children.push(XNode::Element(cfvo));
            }
            for c in rule.colors.iter().take(if rule.kind == "dataBar" { 1 } else { kinds.len() }) {
                scale.children.push(XNode::Element(color_el("color", c)));
            }
            r.children.insert(0, XNode::Element(scale));
        }
        e.children.push(XNode::Element(r));
    }
    e
}

fn validation_el(v: &Validation) -> XElement {
    let mut e = v.raw.as_deref().and_then(parse_el).unwrap_or_else(|| XElement::new("dataValidation"));
    e.attrs.retain(|(k, _)| !k.starts_with("xmlns"));
    e.set_attr("sqref", v.sqref.clone());
    if v.kind == "none" {
        e.remove_attr("type");
    } else {
        e.set_attr("type", v.kind.clone());
    }
    match &v.operator {
        Some(op) => e.set_attr("operator", op.clone()),
        None => e.remove_attr("operator"),
    }
    e.set_attr("allowBlank", if v.allow_blank { "1" } else { "0" });
    if v.raw.is_none() {
        e.set_attr("showErrorMessage", "1");
        e.set_attr("showInputMessage", "1");
    }
    match &v.error {
        Some(t) => e.set_attr("error", t.clone()),
        None => e.remove_attr("error"),
    }
    match &v.prompt {
        Some(t) => e.set_attr("prompt", t.clone()),
        None => e.remove_attr("prompt"),
    }
    e.children.retain(|n| !matches!(n, XNode::Element(x) if x.local() == "formula1" || x.local() == "formula2"));
    if let Some(f) = &v.formula1 {
        e.children.push(XNode::Element(text_el("formula1", &add_future_prefixes(f))));
    }
    if let Some(f) = &v.formula2 {
        e.children.push(XNode::Element(text_el("formula2", &add_future_prefixes(f))));
    }
    e
}

fn hyperlinks_el(pkg: &mut Package, part: &str, sheet: &Sheet) -> Option<XElement> {
    if sheet.hyperlinks.is_empty() {
        return None;
    }
    let mut e = XElement::new("hyperlinks");
    for h in &sheet.hyperlinks {
        let mut el = XElement::new("hyperlink").with_attr("ref", h.range.clone());
        if let Some(t) = &h.target {
            let id = pkg.add_rel(part, REL_HYPERLINK, t, true);
            el.set_attr("r:id", id);
        }
        if let Some(l) = &h.location {
            el.set_attr("location", l.clone());
        }
        if let Some(t) = &h.tooltip {
            el.set_attr("tooltip", t.clone());
        }
        if let Some(d) = &h.display {
            el.set_attr("display", d.clone());
        }
        e.children.push(XNode::Element(el));
    }
    Some(e)
}

/// What a worksheet needs from the whole workbook: values for chart caches, the theme for chart colours.
struct WsCtx<'a> {
    wb: &'a Workbook,
    theme: &'a [String],
    fonts: &'a (Option<String>, Option<String>),
}

fn write_worksheet(pkg: &mut Package, part: &str, sheet: &Sheet, selected: bool, sst: &mut Sst, cx: &WsCtx) -> Result<(), String> {
    let mut doc = pkg.get_xml(part).unwrap_or_else(|| XDocument::parse(crate::template::WORKSHEET).expect("template worksheet"));
    // A part written with a prefixed main namespace needs the r: namespace for hyperlinks too.
    if !doc.root.attrs.iter().any(|(_, v)| v == NS_R) {
        doc.root.set_attr("xmlns:r", NS_R);
    }
    let ws = &mut doc.root;
    update_sheet_pr(ws, sheet);
    put(ws, WS_ORDER, "dimension", vec![XElement::new("dimension").with_attr("ref", dimension(sheet))]);
    update_sheet_views(ws, sheet, selected);
    if ws.child_local("sheetFormatPr").is_none() {
        put(ws, WS_ORDER, "sheetFormatPr", vec![XElement::new("sheetFormatPr").with_attr("defaultRowHeight", fmt_num(sheet.default_row_height))]);
    }
    put(ws, WS_ORDER, "cols", cols_el(sheet).into_iter().collect());
    put(ws, WS_ORDER, "sheetData", vec![sheet_data(sheet, sst)]);
    put(ws, WS_ORDER, "autoFilter", sheet.auto_filter.iter().map(auto_filter_el).collect());
    let merges: Vec<&String> = sheet.merges.iter().filter(|m| parse_range(m).is_some()).collect();
    put(
        ws,
        WS_ORDER,
        "mergeCells",
        if merges.is_empty() {
            vec![]
        } else {
            let mut mc = XElement::new("mergeCells").with_attr("count", merges.len().to_string());
            for m in merges {
                mc.children.push(XNode::Element(XElement::new("mergeCell").with_attr("ref", m.clone())));
            }
            vec![mc]
        },
    );
    put(ws, WS_ORDER, "conditionalFormatting", sheet.cond_formats.iter().filter(|c| !c.rules.is_empty()).map(cond_format_el).collect());
    put(
        ws,
        WS_ORDER,
        "dataValidations",
        if sheet.validations.is_empty() {
            vec![]
        } else {
            let mut dv = XElement::new("dataValidations").with_attr("count", sheet.validations.len().to_string());
            for v in &sheet.validations {
                dv.children.push(XNode::Element(validation_el(v)));
            }
            vec![dv]
        },
    );
    let hl = hyperlinks_el(pkg, part, sheet);
    let ws = &mut doc.root;
    put(ws, WS_ORDER, "hyperlinks", hl.into_iter().collect());
    // Charts made or changed in the editor (a new drawing part needs its `<drawing r:id>`).
    if let Some(rid) = crate::drawing_write::write_drawings(pkg, part, sheet, cx.wb, cx.theme, cx.fonts) {
        put(&mut doc.root, WS_ORDER, "drawing", vec![XElement::new("drawing").with_attr("r:id", rid)]);
    }
    pkg.set_xml(part, &doc);
    update_tables(pkg, sheet);
    Ok(())
}

/// A table whose rows were added or removed gets its new range; untouched
/// table parts stay byte for byte.
fn update_tables(pkg: &mut Package, sheet: &Sheet) {
    for t in sheet.tables.iter().filter(|t| !t.part.is_empty() && parse_range(&t.range).is_some()) {
        let Some(mut doc) = pkg.get_xml(&t.part) else { continue };
        if doc.root.attr("ref") == Some(t.range.as_str()) {
            continue;
        }
        doc.root.set_attr("ref", t.range.clone());
        if let Some(af) = doc.root.child_local_mut("autoFilter") {
            // The filter covers the table without its totals row.
            let r = parse_range(&t.range).unwrap();
            let last = r.r1.saturating_sub(t.totals_rows).max(r.r0);
            af.set_attr("ref", format!("{}:{}", a1(r.r0, r.c0), a1(last, r.c1)));
        }
        pkg.set_xml(&t.part, &doc);
    }
}

fn remove_part(pkg: &mut Package, part: &str) {
    pkg.parts.retain(|(n, _)| n != part);
    let mut ct = pkg.content_types();
    let pn = format!("/{part}");
    ct.root.children.retain(|n| !matches!(n, XNode::Element(e) if e.local() == "Override" && e.attr("PartName") == Some(pn.as_str())));
    pkg.set_xml("[Content_Types].xml", &ct);
}

fn remove_rel(pkg: &mut Package, owner: &str, id: &str) {
    let path = rels_path(owner);
    if let Some(mut doc) = pkg.get_xml(&path) {
        doc.root.children.retain(|n| !matches!(n, XNode::Element(e) if e.attr("Id") == Some(id)));
        pkg.set_xml(&path, &doc);
    }
}

fn new_sheet_part(pkg: &Package) -> String {
    (1..).map(|n| format!("xl/worksheets/sheet{n}.xml")).find(|p| !pkg.has(p)).unwrap()
}

/// Write the workbook. Formula results are recomputed first so the cached
/// values other readers show are current.
pub fn export_xlsx(wb: &Workbook, original: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut wb = wb.clone();
    crate::engine::recalc(&mut wb)?;
    let mut pkg = match original {
        Some(b) if !b.is_empty() => Package::read(b)?,
        _ => crate::template::new_package(),
    };
    let wb_part = workbook_part(&pkg);
    let mut wdoc = pkg.get_xml(&wb_part).ok_or("classeur introuvable")?;

    // Styles: append what the editor added.
    if wb.styles.len() > wb.base_styles {
        let part = workbook_rel_target(&pkg, &wb_part, REL_STYLES).ok_or("styles.xml introuvable")?;
        let mut sdoc = pkg.get_xml(&part).ok_or("styles.xml illisible")?;
        append_styles(&mut sdoc, &wb.styles, wb.base_styles);
        pkg.set_xml(&part, &sdoc);
    }

    let theme_doc = workbook_rel_target(&pkg, &wb_part, crate::read::REL_THEME).and_then(|p| pkg.get_xml(&p));
    let theme = crate::styles::theme_colors(theme_doc.as_ref());
    let fonts = crate::styles::theme_fonts(theme_doc.as_ref());
    let ws_ctx = WsCtx { wb: &wb, theme: &theme, fonts: &fonts };

    // Sheets: existing parts keep their element (sheetId, r:id…); new ones get a part.
    let rels = pkg.rels(&wb_part);
    let old_sheets: Vec<XElement> = wdoc.root.child_local("sheets").map(|s| s.elements().cloned().collect()).unwrap_or_default();
    let part_of = |e: &XElement| rel_id_attr(e).and_then(|id| rels.iter().find(|r| r.id == id)).map(|r| (r.id.clone(), resolve_target(&wb_part, &r.target), r.rel_type.clone()));
    let mut next_sheet_id = old_sheets.iter().filter_map(|e| e.attr("sheetId")?.parse::<u32>().ok()).max().unwrap_or(0) + 1;
    let mut sst = Sst::default();
    let mut new_elems: Vec<XElement> = Vec::new();
    let mut kept_parts: Vec<String> = Vec::new();
    let active = wb.active_sheet.min(wb.sheets.len().saturating_sub(1));
    for (i, sheet) in wb.sheets.iter().enumerate() {
        let existing = old_sheets.iter().find(|e| part_of(e).map(|(_, p, t)| p == sheet.id && t == REL_WORKSHEET).unwrap_or(false));
        let (mut el, part) = match existing {
            Some(e) => (e.clone(), sheet.id.clone()),
            None => {
                let part = new_sheet_part(&pkg);
                pkg.set(&part, crate::template::WORKSHEET.as_bytes().to_vec());
                pkg.ensure_override(&part, CT_WORKSHEET);
                let id = pkg.add_rel(&wb_part, REL_WORKSHEET, &relative_target(&wb_part, &part), false);
                let el = XElement::new("sheet").with_attr("name", "").with_attr("sheetId", next_sheet_id.to_string()).with_attr("r:id", id);
                next_sheet_id += 1;
                (el, part)
            }
        };
        el.set_attr("name", sheet.name.clone());
        match sheet.state {
            SheetState::Visible => el.remove_attr("state"),
            SheetState::Hidden => el.set_attr("state", "hidden"),
            SheetState::VeryHidden => el.set_attr("state", "veryHidden"),
        }
        write_worksheet(&mut pkg, &part, sheet, i == active, &mut sst, &ws_ctx)?;
        kept_parts.push(part);
        new_elems.push(el);
    }
    // Chart sheets and other non-grid sheets stay, after the grids.
    for e in &old_sheets {
        if let Some((_, _, t)) = part_of(e) {
            if t != REL_WORKSHEET {
                new_elems.push(e.clone());
            }
        }
    }
    // Deleted worksheets: drop the part and its relationship.
    for e in &old_sheets {
        if let Some((id, part, t)) = part_of(e) {
            if t == REL_WORKSHEET && !kept_parts.contains(&part) {
                remove_part(&mut pkg, &part);
                remove_rel(&mut pkg, &wb_part, &id);
            }
        }
    }
    let mut sheets_el = XElement::new("sheets");
    sheets_el.children = new_elems.iter().cloned().map(XNode::Element).collect();
    put(&mut wdoc.root, WB_ORDER, "sheets", vec![sheets_el]);

    // Defined names, with sheet scopes mapped to the new order.
    let index_of = |id: &str| wb.sheets.iter().position(|s| s.id == id);
    let mut names = Vec::new();
    for n in &wb.names {
        let mut e = text_el("definedName", &add_future_prefixes(&n.formula)).with_attr("name", n.name.clone());
        if let Some(scope) = &n.scope {
            match index_of(scope) {
                Some(i) => e.set_attr("localSheetId", i.to_string()),
                None => continue,
            }
        }
        if n.hidden {
            e.set_attr("hidden", "1");
        }
        names.push(e);
    }
    put(
        &mut wdoc.root,
        WB_ORDER,
        "definedNames",
        if names.is_empty() {
            vec![]
        } else {
            let mut dn = XElement::new("definedNames");
            dn.children = names.into_iter().map(XNode::Element).collect();
            vec![dn]
        },
    );

    // Active tab, and a full recalculation when Excel opens the file.
    if let Some(view) = wdoc.root.child_local_mut("bookViews").and_then(|b| b.child_local_mut("workbookView")) {
        if active == 0 {
            view.remove_attr("activeTab");
        } else {
            view.set_attr("activeTab", active.to_string());
        }
        if view.attr("firstSheet").and_then(|v| v.parse::<usize>().ok()).map(|f| f > active).unwrap_or(false) {
            view.set_attr("firstSheet", active.to_string());
        }
    }
    if wdoc.root.child_local("calcPr").is_none() {
        put(&mut wdoc.root, WB_ORDER, "calcPr", vec![XElement::new("calcPr")]);
    }
    wdoc.root.child_local_mut("calcPr").unwrap().set_attr("fullCalcOnLoad", "1");
    pkg.set_xml(&wb_part, &wdoc);

    // calcChain lists formula cells by position: stale after edits, Excel rebuilds it.
    if let Some(r) = pkg.rels(&wb_part).into_iter().find(|r| r.rel_type == REL_CALC_CHAIN) {
        let p = resolve_target(&wb_part, &r.target);
        remove_part(&mut pkg, &p);
        remove_rel(&mut pkg, &wb_part, &r.id);
    }

    // Shared strings.
    let ss_part = match workbook_rel_target(&pkg, &wb_part, REL_SHARED_STRINGS) {
        Some(p) => p,
        None => {
            let p = "xl/sharedStrings.xml".to_string();
            pkg.add_rel(&wb_part, REL_SHARED_STRINGS, &relative_target(&wb_part, &p), false);
            p
        }
    };
    pkg.set_xml(&ss_part, &sst.to_doc());
    pkg.ensure_override(&ss_part, CT_SHARED_STRINGS);
    pkg.write()
}
