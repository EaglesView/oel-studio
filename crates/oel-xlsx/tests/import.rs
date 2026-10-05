use oelxlsx::engine::Calc;
use oelxlsx::import_xlsx;
use oelxlsx::model::Workbook;

fn load(name: &str) -> Workbook {
    let bytes = std::fs::read(format!("{}/../../fixtures/xlsx/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
    import_xlsx(&bytes).unwrap()
}

fn text(calc: &Calc, sheet: usize, a1: &str) -> String {
    let (r, c) = oelxlsx::refs::parse_a1(a1).unwrap();
    calc.cell_out(sheet, r, c).map(|o| o.text).unwrap_or_default()
}

#[test]
fn reads_both_producers() {
    for name in ["rich.xlsx", "rich-lo.xlsx"] {
        let wb = load(name);
        let names: Vec<_> = wb.sheets.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["Budget", "Données", "Caché"], "{name}");
        let b = &wb.sheets[0];
        assert_eq!((b.frozen_rows, b.frozen_cols), (1, 1), "{name}");
        assert_eq!(b.merges, ["A15:C15"], "{name}");
        assert!(b.cols.iter().any(|c| c.min == 4 && c.hidden), "{name}: column E hidden");
        assert_eq!(b.tab_color.as_ref().unwrap().css, "#1F6F5C", "{name}");
        assert!(b.auto_filter.is_some(), "{name}");
        assert_eq!(b.validations.len(), 1, "{name}");
        assert_eq!(b.validations[0].kind, "list", "{name}");
        assert!(b.cond_formats.iter().flat_map(|c| &c.rules).any(|r| r.kind == "colorScale"), "{name}");
        assert!(b.hyperlinks[0].target.as_deref().unwrap().starts_with("https://outilsenligne.ca"), "{name}");
        assert_eq!(b.notes.len(), 1, "{name}");
        // "007" stays text.
        let e2 = b.cells.iter().find(|c| c.r == 1 && c.c == 4).unwrap();
        assert_eq!(e2.t.as_deref(), Some("s"), "{name}");
        assert_eq!(e2.v.as_ref().unwrap(), "007", "{name}");
        let b7 = b.cells.iter().find(|c| c.r == 6 && c.c == 1).unwrap();
        assert_eq!(b7.f.as_deref(), Some("SUM(B2:B5)"), "{name}");
        assert!(wb.styles[b7.s as usize].font.bold, "{name}: B7 bold");
        assert_eq!(wb.sheets[2].state, oelxlsx::model::SheetState::Hidden, "{name}");
        assert!(wb.names.iter().any(|n| n.name == "Montants"), "{name}");
        assert!(wb.preserved.iter().any(|p| p.kind == "chart"), "{name}: {:?}", wb.preserved);
        let header = &wb.styles[b.cells[0].s as usize];
        assert_eq!(header.fill.as_ref().unwrap().css, "#1F6F5C", "{name}");
    }
}

#[test]
fn computes_like_excel() {
    for name in ["rich.xlsx", "rich-lo.xlsx"] {
        let wb = load(name);
        let calc = Calc::new(&wb).unwrap();
        assert_eq!(text(&calc, 0, "B7"), "2,285.50 $", "{name}");
        assert_eq!(text(&calc, 0, "C2"), "63.5%", "{name}");
        assert_eq!(text(&calc, 0, "B9"), "1,450.50 $", "{name}: defined name");
        assert_eq!(text(&calc, 0, "B10"), "Loyer : 1450.50", "{name}");
        assert_eq!(text(&calc, 0, "B12"), "#DIV/0!", "{name}");
        assert_eq!(text(&calc, 0, "D2"), "2026-01-01", "{name}");
        assert_eq!(text(&calc, 1, "C3"), "2288.5", "{name}: cross-sheet");
        assert_eq!(text(&calc, 1, "E2"), "20", "{name}: VLOOKUP");
        assert_eq!(text(&calc, 1, "E3"), "50", "{name}");
        assert_eq!(text(&calc, 1, "E4"), "25", "{name}");
        assert_eq!(text(&calc, 1, "E5"), "3.1416", "{name}");
        assert_eq!(text(&calc, 1, "E6"), "grand", "{name}");
    }
}

#[test]
fn edits_recompute() {
    let wb = load("rich-lo.xlsx");
    let mut calc = Calc::new(&wb).unwrap();
    let input = oelxlsx::engine::CellInput { sheet: 0, r: 1, c: 1, t: Some("n".into()), v: Some(2000.into()), fmt: Some("#,##0.00 \"$\"".into()), ..Default::default() };
    assert!(calc.apply(&[input]).is_empty());
    let changed = calc.evaluate();
    assert!(changed.iter().any(|(s, o)| *s == 0 && o.r == 6 && o.c == 1 && o.text == "2,835.00 $"), "{changed:?}");
    calc.structural(&oelxlsx::engine::Structural::InsertRows { sheet: 0, at: 2, count: 1 }).unwrap();
    // B7 moved to B8 and still sums the same four amounts.
    assert_eq!(text(&calc, 0, "B8"), "2,835.00 $");
}

#[test]
fn structured_references_compute() {
    // An Excel template: a table « Data » whose calculated columns use
    // `Data[[#This Row],[…]]` and a running total `SUM(INDEX(Data[…],1):Data[[#This Row],[…]])`.
    let wb = load("complex_sheet_graph.xlsx");
    let t = &wb.sheets[0].tables;
    assert_eq!(t.len(), 1);
    assert_eq!((t[0].name.as_str(), t[0].range.as_str(), t[0].columns.len()), ("Data", "C6:F17", 4));
    let calc = Calc::new(&wb).unwrap();
    assert_eq!(text(&calc, 0, "E7"), "23.18%");
    assert_eq!(text(&calc, 0, "F8"), "39.74%");
    assert_eq!(text(&calc, 0, "F17"), "100.00%");
}

#[test]
fn reads_drawings() {
    let wb = load("complex_sheet_graph.xlsx");
    let d = &wb.sheets[0].drawings;
    let kinds: Vec<_> = d.iter().map(|d| d.kind.as_str()).collect();
    assert_eq!(kinds, ["chart", "picture", "shape", "picture"]);
    // The SVG is preferred to its PNG fallback; rotation and anchor are kept.
    assert_eq!(d[1].media.as_deref(), Some("xl/media/image2.svg"));
    assert_eq!(d[1].mime.as_deref(), Some("image/svg+xml"));
    assert_eq!(d[1].rot, 180.0);
    assert_eq!((d[1].to.unwrap().r, d[1].to.unwrap().c), (2, 1));
    // « Move but don't size with cells »: the size from the file's columns and rows is kept (px).
    assert_eq!(d[1].edit_as.as_deref(), Some("oneCell"));
    assert_eq!(((d[1].cx as f64 / 9525.0).round(), (d[1].cy as f64 / 9525.0).round()), (198.0, 529.0));
    assert_eq!((d[2].edit_as.as_deref(), d[2].cx), (Some("twoCell"), 0));
    // Scheme colour accent2 of the file's theme.
    assert_eq!(d[2].fill.as_deref(), Some("#3C9FE0"));
    // The Pareto chart (chartEx): its `_xlchart.v1.N` names become ranges.
    let c = d[0].chart.as_ref().expect("chart spec");
    assert!(c.ex);
    assert_eq!(c.groups[0].kind, "clusteredColumn");
    let f = c.groups[0].series[0].val.as_ref().and_then(|v| v.f.as_deref()).unwrap();
    assert!(f.contains('!') && !f.starts_with("_xlchart"), "{f}");
}

#[test]
fn reads_a_classic_chart() {
    let wb = load("rich.xlsx");
    let c = wb.sheets.iter().flat_map(|s| &s.drawings).find_map(|d| d.chart.as_ref()).expect("chart");
    assert_eq!(c.groups[0].kind, "bar");
    assert_eq!(c.title.as_ref().and_then(|t| t.text.as_deref()), Some("Montants"));
    assert!(!c.palette.is_empty());
}
