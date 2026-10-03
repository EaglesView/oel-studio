//! ProseMirror JSON → WordprocessingML, written into a copy of the original
//! package. Only the parts we model are regenerated (document, notes,
//! headers/footers, plus additions to numbering, styles, rels and content
//! types); every other part is copied byte for byte.

use super::package::*;
use super::read::{HIGHLIGHTS, IND_KEYS, SPACING_KEYS, paragraph_attrs, run_model, section_values, story_id};
use super::styles::Styles;
use super::template;
use super::xml::{XDocument, XElement, XNode, escape_attr, escape_text, parse_fragment};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

const PPR_ORDER: &[&str] = &[
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
    "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd",
    "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
    "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange",
];
const RPR_ORDER: &[&str] = &[
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof",
    "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd",
    "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange",
];
const TCPR_ORDER: &[&str] = &[
    "cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark",
    "headers", "cellIns", "cellDel", "cellMerge", "tcPrChange",
];
const TRPR_ORDER: &[&str] = &["cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore", "wAfter", "cantSplit", "trHeight", "tblHeader", "tblCellSpacing", "jc", "hidden", "ins", "del", "trPrChange"];
const SECTPR_ORDER: &[&str] = &[
    "headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc", "pgBorders", "lnNumType", "pgNumType",
    "cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter", "docGrid", "printerSettings", "sectPrChange",
];

/// Sort children by schema order; unknown elements keep their place relative to the previous known one.
fn sort_schema(children: &mut Vec<XElement>, order: &[&str]) {
    let mut last = 0usize;
    let mut keyed: Vec<(usize, usize, XElement)> = children
        .drain(..)
        .enumerate()
        .map(|(i, e)| {
            if let Some(k) = order.iter().position(|o| *o == e.local()) {
                last = k;
            }
            (last, i, e)
        })
        .collect();
    keyed.sort_by_key(|(k, i, _)| (*k, *i));
    children.extend(keyed.into_iter().map(|(_, _, e)| e));
}

fn frag_elements(raw: Option<&str>) -> Vec<XElement> {
    raw.and_then(|r| parse_fragment(r).ok())
        .map(|nodes| nodes.into_iter().filter_map(|n| if let XNode::Element(e) = n { Some(e) } else { None }).collect())
        .unwrap_or_default()
}

fn wrap(name: &str, children: Vec<XElement>) -> XElement {
    XElement { name: name.into(), attrs: Vec::new(), children: children.into_iter().map(XNode::Element).collect() }
}

fn el_val(name: &str, val: impl Into<String>) -> XElement {
    XElement::new(name).with_attr("w:val", val)
}

fn replace_or_insert(children: &mut Vec<XElement>, name: &str, new: Option<XElement>) {
    let pos = children.iter().position(|e| e.name == name);
    match (pos, new) {
        (Some(i), Some(n)) => children[i] = n,
        (Some(i), None) => {
            children.remove(i);
        }
        (None, Some(n)) => children.push(n),
        (None, None) => {}
    }
}

fn s(v: &Value) -> Option<&str> {
    v.as_str()
}

/// Everything export needs from the editor.
pub struct ExportInput<'a> {
    pub json: &'a Value,
    pub original: Option<&'a [u8]>,
    pub media: HashMap<String, Vec<u8>>,
}

pub fn export(input: ExportInput) -> Result<Vec<u8>, String> {
    let mut pkg = match input.original {
        Some(b) => Package::read(b)?,
        None => template::package(),
    };
    let j = input.json;
    let main = pkg.main_part();
    let styles = Styles::load(&pkg);
    let sections: Vec<Value> = j["sections"].as_array().cloned().unwrap_or_default();
    let orig_story_of_rid: HashMap<String, String> = pkg.rels(&main).into_iter().filter(|r| !r.external).map(|r| (r.id, story_id(&resolve_target(&main, &r.target)))).collect();
    let mut w = Writer {
        pkg: &mut pkg,
        styles,
        media: input.media,
        part: main.clone(),
        used_styles: HashSet::new(),
        doc_pr_ids: HashSet::new(),
        next_doc_pr: 10_000,
        notes: (note_ids(&j["notes"]["footnote"]), note_ids(&j["notes"]["endnote"])),
        prefix: None,
        content_width: 0,
        sections: sections.iter().filter_map(|sec| Some((s(&sec["id"])?.to_string(), sec.clone()))).collect(),
        section_order: sections.iter().filter_map(|sec| s(&sec["id"]).map(String::from)).collect(),
        sections_written: HashSet::new(),
        story_rids: HashMap::new(),
        orig_story_of_rid,
    };
    w.content_width = sections.first().map(content_width).unwrap_or(9360);

    // --- Numbering for lists created in the editor -----------------------
    w.write_synthetic_numbering(&j["numbering"]["synthetic"]);

    // --- Notes -------------------------------------------------------------
    for kind in ["footnote", "endnote"] {
        if j["notes"][kind].as_object().map(|m| !m.is_empty()).unwrap_or(false) || w.pkg.rels(&main).iter().any(|r| r.rel_type == if kind == "footnote" { REL_FOOTNOTES } else { REL_ENDNOTES }) {
            w.write_notes(&main, kind, &j["notes"][kind])?;
        }
    }

    // --- Headers / footers: every story some section references ------------
    let referenced: HashSet<String> = sections
        .iter()
        .flat_map(|sec| ["headers", "footers"].into_iter().flat_map(move |k| sec[k].as_object().into_iter().flat_map(|m| m.values().filter_map(|v| v.as_str().map(String::from)))))
        .collect();
    if let Some(map) = j["stories"].as_object() {
        for (id, story) in map {
            if !referenced.contains(id) {
                continue;
            }
            let header = s(&story["side"]) == Some("header");
            let (rel_type, ct, root_name, prefix) = if header { (REL_HEADER, CT_HEADER, "w:hdr", "header") } else { (REL_FOOTER, CT_FOOTER, "w:ftr", "footer") };
            let part = match s(&story["part"]).filter(|p| w.pkg.has(p)) {
                Some(p) => p.to_string(),
                None => {
                    let mut n = 1;
                    while w.pkg.has(&format!("word/{prefix}{n}.xml")) {
                        n += 1;
                    }
                    format!("word/{prefix}{n}.xml")
                }
            };
            w.write_story_part(&part, root_name, &story["doc"], &main)?;
            w.pkg.ensure_override(&part, ct);
            let rid = w.pkg.add_rel(&main, rel_type, &relative_target(&main, &part), false);
            w.story_rids.insert(id.clone(), rid);
        }
    }

    // --- Main document -----------------------------------------------------
    w.part = main.clone();
    let body = w.blocks(&j["doc"]["content"], true)?;
    let sect = w.sect_pr(sections.last().unwrap_or(&Value::Null));
    let mut doc = w.pkg.get_xml(&main).unwrap_or_else(|| XDocument::parse(template::DOCUMENT_XML).expect("template"));
    ensure_namespaces(&mut doc.root);
    let mut out = String::with_capacity(body.len() + 4096);
    out.push_str(if doc.prolog.trim().is_empty() { "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" } else { &doc.prolog });
    out.push_str(&doc.root.open_tag());
    let background = s(&j["background"]).map(|c| c.trim_start_matches('#').to_ascii_uppercase());
    let mut wrote_bg = false;
    for c in &doc.root.children {
        match c {
            XNode::Element(e) if e.name == "w:background" => {
                if let Some(bg) = &background {
                    let mut e = e.clone();
                    e.set_attr("w:color", bg.clone());
                    out.push_str(&e.to_xml());
                    wrote_bg = true;
                }
            }
            XNode::Element(e) if e.name == "w:body" => {
                if let (Some(bg), false) = (&background, wrote_bg) {
                    let _ = write!(out, "<w:background w:color=\"{bg}\"/>");
                    wrote_bg = true;
                }
                out.push_str("<w:body>");
                out.push_str(&body);
                out.push_str(&sect);
                out.push_str("</w:body>");
            }
            other => super::xml::write_node(other, &mut out),
        }
    }
    let _ = write!(out, "</{}>", doc.root.name);
    w.pkg.set(&main, out.into_bytes());
    if background.is_some() {
        w.ensure_display_background();
    }

    // --- Styles referenced but missing (new headings, links, notes…) -------
    w.ensure_styles();
    Ok(pkg.write()?)
}

fn note_ids(v: &Value) -> HashSet<String> {
    v.as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default()
}

/// Make sure the prefixes our generated XML uses are declared on the root.
fn ensure_namespaces(root: &mut XElement) {
    for (k, v) in [
        ("xmlns:w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main"),
        ("xmlns:r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"),
        ("xmlns:wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"),
        ("xmlns:a", "http://schemas.openxmlformats.org/drawingml/2006/main"),
        ("xmlns:pic", "http://schemas.openxmlformats.org/drawingml/2006/picture"),
    ] {
        if root.attr(k).is_none() {
            root.attrs.push((k.into(), v.into()));
        }
    }
}

struct Writer<'p> {
    pkg: &'p mut Package,
    styles: Styles,
    media: HashMap<String, Vec<u8>>,
    /// Part currently being written (relationships go there).
    part: String,
    used_styles: HashSet<String>,
    doc_pr_ids: HashSet<i64>,
    next_doc_pr: i64,
    notes: (HashSet<String>, HashSet<String>),
    /// Run XML to put at the start of the next paragraph (note number in notes).
    prefix: Option<String>,
    /// Text width (twips) of the section being written, for tables without widths.
    content_width: i64,
    sections: HashMap<String, Value>,
    section_order: Vec<String>,
    /// Section ids already written (a copied break must not duplicate its section).
    sections_written: HashSet<String>,
    /// Story id → relationship id from the main part.
    story_rids: HashMap<String, String>,
    /// The original package's main-part relationship ids → story ids.
    orig_story_of_rid: HashMap<String, String>,
}

/// Text width of a section, in twips.
fn content_width(sec: &Value) -> i64 {
    let p = &sec["page"];
    (p["width"].as_i64().unwrap_or(12240) - p["left"].as_i64().unwrap_or(1440) - p["right"].as_i64().unwrap_or(1440)).max(1440)
}

impl Writer<'_> {
    // -----------------------------------------------------------------------
    // Blocks
    // -----------------------------------------------------------------------

    fn blocks(&mut self, content: &Value, top: bool) -> Result<String, String> {
        let mut out = String::new();
        let empty = Vec::new();
        let list = content.as_array().unwrap_or(&empty);
        for b in list {
            self.block(b, &mut out)?;
        }
        // Word wants a paragraph after a final table, and a body is never empty.
        if top && list.last().map(|b| b["type"] == "table").unwrap_or(true) {
            out.push_str("<w:p/>");
        }
        Ok(out)
    }

    fn block(&mut self, b: &Value, out: &mut String) -> Result<(), String> {
        match s(&b["type"]).unwrap_or("") {
            "paragraph" => self.paragraph(b, out),
            "table" => self.table(b, out)?,
            "sdtBlock" => {
                out.push_str("<w:sdt>");
                if let Some(pr) = s(&b["attrs"]["sdtPr"]) {
                    let _ = write!(out, "<w:sdtPr>{pr}</w:sdtPr>");
                }
                if let Some(pr) = s(&b["attrs"]["sdtEndPr"]) {
                    let _ = write!(out, "<w:sdtEndPr>{pr}</w:sdtEndPr>");
                }
                out.push_str("<w:sdtContent>");
                for c in b["content"].as_array().into_iter().flatten() {
                    self.block(c, out)?;
                }
                out.push_str("</w:sdtContent></w:sdt>");
            }
            "ooxmlBlock" => out.push_str(s(&b["attrs"]["xml"]).unwrap_or("")),
            // Lenient: content from older editor versions or plain HTML paste.
            "heading" | "blockquote" | "codeBlock" => self.paragraph(b, out),
            "bulletList" | "orderedList" => {
                for item in b["content"].as_array().into_iter().flatten() {
                    for c in item["content"].as_array().into_iter().flatten() {
                        self.block(c, out)?;
                    }
                }
            }
            "horizontalRule" => out.push_str("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"auto\"/></w:pBdr></w:pPr></w:p>"),
            _ => {}
        }
        Ok(())
    }

    fn paragraph(&mut self, p: &Value, out: &mut String) {
        let a = &p["attrs"];
        let raw = s(&a["pPr"]);
        let mut children = frag_elements(raw);
        let orig_ppr = wrap("w:pPr", children.clone());
        let orig = paragraph_attrs(&self.styles, if raw.is_some() { Some(&orig_ppr) } else { None });

        if a["styleId"] != orig["styleId"] {
            replace_or_insert(&mut children, "w:pStyle", s(&a["styleId"]).map(|id| el_val("w:pStyle", id)));
        }
        if let Some(id) = s(&a["styleId"]) {
            self.used_styles.insert(id.to_string());
        }
        if a["align"] != orig["align"] {
            let jc = s(&a["align"]).map(|v| el_val("w:jc", if v == "justify" { "both" } else { v }));
            replace_or_insert(&mut children, "w:jc", jc);
        }
        merge_attr_map(&mut children, "w:spacing", &a["spacing"], &orig["spacing"], SPACING_KEYS);
        merge_attr_map(&mut children, "w:ind", &a["ind"], &orig["ind"], IND_KEYS);
        if a["numId"] != orig["numId"] || a["ilvl"] != orig["ilvl"] {
            let np = a["numId"].as_i64().map(|id| {
                XElement::new("w:numPr").with_child(el_val("w:ilvl", a["ilvl"].as_i64().unwrap_or(0).to_string())).with_child(el_val("w:numId", id.to_string()))
            });
            replace_or_insert(&mut children, "w:numPr", np);
        }
        // The section that ends here: its sectPr goes in this pPr (once; never the final section).
        children.retain(|e| e.name != "w:sectPr");
        if let Some(id) = s(&a["section"]) {
            let last = self.section_order.last().map(String::as_str) == Some(id);
            if !last && self.sections_written.insert(id.to_string()) {
                if let Some(sec) = self.sections.get(id).cloned() {
                    let xml = self.sect_pr(&sec);
                    children.extend(frag_elements(Some(&xml)));
                    // Blocks after this paragraph belong to the next section.
                    let next = self.section_order.iter().position(|x| x == id).and_then(|i| self.section_order.get(i + 1)).and_then(|n| self.sections.get(n));
                    if let Some(next) = next {
                        self.content_width = content_width(next);
                    }
                }
            }
        }
        sort_schema(&mut children, PPR_ORDER);

        out.push_str("<w:p>");
        if !children.is_empty() {
            out.push_str("<w:pPr>");
            for c in &children {
                c.write(out);
            }
            out.push_str("</w:pPr>");
        }
        if let Some(prefix) = self.prefix.take() {
            out.push_str(&prefix);
        }
        self.inlines(&p["content"], out);
        out.push_str("</w:p>");
    }

    // -----------------------------------------------------------------------
    // Inline
    // -----------------------------------------------------------------------

    fn inlines(&mut self, content: &Value, out: &mut String) {
        let Some(list) = content.as_array() else { return };
        let mut i = 0;
        while i < list.len() {
            let link = link_of(&list[i]);
            if let Some(href) = link {
                let mut j = i;
                let mut inner = String::new();
                while j < list.len() && link_of(&list[j]).as_deref() == Some(href.as_str()) {
                    self.inline(&list[j], true, &mut inner);
                    j += 1;
                }
                if let Some(anchor) = href.strip_prefix('#') {
                    out.push_str("<w:hyperlink w:anchor=\"");
                    escape_attr(anchor, out);
                    out.push_str("\" w:history=\"1\">");
                } else {
                    let part = self.part.clone();
                    let rid = self.pkg.add_rel(&part, REL_HYPERLINK, &href, true);
                    let _ = write!(out, "<w:hyperlink r:id=\"{rid}\" w:history=\"1\">");
                }
                out.push_str(&inner);
                out.push_str("</w:hyperlink>");
                i = j;
            } else {
                self.inline(&list[i], false, out);
                i += 1;
            }
        }
    }

    fn inline(&mut self, n: &Value, in_link: bool, out: &mut String) {
        let marks = n["marks"].as_array().cloned().unwrap_or_default();
        match s(&n["type"]).unwrap_or("") {
            "text" => {
                let rpr = self.rpr(&marks, in_link);
                let text = s(&n["text"]).unwrap_or("");
                out.push_str("<w:r>");
                out.push_str(&rpr);
                write_text(text, out);
                out.push_str("</w:r>");
            }
            "hardBreak" => {
                let _ = write!(out, "<w:r>{}<w:br/></w:r>", self.rpr(&marks, in_link));
            }
            "tab" => {
                let _ = write!(out, "<w:r>{}<w:tab/></w:r>", self.rpr(&marks, in_link));
            }
            "pageBreak" => out.push_str("<w:r><w:br w:type=\"page\"/></w:r>"),
            "noteRef" => {
                let a = &n["attrs"];
                let kind = s(&a["kind"]).unwrap_or("footnote");
                let id = a["id"].as_str().map(String::from).or_else(|| a["id"].as_i64().map(|v| v.to_string())).unwrap_or_default();
                let known = if kind == "footnote" { &self.notes.0 } else { &self.notes.1 };
                if !known.contains(&id) {
                    return; // A reference to a missing note would make Word refuse the file.
                }
                let rpr = match s(&a["rPr"]) {
                    Some(r) => r.to_string(),
                    None => {
                        let style = if kind == "footnote" { "footnoteReference" } else { "endnoteReference" };
                        match self.style_for_role(style) {
                            Some(sid) => format!("<w:rStyle w:val=\"{sid}\"/>"),
                            None => "<w:vertAlign w:val=\"superscript\"/>".into(),
                        }
                    }
                };
                let tag = if kind == "footnote" { "w:footnoteReference" } else { "w:endnoteReference" };
                let _ = write!(out, "<w:r><w:rPr>{rpr}</w:rPr><{tag} w:id=\"{id}\"/></w:r>");
            }
            "image" => self.image(n, &marks, in_link, out),
            "ooxmlInline" => out.push_str(s(&n["attrs"]["xml"]).unwrap_or("")),
            _ => {}
        }
    }

    fn style_for_role(&mut self, role: &str) -> Option<String> {
        let id = self.styles.id_for_role(role).or_else(|| template::style_id_for_role(role).map(String::from))?;
        self.used_styles.insert(id.clone());
        Some(id)
    }

    /// Merge the marks into the run's original rPr.
    fn rpr(&mut self, marks: &[Value], in_link: bool) -> String {
        let ts = marks.iter().find(|m| m["type"] == "textStyle");
        let raw = ts.and_then(|m| s(&m["attrs"]["rPr"]));
        let mut children = frag_elements(raw);
        let orig_rpr = wrap("w:rPr", children.clone());
        let orig = run_model(if raw.is_some() { Some(&orig_rpr) } else { None });
        let has = |t: &str| marks.iter().any(|m| m["type"] == t);
        let attr = |k: &str| ts.and_then(|m| s(&m["attrs"][k])).map(String::from);

        let toggles: [(&str, bool, bool, fn() -> XElement); 4] = [
            ("w:b", has("bold"), orig.bold, || XElement::new("w:b")),
            ("w:i", has("italic"), orig.italic, || XElement::new("w:i")),
            ("w:u", has("underline"), orig.underline, || el_val("w:u", "single")),
            ("w:strike", has("strike"), orig.strike, || XElement::new("w:strike")),
        ];
        for (name, now, before, make) in toggles {
            if now != before {
                replace_or_insert(&mut children, name, if now { Some(make()) } else { None });
                if !now && (name == "w:b" || name == "w:i") {
                    children.retain(|e| e.name != format!("{name}Cs"));
                }
            }
        }
        let (sub, sup) = (has("subscript"), has("superscript"));
        if sub != orig.sub || sup != orig.sup {
            let va = if sup { Some(el_val("w:vertAlign", "superscript")) } else if sub { Some(el_val("w:vertAlign", "subscript")) } else { None };
            replace_or_insert(&mut children, "w:vertAlign", va);
        }
        let family = attr("fontFamily");
        if family != orig.font_family {
            let rf = family.map(|f| XElement::new("w:rFonts").with_attr("w:ascii", f.clone()).with_attr("w:hAnsi", f.clone()).with_attr("w:eastAsia", f.clone()).with_attr("w:cs", f));
            replace_or_insert(&mut children, "w:rFonts", rf);
        }
        let size = attr("fontSize");
        if size != orig.font_size {
            let half = size.as_deref().and_then(parse_pt).map(|pt| ((pt * 2.0).round() as i64).to_string());
            let had_cs = children.iter().any(|e| e.name == "w:szCs");
            replace_or_insert(&mut children, "w:sz", half.clone().map(|h| el_val("w:sz", h)));
            if had_cs || half.is_some() {
                replace_or_insert(&mut children, "w:szCs", half.map(|h| el_val("w:szCs", h)));
            }
        }
        let color = attr("color").map(|c| normalize_hex(&c));
        if color != orig.color {
            replace_or_insert(&mut children, "w:color", color.map(|c| el_val("w:color", c.trim_start_matches('#').to_string())));
        }
        let hl = marks.iter().find(|m| m["type"] == "highlight").map(|m| s(&m["attrs"]["color"]).map(normalize_hex).unwrap_or_else(|| "#FFFF00".into()));
        if hl != orig.highlight {
            children.retain(|e| e.name != "w:highlight" && e.name != "w:shd");
            if let Some(h) = hl {
                match HIGHLIGHTS.iter().find(|(_, hex)| hex.eq_ignore_ascii_case(&h)) {
                    Some((name, _)) => children.push(el_val("w:highlight", *name)),
                    None => children.push(XElement::new("w:shd").with_attr("w:val", "clear").with_attr("w:color", "auto").with_attr("w:fill", h.trim_start_matches('#').to_string())),
                }
            }
        }
        // New text inside a link: give it the Hyperlink character style.
        if in_link && raw.is_none() && !children.iter().any(|e| e.name == "w:rStyle") {
            if let Some(id) = self.style_for_role("hyperlink") {
                children.push(el_val("w:rStyle", id));
            }
        }
        if let Some(rs) = children.iter().find(|e| e.name == "w:rStyle").and_then(|e| e.attr("w:val")) {
            self.used_styles.insert(rs.to_string());
        }
        if children.is_empty() {
            return String::new();
        }
        sort_schema(&mut children, RPR_ORDER);
        let mut out = String::from("<w:rPr>");
        for c in &children {
            c.write(&mut out);
        }
        out.push_str("</w:rPr>");
        out
    }

    fn image(&mut self, n: &Value, marks: &[Value], in_link: bool, out: &mut String) {
        let a = &n["attrs"];
        let path = s(&a["path"]).map(String::from).or_else(|| s(&a["src"]).and_then(|src| src.strip_prefix("media:")).map(String::from));
        let Some(path) = path else { return };
        if !self.pkg.has(&path) {
            let Some(bytes) = self.media.remove(&path) else { return };
            let ext = path.rsplit('.').next().unwrap_or("png").to_string();
            self.pkg.ensure_default(&ext, mime_for_ext(&ext));
            self.pkg.set(&path, bytes);
        }
        let part = self.part.clone();
        let rid = self.pkg.add_rel(&part, REL_IMAGE, &relative_target(&part, &path), false);
        let cx = a["cx"].as_i64().unwrap_or(1_905_000);
        let cy = a["cy"].as_i64().unwrap_or(1_905_000);
        let alt = s(&a["alt"]).unwrap_or("");
        let title = s(&a["title"]).unwrap_or("");

        if let Some(xml) = s(&a["xml"]) {
            if let Ok(mut run) = XDocument::parse(xml).map(|d| d.root) {
                if let Some(blip) = run.find_mut("a:blip") {
                    blip.set_attr("r:embed", rid.clone());
                }
                let floating = run.find("wp:anchor").is_some();
                let holder = if floating { "wp:anchor" } else { "wp:inline" };
                if let Some(h) = run.find_mut(holder) {
                    if let Some(ext) = h.child_mut("wp:extent") {
                        ext.set_attr("cx", cx.to_string());
                        ext.set_attr("cy", cy.to_string());
                    }
                    if let Some(pr) = h.child_mut("wp:docPr") {
                        let id = pr.attr("id").and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
                        if !self.doc_pr_ids.insert(id) {
                            let fresh = self.fresh_doc_pr();
                            pr.set_attr("id", fresh.to_string());
                        }
                        if alt.is_empty() { pr.remove_attr("descr") } else { pr.set_attr("descr", alt) }
                        if title.is_empty() { pr.remove_attr("title") } else { pr.set_attr("title", title) }
                    }
                }
                if let Some(x) = run.find_mut("pic:spPr").and_then(|sp| sp.find_mut("a:ext")) {
                    x.set_attr("cx", cx.to_string());
                    x.set_attr("cy", cy.to_string());
                }
                out.push_str(&run.to_xml());
                return;
            }
        }
        let id = self.fresh_doc_pr();
        let rpr = self.rpr(marks, in_link);
        let mut name = String::new();
        escape_attr(&format!("Image {id}"), &mut name);
        let mut alt_x = String::new();
        escape_attr(alt, &mut alt_x);
        let _ = write!(
            out,
            "<w:r>{rpr}<w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"{cx}\" cy=\"{cy}\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>\
<wp:docPr id=\"{id}\" name=\"{name}\" descr=\"{alt_x}\"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>\
<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"{id}\" name=\"{name}\"/><pic:cNvPicPr/></pic:nvPicPr>\
<pic:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>\
<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
        );
    }

    fn fresh_doc_pr(&mut self) -> i64 {
        while self.doc_pr_ids.contains(&self.next_doc_pr) {
            self.next_doc_pr += 1;
        }
        self.doc_pr_ids.insert(self.next_doc_pr);
        self.next_doc_pr
    }

    // -----------------------------------------------------------------------
    // Tables
    // -----------------------------------------------------------------------

    fn table(&mut self, t: &Value, out: &mut String) -> Result<(), String> {
        let a = &t["attrs"];
        let rows = t["content"].as_array().cloned().unwrap_or_default();

        // Place cells on the grid (rowspans occupy the rows below).
        struct Placed {
            col: usize,
            colspan: usize,
            rowspan: usize,
            cell: Value,
        }
        let mut occupied: Vec<HashMap<usize, (usize, Value)>> = vec![HashMap::new(); rows.len()]; // row → col → (span, owner)
        let mut placed: Vec<Vec<Placed>> = Vec::new();
        let mut ncols = 0;
        for (ri, r) in rows.iter().enumerate() {
            let mut col = 0;
            let mut row = Vec::new();
            for c in r["content"].as_array().into_iter().flatten() {
                while occupied[ri].contains_key(&col) {
                    col += occupied[ri][&col].0;
                }
                let colspan = c["attrs"]["colspan"].as_u64().unwrap_or(1).max(1) as usize;
                let rowspan = c["attrs"]["rowspan"].as_u64().unwrap_or(1).max(1) as usize;
                for below in 1..rowspan {
                    if ri + below < rows.len() {
                        occupied[ri + below].insert(col, (colspan, c.clone()));
                    }
                }
                row.push(Placed { col, colspan, rowspan, cell: c.clone() });
                col += colspan;
            }
            let row_end = occupied[ri].iter().map(|(c, (s, _))| c + s).max().unwrap_or(0).max(col);
            ncols = ncols.max(row_end);
            placed.push(row);
        }
        // Grid widths: editor column widths win, the original grid fills the rest.
        let orig_grid: Vec<i64> = a["grid"].as_array().map(|g| g.iter().filter_map(|v| v.as_i64()).collect()).unwrap_or_default();
        let mut grid: Vec<Option<i64>> = vec![None; ncols];
        for row in &placed {
            for p in row {
                if let Some(cw) = p.cell["attrs"]["colwidth"].as_array() {
                    for (k, px) in cw.iter().enumerate() {
                        if let (Some(px), Some(slot)) = (px.as_i64(), grid.get_mut(p.col + k)) {
                            if slot.is_none() && px > 0 {
                                let o = orig_grid.get(p.col + k).copied();
                                *slot = Some(match o {
                                    Some(o) if (o as f64 / 15.0).round() as i64 == px => o,
                                    _ => px * 15,
                                });
                            }
                        }
                    }
                }
            }
        }
        let known: i64 = grid.iter().flatten().sum();
        let unknown = grid.iter().filter(|g| g.is_none()).count() as i64;
        let fill = if unknown > 0 { ((self.content_width - known).max(unknown * 360)) / unknown } else { 0 };
        let grid: Vec<i64> = grid.iter().enumerate().map(|(i, g)| g.or_else(|| if orig_grid.len() == ncols { orig_grid.get(i).copied() } else { None }).unwrap_or(fill)).collect();

        out.push_str("<w:tbl><w:tblPr>");
        match s(&a["tblPr"]) {
            Some(raw) => out.push_str(raw),
            None => {
                if let Some(id) = self.styles.get("TableGrid").map(|_| "TableGrid".to_string()) {
                    let _ = write!(out, "<w:tblStyle w:val=\"{id}\"/>");
                }
                out.push_str("<w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders>");
                for side in ["top", "left", "bottom", "right", "insideH", "insideV"] {
                    let _ = write!(out, "<w:{side} w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>");
                }
                out.push_str("</w:tblBorders><w:tblLook w:val=\"04A0\" w:firstRow=\"1\" w:lastRow=\"0\" w:firstColumn=\"1\" w:lastColumn=\"0\" w:noHBand=\"0\" w:noVBand=\"1\"/>");
            }
        }
        out.push_str("</w:tblPr><w:tblGrid>");
        for g in &grid {
            let _ = write!(out, "<w:gridCol w:w=\"{g}\"/>");
        }
        out.push_str("</w:tblGrid>");

        for (ri, r) in rows.iter().enumerate() {
            let ra = &r["attrs"];
            out.push_str("<w:tr>");
            if let Some(ex) = s(&ra["tblPrEx"]) {
                let _ = write!(out, "<w:tblPrEx>{ex}</w:tblPrEx>");
            }
            let mut trpr = frag_elements(s(&ra["trPr"]));
            let header = ra["header"].as_bool().unwrap_or(false);
            if header != trpr.iter().any(|e| e.name == "w:tblHeader") {
                replace_or_insert(&mut trpr, "w:tblHeader", if header { Some(XElement::new("w:tblHeader")) } else { None });
            }
            if !trpr.is_empty() {
                sort_schema(&mut trpr, TRPR_ORDER);
                out.push_str("<w:trPr>");
                for e in &trpr {
                    e.write(out);
                }
                out.push_str("</w:trPr>");
            }
            let mut cells: Vec<(usize, Option<&Placed>, Option<(usize, Value)>)> = Vec::new();
            for p in &placed[ri] {
                cells.push((p.col, Some(p), None));
            }
            for (col, (span, owner)) in &occupied[ri] {
                cells.push((*col, None, Some((*span, owner.clone()))));
            }
            cells.sort_by_key(|(c, _, _)| *c);
            for (col, p, cont) in cells {
                match (p, cont) {
                    (Some(p), _) => {
                        let width: i64 = grid[p.col..(p.col + p.colspan).min(grid.len())].iter().sum();
                        let tcpr = cell_pr(&p.cell["attrs"], p.colspan, if p.rowspan > 1 { Some(true) } else { None }, width);
                        out.push_str("<w:tc>");
                        out.push_str(&tcpr);
                        let inner = self.cell_blocks(&p.cell["content"])?;
                        out.push_str(&inner);
                        out.push_str("</w:tc>");
                    }
                    (None, Some((span, owner))) => {
                        let width: i64 = grid[col..(col + span).min(grid.len())].iter().sum();
                        let tcpr = cell_pr(&owner["attrs"], span, Some(false), width);
                        let _ = write!(out, "<w:tc>{tcpr}<w:p/></w:tc>");
                    }
                    _ => {}
                }
            }
            out.push_str("</w:tr>");
        }
        out.push_str("</w:tbl>");
        Ok(())
    }

    fn cell_blocks(&mut self, content: &Value) -> Result<String, String> {
        let mut out = String::new();
        let list = content.as_array().cloned().unwrap_or_default();
        for b in &list {
            self.block(b, &mut out)?;
        }
        if !list.last().is_some_and(ends_cell) {
            out.push_str("<w:p/>");
        }
        Ok(out)
    }

    // -----------------------------------------------------------------------
    // Parts
    // -----------------------------------------------------------------------

    /// Header/footer part: keep the original root (namespaces), rewrite its content.
    fn write_story_part(&mut self, part: &str, root_name: &str, doc: &Value, main: &str) -> Result<(), String> {
        let prev = std::mem::replace(&mut self.part, part.to_string());
        let body = self.story_blocks(&doc["content"])?;
        self.part = prev;
        let root = match self.pkg.get_xml(part) {
            Some(d) => d.root,
            None => new_root(root_name, self.pkg.get_xml(main).map(|d| d.root)),
        };
        let mut root = root;
        ensure_namespaces(&mut root);
        let xml = format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n{}{}</{}>", root.open_tag(), body, root.name);
        self.pkg.set(part, xml.into_bytes());
        Ok(())
    }

    /// Blocks of a story (header, footer, note): must end with a paragraph.
    fn story_blocks(&mut self, content: &Value) -> Result<String, String> {
        let mut out = String::new();
        let list = content.as_array().cloned().unwrap_or_default();
        for b in &list {
            self.block(b, &mut out)?;
        }
        if list.last().map(|b| b["type"] != "paragraph").unwrap_or(true) {
            if let Some(prefix) = self.prefix.take() {
                let _ = write!(out, "<w:p>{prefix}</w:p>");
            } else {
                out.push_str("<w:p/>");
            }
        }
        Ok(out)
    }

    fn write_notes(&mut self, main: &str, kind: &str, notes: &Value) -> Result<(), String> {
        let (rel_type, ct, root_name, tag, ref_tag, role) = if kind == "footnote" {
            (REL_FOOTNOTES, CT_FOOTNOTES, "w:footnotes", "w:footnote", "w:footnoteRef", "footnoteReference")
        } else {
            (REL_ENDNOTES, CT_ENDNOTES, "w:endnotes", "w:endnote", "w:endnoteRef", "endnoteReference")
        };
        let part = self
            .pkg
            .rels(main)
            .into_iter()
            .find(|r| r.rel_type == rel_type)
            .map(|r| resolve_target(main, &r.target))
            .unwrap_or_else(|| format!("word/{kind}s.xml"));
        let original = self.pkg.get_xml(&part);
        let mut root = original.as_ref().map(|d| d.root.clone()).unwrap_or_else(|| new_root(root_name, self.pkg.get_xml(main).map(|d| d.root)));
        ensure_namespaces(&mut root);
        let mut body = String::new();
        // Separators and other special notes are kept as they were.
        match &original {
            Some(d) => {
                for e in d.root.elements().filter(|e| e.name == tag && e.attr("w:type").is_some()) {
                    e.write(&mut body);
                }
            }
            None => {
                let _ = write!(
                    body,
                    "<{tag} w:type=\"separator\" w:id=\"-1\"><w:p><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr><w:r><w:separator/></w:r></w:p></{tag}>\
<{tag} w:type=\"continuationSeparator\" w:id=\"0\"><w:p><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></{tag}>"
                );
            }
        }
        let prev = std::mem::replace(&mut self.part, part.clone());
        let mut entries: Vec<(&String, &Value)> = notes.as_object().map(|m| m.iter().collect()).unwrap_or_default();
        entries.sort_by_key(|(id, _)| id.parse::<i64>().unwrap_or(i64::MAX));
        for (id, doc) in entries {
            let has_ref = serde_json::to_string(doc).map(|j| j.contains(ref_tag)).unwrap_or(false);
            if !has_ref {
                let rstyle = self.style_for_role(role).map(|s| format!("<w:rStyle w:val=\"{s}\"/>")).unwrap_or_else(|| "<w:vertAlign w:val=\"superscript\"/>".into());
                self.prefix = Some(format!("<w:r><w:rPr>{rstyle}</w:rPr><{ref_tag}/></w:r><w:r><w:t xml:space=\"preserve\"> </w:t></w:r>"));
            }
            let _ = write!(body, "<{tag} w:id=\"");
            escape_attr(id, &mut body);
            body.push_str("\">");
            let inner = self.story_blocks(&doc["content"])?;
            body.push_str(&inner);
            let _ = write!(body, "</{tag}>");
            self.prefix = None;
        }
        self.part = prev;
        let xml = format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n{}{}</{}>", root.open_tag(), body, root.name);
        self.pkg.set(&part, xml.into_bytes());
        self.pkg.ensure_override(&part, ct);
        self.pkg.add_rel(main, rel_type, &relative_target(main, &part), false);
        Ok(())
    }

    /// A section's `w:sectPr`. Unchanged sections are written back exactly as read;
    /// otherwise only the modelled values that changed are patched into the original.
    fn sect_pr(&mut self, sec: &Value) -> String {
        let raw = s(&sec["sectPr"]);
        let parsed = raw.and_then(|r| frag_elements(Some(r)).into_iter().find(|e| e.name == "w:sectPr"));
        let from_raw = parsed.is_some();
        let el = parsed.unwrap_or_else(|| wrap("w:sectPr", frag_elements(Some(template::SECT_PR))));
        let orig = section_values(Some(&el));
        let orig_refs = |tag: &str| -> HashMap<String, String> {
            el.elements()
                .filter(|e| e.name == tag)
                .filter_map(|e| Some((e.attr("w:type").unwrap_or("default").to_string(), self.orig_story_of_rid.get(e.attr("r:id")?)?.clone())))
                .collect()
        };
        let new_refs = |key: &str| -> HashMap<String, String> {
            sec[key].as_object().map(|m| m.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect()).unwrap_or_default()
        };
        let hf: Vec<(&str, HashMap<String, String>, bool)> = [("w:headerReference", "headers"), ("w:footerReference", "footers")]
            .into_iter()
            .map(|(tag, key)| {
                let now = new_refs(key);
                let changed = now != orig_refs(tag);
                (tag, now, changed)
            })
            .collect();
        let changed = |k: &str| !sec[k].is_null() && sec[k] != orig[k];
        let any = ["page", "kind", "titlePg", "pgNum", "cols"].iter().any(|k| changed(k)) || hf.iter().any(|(_, _, c)| *c);
        if from_raw && !any {
            return raw.unwrap_or_default().to_string();
        }

        let mut ch: Vec<XElement> = el.elements().cloned().collect();
        if changed("page") || !from_raw {
            let page = &sec["page"];
            let g = |k: &str, d: i64| page[k].as_i64().unwrap_or(d);
            let mut pg = ch.iter().find(|e| e.name == "w:pgSz").cloned().unwrap_or_else(|| XElement::new("w:pgSz"));
            pg.set_attr("w:w", g("width", 12240).to_string());
            pg.set_attr("w:h", g("height", 15840).to_string());
            match s(&page["orient"]) {
                Some("landscape") => pg.set_attr("w:orient", "landscape"),
                _ if pg.attr("w:orient").is_some() => pg.set_attr("w:orient", "portrait"),
                _ => {}
            }
            replace_or_insert(&mut ch, "w:pgSz", Some(pg));
            let mut mar = ch.iter().find(|e| e.name == "w:pgMar").cloned().unwrap_or_else(|| XElement::new("w:pgMar"));
            for (k, d) in [("top", 1440), ("right", 1440), ("bottom", 1440), ("left", 1440), ("header", 720), ("footer", 720), ("gutter", 0)] {
                mar.set_attr(&format!("w:{k}"), g(k, d).to_string());
            }
            replace_or_insert(&mut ch, "w:pgMar", Some(mar));
        }
        if changed("kind") {
            let kind = s(&sec["kind"]).unwrap_or("nextPage");
            replace_or_insert(&mut ch, "w:type", if kind == "nextPage" { None } else { Some(el_val("w:type", kind)) });
        }
        if changed("titlePg") {
            replace_or_insert(&mut ch, "w:titlePg", if sec["titlePg"].as_bool().unwrap_or(false) { Some(XElement::new("w:titlePg")) } else { None });
        }
        if changed("pgNum") {
            let mut e = ch.iter().find(|e| e.name == "w:pgNumType").cloned().unwrap_or_else(|| XElement::new("w:pgNumType"));
            match s(&sec["pgNum"]["fmt"]).filter(|f| *f != "decimal") {
                Some(f) => e.set_attr("w:fmt", f),
                None => e.remove_attr("w:fmt"),
            }
            match sec["pgNum"]["start"].as_i64() {
                Some(n) => e.set_attr("w:start", n.to_string()),
                None => e.remove_attr("w:start"),
            }
            replace_or_insert(&mut ch, "w:pgNumType", if e.attrs.is_empty() { None } else { Some(e) });
        }
        if changed("cols") {
            let c = &sec["cols"];
            let mut e = ch.iter().find(|e| e.name == "w:cols").cloned().unwrap_or_else(|| XElement::new("w:cols"));
            let num = c["num"].as_i64().unwrap_or(1).max(1);
            if num > 1 || e.attr("w:num").is_some() {
                e.set_attr("w:num", num.to_string());
            }
            e.set_attr("w:space", c["space"].as_i64().unwrap_or(720).to_string());
            if c["equalWidth"].as_bool().unwrap_or(true) {
                e.remove_attr("w:equalWidth");
            } else {
                e.set_attr("w:equalWidth", "0");
            }
            replace_or_insert(&mut ch, "w:cols", Some(e));
        }
        for (tag, refs, changed) in &hf {
            if !*changed {
                continue;
            }
            ch.retain(|e| e.name != *tag);
            for kind in ["default", "first", "even"] {
                if let Some(rid) = refs.get(kind).and_then(|id| self.story_rids.get(id)) {
                    ch.insert(0, XElement::new(tag).with_attr("w:type", kind).with_attr("r:id", rid.clone()));
                }
            }
        }
        sort_schema(&mut ch, SECTPR_ORDER);
        let mut out = el.open_tag();
        for e in &ch {
            e.write(&mut out);
        }
        out.push_str("</w:sectPr>");
        out
    }

    fn write_synthetic_numbering(&mut self, synthetic: &Value) {
        let Some(list) = synthetic.as_array().filter(|l| !l.is_empty()) else { return };
        let main = self.pkg.main_part();
        let part = &self.pkg.main_related(REL_NUMBERING, "numbering.xml");
        let mut doc = self.pkg.get_xml(part).unwrap_or_else(|| XDocument::parse(template::NUMBERING_XML).expect("template"));
        let existing: HashSet<String> = doc.root.elements().filter(|e| e.name == "w:num").filter_map(|e| e.attr("w:numId").map(String::from)).collect();
        let mut next_abs = doc.root.elements().filter(|e| e.name == "w:abstractNum").filter_map(|e| e.attr("w:abstractNumId").and_then(|v| v.parse::<i64>().ok())).max().unwrap_or(-1) + 1;
        let mut abstracts = Vec::new();
        let mut nums = Vec::new();
        for item in list {
            let Some(num_id) = item["numId"].as_i64() else { continue };
            if existing.contains(&num_id.to_string()) {
                continue;
            }
            let kind = s(&item["kind"]).unwrap_or("bullet");
            abstracts.push(template::abstract_num(next_abs, kind));
            nums.push(XElement::new("w:num").with_attr("w:numId", num_id.to_string()).with_child(el_val("w:abstractNumId", next_abs.to_string())));
            next_abs += 1;
        }
        if abstracts.is_empty() {
            return;
        }
        // Schema: every abstractNum comes before the first num.
        let first_num = doc.root.children.iter().position(|c| matches!(c, XNode::Element(e) if e.name == "w:num")).unwrap_or(doc.root.children.len());
        for (k, a) in abstracts.into_iter().enumerate() {
            doc.root.children.insert(first_num + k, XNode::Element(a));
        }
        let insert_at = doc.root.children.iter().rposition(|c| matches!(c, XNode::Element(e) if e.name == "w:num" || e.name == "w:abstractNum")).map(|i| i + 1).unwrap_or(doc.root.children.len());
        for (k, n) in nums.into_iter().enumerate() {
            doc.root.children.insert(insert_at + k, XNode::Element(n));
        }
        self.pkg.set_xml(part, &doc);
        self.pkg.ensure_override(part, CT_NUMBERING);
        let target = relative_target(&main, part);
        self.pkg.add_rel(&main, REL_NUMBERING, &target, false);
    }

    fn ensure_styles(&mut self) {
        let missing: Vec<String> = self.used_styles.iter().filter(|id| self.styles.get(id).is_none()).cloned().collect();
        if missing.is_empty() {
            return;
        }
        let main = self.pkg.main_part();
        let part = self.pkg.main_related(REL_STYLES, "styles.xml");
        let mut doc = self.pkg.get_xml(&part).unwrap_or_else(|| XDocument::parse(&template::STYLES_XML).expect("template"));
        let tpl = XDocument::parse(&template::STYLES_XML).expect("template");
        let mut added = false;
        for id in missing {
            if let Some(st) = tpl.root.elements().find(|e| e.name == "w:style" && e.attr("w:styleId") == Some(id.as_str())) {
                doc.root.children.push(XNode::Element(st.clone()));
                added = true;
            }
        }
        if added {
            self.pkg.set_xml(&part, &doc);
            let target = relative_target(&main, &part);
            self.pkg.add_rel(&main, REL_STYLES, &target, false);
        }
    }

    fn ensure_display_background(&mut self) {
        let part = self.pkg.main_related(REL_SETTINGS, "settings.xml");
        let Some(mut doc) = self.pkg.get_xml(&part) else { return };
        if doc.root.child("w:displayBackgroundShape").is_some() {
            return;
        }
        let at = doc.root.children.iter().position(|c| matches!(c, XNode::Element(e) if !matches!(e.local(), "writeProtection" | "view" | "zoom" | "removePersonalInformation" | "removeDateAndTime" | "doNotDisplayPageBoundaries"))).unwrap_or(0);
        doc.root.children.insert(at, XNode::Element(XElement::new("w:displayBackgroundShape")));
        self.pkg.set_xml(&part, &doc);
    }
}

/// Word wants a cell to end with a paragraph; one inside a trailing content
/// control counts (Word writes cells like that), and raw blocks are trusted.
fn ends_cell(b: &Value) -> bool {
    match b["type"].as_str() {
        Some("paragraph" | "ooxmlBlock") => true,
        Some("sdtBlock") => b["content"].as_array().and_then(|c| c.last()).is_some_and(ends_cell),
        _ => false,
    }
}

fn link_of(n: &Value) -> Option<String> {
    n["marks"].as_array()?.iter().find(|m| m["type"] == "link").and_then(|m| s(&m["attrs"]["href"])).map(String::from)
}

fn new_root(name: &str, main_root: Option<XElement>) -> XElement {
    let mut root = XElement::new(name);
    if let Some(m) = main_root {
        for (k, v) in m.attrs {
            if k.starts_with("xmlns") || k == "mc:Ignorable" {
                root.attrs.push((k, v));
            }
        }
    }
    root
}

fn cell_pr(a: &Value, colspan: usize, vmerge: Option<bool>, width: i64) -> String {
    let raw = s(&a["tcPr"]);
    let mut ch = frag_elements(raw);
    let raw_w = ch.iter().find(|e| e.name == "w:tcW").and_then(|e| if e.attr("w:type") == Some("dxa") || e.attr("w:type").is_none() { e.attr("w:w").and_then(|v| v.parse::<i64>().ok()) } else { None });
    let keep_w = matches!(raw_w, Some(rw) if (rw - width).abs() <= 15) || (raw.is_some() && raw_w.is_none() && ch.iter().any(|e| e.name == "w:tcW"));
    if !keep_w {
        replace_or_insert(&mut ch, "w:tcW", Some(XElement::new("w:tcW").with_attr("w:w", width.to_string()).with_attr("w:type", "dxa")));
    }
    replace_or_insert(&mut ch, "w:gridSpan", if colspan > 1 { Some(el_val("w:gridSpan", colspan.to_string())) } else { None });
    let vm = match vmerge {
        Some(true) => Some(el_val("w:vMerge", "restart")),
        Some(false) => Some(XElement::new("w:vMerge")),
        None => None,
    };
    replace_or_insert(&mut ch, "w:vMerge", vm);
    let orig_bg = ch.iter().find(|e| e.name == "w:shd").and_then(|e| e.attr("w:fill")).filter(|f| f.len() == 6).map(|f| format!("#{}", f.to_ascii_uppercase()));
    let bg = s(&a["background"]).map(normalize_hex);
    if bg != orig_bg {
        let shd = bg.map(|b| XElement::new("w:shd").with_attr("w:val", "clear").with_attr("w:color", "auto").with_attr("w:fill", b.trim_start_matches('#').to_string()));
        replace_or_insert(&mut ch, "w:shd", shd);
    }
    let orig_va = ch.iter().find(|e| e.name == "w:vAlign").and_then(|e| e.attr("w:val")).map(String::from);
    let va = s(&a["valign"]).map(String::from);
    if va != orig_va {
        replace_or_insert(&mut ch, "w:vAlign", va.map(|v| el_val("w:vAlign", v)));
    }
    sort_schema(&mut ch, TCPR_ORDER);
    let mut out = String::from("<w:tcPr>");
    for e in &ch {
        e.write(&mut out);
    }
    out.push_str("</w:tcPr>");
    out
}

/// `spacing` / `ind`: change only the attributes the editor changed.
fn merge_attr_map(children: &mut Vec<XElement>, name: &str, now: &Value, before: &Value, keys: &[(&str, &str)]) {
    if now == before {
        return;
    }
    let mut el = children.iter().find(|e| e.name == name).cloned().unwrap_or_else(|| XElement::new(name));
    let mut seen = HashSet::new();
    for (xml_key, json_key) in keys {
        if !seen.insert(*json_key) {
            // `start` aliases `left`: only touch it if that is what the file used.
            if el.attr(xml_key).is_none() {
                continue;
            }
        }
        let n = &now[*json_key];
        let b = &before[*json_key];
        if n == b {
            continue;
        }
        let val = n.as_i64().map(|v| v.to_string()).or_else(|| n.as_str().map(String::from));
        // Prefer the alias the file already uses (w:start vs w:left).
        let key = keys.iter().filter(|(_, j)| j == json_key).map(|(x, _)| *x).find(|x| el.attr(x).is_some()).unwrap_or(xml_key);
        match val {
            Some(v) => el.set_attr(key, v),
            None => el.remove_attr(key),
        }
        if *json_key == "firstLine" && !n.is_null() {
            el.remove_attr("w:hanging");
        }
        if *json_key == "hanging" && !n.is_null() {
            el.remove_attr("w:firstLine");
        }
    }
    replace_or_insert(children, name, if el.attrs.is_empty() { None } else { Some(el) });
}

fn write_text(text: &str, out: &mut String) {
    let mut buf = String::new();
    let flush = |buf: &mut String, out: &mut String| {
        if !buf.is_empty() {
            out.push_str("<w:t xml:space=\"preserve\">");
            escape_text(buf, out);
            out.push_str("</w:t>");
            buf.clear();
        }
    };
    for c in text.chars() {
        match c {
            '\u{2011}' => {
                flush(&mut buf, out);
                out.push_str("<w:noBreakHyphen/>");
            }
            '\u{00AD}' => {
                flush(&mut buf, out);
                out.push_str("<w:softHyphen/>");
            }
            '\t' => {
                flush(&mut buf, out);
                out.push_str("<w:tab/>");
            }
            '\n' => {
                flush(&mut buf, out);
                out.push_str("<w:br/>");
            }
            c => buf.push(c),
        }
    }
    flush(&mut buf, out);
}

fn parse_pt(s: &str) -> Option<f64> {
    let s = s.trim();
    if let Some(v) = s.strip_suffix("pt") {
        return v.trim().parse().ok();
    }
    if let Some(v) = s.strip_suffix("px") {
        return v.trim().parse::<f64>().ok().map(|px| px * 0.75);
    }
    s.parse().ok()
}

fn normalize_hex(c: &str) -> String {
    let c = c.trim();
    if let Some(rgb) = c.strip_prefix("rgb(").and_then(|r| r.strip_suffix(')')) {
        let v: Vec<u8> = rgb.split(',').filter_map(|p| p.trim().parse().ok()).collect();
        if v.len() == 3 {
            return format!("#{:02X}{:02X}{:02X}", v[0], v[1], v[2]);
        }
    }
    let h = c.trim_start_matches('#');
    if h.len() == 3 {
        let e: String = h.chars().flat_map(|ch| [ch, ch]).collect();
        return format!("#{}", e.to_ascii_uppercase());
    }
    format!("#{}", h.to_ascii_uppercase())
}

