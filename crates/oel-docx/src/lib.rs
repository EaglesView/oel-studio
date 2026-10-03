//! Lossless DOCX ↔ ProseMirror JSON codec used by the `@oel/docs` editor.
//!
//! `import_docx` turns a package into editor JSON plus everything needed to
//! render it (styles CSS, list definitions, page geometry, media).
//! `export_docx` writes editor JSON back into a copy of the original package:
//! parts the editor does not model are copied byte for byte.

pub mod contract;
pub mod numbering;
pub mod package;
pub mod read;
pub mod styles;
pub mod template;
pub mod theme;
pub mod write;
pub mod xml;

#[cfg(feature = "wasm")]
pub mod wasm;

use numbering::Numbering;
use package::{DocxPackage, Package, REL_ENDNOTES, REL_FOOTNOTES, REL_SETTINGS, resolve_target};
use read::{ReadCtx, read_blocks, section_json};
use serde_json::{Map, Value, json};
use std::collections::{BTreeSet, HashMap};
use styles::Styles;

pub const FORMAT_VERSION: u32 = 2;

pub struct Media {
    pub path: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

pub struct Imported {
    pub json: Value,
    pub media: Vec<Media>,
}

pub fn import_docx(bytes: &[u8]) -> Result<Imported, String> {
    let pkg = Package::read(bytes)?;
    import_package(&pkg)
}

/// A new, empty document (the built-in template run through the importer).
pub fn new_document() -> Imported {
    import_package(&template::package()).expect("template imports")
}

fn import_package(pkg: &Package) -> Result<Imported, String> {
    let main = pkg.main_part();
    let doc = pkg.get_xml(&main).ok_or_else(|| format!("missing or invalid {main}"))?;
    let styles = Styles::load(pkg);
    let numbering = Numbering::load(pkg, &styles);
    let body = doc.root.child("w:body").ok_or("document has no w:body")?;
    let mut media: BTreeSet<String> = BTreeSet::new();

    let mut ctx = ReadCtx::body(pkg, &styles, &numbering, &main);
    let mut content = read_blocks(&mut ctx, body);
    if content.is_empty() {
        content.push(json!({ "type": "paragraph", "attrs": read::paragraph_attrs(&styles, None) }));
    }
    let last = section_json(&mut ctx, "body", body.child("w:sectPr"));
    let mut sections = ctx.sections.take().unwrap_or_default();
    sections.push(last);
    let background = doc.root.child("w:background").and_then(|b| b.attr("w:color")).filter(|c| c.len() == 6).map(|c| format!("#{c}"));
    let main_rels = pkg.rels(&main);
    media.extend(std::mem::take(&mut ctx.media));

    // Headers and footers, one story per part, whichever sections reference them.
    let mut stories = Map::new();
    for (id, (side, part)) in std::mem::take(&mut ctx.stories) {
        let root = if side == "header" { "w:hdr" } else { "w:ftr" };
        let Some(d) = pkg.get_xml(&part).filter(|d| d.root.name == root) else { continue };
        let mut c = ReadCtx::new(pkg, &styles, &numbering, &part);
        let blocks = read_blocks(&mut c, &d.root);
        media.extend(c.media);
        stories.insert(id, json!({ "part": part, "side": side, "doc": { "type": "doc", "content": blocks } }));
    }
    // A reference to a missing or invalid part is dropped (Word ignores it too).
    for sec in &mut sections {
        for key in ["headers", "footers"] {
            if let Some(refs) = sec[key].as_object_mut() {
                refs.retain(|_, v| v.as_str().is_some_and(|id| stories.contains_key(id)));
            }
        }
    }

    let settings = pkg.get_xml(&pkg.main_related(REL_SETTINGS, "settings.xml"));
    let flag = |name: &str| settings.as_ref().and_then(|d| d.root.child(name)).is_some_and(|e| !matches!(e.attr("w:val"), Some("0" | "false" | "off")));
    let default_tab = settings.as_ref().and_then(|d| d.root.child_val("w:defaultTabStop")).and_then(|v| v.parse::<i64>().ok()).unwrap_or(720);

    let mut notes = Map::new();
    for (kind, rel_type, root, tag) in [("footnote", REL_FOOTNOTES, "w:footnotes", "w:footnote"), ("endnote", REL_ENDNOTES, "w:endnotes", "w:endnote")] {
        let mut m = Map::new();
        if let Some(rel) = main_rels.iter().find(|r| r.rel_type == rel_type) {
            let part = resolve_target(&main, &rel.target);
            if let Some(d) = pkg.get_xml(&part).filter(|d| d.root.name == root) {
                let mut c = ReadCtx::new(pkg, &styles, &numbering, &part);
                for n in d.root.elements().filter(|e| e.name == tag && e.attr("w:type").is_none()) {
                    let id = n.attr("w:id").unwrap_or("0").to_string();
                    let blocks = read_blocks(&mut c, n);
                    m.insert(id, json!({ "type": "doc", "content": blocks }));
                }
                media.extend(c.media);
            }
        }
        notes.insert(kind.into(), Value::Object(m));
    }

    let title = pkg
        .get_xml("docProps/core.xml")
        .and_then(|d| d.root.child("dc:title").map(|t| t.text_content()))
        .filter(|t| !t.trim().is_empty());

    let media: Vec<Media> = media
        .into_iter()
        .filter_map(|path| pkg.get(&path).map(|b| Media { mime: pkg.mime_of(&path), bytes: b.to_vec(), path }))
        .collect();

    let mut style_list = styles.to_json();
    // List definitions inherited from styles (e.g. "List Bullet").
    if let Some(arr) = style_list.as_array_mut() {
        for s in arr {
            let id = s["id"].as_str().unwrap_or_default().to_string();
            let np = styles.get(&id).and_then(|d| d.ppr.as_ref()).and_then(|p| p.child("w:numPr"));
            s["numId"] = np.and_then(|n| n.child_val("w:numId")).and_then(|v| v.parse::<i64>().ok()).map(Value::from).unwrap_or(Value::Null);
        }
    }

    let json = json!({
        "version": FORMAT_VERSION,
        "doc": { "type": "doc", "content": content },
        "notes": notes,
        "stories": stories,
        "sections": sections,
        "settings": { "evenAndOddHeaders": flag("w:evenAndOddHeaders"), "defaultTabStop": default_tab, "mirrorMargins": flag("w:mirrorMargins") },
        "background": background,
        "styles": style_list,
        "stylesCss": styles.css(),
        "defaults": styles.defaults_json(),
        "numbering": numbering.to_json(),
        "title": title,
        "media": media.iter().map(|m| json!({ "path": m.path, "mime": m.mime })).collect::<Vec<_>>(),
    });
    Ok(Imported { json, media })
}

/// Write editor JSON into a copy of `original` (or a new package).
/// `media` holds bytes for images added in the editor, keyed by package path.
pub fn export_docx(json: &Value, original: Option<&[u8]>, media: HashMap<String, Vec<u8>>) -> Result<Vec<u8>, String> {
    write::export(write::ExportInput { json, original, media })
}
