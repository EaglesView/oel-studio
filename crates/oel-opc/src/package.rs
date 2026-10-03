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

impl Package {
    pub fn read(bytes: &[u8]) -> Result<Self, String> {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("not an OOXML package (zip): {e}"))?;
        let mut parts = Vec::with_capacity(zip.len());
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            if f.is_dir() {
                continue;
            }
            let mut buf = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
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
        let mut doc = self.get_xml(&path).unwrap_or_else(|| XDocument {
            prolog: String::new(),
            root: XElement::new("Relationships").with_attr("xmlns", "http://schemas.openxmlformats.org/package/2006/relationships"),
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
        self.get_xml("[Content_Types].xml").unwrap_or_else(|| XDocument {
            prolog: String::new(),
            root: XElement::new("Types").with_attr("xmlns", "http://schemas.openxmlformats.org/package/2006/content-types"),
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
}
