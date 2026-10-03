//! DOCX ↔ ProseMirror JSON codec: import, lossless round trip, edits, validity.

use oeldocx::{export_docx, import_docx, new_document, package::Package};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/docx").join(name)).unwrap()
}

fn texts(v: &Value, out: &mut String) {
    if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
        out.push_str(t);
    }
    if let Some(c) = v.get("content").and_then(|c| c.as_array()) {
        for n in c {
            texts(n, out);
        }
        if v["type"] == "paragraph" {
            out.push('\n');
        }
    }
}

fn all_text(doc: &Value) -> String {
    let mut s = String::new();
    texts(doc, &mut s);
    s
}

fn find_all<'a>(v: &'a Value, ty: &str, out: &mut Vec<&'a Value>) {
    if v["type"] == ty {
        out.push(v);
    }
    if let Some(c) = v.get("content").and_then(|c| c.as_array()) {
        for n in c {
            find_all(n, ty, out);
        }
    }
}

fn nodes<'a>(v: &'a Value, ty: &str) -> Vec<&'a Value> {
    let mut out = Vec::new();
    find_all(v, ty, &mut out);
    out
}

/// LibreOffice must be able to open what we write (skipped when not installed).
fn assert_opens_in_libreoffice(bytes: &[u8], name: &str) {
    if Command::new("soffice").arg("--version").output().is_err() {
        eprintln!("soffice not found, skipping validity check");
        return;
    }
    let dir = std::env::temp_dir().join(format!("oeldocx-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join(format!("{name}.docx"));
    std::fs::write(&input, bytes).unwrap();
    let status = Command::new("soffice")
        .args(["--headless", &format!("-env:UserInstallation=file://{}/profile", dir.display()), "--convert-to", "pdf", "--outdir"])
        .arg(&dir)
        .arg(&input)
        .output()
        .unwrap();
    let pdf = dir.join(format!("{name}.pdf"));
    assert!(pdf.exists() && std::fs::metadata(&pdf).unwrap().len() > 500, "LibreOffice could not convert {name}: {}", String::from_utf8_lossy(&status.stderr));
}

#[test]
fn imports_test_document() {
    let imp = import_docx(&fixture("tesxte.docx")).unwrap();
    let j = &imp.json;
    let paras = nodes(&j["doc"], "paragraph");
    assert_eq!(paras.len(), 1);
    let text = all_text(&j["doc"]);
    assert!(text.starts_with("La première chose qui m’a sauté aux yeux"));
    assert!(text.contains("u/altpoint"));
    // Language kept on the run as raw rPr.
    let first = &paras[0]["content"][0];
    let ts = first["marks"].as_array().unwrap().iter().find(|m| m["type"] == "textStyle").unwrap();
    assert!(ts["attrs"]["rPr"].as_str().unwrap().contains("fr-CA"));
    assert_eq!(j["page"]["width"], 12240);
    assert_eq!(j["page"]["left"], 1440);
    assert!(j["stylesCss"].as_str().unwrap().contains(".oel-doc .oel-p"));
    assert!(j["styles"].as_array().unwrap().iter().any(|s| s["role"] == "heading1"));
}

#[test]
fn imports_rich_document() {
    let imp = import_docx(&fixture("rich.docx")).unwrap();
    let j = &imp.json;
    let text = all_text(&j["doc"]);
    for needle in ["Rapport d’essai", "gras", "Premier point", "Sous-point", "Étape deux", "A+B", "C (2 lignes)", "Fin du document."] {
        assert!(text.contains(needle), "missing {needle:?} in {text}");
    }
    let paras = nodes(&j["doc"], "paragraph");
    assert_eq!(paras[0]["attrs"]["outline"], 0, "heading 1 outline level");
    assert!(paras.iter().any(|p| p["attrs"]["align"] == "center"));
    assert!(paras.iter().filter(|p| !p["attrs"]["numId"].is_null()).count() >= 5);
    assert!(paras.iter().any(|p| p["attrs"]["ilvl"] == 1));
    // Merged cells
    let cells = nodes(&j["doc"], "tableCell");
    assert!(cells.iter().any(|c| c["attrs"]["colspan"] == 2));
    assert!(cells.iter().any(|c| c["attrs"]["rowspan"] == 2));
    assert_eq!(cells.len(), 4);
    // Image, link, footnote, header, footer
    let imgs = nodes(&j["doc"], "image");
    assert_eq!(imgs.len(), 1);
    assert_eq!(imp.media.len(), 1);
    assert_eq!(imp.media[0].mime, "image/png");
    let links: Vec<_> = nodes(&j["doc"], "text").into_iter().filter(|t| t["marks"].as_array().map(|m| m.iter().any(|m| m["type"] == "link")).unwrap_or(false)).collect();
    assert!(!links.is_empty());
    assert_eq!(nodes(&j["doc"], "noteRef").len(), 1);
    let notes = j["notes"]["footnote"].as_object().unwrap();
    assert_eq!(notes.len(), 1);
    assert!(all_text(notes.values().next().unwrap()).contains("Une note de bas de page."));
    assert!(all_text(&j["headers"]["default"]["doc"]).contains("En-tête du rapport"));
    assert!(j["footers"]["default"].is_object());
    let bold = nodes(&j["doc"], "text").into_iter().find(|t| t["text"] == "gras").unwrap();
    assert!(bold["marks"].as_array().unwrap().iter().any(|m| m["type"] == "bold"));
}

fn round_trip(name: &str) {
    let original = fixture(name);
    let a = import_docx(&original).unwrap();
    let bytes = export_docx(&a.json, Some(&original), HashMap::new()).unwrap();
    let b = import_docx(&bytes).unwrap();
    for key in ["doc", "notes", "headers", "footers", "page", "numbering", "styles"] {
        let (x, y) = (&a.json[key], &b.json[key]);
        assert_eq!(x, y, "{name}: `{key}` changed through a round trip");
    }
    // Parts we do not model are copied byte for byte.
    let (p0, p1) = (Package::read(&original).unwrap(), Package::read(&bytes).unwrap());
    for part in ["word/styles.xml", "word/theme/theme1.xml", "word/settings.xml", "word/fontTable.xml", "docProps/core.xml"] {
        if let Some(orig) = p0.get(part) {
            assert_eq!(Some(orig), p1.get(part), "{name}: {part} was not preserved");
        }
    }
    assert_opens_in_libreoffice(&bytes, &format!("rt-{}", name.trim_end_matches(".docx")));
}

#[test]
fn round_trip_test_document() {
    round_trip("tesxte.docx");
}

#[test]
fn round_trip_rich_document() {
    round_trip("rich.docx");
}

#[test]
fn round_trip_basic_fixture() {
    round_trip("basic_text.docx");
}

#[test]
fn round_trip_complex_template() {
    round_trip("complex_template.docx");
}

#[test]
fn edits_are_written() {
    let original = fixture("tesxte.docx");
    let imp = import_docx(&original).unwrap();
    let mut j = imp.json.clone();
    let heading_id = j["styles"].as_array().unwrap().iter().find(|s| s["role"] == "heading1").unwrap()["id"].as_str().unwrap().to_string();

    // Bold the first run, keep its language.
    let first = &mut j["doc"]["content"][0]["content"][0];
    first["marks"].as_array_mut().unwrap().push(json!({ "type": "bold" }));

    let p = |content: Value, attrs: Value| json!({ "type": "paragraph", "attrs": attrs, "content": content });
    let new_blocks = vec![
        p(json!([{ "type": "text", "text": "Nouveau titre" }]), json!({ "styleId": heading_id })),
        p(
            json!([
                { "type": "text", "text": "Rouge 14 pt ", "marks": [{ "type": "textStyle", "attrs": { "color": "#CC0000", "fontSize": "14pt", "fontFamily": "Georgia" } }] },
                { "type": "text", "text": "lien", "marks": [{ "type": "link", "attrs": { "href": "https://example.org/" } }] },
                { "type": "tab" },
                { "type": "text", "text": "surligné", "marks": [{ "type": "highlight", "attrs": { "color": "#FFFF00" } }, { "type": "italic" }] },
                { "type": "noteRef", "attrs": { "kind": "footnote", "id": "1" } },
                { "type": "image", "attrs": { "src": "media:word/media/oel-new.png", "path": "word/media/oel-new.png", "cx": 381000, "cy": 190500, "alt": "Carré" } },
                { "type": "pageBreak" }
            ]),
            json!({ "align": "justify", "spacing": { "before": 240, "after": 120, "line": 360, "lineRule": "auto" }, "ind": { "left": 720, "firstLine": 360 } }),
        ),
        p(json!([{ "type": "text", "text": "Puce" }]), json!({ "numId": 900, "ilvl": 0 })),
        p(json!([{ "type": "text", "text": "Numéro" }]), json!({ "numId": 901, "ilvl": 1 })),
        json!({ "type": "table", "attrs": {}, "content": [
            { "type": "tableRow", "content": [
                { "type": "tableCell", "attrs": { "colspan": 2, "rowspan": 1, "background": "#EEEEEE" }, "content": [p(json!([{ "type": "text", "text": "Fusion" }]), json!({}))] },
                { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 2 }, "content": [p(json!([{ "type": "text", "text": "Haut" }]), json!({}))] }
            ]},
            { "type": "tableRow", "content": [
                { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [p(json!([{ "type": "text", "text": "x" }]), json!({}))] },
                { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [p(json!([{ "type": "text", "text": "y" }]), json!({}))] }
            ]}
        ]}),
    ];
    j["doc"]["content"].as_array_mut().unwrap().extend(new_blocks);
    j["notes"]["footnote"]["1"] = json!({ "type": "doc", "content": [p(json!([{ "type": "text", "text": "Ma note." }]), json!({}))] });
    j["numbering"]["synthetic"] = json!([{ "numId": 900, "kind": "bullet" }, { "numId": 901, "kind": "decimal" }]);
    j["headers"]["default"] = json!({ "doc": { "type": "doc", "content": [p(json!([{ "type": "text", "text": "Mon en-tête" }]), json!({}))] } });
    j["page"]["width"] = json!(11906);
    j["page"]["height"] = json!(16838);
    j["page"]["background"] = json!("#FAF7F0");

    let png = std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/docx/rich.docx")).ok().and_then(|b| Package::read(&b).ok()).and_then(|p| p.get("word/media/image1.png").map(|b| b.to_vec())).unwrap();
    let mut media = HashMap::new();
    media.insert("word/media/oel-new.png".to_string(), png);
    let bytes = export_docx(&j, Some(&original), media).unwrap();

    let back = import_docx(&bytes).unwrap().json;
    let text = all_text(&back["doc"]);
    assert!(text.contains("Nouveau titre") && text.contains("Puce") && text.contains("Fusion"));
    let paras = nodes(&back["doc"], "paragraph");
    let first_run = &paras[0]["content"][0];
    let marks = first_run["marks"].as_array().unwrap();
    assert!(marks.iter().any(|m| m["type"] == "bold"));
    assert!(marks.iter().find(|m| m["type"] == "textStyle").unwrap()["attrs"]["rPr"].as_str().unwrap().contains("fr-CA"));
    let title = paras.iter().find(|p| all_text(p).contains("Nouveau titre")).unwrap();
    assert_eq!(title["attrs"]["styleId"], Value::from(heading_id));
    assert_eq!(title["attrs"]["outline"], 0);
    let rich = paras.iter().find(|p| all_text(p).contains("Rouge 14 pt")).unwrap();
    assert_eq!(rich["attrs"]["align"], "justify");
    assert_eq!(rich["attrs"]["spacing"]["line"], 360);
    assert_eq!(rich["attrs"]["ind"]["firstLine"], 360);
    let red = &rich["content"][0]["marks"][0]["attrs"];
    assert_eq!(red["color"], "#CC0000");
    assert_eq!(red["fontSize"], "14pt");
    assert_eq!(red["fontFamily"], "Georgia");
    assert_eq!(nodes(&back["doc"], "image").len(), 1);
    assert_eq!(nodes(&back["doc"], "pageBreak").len(), 1);
    assert_eq!(nodes(&back["doc"], "noteRef").len(), 1);
    assert!(all_text(&back["notes"]["footnote"]["1"]).contains("Ma note."));
    assert!(all_text(&back["headers"]["default"]["doc"]).contains("Mon en-tête"));
    assert!(back["numbering"]["nums"]["900"]["levels"][0]["fmt"] == "bullet");
    assert!(back["numbering"]["nums"]["901"]["levels"][1]["fmt"] == "lowerLetter");
    let cells = nodes(&back["doc"], "tableCell");
    assert!(cells.iter().any(|c| c["attrs"]["colspan"] == 2 && c["attrs"]["background"] == "#EEEEEE"));
    assert!(cells.iter().any(|c| c["attrs"]["rowspan"] == 2));
    assert_eq!(back["page"]["width"], 11906);
    assert_eq!(back["page"]["background"], "#FAF7F0");
    let link = nodes(&back["doc"], "text").into_iter().find(|t| t["text"] == "lien").unwrap();
    assert!(link["marks"].as_array().unwrap().iter().any(|m| m["type"] == "link" && m["attrs"]["href"] == "https://example.org/"));
    // Untouched parts still byte-identical.
    let (p0, p1) = (Package::read(&original).unwrap(), Package::read(&bytes).unwrap());
    assert_eq!(p0.get("word/theme/theme1.xml"), p1.get("word/theme/theme1.xml"));
    assert_opens_in_libreoffice(&bytes, "edited");
}

#[test]
fn removing_formatting_removes_it() {
    let original = fixture("rich.docx");
    let mut j = import_docx(&original).unwrap().json;
    fn strip_bold(v: &mut Value) {
        if let Some(m) = v.get_mut("marks").and_then(|m| m.as_array_mut()) {
            m.retain(|m| m["type"] != "bold");
        }
        if let Some(c) = v.get_mut("content").and_then(|c| c.as_array_mut()) {
            for n in c {
                strip_bold(n);
            }
        }
    }
    strip_bold(&mut j["doc"]);
    let bytes = export_docx(&j, Some(&original), HashMap::new()).unwrap();
    let back = import_docx(&bytes).unwrap().json;
    assert!(nodes(&back["doc"], "text").iter().all(|t| !t["marks"].as_array().map(|m| m.iter().any(|m| m["type"] == "bold")).unwrap_or(false)));
}

#[test]
fn new_document_exports() {
    let doc = new_document();
    let mut j = doc.json.clone();
    j["doc"]["content"] = json!([{ "type": "paragraph", "content": [{ "type": "text", "text": "Bonjour" }] }]);
    let bytes = export_docx(&j, None, HashMap::new()).unwrap();
    let back = import_docx(&bytes).unwrap().json;
    assert_eq!(all_text(&back["doc"]).trim(), "Bonjour");
    assert!(back["styles"].as_array().unwrap().iter().any(|s| s["id"] == "Heading1"));
    assert_opens_in_libreoffice(&bytes, "new");
}

#[test]
fn round_trip_long_document() {
    round_trip("long.docx");
}
