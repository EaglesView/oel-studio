//! WordprocessingML → ProseMirror JSON.
//!
//! The schema produced here is mirrored exactly by `@oel/docs`. Two rules keep
//! the round trip lossless:
//!
//! 1. `pPr` / `rPr` / `tcPr` … are kept whole as raw XML on the node or mark.
//!    The handful of properties the editor can change are *also* exposed as
//!    attrs; on export, an attr that still equals what the raw XML says leaves
//!    the raw element untouched (see `write.rs`).
//! 2. Anything the editor does not understand becomes an opaque
//!    `ooxmlInline` / `ooxmlBlock` atom holding its XML verbatim.

use super::numbering::Numbering;
use super::package::{Package, Rel, resolve_target};
use super::styles::{Styles, ppr_css};
use super::xml::{XElement, nodes_to_xml};
use serde_json::{Map, Value, json};
use std::collections::{BTreeSet, HashMap};

pub struct ReadCtx<'a> {
    pub pkg: &'a Package,
    pub styles: &'a Styles,
    pub numbering: &'a Numbering,
    pub part: String,
    pub rels: HashMap<String, Rel>,
    pub media: BTreeSet<String>,
}

impl<'a> ReadCtx<'a> {
    pub fn new(pkg: &'a Package, styles: &'a Styles, numbering: &'a Numbering, part: &str) -> Self {
        let rels = pkg.rels(part).into_iter().map(|r| (r.id.clone(), r)).collect();
        ReadCtx { pkg, styles, numbering, part: part.to_string(), rels, media: BTreeSet::new() }
    }

    fn rel_target(&self, id: &str) -> Option<(String, bool)> {
        self.rels.get(id).map(|r| if r.external { (r.target.clone(), true) } else { (resolve_target(&self.part, &r.target), false) })
    }
}

/// Inner XML of an element's children (what we store as raw props).
pub fn inner_xml(e: &XElement) -> String {
    nodes_to_xml(&e.children)
}

fn is_on(e: &XElement) -> bool {
    !matches!(e.attr("w:val"), Some("0") | Some("false") | Some("off") | Some("none"))
}

fn num_attr(e: &XElement, k: &str) -> Option<i64> {
    e.attr(k).and_then(|v| v.parse::<f64>().ok()).map(|v| v as i64)
}

fn node(t: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("type".into(), Value::from(t));
    m
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/// Convert the block-level children of `w:body`, `w:tc`, `w:hdr`, `w:footnote`…
pub fn read_blocks(ctx: &mut ReadCtx, parent: &XElement) -> Vec<Value> {
    let mut out = Vec::new();
    for c in parent.elements() {
        match c.name.as_str() {
            "w:p" => out.push(read_paragraph(ctx, c)),
            "w:tbl" => out.push(read_table(ctx, c)),
            "w:sdt" => out.push(read_sdt_block(ctx, c)),
            "w:sectPr" | "w:tblPr" | "w:tcPr" | "w:proofErr" => {}
            // Accept tracked block changes: keep their content.
            "w:ins" | "w:customXml" => out.extend(read_blocks(ctx, c)),
            "w:del" => {}
            _ => out.push(ooxml_block(c, &label_for(c))),
        }
    }
    out
}

fn ooxml_block(e: &XElement, label: &str) -> Value {
    let mut n = node("ooxmlBlock");
    n.insert("attrs".into(), json!({ "xml": e.to_xml(), "label": label }));
    Value::Object(n)
}

fn label_for(e: &XElement) -> String {
    match e.local() {
        "bookmarkStart" | "bookmarkEnd" => "Signet".into(),
        "oMath" | "oMathPara" => {
            let t = e.text_content();
            if t.is_empty() { "Équation".into() } else { t }
        }
        "object" | "pict" => "Objet incorporé".into(),
        "drawing" | "AlternateContent" => "Dessin".into(),
        "altChunk" => "Contenu importé".into(),
        other => other.to_string(),
    }
}

fn read_sdt_block(ctx: &mut ReadCtx, e: &XElement) -> Value {
    let content = e.child("w:sdtContent").map(|c| read_blocks(ctx, c)).unwrap_or_default();
    if content.is_empty() {
        return ooxml_block(e, "Contrôle de contenu");
    }
    let gallery = e
        .child("w:sdtPr")
        .and_then(|p| p.find("w:docPartGallery"))
        .and_then(|g| g.attr("w:val"))
        .map(String::from);
    let mut n = node("sdtBlock");
    n.insert(
        "attrs".into(),
        json!({
            "sdtPr": e.child("w:sdtPr").map(inner_xml),
            "sdtEndPr": e.child("w:sdtEndPr").map(inner_xml),
            "gallery": gallery,
        }),
    );
    n.insert("content".into(), Value::Array(content));
    Value::Object(n)
}

fn attr_map(e: Option<&XElement>, keys: &[(&str, &str)]) -> Value {
    let Some(e) = e else { return Value::Null };
    let mut m = Map::new();
    for (xml_key, json_key) in keys {
        if let Some(v) = e.attr(xml_key) {
            match v.parse::<i64>() {
                Ok(n) => m.insert((*json_key).into(), Value::from(n)),
                Err(_) => m.insert((*json_key).into(), Value::from(v)),
            };
        }
    }
    if m.is_empty() { Value::Null } else { Value::Object(m) }
}

pub const SPACING_KEYS: &[(&str, &str)] = &[("w:before", "before"), ("w:after", "after"), ("w:line", "line"), ("w:lineRule", "lineRule")];
pub const IND_KEYS: &[(&str, &str)] = &[("w:left", "left"), ("w:start", "left"), ("w:right", "right"), ("w:end", "right"), ("w:firstLine", "firstLine"), ("w:hanging", "hanging")];

pub fn align_of(ppr: Option<&XElement>) -> Option<&'static str> {
    ppr.and_then(|p| p.child_val("w:jc")).map(|v| match v {
        "center" => "center",
        "right" | "end" => "right",
        "both" | "distribute" => "justify",
        _ => "left",
    })
}

/// Paragraph attrs straight from a pPr (also used by the writer to compare).
pub fn paragraph_attrs(styles: &Styles, ppr: Option<&XElement>) -> Map<String, Value> {
    let style_id = ppr.and_then(|p| p.child_val("w:pStyle")).map(String::from);
    let num_pr = ppr.and_then(|p| p.child("w:numPr"));
    let num_id = num_pr.and_then(|n| n.child_val("w:numId")).and_then(|v| v.parse::<i64>().ok());
    let ilvl = num_pr.and_then(|n| n.child_val("w:ilvl")).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
    let outline = ppr
        .and_then(|p| p.child_val("w:outlineLvl"))
        .and_then(|v| v.parse::<u8>().ok())
        .filter(|v| *v < 9)
        .or_else(|| style_id.as_deref().and_then(|s| styles.outline_of(s)))
        .or_else(|| if style_id.is_none() { styles.default_paragraph().and_then(|d| styles.outline_of(&d.id)) } else { None });
    // Display-only CSS for what the editor renders but does not edit (borders, shading…).
    let css: Vec<String> = ppr
        .map(|p| ppr_css(p).into_iter().filter(|(k, _)| !matches!(k.as_str(), "text-align" | "margin-top" | "margin-bottom" | "line-height" | "margin-left" | "margin-right" | "text-indent")).map(|(k, v)| format!("{k}:{v}")).collect())
        .unwrap_or_default();
    let mut a = Map::new();
    a.insert("pPr".into(), ppr.map(inner_xml).filter(|s| !s.is_empty()).map(Value::from).unwrap_or(Value::Null));
    a.insert("styleId".into(), style_id.map(Value::from).unwrap_or(Value::Null));
    a.insert("align".into(), align_of(ppr).map(Value::from).unwrap_or(Value::Null));
    a.insert("spacing".into(), attr_map(ppr.and_then(|p| p.child("w:spacing")), SPACING_KEYS));
    a.insert("ind".into(), attr_map(ppr.and_then(|p| p.child("w:ind")), IND_KEYS));
    a.insert("numId".into(), num_id.map(Value::from).unwrap_or(Value::Null));
    a.insert("ilvl".into(), Value::from(ilvl));
    a.insert("outline".into(), outline.map(Value::from).unwrap_or(Value::Null));
    a.insert("css".into(), if css.is_empty() { Value::Null } else { Value::from(css.join(";")) });
    a.insert("sectionBreak".into(), Value::from(ppr.and_then(|p| p.child("w:sectPr")).is_some()));
    a.insert("checked".into(), Value::Null);
    a
}

pub fn read_paragraph(ctx: &mut ReadCtx, p: &XElement) -> Value {
    let ppr = p.child("w:pPr");
    let mut n = node("paragraph");
    n.insert("attrs".into(), Value::Object(paragraph_attrs(ctx.styles, ppr)));
    let mut inl = Vec::new();
    read_inline_children(ctx, p, &[], &mut inl);
    merge_text(&mut inl);
    if !inl.is_empty() {
        n.insert("content".into(), Value::Array(inl));
    }
    Value::Object(n)
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

fn read_table(ctx: &mut ReadCtx, t: &XElement) -> Value {
    let grid: Vec<i64> = t
        .child("w:tblGrid")
        .map(|g| g.elements().filter(|c| c.name == "w:gridCol").map(|c| num_attr(c, "w:w").unwrap_or(0)).collect())
        .unwrap_or_default();
    let style_id = t.child("w:tblPr").and_then(|p| p.child_val("w:tblStyle")).map(String::from);

    // First pass: place every w:tc on the grid, so vMerge chains become rowspans.
    struct Cell<'e> {
        el: &'e XElement,
        col: usize,
        span: usize,
        vmerge: Option<bool>, // Some(true) = restart, Some(false) = continue
    }
    let rows: Vec<&XElement> = t.elements().filter(|e| e.name == "w:tr").collect();
    let mut placed: Vec<Vec<Cell>> = Vec::new();
    for r in &rows {
        let mut col = r.child("w:trPr").and_then(|p| p.child_val("w:gridBefore")).and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
        let mut cells = Vec::new();
        for tc in r.elements().filter(|e| e.name == "w:tc") {
            let tcpr = tc.child("w:tcPr");
            let span = tcpr.and_then(|p| p.child_val("w:gridSpan")).and_then(|v| v.parse::<usize>().ok()).unwrap_or(1).max(1);
            let vmerge = tcpr.and_then(|p| p.child("w:vMerge")).map(|v| v.attr("w:val") == Some("restart"));
            cells.push(Cell { el: tc, col, span, vmerge });
            col += span;
        }
        placed.push(cells);
    }

    let mut out_rows = Vec::new();
    for (ri, r) in rows.iter().enumerate() {
        let mut cells_json = Vec::new();
        for cell in &placed[ri] {
            if cell.vmerge == Some(false) {
                // Continuation: absorbed by the restart cell above, unless orphaned.
                let has_owner = ri > 0 && placed[..ri].iter().rev().any(|row| row.iter().any(|c| c.col == cell.col && c.vmerge == Some(true)));
                if has_owner {
                    continue;
                }
            }
            let mut rowspan = 1;
            if cell.vmerge == Some(true) {
                for below in placed.iter().skip(ri + 1) {
                    if below.iter().any(|c| c.col == cell.col && c.vmerge == Some(false)) {
                        rowspan += 1;
                    } else {
                        break;
                    }
                }
            }
            let tcpr = cell.el.child("w:tcPr");
            let colwidth: Vec<Value> = (cell.col..cell.col + cell.span)
                .map(|i| grid.get(i).map(|tw| Value::from((*tw as f64 / 15.0).round() as i64)).unwrap_or(Value::Null))
                .collect();
            let colwidth = if colwidth.iter().all(|v| !v.is_null()) && !colwidth.is_empty() { Value::Array(colwidth) } else { Value::Null };
            let background = tcpr.and_then(|p| p.child("w:shd")).and_then(|s| s.attr("w:fill")).filter(|f| f.len() == 6).map(|f| format!("#{f}"));
            let valign = tcpr.and_then(|p| p.child_val("w:vAlign")).map(String::from);
            let mut content = read_blocks(ctx, cell.el);
            if content.is_empty() {
                content.push(Value::Object({
                    let mut p = node("paragraph");
                    p.insert("attrs".into(), Value::Object(paragraph_attrs(ctx.styles, None)));
                    p
                }));
            }
            let mut c = node("tableCell");
            c.insert(
                "attrs".into(),
                json!({
                    "colspan": cell.span,
                    "rowspan": rowspan,
                    "colwidth": colwidth,
                    "background": background,
                    "valign": valign,
                    "tcPr": tcpr.map(inner_xml).filter(|s| !s.is_empty()),
                }),
            );
            c.insert("content".into(), Value::Array(content));
            cells_json.push(Value::Object(c));
        }
        if cells_json.is_empty() {
            continue;
        }
        let mut row = node("tableRow");
        row.insert(
            "attrs".into(),
            json!({
                "trPr": r.child("w:trPr").map(inner_xml).filter(|s| !s.is_empty()),
                "tblPrEx": r.child("w:tblPrEx").map(inner_xml).filter(|s| !s.is_empty()),
                "header": r.child("w:trPr").and_then(|p| p.child("w:tblHeader")).is_some(),
            }),
        );
        row.insert("content".into(), Value::Array(cells_json));
        out_rows.push(Value::Object(row));
    }
    if out_rows.is_empty() {
        return ooxml_block(t, "Tableau vide");
    }
    let mut n = node("table");
    n.insert(
        "attrs".into(),
        json!({
            "tblPr": t.child("w:tblPr").map(inner_xml).filter(|s| !s.is_empty()),
            "grid": grid,
            "styleId": style_id,
        }),
    );
    n.insert("content".into(), Value::Array(out_rows));
    Value::Object(n)
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

/// Paragraph-level children (runs, hyperlinks, fields, bookmarks…).
fn read_inline_children(ctx: &mut ReadCtx, parent: &XElement, marks: &[Value], out: &mut Vec<Value>) {
    for c in parent.elements() {
        match c.name.as_str() {
            "w:pPr" | "w:proofErr" | "w:del" | "w:moveFrom" | "w:moveFromRangeStart" | "w:moveFromRangeEnd" => {}
            "w:r" => read_run(ctx, c, marks, out),
            "w:hyperlink" => {
                let href = c
                    .attr("r:id")
                    .and_then(|id| ctx.rel_target(id))
                    .map(|(t, _)| t)
                    .or_else(|| c.attr("w:anchor").map(|a| format!("#{a}")));
                let mut m = marks.to_vec();
                if let Some(href) = href {
                    m.push(json!({ "type": "link", "attrs": { "href": href } }));
                }
                read_inline_children(ctx, c, &m, out);
            }
            "w:ins" | "w:moveTo" | "w:smartTag" | "w:customXml" | "w:dir" | "w:bdo" => read_inline_children(ctx, c, marks, out),
            "w:sdt" => match c.child("w:sdtContent") {
                Some(content) => read_inline_children(ctx, content, marks, out),
                None => out.push(ooxml_inline(c.to_xml(), "Contrôle", false, None, marks)),
            },
            "w:fldSimple" => {
                let instr = c.attr("w:instr").unwrap_or("").trim().to_string();
                let field = instr.split_whitespace().next().map(|s| s.to_ascii_uppercase());
                let text = c.text_content();
                out.push(ooxml_inline(c.to_xml(), if text.is_empty() { &instr } else { &text }, false, field, marks));
            }
            "w:bookmarkStart" | "w:bookmarkEnd" | "w:commentRangeStart" | "w:commentRangeEnd" | "w:permStart" | "w:permEnd" | "w:moveToRangeStart" | "w:moveToRangeEnd" => {
                out.push(ooxml_inline(c.to_xml(), &label_for(c), true, None, &[]))
            }
            _ => out.push(ooxml_inline(c.to_xml(), &label_for(c), false, None, marks)),
        }
    }
}

fn ooxml_inline(xml: String, label: &str, hidden: bool, field: Option<String>, marks: &[Value]) -> Value {
    let mut n = node("ooxmlInline");
    n.insert("attrs".into(), json!({ "xml": xml, "label": label, "hidden": hidden, "field": field }));
    if !marks.is_empty() {
        n.insert("marks".into(), Value::Array(marks.to_vec()));
    }
    Value::Object(n)
}

/// Named `w:highlight` colours.
pub const HIGHLIGHTS: &[(&str, &str)] = &[
    ("yellow", "#FFFF00"),
    ("green", "#00FF00"),
    ("cyan", "#00FFFF"),
    ("magenta", "#FF00FF"),
    ("blue", "#0000FF"),
    ("red", "#FF0000"),
    ("darkBlue", "#000080"),
    ("darkCyan", "#008080"),
    ("darkGreen", "#008000"),
    ("darkMagenta", "#800080"),
    ("darkRed", "#800000"),
    ("darkYellow", "#808000"),
    ("darkGray", "#808080"),
    ("lightGray", "#C0C0C0"),
    ("black", "#000000"),
    ("white", "#FFFFFF"),
];

/// The run properties the editor models, as read from an rPr.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RunModel {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub sub: bool,
    pub sup: bool,
    pub font_family: Option<String>,
    pub font_size: Option<String>,
    pub color: Option<String>,
    pub highlight: Option<String>,
}

pub fn run_model(rpr: Option<&XElement>) -> RunModel {
    let mut m = RunModel::default();
    let Some(rpr) = rpr else { return m };
    for c in rpr.elements() {
        match c.name.as_str() {
            "w:b" => m.bold = is_on(c),
            "w:i" => m.italic = is_on(c),
            "w:u" => m.underline = is_on(c),
            "w:strike" => m.strike = is_on(c),
            "w:vertAlign" => match c.attr("w:val") {
                Some("subscript") => m.sub = true,
                Some("superscript") => m.sup = true,
                _ => {}
            },
            "w:rFonts" => m.font_family = c.attr("w:ascii").or_else(|| c.attr("w:hAnsi")).map(String::from),
            "w:sz" => m.font_size = c.attr("w:val").and_then(|v| v.parse::<f64>().ok()).map(|v| format!("{}pt", v / 2.0)),
            "w:color" => m.color = c.attr("w:val").filter(|v| *v != "auto" && v.len() == 6).map(|v| format!("#{}", v.to_ascii_uppercase())),
            "w:highlight" => {
                m.highlight = c.attr("w:val").and_then(|v| HIGHLIGHTS.iter().find(|(n, _)| *n == v)).map(|(_, h)| h.to_string());
            }
            "w:shd" => {
                if m.highlight.is_none() {
                    m.highlight = c.attr("w:fill").filter(|f| *f != "auto" && f.len() == 6).map(|f| format!("#{}", f.to_ascii_uppercase()));
                }
            }
            _ => {}
        }
    }
    m
}

/// Marks for a run: modeled props as editor marks, the raw rPr on `textStyle`.
pub fn run_marks(rpr: Option<&XElement>, inherited: &[Value]) -> Vec<Value> {
    let mut marks = inherited.to_vec();
    let m = run_model(rpr);
    for (on, t) in [(m.bold, "bold"), (m.italic, "italic"), (m.underline, "underline"), (m.strike, "strike"), (m.sub, "subscript"), (m.sup, "superscript")] {
        if on {
            marks.push(json!({ "type": t }));
        }
    }
    if let Some(h) = &m.highlight {
        marks.push(json!({ "type": "highlight", "attrs": { "color": h } }));
    }
    let raw = rpr.map(inner_xml).filter(|s| !s.is_empty());
    let rstyle = rpr.and_then(|r| r.child_val("w:rStyle")).map(String::from);
    if raw.is_some() || m.font_family.is_some() || m.font_size.is_some() || m.color.is_some() {
        marks.push(json!({
            "type": "textStyle",
            "attrs": {
                "fontFamily": m.font_family,
                "fontSize": m.font_size,
                "color": m.color,
                "rPr": raw,
                "rStyle": rstyle,
            }
        }));
    }
    marks
}

fn text_node(text: &str, marks: &[Value]) -> Value {
    let mut n = node("text");
    n.insert("text".into(), Value::from(text));
    if !marks.is_empty() {
        n.insert("marks".into(), Value::Array(marks.to_vec()));
    }
    Value::Object(n)
}

fn atom(t: &str, attrs: Value, marks: &[Value]) -> Value {
    let mut n = node(t);
    if !attrs.is_null() {
        n.insert("attrs".into(), attrs);
    }
    if !marks.is_empty() {
        n.insert("marks".into(), Value::Array(marks.to_vec()));
    }
    Value::Object(n)
}

/// One special run child, re-wrapped as its own run so it can be written back as is.
fn wrap_run(rpr: Option<&XElement>, child: &XElement) -> String {
    let mut s = String::from("<w:r>");
    if let Some(r) = rpr {
        r.write(&mut s);
    }
    child.write(&mut s);
    s.push_str("</w:r>");
    s
}

fn read_run(ctx: &mut ReadCtx, r: &XElement, inherited: &[Value], out: &mut Vec<Value>) {
    let rpr = r.child("w:rPr");
    let marks = run_marks(rpr, inherited);
    let mut buf = String::new();
    let flush = |buf: &mut String, out: &mut Vec<Value>| {
        if !buf.is_empty() {
            out.push(text_node(buf, &marks));
            buf.clear();
        }
    };
    for c in r.elements() {
        match c.name.as_str() {
            "w:rPr" | "w:lastRenderedPageBreak" | "w:delText" | "w:delInstrText" => {}
            "w:t" => buf.push_str(&c.text_content()),
            "w:noBreakHyphen" => buf.push('\u{2011}'),
            "w:softHyphen" => buf.push('\u{00AD}'),
            "w:tab" | "w:ptab" => {
                flush(&mut buf, out);
                out.push(atom("tab", Value::Null, &marks));
            }
            "w:cr" => {
                flush(&mut buf, out);
                out.push(atom("hardBreak", Value::Null, &marks));
            }
            "w:br" => {
                flush(&mut buf, out);
                match c.attr("w:type") {
                    Some("page") => out.push(atom("pageBreak", Value::Null, &[])),
                    Some("column") => out.push(ooxml_inline(wrap_run(rpr, c), "Saut de colonne", false, None, &[])),
                    _ => out.push(atom("hardBreak", Value::Null, &marks)),
                }
            }
            "w:footnoteReference" | "w:endnoteReference" => {
                flush(&mut buf, out);
                let kind = if c.name == "w:footnoteReference" { "footnote" } else { "endnote" };
                out.push(atom(
                    "noteRef",
                    json!({ "kind": kind, "id": c.attr("w:id").unwrap_or("0"), "rPr": rpr.map(inner_xml).filter(|s| !s.is_empty()) }),
                    &[],
                ));
            }
            "w:footnoteRef" | "w:endnoteRef" => {
                flush(&mut buf, out);
                out.push(ooxml_inline(wrap_run(rpr, c), "", false, Some("NOTENUM".into()), &[]));
            }
            "w:fldChar" | "w:instrText" => {
                flush(&mut buf, out);
                let field = if c.name == "w:instrText" { c.text_content().split_whitespace().next().map(|s| s.to_ascii_uppercase()) } else { None };
                out.push(ooxml_inline(wrap_run(rpr, c), "", true, field, &[]));
            }
            "w:drawing" => {
                flush(&mut buf, out);
                out.push(read_drawing(ctx, rpr, c, &marks));
            }
            "w:sym" => {
                flush(&mut buf, out);
                let glyph = c
                    .attr("w:char")
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .and_then(char::from_u32)
                    .map(|ch| super::numbering::bullet_glyph(&ch.to_string(), c.attr("w:font")))
                    .unwrap_or_default();
                out.push(ooxml_inline(wrap_run(rpr, c), &glyph, false, None, &marks));
            }
            _ => {
                flush(&mut buf, out);
                out.push(ooxml_inline(wrap_run(rpr, c), &label_for(c), false, None, &marks));
            }
        }
    }
    flush(&mut buf, out);
}

fn read_drawing(ctx: &mut ReadCtx, rpr: Option<&XElement>, d: &XElement, marks: &[Value]) -> Value {
    let xml = wrap_run(rpr, d);
    let blip = d.find("a:blip");
    let target = blip.and_then(|b| b.attr("r:embed")).and_then(|id| ctx.rel_target(id).map(|t| (id.to_string(), t)));
    let Some((rid, (path, external))) = target else {
        return ooxml_inline(xml, "Dessin", false, None, marks);
    };
    if external {
        return ooxml_inline(xml, "Image liée", false, None, marks);
    }
    ctx.media.insert(path.clone());
    let wrapper = d.elements().next();
    let floating = wrapper.map(|w| w.name == "wp:anchor").unwrap_or(false);
    let extent = wrapper.and_then(|w| w.child("wp:extent"));
    let doc_pr = wrapper.and_then(|w| w.child("wp:docPr"));
    atom(
        "image",
        json!({
            "src": format!("media:{path}"),
            "path": path,
            "rid": rid,
            "cx": extent.and_then(|e| num_attr(e, "cx")),
            "cy": extent.and_then(|e| num_attr(e, "cy")),
            "alt": doc_pr.and_then(|p| p.attr("descr")).unwrap_or(""),
            "title": doc_pr.and_then(|p| p.attr("title")).unwrap_or(""),
            "floating": floating,
            "xml": xml,
        }),
        marks,
    )
}

/// Merge adjacent text nodes that ended up with identical marks.
pub fn merge_text(nodes: &mut Vec<Value>) {
    let mut out: Vec<Value> = Vec::with_capacity(nodes.len());
    for n in nodes.drain(..) {
        if n["type"] == "text" {
            if let Some(last) = out.last_mut() {
                if last["type"] == "text" && last.get("marks") == n.get("marks") {
                    let joined = format!("{}{}", last["text"].as_str().unwrap_or(""), n["text"].as_str().unwrap_or(""));
                    last["text"] = Value::from(joined);
                    continue;
                }
            }
        }
        out.push(n);
    }
    *nodes = out;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/// Page geometry (twips) from a sectPr.
pub fn page_json(sect: Option<&XElement>) -> Value {
    let pg = sect.and_then(|s| s.child("w:pgSz"));
    let mar = sect.and_then(|s| s.child("w:pgMar"));
    let g = |e: Option<&XElement>, k: &str, d: i64| e.and_then(|e| num_attr(e, k)).unwrap_or(d);
    json!({
        "width": g(pg, "w:w", 12240),
        "height": g(pg, "w:h", 15840),
        "orient": pg.and_then(|p| p.attr("w:orient")).unwrap_or("portrait"),
        "top": g(mar, "w:top", 1440),
        "right": g(mar, "w:right", 1440),
        "bottom": g(mar, "w:bottom", 1440),
        "left": g(mar, "w:left", 1440),
        "header": g(mar, "w:header", 720),
        "footer": g(mar, "w:footer", 720),
        "gutter": g(mar, "w:gutter", 0),
        "titlePg": sect.and_then(|s| s.child("w:titlePg")).map(is_on).unwrap_or(false),
        "sectPr": sect.map(inner_xml),
        "background": Value::Null,
    })
}

/// Parts referenced by `w:headerReference` / `w:footerReference` in a sectPr.
pub fn header_footer_refs(ctx: &ReadCtx, sect: Option<&XElement>, tag: &str) -> Vec<(String, String)> {
    let Some(sect) = sect else { return Vec::new() };
    sect.elements()
        .filter(|e| e.name == tag)
        .filter_map(|e| {
            let kind = e.attr("w:type").unwrap_or("default").to_string();
            let (path, external) = ctx.rel_target(e.attr("r:id")?)?;
            if external { None } else { Some((kind, path)) }
        })
        .collect()
}

