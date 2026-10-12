//! Fonts of a document: its font table and theme fonts, with the open
//! substitutes (shared with the other codecs, `oel_opc::fonts`) and the fonts
//! embedded in the package (`word/fonts/*.odttf`, obfuscated with the font key).

use super::package::{DocxPackage, Package, REL_FONT, REL_FONT_TABLE, resolve_target};
use super::styles::Styles;
use serde_json::{Value, json};

pub use oel_opc::fonts::{SUBSTITUTES, Substitute, css_font, deobfuscate, substitute_for};

/// A de-obfuscated embedded font, served to the editor as media.
pub struct EmbeddedFont {
    pub family: String,
    pub path: String,
    pub mime: &'static str,
    pub weight: u16,
    pub italic: bool,
    pub bytes: Vec<u8>,
}

/// The document's fonts (font table + theme), with their substitutes and embedded faces.
pub fn document_fonts(pkg: &Package, styles: &Styles) -> (Value, Vec<EmbeddedFont>) {
    let mut names: Vec<String> = Vec::new();
    let mut embedded: Vec<EmbeddedFont> = Vec::new();
    let table_part = pkg.main_related(REL_FONT_TABLE, "fontTable.xml");
    if let Some(doc) = pkg.get_xml(&table_part) {
        let rels = pkg.rels(&table_part);
        for f in doc.root.elements().filter(|e| e.name == "w:font") {
            let Some(name) = f.attr("w:name").filter(|n| !n.trim().is_empty()) else { continue };
            names.push(name.to_string());
            for (tag, weight, italic) in [("w:embedRegular", 400, false), ("w:embedBold", 700, false), ("w:embedItalic", 400, true), ("w:embedBoldItalic", 700, true)] {
                let Some(e) = f.child(tag) else { continue };
                let rel = e.attr("r:id").and_then(|id| rels.iter().find(|r| r.id == id && r.rel_type == REL_FONT && !r.external));
                let Some(rel) = rel else { continue };
                let part = resolve_target(&table_part, &rel.target);
                let Some(raw) = pkg.get(&part) else { continue };
                let mut bytes = raw.to_vec();
                let key = e.attr("w:fontKey").unwrap_or("");
                if !key.is_empty() && !deobfuscate(&mut bytes, key) {
                    continue;
                }
                let otf = bytes.starts_with(b"OTTO");
                let stem = part.rsplit('/').next().unwrap_or(&part).trim_end_matches(".odttf").trim_end_matches(".ttf").to_string();
                // A path of its own (never written back: the package keeps the obfuscated part).
                let path = format!("word/fonts/{stem}{}", if otf { ".otf" } else { ".ttf" });
                embedded.push(EmbeddedFont { family: name.to_string(), path, mime: if otf { "font/otf" } else { "font/ttf" }, weight, italic, bytes });
            }
        }
    }
    for t in [&styles.minor_font, &styles.major_font].into_iter().flatten() {
        if !names.iter().any(|n| n.eq_ignore_ascii_case(t)) {
            names.push(t.clone());
        }
    }
    let list: Vec<Value> = names
        .iter()
        .map(|n| {
            let faces: Vec<Value> = embedded.iter().filter(|e| &e.family == n).map(|e| json!({ "path": e.path, "weight": e.weight, "italic": e.italic })).collect();
            json!({ "name": n, "substitute": substitute_for(n).map(|s| s.open), "embedded": faces })
        })
        .collect();
    (Value::Array(list), embedded)
}
