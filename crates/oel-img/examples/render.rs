//! `cargo run -p oel-img --release --example render -- in.jpg '{"exposure":1}' out.png`
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let [_, input, recipe, output] = &a[..] else {
        eprintln!("usage: render <image> <recipe-json> <out.png>");
        std::process::exit(2);
    };
    let img = oelimg::decode::decode(&std::fs::read(input).unwrap()).unwrap();
    let s = oelimg::Recipe::from_json(recipe).unwrap().resolve();
    let out = oelimg::cpu::render(&img, &s, &oelimg::RenderOptions::default());
    image::save_buffer(output, &out.data, out.width, out.height, image::ExtendedColorType::Rgba8).unwrap();
}
