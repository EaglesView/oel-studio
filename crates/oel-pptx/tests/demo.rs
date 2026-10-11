//! The demo Bureau's deck (`fixtures/demo`, plan solo MVP S-3): four slides, the logo, the chart
//! the desk replaces with a linked copy, white on black at the end; it survives a round trip.

use oelpptx::model::*;
use oelpptx::{export_pptx, import_pptx};

fn demo() -> Vec<u8> {
    std::fs::read(format!("{}/../../fixtures/demo/Bienvenue dans le Bureau.pptx", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn check(deck: &Deck, media: &[Media]) {
    assert_eq!(deck.slides.len(), 4);
    let logo = deck.slides[0].elements.iter().find(|e| e.name == "Logo").expect("logo on the intro");
    assert_eq!(logo.kind, ElementKind::Picture);
    let img = logo.image.as_ref().unwrap();
    assert!(media.iter().any(|m| m.path == img.media), "logo media travels with the deck");
    let chart = deck.slides[2].elements.iter().find(|e| e.name == "Graphique du tableur").expect("chart on slide 3");
    assert!(chart.chart.is_some());
    assert_eq!(deck.slides[3].background, Some(Paint::Solid { color: "#000000".into() }));
}

#[test]
fn demo_deck_imports_and_round_trips() {
    let bytes = demo();
    let a = import_pptx(&bytes).unwrap();
    check(&a.deck, &a.media);
    let out = export_pptx(&a.deck, Some(&bytes), Default::default()).unwrap();
    let b = import_pptx(&out).unwrap();
    check(&b.deck, &b.media);
}

fn chart_values(deck: &Deck, slide: usize, name: &str) -> Vec<Option<f64>> {
    let el = deck.slides[slide].elements.iter().find(|e| e.name == name).expect("chart element");
    el.chart.as_ref().unwrap().groups[0].series[0].val.as_ref().unwrap().num.clone()
}

/// Plan solo MVP R1: a linked copy's data and a chart made in the editor reach the .pptx.
#[test]
fn changed_and_new_charts_are_written() {
    let bytes = demo();
    let mut a = import_pptx(&bytes).unwrap();
    // The linked copy got new numbers (a lap time edited in the workbook).
    let chart = a.deck.slides[2].elements.iter_mut().find(|e| e.name == "Graphique du tableur").unwrap();
    let spec = chart.chart.as_mut().unwrap();
    spec.part.clear();
    spec.groups[0].series[0].val.as_mut().unwrap().num[0] = Some(57.0);
    let copy = spec.clone();
    // « Lier dans… › Dernière diapositive »: a new frame on the thank-you slide.
    a.deck.slides[3].elements.push(Element { id: "c-new".into(), kind: ElementKind::Graphic, name: "Graphique lié".into(), x: 914_400, y: 914_400, cx: 4_572_000, cy: 2_743_200, chart: Some(copy), ..Default::default() });

    let out = export_pptx(&a.deck, Some(&bytes), Default::default()).unwrap();
    let b = import_pptx(&out).unwrap();
    assert_eq!(chart_values(&b.deck, 2, "Graphique du tableur")[0], Some(57.0), "the changed chart is written");
    assert_eq!(chart_values(&b.deck, 3, "Graphique lié")[0], Some(57.0), "the new chart is written");
    let parts = oel_opc::package::Package::read(&out).unwrap();
    assert!(parts.has("ppt/charts/chart1.xml"), "the original part stays");
    assert_eq!(parts.parts.iter().filter(|(n, _)| n.starts_with("ppt/charts/chart") && n.ends_with(".xml")).count(), 3);

    // Untouched, the chart part is kept byte for byte.
    let same = export_pptx(&import_pptx(&bytes).unwrap().deck, Some(&bytes), Default::default()).unwrap();
    let (p0, p1) = (oel_opc::package::Package::read(&bytes).unwrap(), oel_opc::package::Package::read(&same).unwrap());
    assert_eq!(p0.get("ppt/charts/chart1.xml"), p1.get("ppt/charts/chart1.xml"));
}

/// python-pptx writes negative axis ids: they are read as distinct ids, so a rewritten chart keeps its axes.
#[test]
fn negative_axis_ids_stay_distinct() {
    let a = import_pptx(&demo()).unwrap();
    let spec = a.deck.slides[2].elements.iter().find(|e| e.name == "Graphique du tableur").unwrap().chart.as_ref().unwrap();
    let ids: Vec<u32> = spec.axes.iter().map(|x| x.id).collect();
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    assert!(ids.iter().all(|&i| i != 0));
    assert_eq!(spec.groups[0].axis_ids, ids);
    assert_eq!(spec.axes[0].cross_ax, Some(ids[1]));
}
