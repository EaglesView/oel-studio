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

/// Plan solo MVP R1: a chart made in the editor (a linked copy: no XML, a spec) reaches the .docx.
#[test]
fn editor_made_chart_is_written() {
    let charts = std::fs::read(format!("{}/../../fixtures/charts/generated-charts.docx", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let spec = {
        fn first_chart(v: &serde_json::Value) -> Option<serde_json::Value> {
            if v["type"] == "ooxmlInline" && !v["attrs"]["chart"].is_null() {
                return Some(v["attrs"]["chart"].clone());
            }
            v["content"].as_array()?.iter().find_map(first_chart)
        }
        first_chart(&import_docx(&charts).unwrap().json["doc"]).expect("a chart in generated-charts.docx")
    };
    let bytes = demo();
    let mut a = import_docx(&bytes).unwrap();
    let node = serde_json::json!({ "type": "paragraph", "content": [{ "type": "ooxmlInline", "attrs": {
        "xml": "", "label": "Graphique", "hidden": false, "field": null, "chart": spec, "cx": 5_400_000, "cy": 3_240_000, "floating": false, "oid": "c1" } }] });
    a.json["doc"]["content"].as_array_mut().unwrap().push(node);
    let out = export_docx(&a.json, Some(&bytes), HashMap::new()).unwrap();
    let b = import_docx(&out).unwrap();
    contract::check(&b.json).unwrap();
    let count = |v: &serde_json::Value| -> usize {
        fn walk(v: &serde_json::Value) -> usize {
            usize::from(v["type"] == "ooxmlInline" && !v["attrs"]["chart"].is_null()) + v["content"].as_array().map(|c| c.iter().map(walk).sum()).unwrap_or(0)
        }
        walk(v)
    };
    assert_eq!(count(&b.json["doc"]), 1, "the chart comes back as a chart");
    let pkg = oel_opc::package::Package::read(&out).unwrap();
    assert!(pkg.has("word/charts/chart1.xml"));
}
