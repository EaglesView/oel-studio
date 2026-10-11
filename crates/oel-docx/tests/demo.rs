//! The demo Bureau's document (`fixtures/demo`, plan solo MVP S-3): matches the contract, holds
//! the logo, and survives a round trip.

use oeldocx::{contract, export_docx, import_docx};
use std::collections::HashMap;

fn demo() -> Vec<u8> {
    std::fs::read(format!("{}/../../fixtures/demo/À propos du Bureau.docx", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn has_image(v: &serde_json::Value) -> bool {
    v.get("type").and_then(|t| t.as_str()) == Some("image") || v.get("content").and_then(|c| c.as_array()).is_some_and(|c| c.iter().any(has_image))
}

#[test]
fn demo_document_round_trips_with_its_logo() {
    let bytes = demo();
    let a = import_docx(&bytes).unwrap();
    contract::check(&a.json).unwrap();
    assert!(has_image(&a.json["doc"]), "the logo is an inline picture");
    // `apps/web/src/bureau/demo.ts` (DOC_LOGO) links the desk's logo into this picture by its path.
    assert!(a.media.iter().any(|m| m.path == "word/media/image1.png"), "the logo is word/media/image1.png");
    let out = export_docx(&a.json, Some(&bytes), HashMap::new()).unwrap();
    let b = import_docx(&out).unwrap();
    contract::check(&b.json).unwrap();
    assert!(has_image(&b.json["doc"]));
    assert_eq!(a.json["doc"], b.json["doc"]);
}
