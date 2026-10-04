//! `cargo run -p oel-pptx --example dump -- file.pptx [out.json]`: the deck JSON of a file.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).expect("read");
    let t = std::time::Instant::now();
    let imp = oelpptx::import_pptx(&bytes).expect("import");
    let json = serde_json::to_string_pretty(&imp.deck).unwrap();
    eprintln!("{} slides, {} layouts, {} media, {} KB JSON, {:?}", imp.deck.slides.len(), imp.deck.layouts.len(), imp.media.len(), json.len() / 1024, t.elapsed());
    match args.get(2) {
        Some(out) => std::fs::write(out, json).unwrap(),
        None => println!("{json}"),
    }
}
