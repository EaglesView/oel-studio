//! The reader's JSON matches the declared contract (`src/contract.rs`), for
//! every fixture, the blank document, and a re-import after export.

use oeldocx::{contract, export_docx, import_docx, new_document};
use std::collections::HashMap;
use std::path::PathBuf;

fn fixtures() -> Vec<(String, Vec<u8>)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/docx");
    let mut out: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "docx"))
        .map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), std::fs::read(&p).unwrap()))
        .collect();
    out.sort();
    assert!(!out.is_empty(), "no fixtures in {}", dir.display());
    out
}

#[test]
fn fixtures_match_contract() {
    for (name, bytes) in fixtures() {
        let imp = import_docx(&bytes).unwrap();
        contract::check(&imp.json).unwrap_or_else(|e| panic!("{name}: {e}"));
        let out = export_docx(&imp.json, Some(&bytes), HashMap::new()).unwrap();
        contract::check(&import_docx(&out).unwrap().json).unwrap_or_else(|e| panic!("{name} after export: {e}"));
    }
}

#[test]
fn new_document_matches_contract() {
    contract::check(&new_document().json).unwrap();
}

#[test]
fn check_rejects_unknown_attrs() {
    let mut j = new_document().json;
    j["doc"]["content"][0]["attrs"]["mystery"] = 1.into();
    assert!(contract::check(&j).unwrap_err().contains("paragraph"));
}
