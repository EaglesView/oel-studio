//! Retouched pictures (plan L-7): Office files carry the final pixels where Office expects them,
//! and OEL keeps the original and its recipe beside them, in parts Office does not read:
//!
//! ```text
//! _rels/.rels                       … Type=OEL_RETOUCH_REL → oel/img/manifest.json
//! oel/img/manifest.json             [{ rendered, renderedHash, original, recipe }]
//! oel/media/<hash>.<ext>            the originals
//! ```
//!
//! A picture whose pixels changed outside OEL (hash mismatch) loses its recipe on reading: the
//! visible image becomes the new base.

use crate::package::{mime_for_ext, rels_path, Package};
use crate::xml::XNode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub const OEL_RETOUCH_REL: &str = "https://outilsenligne.ca/relationships/oel-img";
pub const MANIFEST: &str = "oel/img/manifest.json";
const ORIGINALS: &str = "oel/media/";

/// One retouched picture as stored in the manifest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetouchEntry {
    /// Package part with the final pixels (what Office shows).
    pub rendered: String,
    /// FNV-1a 64 of `rendered`'s bytes when OEL wrote it.
    pub rendered_hash: String,
    /// Package part with the original (`oel/media/…`).
    pub original: String,
    /// `oel-img-recipe@1` JSON.
    pub recipe: Value,
}

/// What the editor holds for a retouched picture: its rendered part, its original part (in the
/// package or among the editor's media) and its recipe.
pub struct Retouch<'a> {
    pub rendered: &'a str,
    pub original: &'a str,
    pub recipe: &'a Value,
}

pub fn fnv64(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn ext_of(path: &str) -> &str {
    path.rsplit_once('.').map(|(_, e)| e).filter(|e| !e.contains('/')).unwrap_or("bin")
}

/// Writes the manifest for `items` (replacing any previous one) and copies each original into
/// `oel/media/`. Originals not in the package are taken from `media` (pictures added in the
/// editor). Items whose rendered part or original cannot be found are skipped.
pub fn write(pkg: &mut Package, items: &[Retouch], media: &HashMap<String, Vec<u8>>) {
    let mut entries = Vec::new();
    let mut keep = Vec::new();
    for it in items {
        let Some(rendered) = pkg.get(it.rendered).map(fnv64) else { continue };
        let original = pkg.get(it.original).map(|b| b.to_vec()).or_else(|| media.get(it.original).cloned());
        let Some(original) = original else { continue };
        let ext = ext_of(it.original).to_ascii_lowercase();
        let part = format!("{ORIGINALS}{}.{ext}", fnv64(&original));
        if !pkg.has(&part) {
            pkg.ensure_default(&ext, mime_for_ext(&ext));
            pkg.set(&part, original);
        }
        keep.push(part.clone());
        entries.push(RetouchEntry { rendered: it.rendered.to_string(), rendered_hash: rendered, original: part, recipe: it.recipe.clone() });
    }
    // Originals no picture uses any more go away with the old manifest.
    let stale: Vec<String> = pkg.parts.iter().map(|(n, _)| n.clone()).filter(|n| n.starts_with(ORIGINALS) && !keep.contains(n)).collect();
    for n in stale {
        pkg.remove(&n);
    }
    if entries.is_empty() {
        if pkg.has(MANIFEST) {
            pkg.remove(MANIFEST);
            // No dangling relationship to the manifest.
            let rels = rels_path("");
            if let Some(mut doc) = pkg.get_xml(&rels) {
                doc.root.children.retain(|n| !matches!(n, XNode::Element(e) if e.attr("Type") == Some(OEL_RETOUCH_REL)));
                pkg.set_xml(&rels, &doc);
            }
        }
        return;
    }
    pkg.ensure_override(MANIFEST, "application/json");
    pkg.set(MANIFEST, serde_json::to_vec_pretty(&entries).expect("manifest serialises"));
    pkg.add_rel("", OEL_RETOUCH_REL, MANIFEST, false);
}

/// The manifest's entries whose rendered part still holds the pixels OEL wrote, by rendered part.
pub fn read(pkg: &Package) -> HashMap<String, RetouchEntry> {
    let Some(bytes) = pkg.get(MANIFEST) else { return HashMap::new() };
    let Ok(entries) = serde_json::from_slice::<Vec<RetouchEntry>>(bytes) else { return HashMap::new() };
    entries
        .into_iter()
        .filter(|e| pkg.has(&e.original) && pkg.get(&e.rendered).map(fnv64).as_deref() == Some(e.rendered_hash.as_str()))
        .map(|e| (e.rendered.clone(), e))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pkg() -> Package {
        let mut p = Package { parts: vec![] };
        p.set("word/media/image1.png", b"rendered".to_vec());
        p.set("word/media/image0.png", b"original".to_vec());
        p
    }

    #[test]
    fn writes_and_reads_back() {
        let mut p = pkg();
        let recipe = json!({ "exposure": 0.5 });
        write(&mut p, &[Retouch { rendered: "word/media/image1.png", original: "word/media/image0.png", recipe: &recipe }], &HashMap::new());
        let back = read(&Package::read(&p.write().unwrap()).unwrap());
        let e = &back["word/media/image1.png"];
        assert_eq!(e.recipe, recipe);
        assert!(e.original.starts_with("oel/media/") && e.original.ends_with(".png"));
        assert!(p.rels("").iter().any(|r| r.rel_type == OEL_RETOUCH_REL));
    }

    #[test]
    fn pictures_changed_outside_oel_lose_their_recipe() {
        let mut p = pkg();
        write(&mut p, &[Retouch { rendered: "word/media/image1.png", original: "word/media/image0.png", recipe: &json!({}) }], &HashMap::new());
        p.set("word/media/image1.png", b"edited in Word".to_vec());
        assert!(read(&p).is_empty());
    }

    #[test]
    fn originals_from_the_editor_and_cleanup() {
        let mut p = pkg();
        let media = HashMap::from([("word/media/oel-a.jpg".to_string(), b"added".to_vec())]);
        write(&mut p, &[Retouch { rendered: "word/media/image1.png", original: "word/media/oel-a.jpg", recipe: &json!({}) }], &media);
        assert_eq!(p.parts.iter().filter(|(n, _)| n.starts_with("oel/media/")).count(), 1);
        write(&mut p, &[], &media);
        assert!(!p.has(MANIFEST));
        assert!(!p.rels("").iter().any(|r| r.rel_type == OEL_RETOUCH_REL));
        assert_eq!(p.parts.iter().filter(|(n, _)| n.starts_with("oel/media/")).count(), 0);
    }
}
