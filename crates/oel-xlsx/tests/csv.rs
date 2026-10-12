use oelxlsx::csv::{CsvOptions, export_csv, import_csv};

#[test]
fn french_excel_dialect_round_trips() {
    let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/csv/fr-cp1252.csv")).unwrap();
    let wb = import_csv(&bytes, &CsvOptions::default()).unwrap();
    let d = wb.csv.clone().unwrap();
    assert_eq!((d.delimiter.as_str(), d.encoding.as_str(), d.line_ending.as_str(), d.decimal_comma, d.bom), (";", "windows-1252", "\r\n", true, false));
    let s = &wb.sheets[0];
    let get = |r, c| s.cells.iter().find(|x| x.r == r && x.c == c).unwrap();
    assert_eq!(get(1, 0).v.as_ref().unwrap(), "Élise");
    assert_eq!(get(1, 1).v.as_ref().unwrap().as_f64(), Some(1234.5));
    assert_eq!(get(2, 0).v.as_ref().unwrap(), "Côté; Jean");
    assert_eq!(get(3, 1).v.as_ref().unwrap(), "007");
    let (out, lost) = export_csv(&wb, 0, None).unwrap();
    assert_eq!(lost, 0);
    assert_eq!(out, bytes, "byte-identical: {:?}", String::from_utf8_lossy(&out));
}

#[test]
fn utf8_bom_quotes_and_formulas_stay_text() {
    let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/csv/utf8-bom.csv")).unwrap();
    let wb = import_csv(&bytes, &CsvOptions::default()).unwrap();
    let d = wb.csv.clone().unwrap();
    assert_eq!((d.delimiter.as_str(), d.bom, d.line_ending.as_str()), (",", true, "\n"));
    let s = &wb.sheets[0];
    let get = |r, c| s.cells.iter().find(|x| x.r == r && x.c == c).unwrap();
    assert_eq!(get(1, 2).v.as_ref().unwrap(), "x\ny");
    assert_eq!(get(2, 2).v.as_ref().unwrap(), "=SUM(1)");
    assert!(get(2, 2).f.is_none(), "CSV never runs formulas");
    let (out, _) = export_csv(&wb, 0, None).unwrap();
    assert_eq!(out, bytes, "{:?}", String::from_utf8_lossy(&out));
}

#[test]
fn csv_saved_as_xlsx() {
    let wb = import_csv("Date,Montant\n2026-01-05,12.5\n".as_bytes(), &CsvOptions { sheet_name: Some("ventes".into()), ..Default::default() }).unwrap();
    let out = oelxlsx::export_xlsx(&wb, None).unwrap();
    let back = oelxlsx::import_xlsx(&out).unwrap();
    assert_eq!(back.sheets[0].name, "ventes");
    let date = back.sheets[0].cells.iter().find(|c| c.r == 1 && c.c == 0).unwrap();
    assert_eq!(back.styles[date.s as usize].num_fmt, "yyyy-mm-dd");
}
