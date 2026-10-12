//! The demo Bureau's workbook (`fixtures/demo`, plan solo MVP S-3): results read from the laps
//! with MINIFS, AVERAGEIFS, RANK.EQ and XLOOKUP are computed, cached, and survive a round trip.

use oelxlsx::model::{Sheet, Workbook};
use oelxlsx::{engine, export_xlsx, import_xlsx};
use serde_json::{json, Value};

fn demo() -> Vec<u8> {
    std::fs::read(format!("{}/../../fixtures/demo/Chronos — tours de piste.xlsx", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn value(s: &Sheet, a1: &str) -> Value {
    let (r, c) = oelxlsx::refs::parse_a1(a1).unwrap();
    s.cells.iter().find(|x| x.r == r && x.c == c).and_then(|x| x.v.clone()).unwrap_or(Value::Null)
}

fn results(wb: &Workbook) -> &Sheet {
    wb.sheets.iter().find(|s| s.name == "Résultats").unwrap()
}

#[test]
fn demo_results_are_computed_and_cached() {
    let wb = import_xlsx(&demo()).unwrap();
    assert_eq!(wb.sheets.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Résultats", "Tours"]);
    let r = results(&wb);
    assert_eq!(value(r, "B4"), json!(58.1), "Maya's best lap (MINIFS)");
    assert_eq!(value(r, "E4"), json!(1.0), "Maya ranks first (RANK.EQ)");
    assert_eq!(value(r, "H3"), json!("Maya"), "XLOOKUP");
    assert_eq!(value(r, "H4"), json!(18.0), "COUNTA");

    let chart = r.drawings.iter().find_map(|d| d.chart.as_ref()).expect("chart on Résultats");
    let best = chart.groups[0].series[0].val.as_ref().unwrap();
    assert_eq!(best.num, [59.8, 64.9, 58.1, 68.8, 61.7, 72.9].map(Some), "chart cache filled");
}

#[test]
fn demo_survives_a_round_trip_and_a_recalc() {
    let bytes = demo();
    let a = import_xlsx(&bytes).unwrap();
    let b = import_xlsx(&export_xlsx(&a, Some(&bytes)).unwrap()).unwrap();
    let mut c = b.clone();
    engine::recalc(&mut c).unwrap();
    for wb in [&b, &c] {
        let r = results(wb);
        assert_eq!(value(r, "H3"), json!("Maya"));
        assert_eq!(value(r, "C4"), json!(58.6));
    }
}
