//! `styles.xml` + theme fonts → style list for the editor and CSS that makes
//! imported paragraphs look like they do in Word.

use super::package::Package;
use super::xml::{XDocument, XElement};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fmt::Write as _;

#[derive(Debug, Clone)]
pub struct StyleDef {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub based_on: Option<String>,
    pub is_default: bool,
    pub quick: bool,
    pub hidden: bool,
    pub ppr: Option<XElement>,
    pub rpr: Option<XElement>,
}

#[derive(Debug, Clone, Default)]
pub struct Styles {
    pub defs: Vec<StyleDef>,
    pub by_id: HashMap<String, usize>,
    pub default_rpr: Option<XElement>,
    pub default_ppr: Option<XElement>,
    pub minor_font: Option<String>,
    pub major_font: Option<String>,
}

/// Docs-style role of a built-in style, from its canonical (English) name.
/// Word keeps canonical names in styles.xml even when ids are localised (`Titre1`).
pub fn role_of(name: &str) -> Option<String> {
    let n = name.to_ascii_lowercase();
    match n.as_str() {
        "normal" => Some("normal".into()),
        "title" => Some("title".into()),
        "subtitle" => Some("subtitle".into()),
        "list paragraph" => Some("listParagraph".into()),
        "footnote text" => Some("footnoteText".into()),
        "footnote reference" => Some("footnoteReference".into()),
        "endnote text" => Some("endnoteText".into()),
        "endnote reference" => Some("endnoteReference".into()),
        "hyperlink" => Some("hyperlink".into()),
        "header" => Some("header".into()),
        "footer" => Some("footer".into()),
        _ => n.strip_prefix("heading ").and_then(|l| l.parse::<u8>().ok()).map(|l| format!("heading{l}")),
    }
}

impl Styles {
    pub fn load(pkg: &Package) -> Styles {
        let mut s = Styles::default();
        if let Some(theme) = pkg.get_xml("word/theme/theme1.xml") {
            let font = |name: &str| theme.root.find(name).and_then(|f| f.child("a:latin")).and_then(|l| l.attr("typeface")).filter(|t| !t.is_empty()).map(String::from);
            s.minor_font = font("a:minorFont");
            s.major_font = font("a:majorFont");
        }
        let Some(doc) = pkg.get_xml("word/styles.xml") else { return s };
        Self::from_xml(&doc, s)
    }

    fn from_xml(doc: &XDocument, mut s: Styles) -> Styles {
        if let Some(dd) = doc.root.child("w:docDefaults") {
            s.default_rpr = dd.child("w:rPrDefault").and_then(|r| r.child("w:rPr")).cloned();
            s.default_ppr = dd.child("w:pPrDefault").and_then(|r| r.child("w:pPr")).cloned();
        }
        for st in doc.root.elements().filter(|e| e.name == "w:style") {
            let id = st.attr("w:styleId").unwrap_or_default().to_string();
            if id.is_empty() {
                continue;
            }
            let def = StyleDef {
                name: st.child_val("w:name").unwrap_or(&id).to_string(),
                id: id.clone(),
                kind: st.attr("w:type").unwrap_or("paragraph").to_string(),
                based_on: st.child_val("w:basedOn").map(String::from),
                is_default: matches!(st.attr("w:default"), Some("1") | Some("true") | Some("on")),
                quick: st.child("w:qFormat").is_some(),
                hidden: st.child("w:semiHidden").is_some() || st.child("w:hidden").is_some(),
                ppr: st.child("w:pPr").cloned(),
                rpr: st.child("w:rPr").cloned(),
            };
            s.by_id.insert(id, s.defs.len());
            s.defs.push(def);
        }
        s
    }

    pub fn get(&self, id: &str) -> Option<&StyleDef> {
        self.by_id.get(id).map(|&i| &self.defs[i])
    }

    pub fn default_paragraph(&self) -> Option<&StyleDef> {
        self.defs.iter().find(|d| d.kind == "paragraph" && d.is_default)
    }

    /// Style id for a Docs role (`heading1`), whatever the document's language.
    pub fn id_for_role(&self, role: &str) -> Option<String> {
        self.defs.iter().find(|d| role_of(&d.name).as_deref() == Some(role)).map(|d| d.id.clone())
    }

    /// Basis chain from the root ancestor down to `id` (cycle-safe).
    fn chain(&self, id: &str) -> Vec<&StyleDef> {
        let mut out = Vec::new();
        let mut cur = self.get(id);
        while let Some(d) = cur {
            if out.iter().any(|o: &&StyleDef| o.id == d.id) || out.len() > 16 {
                break;
            }
            out.push(d);
            cur = d.based_on.as_deref().and_then(|b| self.get(b));
        }
        out.reverse();
        out
    }

    /// Outline level (0 = Heading 1) of a paragraph style, via its chain or its role.
    pub fn outline_of(&self, id: &str) -> Option<u8> {
        let chain = self.chain(id);
        for d in chain.iter().rev() {
            if let Some(v) = d.ppr.as_ref().and_then(|p| p.child_val("w:outlineLvl")).and_then(|v| v.parse::<u8>().ok()) {
                return if v < 9 { Some(v) } else { None };
            }
        }
        chain.last().and_then(|d| role_of(&d.name)).and_then(|r| r.strip_prefix("heading").and_then(|l| l.parse::<u8>().ok())).map(|l| l.saturating_sub(1))
    }

    pub fn to_json(&self) -> Value {
        let list: Vec<Value> = self
            .defs
            .iter()
            .filter(|d| d.kind == "paragraph" || d.kind == "character")
            .map(|d| {
                json!({
                    "id": d.id,
                    "name": d.name,
                    "kind": d.kind,
                    "role": role_of(&d.name),
                    "basedOn": d.based_on,
                    "isDefault": d.is_default,
                    "quick": d.quick,
                    "hidden": d.hidden,
                    "outline": if d.kind == "paragraph" { self.outline_of(&d.id).map(Value::from).unwrap_or(Value::Null) } else { Value::Null },
                })
            })
            .collect();
        Value::Array(list)
    }

    fn resolve_font(&self, rfonts: &XElement) -> Option<String> {
        if let Some(f) = rfonts.attr("w:ascii").or_else(|| rfonts.attr("w:hAnsi")) {
            return Some(f.to_string());
        }
        match rfonts.attr("w:asciiTheme").or_else(|| rfonts.attr("w:hAnsiTheme")) {
            Some(t) if t.starts_with("major") => self.major_font.clone(),
            Some(_) => self.minor_font.clone(),
            None => None,
        }
    }

    /// CSS declarations for a run property set, merged over `base`.
    fn rpr_decls(&self, rpr: &XElement, out: &mut Vec<(String, String)>) {
        for c in rpr.elements() {
            let on = !matches!(c.attr("w:val"), Some("0") | Some("false") | Some("off") | Some("none"));
            match c.name.as_str() {
                "w:rFonts" => {
                    if let Some(f) = self.resolve_font(c) {
                        set(out, "font-family", css_font(&f));
                    }
                }
                "w:sz" => {
                    if let Some(v) = c.attr("w:val").and_then(|v| v.parse::<f32>().ok()) {
                        set(out, "font-size", format!("{}pt", v / 2.0));
                    }
                }
                "w:b" => set(out, "font-weight", if on { "700" } else { "400" }.into()),
                "w:i" => set(out, "font-style", if on { "italic" } else { "normal" }.into()),
                "w:u" => set(out, "text-decoration-line", if on { "underline" } else { "none" }.into()),
                "w:strike" | "w:dstrike" => {
                    if on {
                        set(out, "text-decoration-line", "line-through".into())
                    }
                }
                "w:caps" => set(out, "text-transform", if on { "uppercase" } else { "none" }.into()),
                "w:smallCaps" => set(out, "font-variant-caps", if on { "small-caps" } else { "normal" }.into()),
                "w:color" => {
                    if let Some(v) = c.attr("w:val").filter(|v| *v != "auto" && v.len() == 6) {
                        set(out, "color", format!("#{v}"));
                    }
                }
                "w:spacing" => {
                    if let Some(v) = c.attr("w:val").and_then(|v| v.parse::<f32>().ok()) {
                        set(out, "letter-spacing", format!("{}pt", v / 20.0));
                    }
                }
                "w:shd" => {
                    if let Some(f) = c.attr("w:fill").filter(|f| f.len() == 6) {
                        set(out, "background-color", format!("#{f}"));
                    }
                }
                "w:vanish" => {
                    if on {
                        set(out, "display", "none".into())
                    }
                }
                _ => {}
            }
        }
    }

    fn ppr_decls(&self, ppr: &XElement, out: &mut Vec<(String, String)>) {
        for (k, v) in ppr_css(ppr) {
            set(out, &k, v);
        }
    }

    /// Stylesheet scoped under `.oel-doc`, one rule per paragraph/character style.
    pub fn css(&self) -> String {
        let mut css = String::new();
        let mut base = Vec::new();
        if let Some(r) = &self.default_rpr {
            self.rpr_decls(r, &mut base);
        }
        if !base.iter().any(|(k, _)| k == "font-family") {
            if let Some(f) = &self.minor_font {
                set(&mut base, "font-family", css_font(f));
            }
        }
        if let Some(p) = &self.default_ppr {
            self.ppr_decls(p, &mut base);
        }
        let default_id = self.default_paragraph().map(|d| d.id.clone());
        let mut normal = base.clone();
        if let Some(id) = &default_id {
            self.style_decls(id, &mut normal);
        }
        rule(&mut css, ".oel-doc .oel-p", &normal);

        for d in &self.defs {
            match d.kind.as_str() {
                "paragraph" => {
                    let mut decls = base.clone();
                    self.style_decls(&d.id, &mut decls);
                    rule(&mut css, &format!(".oel-doc .oel-p[data-style=\"{}\"]", css_escape(&d.id)), &decls);
                }
                "character" => {
                    let mut decls = Vec::new();
                    for s in self.chain(&d.id) {
                        if let Some(r) = &s.rpr {
                            self.rpr_decls(r, &mut decls);
                        }
                    }
                    rule(&mut css, &format!(".oel-doc [data-rstyle=\"{}\"]", css_escape(&d.id)), &decls);
                }
                _ => {}
            }
        }
        css
    }

    fn style_decls(&self, id: &str, decls: &mut Vec<(String, String)>) {
        for s in self.chain(id) {
            if let Some(p) = &s.ppr {
                self.ppr_decls(p, decls);
            }
            if let Some(r) = &s.rpr {
                self.rpr_decls(r, decls);
            }
        }
    }

    /// Effective default font and size, for the toolbar when nothing is set on a run.
    pub fn defaults_json(&self) -> Value {
        let mut base = Vec::new();
        if let Some(r) = &self.default_rpr {
            self.rpr_decls(r, &mut base);
        }
        if let Some(d) = self.default_paragraph() {
            self.style_decls(&d.id.clone(), &mut base);
        }
        let get = |k: &str| base.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.clone());
        let mut family = get("font-family").map(|f| f.split(',').next().unwrap_or("").trim_matches('"').trim_matches('\'').to_string());
        if family.is_none() {
            family = self.minor_font.clone();
        }
        json!({
            "fontFamily": family.unwrap_or_else(|| "Calibri".into()),
            "fontSize": get("font-size").unwrap_or_else(|| "11pt".into()),
        })
    }
}

/// CSS for the paragraph properties we render: shared by styles and direct pPr.
pub fn ppr_css(ppr: &XElement) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for c in ppr.elements() {
        match c.name.as_str() {
            "w:jc" => {
                let v = match c.attr("w:val").unwrap_or("left") {
                    "center" => "center",
                    "right" | "end" => "right",
                    "both" | "distribute" | "lowKashida" | "mediumKashida" | "highKashida" | "thaiDistribute" => "justify",
                    _ => "left",
                };
                set(&mut out, "text-align", v.into());
            }
            "w:spacing" => {
                let tw = |k: &str| c.attr(k).and_then(|v| v.parse::<f32>().ok());
                if let Some(v) = tw("w:before") {
                    set(&mut out, "margin-top", format!("{}pt", v / 20.0));
                }
                if let Some(v) = tw("w:after") {
                    set(&mut out, "margin-bottom", format!("{}pt", v / 20.0));
                }
                if let Some(line) = tw("w:line") {
                    match c.attr("w:lineRule").unwrap_or("auto") {
                        "auto" => set(&mut out, "line-height", format!("{:.3}", (line / 240.0) * 1.15)),
                        _ => set(&mut out, "line-height", format!("{}pt", line / 20.0)),
                    }
                }
            }
            "w:ind" => {
                let tw = |k: &str| c.attr(k).and_then(|v| v.parse::<f32>().ok());
                if let Some(v) = tw("w:left").or_else(|| tw("w:start")) {
                    set(&mut out, "margin-left", format!("{}pt", v / 20.0));
                }
                if let Some(v) = tw("w:right").or_else(|| tw("w:end")) {
                    set(&mut out, "margin-right", format!("{}pt", v / 20.0));
                }
                if let Some(v) = tw("w:hanging") {
                    set(&mut out, "text-indent", format!("{}pt", -v / 20.0));
                } else if let Some(v) = tw("w:firstLine") {
                    set(&mut out, "text-indent", format!("{}pt", v / 20.0));
                }
            }
            "w:shd" => {
                if let Some(f) = c.attr("w:fill").filter(|f| f.len() == 6) {
                    set(&mut out, "background-color", format!("#{f}"));
                }
            }
            "w:pBdr" => {
                for side in c.elements() {
                    let name = match side.local() {
                        "top" => "border-top",
                        "bottom" => "border-bottom",
                        "left" | "start" => "border-left",
                        "right" | "end" => "border-right",
                        _ => continue,
                    };
                    if let Some(b) = border_css(side) {
                        set(&mut out, name, b);
                        let space = side.attr("w:space").and_then(|v| v.parse::<f32>().ok()).unwrap_or(1.0);
                        set(&mut out, &name.replace("border", "padding"), format!("{space}pt"));
                    }
                }
            }
            "w:pageBreakBefore" => {
                if !matches!(c.attr("w:val"), Some("0") | Some("false")) {
                    set(&mut out, "--oel-break-before", "page".into());
                }
            }
            _ => {}
        }
    }
    out
}

pub fn border_css(side: &XElement) -> Option<String> {
    let val = side.attr("w:val")?;
    if val == "nil" || val == "none" {
        return None;
    }
    let width = side.attr("w:sz").and_then(|v| v.parse::<f32>().ok()).map(|v| v / 8.0).unwrap_or(0.5).max(0.5);
    let color = side.attr("w:color").filter(|c| c.len() == 6).map(|c| format!("#{c}")).unwrap_or_else(|| "currentColor".into());
    let style = match val {
        "double" => "double",
        "dotted" => "dotted",
        "dashed" | "dashSmallGap" | "dotDash" | "dotDotDash" => "dashed",
        _ => "solid",
    };
    Some(format!("{width}pt {style} {color}"))
}

fn set(out: &mut Vec<(String, String)>, k: &str, v: String) {
    if let Some(slot) = out.iter_mut().find(|(kk, _)| kk == k) {
        slot.1 = v;
    } else {
        out.push((k.to_string(), v));
    }
}

fn rule(css: &mut String, sel: &str, decls: &[(String, String)]) {
    if decls.is_empty() {
        return;
    }
    let _ = write!(css, "{sel}{{");
    for (k, v) in decls {
        let _ = write!(css, "{k}:{v};");
    }
    css.push_str("}\n");
}

/// Font stack with metric-compatible open fallbacks for the common Office fonts.
pub fn css_font(name: &str) -> String {
    let fallback = match name.to_ascii_lowercase().as_str() {
        "calibri" | "aptos" => "Carlito, ",
        "cambria" => "Caladea, ",
        "arial" | "helvetica" => "\"Liberation Sans\", Arimo, ",
        "times new roman" | "times" => "\"Liberation Serif\", Tinos, ",
        "courier new" | "courier" => "\"Liberation Mono\", Cousine, ",
        _ => "",
    };
    format!("\"{}\", {fallback}sans-serif", name.replace('"', ""))
}

fn css_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
