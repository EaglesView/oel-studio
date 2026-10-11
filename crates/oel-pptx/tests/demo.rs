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
