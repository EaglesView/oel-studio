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
    let body = j["sections"].as_array().unwrap().last().unwrap();
    assert_eq!(body["id"], "body");
    assert_eq!(body["page"]["width"], 12240);
    assert_eq!(body["page"]["left"], 1440);
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
    let body = j["sections"].as_array().unwrap().last().unwrap();
    let header = body["headers"]["default"].as_str().unwrap();
    assert!(all_text(&j["stories"][header]["doc"]).contains("En-tête du rapport"));
    assert_eq!(j["stories"][header]["side"], "header");
    let footer = body["footers"]["default"].as_str().unwrap();
    assert!(j["stories"][footer]["doc"].is_object());
    let bold = nodes(&j["doc"], "text").into_iter().find(|t| t["text"] == "gras").unwrap();
    assert!(bold["marks"].as_array().unwrap().iter().any(|m| m["type"] == "bold"));
}

fn round_trip(name: &str) {
    let original = fixture(name);
    let a = import_docx(&original).unwrap();
    let bytes = export_docx(&a.json, Some(&original), HashMap::new()).unwrap();
    let b = import_docx(&bytes).unwrap();
    for key in ["doc", "notes", "stories", "sections", "settings", "background", "numbering", "styles"] {
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
    j["stories"]["hf-new"] = json!({ "side": "header", "doc": { "type": "doc", "content": [p(json!([{ "type": "text", "text": "Mon en-tête" }]), json!({}))] } });
    let body = j["sections"].as_array_mut().unwrap().last_mut().unwrap();
    body["headers"]["default"] = json!("hf-new");
    body["page"]["width"] = json!(11906);
    body["page"]["height"] = json!(16838);
    j["background"] = json!("#FAF7F0");

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
    let back_body = back["sections"].as_array().unwrap().last().unwrap();
    let header = back_body["headers"]["default"].as_str().unwrap();
    assert!(all_text(&back["stories"][header]["doc"]).contains("Mon en-tête"));
    assert!(back["numbering"]["nums"]["900"]["levels"][0]["fmt"] == "bullet");
    assert!(back["numbering"]["nums"]["901"]["levels"][1]["fmt"] == "lowerLetter");
    let cells = nodes(&back["doc"], "tableCell");
    assert!(cells.iter().any(|c| c["attrs"]["colspan"] == 2 && c["attrs"]["background"] == "#EEEEEE"));
    assert!(cells.iter().any(|c| c["attrs"]["rowspan"] == 2));
    assert_eq!(back_body["page"]["width"], 11906);
    assert_eq!(back["background"], "#FAF7F0");
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

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

fn sections(j: &Value) -> &Vec<Value> {
    j["sections"].as_array().unwrap()
}

/// The `w:sectPr` elements of a package's main document, in order, in the
/// serializer's canonical form (the document part is always re-serialized).
fn sect_prs(bytes: &[u8]) -> Vec<String> {
    let pkg = Package::read(bytes).unwrap();
    let doc = pkg.get_str("word/document.xml").unwrap().to_string();
    let mut out = Vec::new();
    let mut rest = doc.as_str();
    while let Some(i) = rest.find("<w:sectPr") {
        let end = rest[i..].find("</w:sectPr>").map(|e| i + e + "</w:sectPr>".len()).unwrap();
        out.push(oeldocx::xml::XDocument::parse(&rest[i..end]).unwrap().root.to_xml());
        rest = &rest[end..];
    }
    out
}

#[test]
fn sections_are_read() {
    let j = import_docx(&fixture("complex_template.docx")).unwrap().json;
    let s = sections(&j);
    assert_eq!(s.len(), 5);
    assert_eq!(s.iter().map(|x| x["id"].as_str().unwrap()).collect::<Vec<_>>(), ["s1", "s2", "s3", "s4", "body"]);
    // Cover: 0.5" margins, roman numbers restarting at 1, first page different.
    assert_eq!(s[0]["page"]["left"], 720);
    assert_eq!(s[0]["page"]["right"], 720);
    assert_eq!(s[0]["pgNum"], json!({ "fmt": "lowerRoman", "start": 1 }));
    assert_eq!(s[0]["titlePg"], true);
    assert_eq!(s[0]["kind"], "nextPage");
    // Chapters: 2" left margin; explicit references on s2 and s3 only.
    assert_eq!(s[1]["page"]["left"], 2880);
    assert_eq!(s[1]["pgNum"], json!({ "fmt": "decimal", "start": 1 }));
    assert_eq!(s[1]["footers"], json!({ "default": "footer13", "first": "footer22" }));
    assert_eq!(s[1]["headers"], json!({ "first": "header11" }));
    assert_eq!(s[2]["footers"], json!({ "default": "footer31" }));
    assert_eq!(s[3]["footers"], json!({}));
    assert_eq!(s[4]["headers"], json!({}));
    assert_eq!(s[4]["pgNum"]["start"], Value::Null);
    // Each story once, keyed by part.
    assert_eq!(j["stories"]["footer13"]["part"], "word/footer13.xml");
    assert_eq!(j["stories"]["footer13"]["side"], "footer");
    assert_eq!(j["stories"].as_object().unwrap().len(), 4);
    // The paragraph that ends a section names it, and its pPr no longer holds the sectPr.
    let paras = nodes(&j["doc"], "paragraph");
    let ends: Vec<_> = paras.iter().filter(|p| !p["attrs"]["section"].is_null()).collect();
    assert_eq!(ends.iter().map(|p| p["attrs"]["section"].as_str().unwrap()).collect::<Vec<_>>(), ["s1", "s2", "s3", "s4"]);
    assert!(paras.iter().all(|p| !p["attrs"]["pPr"].as_str().unwrap_or("").contains("sectPr")));
    assert_eq!(j["settings"]["evenAndOddHeaders"], false);
}

#[test]
fn section_settings_are_read() {
    let j = import_docx(&fixture("sections-headers.docx")).unwrap().json;
    assert_eq!(j["settings"]["evenAndOddHeaders"], true);
    let s = sections(&j);
    assert_eq!(s[0]["headers"], json!({ "default": "header1", "first": "header2", "even": "header3" }));
    assert_eq!(s[1]["headers"], json!({}));
    assert_eq!(s[2]["footers"], json!({ "default": "footer2" }));
    let m = import_docx(&fixture("sections-margins.docx")).unwrap().json;
    let s = sections(&m);
    assert_eq!(s[1]["page"]["orient"], "landscape");
    assert_eq!(s[1]["page"]["width"], 15840);
    assert_eq!(s[2]["kind"], "continuous");
}

#[test]
fn round_trip_section_fixtures() {
    for name in ["sections-margins.docx", "sections-headers.docx", "anchors.docx", "table-borders.docx"] {
        round_trip(name);
        // Unchanged sections are written back exactly.
        let original = fixture(name);
        let a = import_docx(&original).unwrap();
        let out = export_docx(&a.json, Some(&original), HashMap::new()).unwrap();
        assert_eq!(sect_prs(&original), sect_prs(&out), "{name}");
    }
}

#[test]
fn editing_a_section_patches_its_sect_pr() {
    let original = fixture("complex_template.docx");
    let mut j = import_docx(&original).unwrap().json;
    let s2 = &mut j["sections"][1];
    s2["page"]["left"] = json!(1440);
    s2["page"]["orient"] = json!("landscape");
    s2["page"]["width"] = json!(15840);
    s2["page"]["height"] = json!(12240);
    s2["pgNum"]["fmt"] = json!("upperRoman");
    let out = export_docx(&j, Some(&original), HashMap::new()).unwrap();
    let (before, after) = (sect_prs(&original), sect_prs(&out));
    assert_eq!(before.len(), after.len());
    for (i, (b, a)) in before.iter().zip(&after).enumerate() {
        if i == 1 {
            assert_ne!(b, a);
            assert!(a.contains(r#"w:left="1440""#) && a.contains(r#"w:orient="landscape""#) && a.contains(r#"w:fmt="upperRoman""#), "{a}");
            // References and the rsid attributes are kept.
            assert!(a.contains("footerReference") && a.contains("w:rsidSect"), "{a}");
        } else {
            assert_eq!(b, a, "section {i} must be byte-identical");
        }
    }
    let back = import_docx(&out).unwrap().json;
    assert_eq!(back["sections"][1]["page"]["left"], 1440);
    assert_eq!(back["sections"][1]["pgNum"]["fmt"], "upperRoman");
    assert_eq!(back["sections"][1]["footers"], j["sections"][1]["footers"]);
}

#[test]
fn adding_and_removing_a_section_break() {
    let original = fixture("sections-margins.docx");
    let j = import_docx(&original).unwrap().json;

    // Remove the first break: the merged text takes the following section's setup.
    let mut merged = j.clone();
    for p in merged["doc"]["content"].as_array_mut().unwrap() {
        if p["attrs"]["section"] == "s1" {
            p["attrs"]["section"] = Value::Null;
        }
    }
    merged["sections"].as_array_mut().unwrap().remove(0);
    let out = export_docx(&merged, Some(&original), HashMap::new()).unwrap();
    let back = import_docx(&out).unwrap().json;
    assert_eq!(sections(&back).len(), 2);
    assert_eq!(back["sections"][0]["page"]["orient"], "landscape");

    // Add a continuous break with its own margins after the first paragraph.
    let mut added = j.clone();
    added["doc"]["content"][0]["attrs"]["section"] = json!("sNew");
    let mut sec = j["sections"][0].clone();
    sec["id"] = json!("sNew");
    sec["sectPr"] = Value::Null;
    sec["kind"] = json!("continuous");
    sec["page"]["left"] = json!(2000);
    added["sections"].as_array_mut().unwrap().insert(0, sec);
    let out = export_docx(&added, Some(&original), HashMap::new()).unwrap();
    let back = import_docx(&out).unwrap().json;
    assert_eq!(sections(&back).len(), 4);
    assert_eq!(back["sections"][0]["kind"], "continuous");
    assert_eq!(back["sections"][0]["page"]["left"], 2000);
    assert_eq!(back["sections"][1]["page"]["left"], 720);
    assert_opens_in_libreoffice(&out, "added-section");

    // A break copied onto a second paragraph (split) is written once.
    let mut dup = j.clone();
    dup["doc"]["content"][1]["attrs"]["section"] = json!("s1");
    let out = export_docx(&dup, Some(&original), HashMap::new()).unwrap();
    assert_eq!(sections(&import_docx(&out).unwrap().json).len(), 3);
}

#[test]
fn linking_a_header_to_the_previous_section() {
    let original = fixture("sections-headers.docx");
    let mut j = import_docx(&original).unwrap().json;
    // s3 drops its own footer (« Lier au précédent »): the part stays, the reference goes.
    j["sections"][2]["footers"] = json!({});
    let out = export_docx(&j, Some(&original), HashMap::new()).unwrap();
    let back = import_docx(&out).unwrap().json;
    assert_eq!(back["sections"][2]["footers"], json!({}));
    assert_eq!(back["sections"][0]["footers"], json!({ "default": "footer1" }));
    // s2 gets its own copy of the inherited default header.
    let mut j = import_docx(&original).unwrap().json;
    let copy = j["stories"]["header1"].clone();
    j["stories"]["hf-copy"] = json!({ "side": "header", "doc": copy["doc"] });
    j["sections"][1]["headers"] = json!({ "default": "hf-copy" });
    let out = export_docx(&j, Some(&original), HashMap::new()).unwrap();
    let back = import_docx(&out).unwrap().json;
    let id = back["sections"][1]["headers"]["default"].as_str().unwrap().to_string();
    assert_ne!(id, "header1");
    assert_eq!(all_text(&back["stories"][&id]["doc"]), all_text(&back["stories"]["header1"]["doc"]));
    assert_opens_in_libreoffice(&out, "linked-header");
}
