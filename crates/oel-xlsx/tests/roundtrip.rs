use oelxlsx::model::{Cell, Workbook};
use oelxlsx::{engine, export_xlsx, import_xlsx, new_workbook};
use oel_opc::package::Package;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/../../fixtures/xlsx/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

/// Compare workbooks with cached results recomputed on both sides (openpyxl writes none).
fn normalized(mut wb: Workbook) -> Workbook {
    engine::recalc(&mut wb).unwrap();
    for s in &mut wb.sheets {
        s.cells.sort_by_key(|c| (c.r, c.c));
        // Raw XML carried for CF/DV/filters is re-serialized (attribute quoting may differ).
        for cf in &mut s.cond_formats {
            for r in &mut cf.rules {
                r.raw = None;
            }
        }
        for v in &mut s.validations {
            v.raw = None;
        }
        if let Some(af) = &mut s.auto_filter {
            af.raw = None;
        }
    }
    wb
}

#[test]
fn roundtrip_is_stable() {
    for name in ["rich.xlsx", "rich-lo.xlsx"] {
        let bytes = fixture(name);
        let a = import_xlsx(&bytes).unwrap();
        let out = export_xlsx(&a, Some(&bytes)).unwrap();
        let b = import_xlsx(&out).unwrap();
        assert_eq!(normalized(a.clone()), normalized(b), "{name}");

        // Untouched parts are byte-identical.
        let (p0, p1) = (Package::read(&bytes).unwrap(), Package::read(&out).unwrap());
        for (part, data) in &p0.parts {
            let keep = part.starts_with("xl/charts/") || part.starts_with("xl/drawings/") || part.starts_with("xl/theme/") || part.ends_with("styles.xml") || part.starts_with("xl/comments") || part.starts_with("docProps/");
            if keep {
                assert_eq!(p1.get(part), Some(data.as_slice()), "{name}: {part} changed");
            }
        }
        assert!(!p1.has("xl/calcChain.xml"));
    }
}

#[test]
fn edits_survive() {
    let bytes = fixture("rich-lo.xlsx");
    let mut wb = import_xlsx(&bytes).unwrap();
    // New value, new formula with a post-2007 function, a new style, a new sheet, a rename.
    let s0 = &mut wb.sheets[0];
    s0.cells.retain(|c| !(c.r == 1 && c.c == 1));
    s0.cells.push(Cell { r: 1, c: 1, t: Some("n".into()), v: Some(2000.into()), s: 3, ..Default::default() });
    s0.cells.push(Cell { r: 19, c: 0, f: Some("CONCAT(A2,\"-\",A3)".into()), ..Default::default() });
    let mut bold_red = wb.styles[0].clone();
    bold_red.font.bold = true;
    bold_red.fill = Some(oelxlsx::model::Color { css: "#FF0000".into(), ..Default::default() });
    wb.styles.push(bold_red);
    let new_style = (wb.styles.len() - 1) as u32;
    wb.sheets[0].cells.push(Cell { r: 20, c: 0, t: Some("s".into()), v: Some("rouge".into()), s: new_style, ..Default::default() });
    wb.sheets[0].frozen_rows = 2;
    wb.sheets[0].frozen_cols = 0;
    wb.sheets[1].name = "Données 2026".into();
    let mut extra = oelxlsx::model::Sheet { id: "new-1".into(), name: "Nouvelle".into(), zoom: 100, show_grid: true, default_col_width: 8.43, default_row_height: 15.0, ..Default::default() };
    extra.cells.push(Cell { r: 0, c: 0, f: Some("'Données 2026'!E2*2".into()), ..Default::default() });
    wb.sheets.push(extra);
    wb.sheets.remove(2); // delete « Caché »

    let out = export_xlsx(&wb, Some(&bytes)).unwrap();
    let back = import_xlsx(&out).unwrap();
    let names: Vec<_> = back.sheets.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Budget", "Données 2026", "Nouvelle"]);
    let b = &back.sheets[0];
    let get = |s: &oelxlsx::model::Sheet, r, c| s.cells.iter().find(|x| x.r == r && x.c == c).cloned().unwrap();
    assert_eq!(get(b, 6, 1).v.unwrap().as_f64(), Some(2835.0), "cached SUM updated");
    let concat = get(b, 19, 0);
    assert_eq!(concat.f.as_deref(), Some("CONCAT(A2,\"-\",A3)"));
    assert_eq!(concat.v.unwrap(), "Loyer-Épicerie");
    let red = get(b, 20, 0);
    assert!(back.styles[red.s as usize].font.bold);
    assert_eq!(back.styles[red.s as usize].fill.as_ref().unwrap().css, "#FF0000");
    assert_eq!((b.frozen_rows, b.frozen_cols), (2, 0));
    assert_eq!(get(&back.sheets[2], 0, 0).v.unwrap().as_f64(), Some(40.0));
    // The file stores the prefixed name Excel needs.
    let pkg = Package::read(&out).unwrap();
    let sheet1 = pkg.get_str("xl/worksheets/sheet1.xml").unwrap();
    assert!(sheet1.contains("_xlfn.CONCAT("), "{}", &sheet1[..200]);
    assert!(!pkg.has("xl/worksheets/sheet3.xml") || pkg.get_str("xl/workbook.xml").unwrap().contains("Nouvelle"));
    // The chart is still there.
    assert!(pkg.has("xl/charts/chart1.xml"));
    std::fs::create_dir_all("target/out").unwrap();
    std::fs::write("target/out/edited.xlsx", &out).unwrap();
}

#[test]
fn new_workbook_exports() {
    let mut wb = new_workbook();
    assert_eq!(wb.sheets[0].name, "Feuille 1");
    wb.sheets[0].cells.push(Cell { r: 0, c: 0, t: Some("n".into()), v: Some(21.into()), ..Default::default() });
    wb.sheets[0].cells.push(Cell { r: 0, c: 1, f: Some("A1*2".into()), ..Default::default() });
    let out = export_xlsx(&wb, None).unwrap();
    let back = import_xlsx(&out).unwrap();
    assert_eq!(back.sheets[0].cells[1].v.as_ref().unwrap().as_f64(), Some(42.0));
    std::fs::create_dir_all("target/out").unwrap();
    std::fs::write("target/out/new.xlsx", &out).unwrap();
}

/// LibreOffice must open our output and compute the same values as the engine.
/// Skipped when `soffice` is not installed.
#[test]
fn libreoffice_agrees() {
    if std::process::Command::new("soffice").arg("--version").output().is_err() {
        eprintln!("soffice absent: skipped");
        return;
    }
    let bytes = fixture("rich-lo.xlsx");
    let mut wb = import_xlsx(&bytes).unwrap();
    wb.sheets[0].cells.retain(|c| !(c.r == 1 && c.c == 1));
    wb.sheets[0].cells.push(Cell { r: 1, c: 1, t: Some("n".into()), v: Some(2000.into()), s: 3, ..Default::default() });
    let out = export_xlsx(&wb, Some(&bytes)).unwrap();
    let dir = std::env::temp_dir().join(format!("oelxlsx-lo-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("t.xlsx"), &out).unwrap();
    let st = std::process::Command::new("soffice")
        .args(["--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", "--outdir"])
        .arg(&dir)
        .arg(dir.join("t.xlsx"))
        .output()
        .unwrap();
    assert!(st.status.success());
    let mut calc = engine::Calc::new(&wb).unwrap();
    calc.evaluate();
    for (i, sheet) in wb.sheets.iter().enumerate() {
        let csv = std::fs::read_to_string(dir.join(format!("t-{}.csv", sheet.name))).unwrap();
        let mut rdr = ::csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(csv.as_bytes());
        let grid: Vec<Vec<String>> = rdr.records().map(|r| r.unwrap().iter().map(String::from).collect()).collect();
        for cell in sheet.cells.iter().filter(|c| c.f.is_some()) {
            let lo = grid.get(cell.r as usize).and_then(|r| r.get(cell.c as usize)).cloned().unwrap_or_default();
            let ours = calc.cell_out(i, cell.r, cell.c).unwrap();
            // LibreOffice writes full precision for General/percent cells; compare numerically then.
            match (ours.v.as_f64(), lo.trim_end_matches('%').parse::<f64>()) {
                (Some(a), Ok(b)) => {
                    let b = if lo.ends_with('%') { b / 100.0 } else { b };
                    assert!((a - b).abs() < 1e-9 * a.abs().max(1.0), "{}!{}: ours {a} vs LibreOffice {b}", sheet.name, oelxlsx::refs::a1(cell.r, cell.c));
                }
                _ => assert_eq!(ours.text, lo, "{}!{}", sheet.name, oelxlsx::refs::a1(cell.r, cell.c)),
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn table_range_follows_rows_and_drawings_stay() {
    let bytes = fixture("complex_sheet_graph.xlsx");
    let mut wb = import_xlsx(&bytes).unwrap();
    let out = export_xlsx(&wb, Some(&bytes)).unwrap();
    let (p0, p1) = (Package::read(&bytes).unwrap(), Package::read(&out).unwrap());
    for part in ["xl/tables/table1.xml", "xl/drawings/drawing1.xml", "xl/charts/chartEx1.xml", "xl/media/image2.svg"] {
        assert_eq!(p0.get(part), p1.get(part), "{part} untouched");
    }
    wb.sheets[0].tables[0].range = "C6:F18".into();
    let out = export_xlsx(&wb, Some(&bytes)).unwrap();
    let b = import_xlsx(&out).unwrap();
    assert_eq!(b.sheets[0].tables[0].range, "C6:F18");
    let t = Package::read(&out).unwrap().get_xml("xl/tables/table1.xml").unwrap();
    assert_eq!(t.root.child_local("autoFilter").unwrap().attr("ref"), Some("C6:F18"));
}
