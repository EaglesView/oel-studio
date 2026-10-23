//! OPC package: the zip container, relationships and content types.
//!
//! Parts we do not regenerate are written back byte for byte, in their
//! original order, which is what keeps styles, themes, settings, fonts and
//! custom XML intact through an edit.

use crate::xml::{XDocument, XElement, XNode};
use std::io::{Cursor, Read, Write};

pub const REL_IMAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
pub const REL_HYPERLINK: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
pub const REL_STYLES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
pub const REL_THEME: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
pub const REL_OFFICE_DOC: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

#[derive(Debug, Clone)]
pub struct Package {
    /// Parts in archive order. Names have no leading slash (`word/document.xml`).
    pub parts: Vec<(String, Vec<u8>)>,
}

#[derive(Debug, Clone)]
pub struct Rel {
    pub id: String,
    pub rel_type: String,
    pub target: String,
    pub external: bool,
}

/// Most parts a package may hold. Office files have tens to a few thousand (a deck with many pictures).
pub const MAX_PARTS: usize = 20_000;
/// Most bytes all parts together may inflate to. Deflate expands up to ~1 000:1, so a small crafted
/// archive could otherwise ask for gigabytes; 1 GiB is beyond what the browser engines can edit anyway.
pub const MAX_INFLATED_BYTES: u64 = 1 << 30;
/// Largest buffer reserved up front from a part's *declared* size, which the archive may lie about;
/// bigger parts grow as they are read.
const MAX_RESERVE: u64 = 16 << 20;

impl Package {
    pub fn read(bytes: &[u8]) -> Result<Self, String> {
        Self::read_limited(bytes, MAX_PARTS, MAX_INFLATED_BYTES)
    }

    fn read_limited(bytes: &[u8], max_parts: usize, max_inflated: u64) -> Result<Self, String> {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("not an OOXML package (zip): {e}"))?;
        if zip.len() > max_parts {
            return Err(format!("package has {} entries, more than the {max_parts} accepted", zip.len()));
        }
        let mut parts = Vec::with_capacity(zip.len());
        let mut left = max_inflated;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            if f.is_dir() {
                continue;
            }
            let mut buf = Vec::with_capacity(f.size().min(left).min(MAX_RESERVE) as usize);
            // One byte past the budget tells an oversized package from one that fills it exactly.
            let n = (&mut f).take(left + 1).read_to_end(&mut buf).map_err(|e| e.to_string())? as u64;
            if n > left {
                return Err(format!("package inflates to more than {} MB", max_inflated >> 20));
            }
            left -= n;
            buf.shrink_to_fit();
            parts.push((f.name().trim_start_matches('/').to_string(), buf));
        }
        Ok(Package { parts })
    }

    pub fn write(&self) -> Result<Vec<u8>, String> {
        let mut out = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut out);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            // [Content_Types].xml first, as Word writes it.
            let mut order: Vec<&(String, Vec<u8>)> = self.parts.iter().collect();
            order.sort_by_key(|(n, _)| n != "[Content_Types].xml");
            for (name, data) in order {
                zip.start_file(name.as_str(), opts).map_err(|e| e.to_string())?;
                zip.write_all(data).map_err(|e| e.to_string())?;
            }
            zip.finish().map_err(|e| e.to_string())?;
        }
        Ok(out.into_inner())
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.parts.iter().find(|(n, _)| n == name).map(|(_, d)| d.as_slice())
    }

    pub fn get_str(&self, name: &str) -> Option<String> {
        self.get(name).map(|b| String::from_utf8_lossy(b).into_owned())
    }

    pub fn get_xml(&self, name: &str) -> Option<XDocument> {
        self.get_str(name).and_then(|s| XDocument::parse(&s).ok())
    }

    pub fn has(&self, name: &str) -> bool {
        self.parts.iter().any(|(n, _)| n == name)
    }

    pub fn set(&mut self, name: &str, data: Vec<u8>) {
        if let Some(slot) = self.parts.iter_mut().find(|(n, _)| n == name) {
            slot.1 = data;
        } else {
            self.parts.push((name.to_string(), data));
        }
    }

    pub fn remove(&mut self, name: &str) {
        self.parts.retain(|(n, _)| n != name);
    }

    pub fn set_xml(&mut self, name: &str, doc: &XDocument) {
        self.set(name, doc.to_string().into_bytes());
    }

    /// The main part (`word/document.xml`, `xl/workbook.xml`…), from the package relationships.
    pub fn office_document(&self) -> Option<String> {
        self.rels("").into_iter().find(|r| r.rel_type == REL_OFFICE_DOC).map(|r| resolve_target("", &r.target))
    }

    /// The part a relationship of `source` points to (first one of that type), resolved to a package path.
    pub fn part_by_rel(&self, source: &str, rel_type: &str) -> Option<String> {
        self.rels(source).into_iter().find(|r| r.rel_type == rel_type && !r.external).map(|r| resolve_target(source, &r.target))
    }

    /// Relationships of a part (`""` = the package itself).
    pub fn rels(&self, part: &str) -> Vec<Rel> {
        let Some(doc) = self.get_xml(&rels_path(part)) else { return Vec::new() };
        doc.root
            .elements()
            .filter(|e| e.local() == "Relationship")
            .map(|e| Rel {
                id: e.attr("Id").unwrap_or_default().to_string(),
                rel_type: e.attr("Type").unwrap_or_default().to_string(),
                target: e.attr("Target").unwrap_or_default().to_string(),
                external: e.attr("TargetMode") == Some("External"),
            })
            .collect()
    }

    /// Add a relationship to a part and return its id (reuses an identical one).
    pub fn add_rel(&mut self, part: &str, rel_type: &str, target: &str, external: bool) -> String {
        let path = rels_path(part);
        let mut doc = self.get_xml(&path).unwrap_or_else(|| {
            XDocument::new(XElement::new("Relationships").with_attr("xmlns", "http://schemas.openxmlformats.org/package/2006/relationships"))
        });
        for e in doc.root.elements() {
            if e.attr("Type") == Some(rel_type) && e.attr("Target") == Some(target) {
                return e.attr("Id").unwrap_or_default().to_string();
            }
        }
        let mut n = doc.root.elements().count() + 1;
        let taken: Vec<String> = doc.root.elements().filter_map(|e| e.attr("Id").map(String::from)).collect();
        let id = loop {
            let cand = format!("rIdOel{n}");
            if !taken.contains(&cand) {
                break cand;
            }
            n += 1;
        };
        let mut rel = XElement::new("Relationship").with_attr("Id", id.clone()).with_attr("Type", rel_type).with_attr("Target", target);
        if external {
            rel.set_attr("TargetMode", "External");
        }
        doc.root.children.push(XNode::Element(rel));
        self.set_xml(&path, &doc);
        id
    }

    pub fn content_types(&self) -> XDocument {
        self.get_xml("[Content_Types].xml").unwrap_or_else(|| {
            XDocument::new(XElement::new("Types").with_attr("xmlns", "http://schemas.openxmlformats.org/package/2006/content-types"))
        })
    }

    pub fn ensure_override(&mut self, part: &str, content_type: &str) {
        let mut ct = self.content_types();
        let pn = format!("/{part}");
        if !ct.root.elements().any(|e| e.local() == "Override" && e.attr("PartName") == Some(pn.as_str())) {
            ct.root.children.push(XNode::Element(XElement::new("Override").with_attr("PartName", pn).with_attr("ContentType", content_type)));
            self.set_xml("[Content_Types].xml", &ct);
        }
    }

    pub fn ensure_default(&mut self, ext: &str, content_type: &str) {
        let mut ct = self.content_types();
        let ext = ext.to_ascii_lowercase();
        if !ct.root.elements().any(|e| e.local() == "Default" && e.attr("Extension").map(|x| x.eq_ignore_ascii_case(&ext)) == Some(true)) {
            ct.root.children.insert(0, XNode::Element(XElement::new("Default").with_attr("Extension", ext).with_attr("ContentType", content_type)));
            self.set_xml("[Content_Types].xml", &ct);
        }
    }

    pub fn mime_of(&self, part: &str) -> String {
        let ct = self.content_types();
        let pn = format!("/{part}");
        if let Some(o) = ct.root.elements().find(|e| e.local() == "Override" && e.attr("PartName") == Some(pn.as_str())) {
            return o.attr("ContentType").unwrap_or_default().to_string();
        }
        let ext = part.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if let Some(d) = ct.root.elements().find(|e| e.local() == "Default" && e.attr("Extension").map(|x| x.eq_ignore_ascii_case(&ext)) == Some(true)) {
            return d.attr("ContentType").unwrap_or_default().to_string();
        }
        mime_for_ext(&ext).to_string()
    }
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "emf" => "image/x-emf",
        "wmf" => "image/x-wmf",
        _ => "application/octet-stream",
    }
}

/// `word/document.xml` → `word/_rels/document.xml.rels`; `""` → `_rels/.rels`.
pub fn rels_path(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None if part.is_empty() => "_rels/.rels".to_string(),
        None => format!("_rels/{part}.rels"),
    }
}

/// Resolve a relationship target relative to the part that owns it.
pub fn resolve_target(part: &str, target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        return abs.to_string();
    }
    let base = part.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let mut segs: Vec<&str> = if base.is_empty() { Vec::new() } else { base.split('/').collect() };
    for s in target.split('/') {
        match s {
            "." | "" => {}
            ".." => {
                segs.pop();
            }
            s => segs.push(s),
        }
    }
    segs.join("/")
}

/// Inverse of `resolve_target` for parts in the same directory tree.
pub fn relative_target(part: &str, abs: &str) -> String {
    let base = part.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
    abs.strip_prefix(&base).map(String::from).unwrap_or_else(|| format!("/{abs}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert_eq!(rels_path("word/document.xml"), "word/_rels/document.xml.rels");
        assert_eq!(rels_path(""), "_rels/.rels");
        assert_eq!(resolve_target("word/document.xml", "media/image1.png"), "word/media/image1.png");
        assert_eq!(resolve_target("word/document.xml", "../customXml/item1.xml"), "customXml/item1.xml");
        assert_eq!(resolve_target("", "word/document.xml"), "word/document.xml");
        assert_eq!(relative_target("word/document.xml", "word/media/a.png"), "media/a.png");
    }

    fn zip_of(parts: &[(&str, Vec<u8>)]) -> Vec<u8> {
        Package { parts: parts.iter().map(|(n, b)| (n.to_string(), b.clone())).collect() }.write().unwrap()
    }

    #[test]
    fn inflated_size_is_bounded() {
        // 4 MiB of zeros deflate to a few kilobytes: a small decompression bomb.
        let bomb = zip_of(&[("a.xml", vec![0; 2 << 20]), ("b.xml", vec![0; 2 << 20])]);
        assert!(bomb.len() < 64 << 10);
        assert!(Package::read_limited(&bomb, MAX_PARTS, 4 << 20).is_ok(), "exactly the budget is accepted");
        let err = Package::read_limited(&bomb, MAX_PARTS, (4 << 20) - 1).unwrap_err();
        assert!(err.contains("inflates"), "{err}");
        // The budget is shared by all parts, not per part.
        assert!(Package::read_limited(&bomb, MAX_PARTS, 3 << 20).is_err());
    }

    #[test]
    fn part_count_is_bounded() {
        let parts: Vec<(&str, Vec<u8>)> = ["a", "b", "c"].iter().map(|n| (*n, vec![1])).collect();
        let bytes = zip_of(&parts);
        assert!(Package::read_limited(&bytes, 3, MAX_INFLATED_BYTES).is_ok());
        assert!(Package::read_limited(&bytes, 2, MAX_INFLATED_BYTES).unwrap_err().contains("entries"));
    }

    /// A header claiming 4 GB must not reserve 4 GB (in WASM that aborts the engine).
    #[test]
    fn declared_sizes_are_not_trusted() {
        let mut bytes = zip_of(&[("a.xml", b"<a/>".to_vec())]);
        let huge = 0xFFFF_FFF0u32.to_le_bytes();
        for (sig, at) in [([0x50, 0x4b, 0x03, 0x04], 22), ([0x50, 0x4b, 0x01, 0x02], 24)] {
            let p = bytes.windows(4).position(|w| w == sig).unwrap();
            bytes[p + at..p + at + 4].copy_from_slice(&huge);
        }
        // The zip crate reads the part anyway (it stops at the end of the deflate stream).
        let pkg = Package::read(&bytes).unwrap();
        assert_eq!(pkg.get("a.xml"), Some(&b"<a/>"[..]));
        assert!(pkg.parts[0].1.capacity() < 1 << 20);
    }
}
