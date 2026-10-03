//! Fonts: open substitutes for the usual Word fonts (so every machine renders
//! a document alike), and fonts embedded in the package (`word/fonts/*.odttf`,
//! obfuscated with the font key from the font table).

use super::package::{DocxPackage, Package, REL_FONT, REL_FONT_TABLE, resolve_target};
use super::styles::Styles;
use serde_json::{Value, json};

/// An open font standing in for a Word font.
pub struct Substitute {
    /// Word font names it replaces (lower case).
    pub word: &'static [&'static str],
    /// A metric-compatible or look-alike font often installed locally, tried first.
    pub local: Option<&'static str>,
    /// The web font the editor self-hosts (`@fontsource/*`) and loads on demand.
    pub open: &'static str,
    pub generic: &'static str,
    /// Licence of `open`.
    pub licence: &'static str,
}

/// Substitutes, metric-compatible ones first. All web fonts are SIL OFL 1.1 (via Fontsource).
pub const SUBSTITUTES: &[Substitute] = &[
    Substitute { word: &["calibri", "aptos"], local: None, open: "Carlito", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["cambria"], local: None, open: "Caladea", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["arial", "helvetica"], local: Some("Liberation Sans"), open: "Arimo", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["times new roman", "times"], local: Some("Liberation Serif"), open: "Tinos", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["courier new", "courier"], local: Some("Liberation Mono"), open: "Cousine", generic: "monospace", licence: "OFL-1.1" },
    Substitute { word: &["georgia"], local: None, open: "Gelasio", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["century gothic"], local: Some("TeX Gyre Adventor"), open: "Questrial", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["felix titling"], local: None, open: "Cinzel", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["gill sans", "gill sans mt"], local: None, open: "Lato", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["segoe ui", "segoe ui light", "segoe ui semibold"], local: None, open: "Open Sans", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["consolas", "lucida console"], local: None, open: "Inconsolata", generic: "monospace", licence: "OFL-1.1" },
    Substitute { word: &["garamond", "adobe garamond pro"], local: None, open: "EB Garamond", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["franklin gothic book", "franklin gothic medium", "franklin gothic demi"], local: None, open: "Libre Franklin", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["trebuchet ms"], local: None, open: "Fira Sans", generic: "sans-serif", licence: "OFL-1.1" },
];

pub fn substitute_for(name: &str) -> Option<&'static Substitute> {
    let n = name.trim().to_ascii_lowercase();
    SUBSTITUTES.iter().find(|s| s.word.contains(&n.as_str()))
}

/// CSS font stack: the Word font, then its local and web substitutes, then a generic family.
pub fn css_font(name: &str) -> String {
    let name = name.replace('"', "");
    match substitute_for(&name) {
        Some(s) => {
            let local = s.local.map(|l| format!("\"{l}\", ")).unwrap_or_default();
            format!("\"{name}\", {local}\"{}\", {}", s.open, s.generic)
        }
        None => format!("\"{name}\", sans-serif"),
    }
}

/// XOR the first 32 bytes with the font key (GUID bytes reversed, twice), per ECMA-376 Part 2.
pub fn deobfuscate(data: &mut [u8], font_key: &str) -> bool {
    let hex: String = font_key.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 32 {
        return false;
    }
    let mut key = [0u8; 16];
    for (i, k) in key.iter_mut().enumerate() {
        *k = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0);
    }
    key.reverse();
    for (i, b) in data.iter_mut().take(32).enumerate() {
        *b ^= key[i % 16];
    }
    true
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stacks_put_the_word_font_first() {
        assert_eq!(css_font("Felix Titling"), "\"Felix Titling\", \"Cinzel\", serif");
        assert_eq!(css_font("Century Gothic"), "\"Century Gothic\", \"TeX Gyre Adventor\", \"Questrial\", sans-serif");
        assert_eq!(css_font("Calibri"), "\"Calibri\", \"Carlito\", sans-serif");
        assert_eq!(css_font("Mystery"), "\"Mystery\", sans-serif");
    }

    #[test]
    fn deobfuscation_is_its_own_inverse() {
        let original: Vec<u8> = (0..64).collect();
        let mut data = original.clone();
        assert!(deobfuscate(&mut data, "{6C3B2F1A-9D4E-4B7A-8E21-0F5A3C9D7B64}"));
        assert_ne!(data, original);
        assert_eq!(&data[32..], &original[32..]);
        deobfuscate(&mut data, "{6C3B2F1A-9D4E-4B7A-8E21-0F5A3C9D7B64}");
        assert_eq!(data, original);
        assert!(!deobfuscate(&mut data, "not a guid"));
    }
}
