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
use package::{DocxPackage, Package, REL_ENDNOTES, REL_FOOTNOTES, resolve_target};
use read::{ReadCtx, header_footer_refs, page_json, read_blocks};
use serde_json::{Map, Value, json};
use std::collections::{BTreeSet, HashMap};
use styles::Styles;

pub const FORMAT_VERSION: u32 = 1;

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

    let mut ctx = ReadCtx::new(pkg, &styles, &numbering, &main);
    let mut content = read_blocks(&mut ctx, body);
    if content.is_empty() {
        content.push(json!({ "type": "paragraph", "attrs": read::paragraph_attrs(&styles, None) }));
    }
    let sect = body.child("w:sectPr");
    let mut page = page_json(sect);
    if let Some(bg) = doc.root.child("w:background").and_then(|b| b.attr("w:color")).filter(|c| c.len() == 6) {
        page["background"] = Value::from(format!("#{bg}"));
    }
    let header_refs = header_footer_refs(&ctx, sect, "w:headerReference");
    let footer_refs = header_footer_refs(&ctx, sect, "w:footerReference");
    let main_rels = pkg.rels(&main);
    media.extend(std::mem::take(&mut ctx.media));

    let mut story = |refs: Vec<(String, String)>, root: &str| -> Map<String, Value> {
        let mut out = Map::new();
        for (kind, part) in refs {
            let Some(d) = pkg.get_xml(&part) else { continue };
            if d.root.name != root {
                continue;
            }
            let mut c = ReadCtx::new(pkg, &styles, &numbering, &part);
            let blocks = read_blocks(&mut c, &d.root);
            media.extend(c.media);
            out.insert(kind, json!({ "part": part, "doc": { "type": "doc", "content": blocks } }));
        }
        out
    };
    let headers = story(header_refs, "w:hdr");
    let footers = story(footer_refs, "w:ftr");

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
        "headers": headers,
        "footers": footers,
        "page": page,
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
