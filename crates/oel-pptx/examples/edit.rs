//! `cargo run -p oel-pptx --example edit -- in.pptx out.pptx`: a scripted edit
//! (reorder, duplicate, delete, new slide, text, notes), to open the result in
//! PowerPoint or LibreOffice.
use oelpptx::model::*;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).unwrap();
    let mut deck = oelpptx::import_pptx(&bytes).unwrap().deck;
    let last = deck.slides.pop().unwrap();
    deck.slides.insert(0, last);
    let mut dup = deck.slides[1].clone();
    dup.id = "copie".into();
    deck.slides.insert(2, dup);
    if deck.slides.len() > 4 {
        deck.slides.remove(3);
    }
    if let Some(t) = deck.slides[1].elements.iter_mut().find_map(|e| e.text.as_mut().filter(|t| !t.paras.is_empty() && !t.paras[0].runs.is_empty())) {
        t.paras[0].runs[0].text = "Texte modifié".into();
    }
    let layout = deck.layouts[0].clone();
    let mut els: Vec<Element> = layout.placeholders.iter().filter(|p| p.ph.as_ref().is_some_and(|ph| matches!(ph.kind.as_str(), "title" | "ctrTitle" | "subTitle" | "body" | "obj"))).cloned().collect();
    for (k, e) in els.iter_mut().enumerate() {
        e.src = None;
        e.id = format!("n{k}");
        if let Some(t) = e.text.as_mut() {
            t.paras = vec![Para { runs: vec![Run { kind: "text".into(), text: format!("Nouveau {k}"), ..Default::default() }], ..Default::default() }];
        }
    }
    deck.slides.push(Slide { id: "neuve".into(), layout: layout.id, elements: els, notes: "Notes de la nouvelle diapo".into(), ..Default::default() });
    deck.slides[0].notes = "Première".into();
    let out = oelpptx::export_pptx(&deck, Some(&bytes), Default::default()).unwrap();
    std::fs::write(&args[2], out).unwrap();
    eprintln!("{} slides", deck.slides.len());
}
