//! Parts are found through the main document's relationships, not by their
//! usual names: templates often ship `theme11.xml`, `settings2.xml`…

use oeldocx::{export_docx, import_docx, package::Package};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/docx").join(name)).unwrap()
}

/// `complex_template.docx` with its numbering part moved to `word/numbering7.xml`.
fn with_renamed_numbering() -> Vec<u8> {
    let mut pkg = Package::read(&fixture("complex_template.docx")).unwrap();
    let numbering = pkg.get("word/numbering.xml").unwrap().to_vec();
    pkg.set("word/numbering7.xml", numbering);
    let rels = pkg.get_str("word/_rels/document.xml.rels").unwrap().replace("Target=\"numbering.xml\"", "Target=\"numbering7.xml\"");
    pkg.set("word/_rels/document.xml.rels", rels.into_bytes());
    pkg.set("word/numbering.xml", b"<?xml version=\"1.0\"?><w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>".to_vec());
    pkg.write().unwrap()
}

#[test]
fn theme_fonts_come_from_the_related_theme_part() {
    // The theme is word/theme/theme11.xml: body Century Gothic, headings Felix Titling.
    let j = import_docx(&fixture("complex_template.docx")).unwrap().json;
    let css = j["stylesCss"].as_str().unwrap();
    assert!(css.contains("Felix Titling"), "major theme font missing from styles CSS");
    assert!(j["defaults"]["fontFamily"].as_str().unwrap().contains("Century Gothic"), "{}", j["defaults"]);
}

#[test]
fn numbering_comes_from_the_related_part() {
    let original = import_docx(&fixture("complex_template.docx")).unwrap().json;
    let renamed = import_docx(&with_renamed_numbering()).unwrap().json;
    assert!(!original["numbering"]["nums"].as_object().unwrap().is_empty());
    assert_eq!(renamed["numbering"], original["numbering"]);
}

#[test]
fn new_lists_are_written_to_the_related_numbering_part() {
    let bytes = with_renamed_numbering();
    let mut j = import_docx(&bytes).unwrap().json;
    let num_id = j["numbering"]["maxNumId"].as_i64().unwrap() + 1;
    j["numbering"]["synthetic"] = json!([{ "numId": num_id, "kind": "bullet" }]);
    let out = Package::read(&export_docx(&j, Some(&bytes), HashMap::new()).unwrap()).unwrap();
    let tag = format!("w:numId=\"{num_id}\"");
    assert!(out.get_str("word/numbering7.xml").unwrap().contains(&tag), "new list not in the related part");
    assert!(!out.get_str("word/numbering.xml").unwrap().contains(&tag));
}

#[test]
fn page_background_is_enabled_in_the_related_settings_part() {
    // Settings live in word/settings2.xml; there is no word/settings.xml.
    let bytes = fixture("complex_template.docx");
    let mut j = import_docx(&bytes).unwrap().json;
    j["page"]["background"] = json!("#FFF4E0");
    let out = Package::read(&export_docx(&j, Some(&bytes), HashMap::new()).unwrap()).unwrap();
    assert!(out.get_str("word/settings2.xml").unwrap().contains("w:displayBackgroundShape"));
    assert!(!out.has("word/settings.xml"));
}

#[test]
fn theme_colours_come_from_the_related_theme_and_settings_parts() {
    let pkg = Package::read(&fixture("complex_template.docx")).unwrap();
    let theme = oeldocx::theme::Theme::load(&pkg);
    assert_eq!(theme.scheme_hex("accent1"), Some("F75952"));
    assert_eq!(theme.scheme_hex("tx2"), Some("2A2A2A"));
    let fill = oeldocx::xml::XDocument::parse(r#"<a:schemeClr xmlns:a="a" val="tx1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr>"#).unwrap();
    assert_eq!(theme.resolve(&fill.root).as_deref(), Some("#404040"));
}
