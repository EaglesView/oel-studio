//! OPC package: shared plumbing from `oel-opc`, plus the WordprocessingML
//! relationship and content types this codec adds.

pub use oel_opc::package::*;

pub const REL_HEADER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
pub const REL_FOOTER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
pub const REL_FOOTNOTES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes";
pub const REL_ENDNOTES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes";
pub const REL_NUMBERING: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
pub const REL_FONT_TABLE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable";
pub const REL_FONT: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
pub const REL_SETTINGS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings";

pub const CT_HEADER: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
pub const CT_FOOTER: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
pub const CT_FOOTNOTES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
pub const CT_ENDNOTES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml";
pub const CT_NUMBERING: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";

/// Where Word's parts live. Templates often rename them (`theme11.xml`,
/// `settings2.xml`), so they are found through relationships; the usual names
/// are only the fallback for packages that lack the relationship.
pub trait DocxPackage {
    /// The main document part.
    fn main_part(&self) -> String;
    /// The part the main document relates to with `rel_type`, else `word/<fallback>`.
    fn main_related(&self, rel_type: &str, fallback: &str) -> String;
}

impl DocxPackage for Package {
    fn main_part(&self) -> String {
        self.office_document().unwrap_or_else(|| "word/document.xml".to_string())
    }

    fn main_related(&self, rel_type: &str, fallback: &str) -> String {
        self.part_by_rel(&self.main_part(), rel_type).unwrap_or_else(|| format!("word/{fallback}"))
    }
}
