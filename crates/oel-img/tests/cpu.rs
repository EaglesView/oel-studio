//! CPU reference: identity, one assertion per control (direction of the effect), geometry,
//! decoding of the fixtures in `fixtures/img/`.

use oelimg::color::{luma, rgb_to_hsv, srgb_eotf};
use oelimg::cpu::{histogram, mean_luma, render, resize_area};
use oelimg::decode::decode;
use oelimg::{Image, Recipe, RenderOptions, Settings};
use serde_json::json;

const FIXTURES: [&str; 7] = ["landscape.jpg", "portrait.jpg", "high-key.jpg", "low-key.jpg", "saturated.png", "alpha.png", "adobe-rgb.jpg"];

fn fixture(name: &str) -> Image {
    let path = format!("{}/../../fixtures/img/{name}", env!("CARGO_MANIFEST_DIR"));
    decode(&std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))).unwrap()
}

fn settings(v: serde_json::Value) -> Settings {
    serde_json::from_value::<Recipe>(v).unwrap().resolve()
}

fn run(img: &Image, v: serde_json::Value) -> Image {
    render(img, &settings(v), &RenderOptions::default())
}

fn linear(img: &Image) -> Vec<[f32; 3]> {
    img.data.chunks_exact(4).map(|p| [0, 1, 2].map(|i| srgb_eotf(p[i] as f32 / 255.0))).collect()
}

/// Mean luminance of the pixels whose *original* luminance satisfies `pick`.
fn mean_where(orig: &Image, out: &Image, pick: impl Fn(f32) -> bool) -> f32 {
    let (a, b) = (linear(orig), linear(out));
    let sel: Vec<f32> = a.iter().zip(&b).filter(|(o, _)| pick(luma(**o))).map(|(_, n)| luma(*n)).collect();
    assert!(!sel.is_empty());
    sel.iter().sum::<f32>() / sel.len() as f32
}

fn std_luma(img: &Image) -> f32 {
    let l: Vec<f32> = linear(img).iter().map(|c| luma(*c).powf(1.0 / 2.2)).collect();
    let m = l.iter().sum::<f32>() / l.len() as f32;
    (l.iter().map(|v| (v - m).powi(2)).sum::<f32>() / l.len() as f32).sqrt()
}

/// High-frequency energy: mean absolute difference between horizontal neighbours.
fn hf(img: &Image) -> f32 {
    let w = img.width as usize;
    let l: Vec<f32> = linear(img).iter().map(|c| luma(*c).powf(1.0 / 2.2)).collect();
    let mut s = 0.0;
    for (i, v) in l.iter().enumerate() {
        if i % w + 1 < w {
            s += (l[i + 1] - v).abs();
        }
    }
    s / l.len() as f32
}

fn mean_sat(img: &Image) -> f32 {
    let l = linear(img);
    l.iter().map(|c| rgb_to_hsv(c.map(|v| v.powf(1.0 / 2.2)))[1]).sum::<f32>() / l.len() as f32
}

fn mean_channel(img: &Image, ch: usize) -> f32 {
    let l = linear(img);
    l.iter().map(|c| c[ch]).sum::<f32>() / l.len() as f32
}

#[test]
fn identity_recipe_is_the_input() {
    for name in FIXTURES {
        let img = fixture(name);
        let out = render(&img, &Settings::default(), &RenderOptions::default());
        assert_eq!((out.width, out.height), (img.width, img.height), "{name}");
        let max = img.data.iter().zip(&out.data).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
        assert!(max <= 1, "{name}: max diff {max}");
    }
}

#[test]
fn decoding_orients_and_converts() {
    let p = fixture("portrait.jpg");
    assert_eq!((p.width, p.height), (160, 240), "EXIF orientation 6 applied");
    let a = fixture("alpha.png");
    assert_eq!(a.data[3], 0, "corner transparent");
    let mid = ((80 * 240 + 120) * 4 + 3) as usize;
    assert_eq!(a.data[mid], 255);
    // Adobe RGB tagged: converting to sRGB widens chroma, so it must differ from reading the
    // same pixels untagged.
    let bytes = std::fs::read(format!("{}/../../fixtures/img/adobe-rgb.jpg", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let raw = image::load_from_memory(&bytes).unwrap().to_rgba8().into_raw();
    let tagged = fixture("adobe-rgb.jpg");
    let diff = raw.iter().zip(&tagged.data).filter(|(a, b)| a.abs_diff(**b) > 3).count();
    assert!(diff > raw.len() / 20, "ICC conversion applied ({diff} values changed)");
}

#[test]
fn white_balance_and_exposure() {
    let img = fixture("landscape.jpg");
    let base = mean_luma(&img);
    assert!(mean_luma(&run(&img, json!({ "exposure": 1.0 }))) > base * 1.5);
    assert!(mean_luma(&run(&img, json!({ "exposure": -1.0 }))) < base * 0.7);
    let warm = run(&img, json!({ "whiteBalance": { "tempK": 9000 } }));
    let cool = run(&img, json!({ "whiteBalance": { "tempK": 4000 } }));
    let rb = |i: &Image| mean_channel(i, 0) - mean_channel(i, 2);
    assert!(rb(&warm) > rb(&img) && rb(&img) > rb(&cool));
    let mag = run(&img, json!({ "whiteBalance": { "tint": 60 } }));
    let mg = |i: &Image| (mean_channel(i, 0) + mean_channel(i, 2)) / 2.0 - mean_channel(i, 1);
    assert!(mg(&mag) > mg(&img));
}

#[test]
fn tone_controls() {
    let img = fixture("landscape.jpg");
    let ctr = |v: f32| std_luma(&run(&img, json!({ "contrast": v })));
    assert!(ctr(-50.0) < ctr(0.0) && ctr(0.0) < ctr(50.0));

    let bright = |l: f32| l > 0.4;
    let dark = |l: f32| l < 0.05;
    let hl = |v: f32| mean_where(&img, &run(&img, json!({ "highlights": v })), bright);
    assert!(hl(-80.0) < hl(0.0) && hl(0.0) < hl(80.0));
    let sh = |v: f32| mean_where(&img, &run(&img, json!({ "shadows": v })), dark);
    assert!(sh(-80.0) < sh(0.0) && sh(0.0) < sh(80.0));
    let wh = |v: f32| mean_where(&img, &run(&img, json!({ "whites": v })), bright);
    assert!(wh(-80.0) < wh(0.0) && wh(0.0) < wh(80.0));
    let bl = |v: f32| mean_where(&img, &run(&img, json!({ "blacks": v })), dark);
    assert!(bl(-80.0) < bl(0.0) && bl(0.0) < bl(80.0));

    let lifted = run(&img, json!({ "toneCurve": { "rgb": [[0, 0], [0.5, 0.65], [1, 1]] } }));
    assert!(mean_luma(&lifted) > mean_luma(&img));
    let red = run(&img, json!({ "toneCurve": { "r": [[0, 0], [0.5, 0.6], [1, 1]] } }));
    assert!(mean_channel(&red, 0) > mean_channel(&img, 0));
    assert!((mean_channel(&red, 2) - mean_channel(&img, 2)).abs() < 1e-3);
}

#[test]
fn colour_controls() {
    let img = fixture("saturated.png");
    let sat = |v: f32| mean_sat(&run(&img, json!({ "presence": { "saturation": v } })));
    assert!(sat(-50.0) < sat(0.0) && sat(0.0) < sat(50.0));
    let grey = run(&img, json!({ "presence": { "saturation": -100 } }));
    assert!(mean_sat(&grey) < 0.01);
    let dull = fixture("high-key.jpg");
    let vib = |v: f32| mean_sat(&run(&dull, json!({ "presence": { "vibrance": v } })));
    assert!(vib(-50.0) < vib(0.0) && vib(0.0) < vib(50.0));

    // HSL: only reds move with the red band.
    let reds = |i: &Image| {
        let l = linear(i);
        let o = linear(&img);
        let sel: Vec<f32> = o.iter().zip(&l).filter(|(c, _)| { let h = rgb_to_hsv(**c); h[1] > 0.5 && (h[0] < 10.0 || h[0] > 350.0) }).map(|(_, n)| rgb_to_hsv(n.map(|v| v.powf(1.0 / 2.2)))[1]).collect();
        sel.iter().sum::<f32>() / sel.len() as f32
    };
    let desat = run(&img, json!({ "hsl": { "red": { "sat": -80 } } }));
    assert!(reds(&desat) < reds(&img) - 0.2);
    let blues = |i: &Image| {
        let (o, l) = (linear(&img), linear(i));
        o.iter().zip(&l).filter(|(c, _)| { let h = rgb_to_hsv(**c); h[1] > 0.5 && (h[0] - 240.0).abs() < 8.0 }).map(|(_, n)| n[2]).sum::<f32>()
    };
    assert!((blues(&desat) - blues(&img)).abs() / blues(&img) < 0.01, "blues untouched");
    let darker = run(&img, json!({ "hsl": { "red": { "lum": -80 } } }));
    assert!(mean_luma(&darker) < mean_luma(&img));

    // Grading: warm highlights raise red in bright pixels more than in dark ones.
    let land = fixture("landscape.jpg");
    let g = run(&land, json!({ "grading": { "highlights": { "hue": 30, "sat": 80 } } }));
    let red_gain = |pick: &dyn Fn(f32) -> bool| {
        let (o, n) = (linear(&land), linear(&g));
        let d: Vec<f32> = o.iter().zip(&n).filter(|(c, _)| pick(luma(**c))).map(|(c, x)| (x[0] - x[2]) - (c[0] - c[2])).collect();
        d.iter().sum::<f32>() / d.len() as f32
    };
    assert!(red_gain(&|l| l > 0.4) > red_gain(&|l| l < 0.03) + 0.01);
    let lift = run(&land, json!({ "grading": { "shadows": { "lum": 60 } } }));
    assert!(mean_where(&land, &lift, |l| l < 0.03) > mean_where(&land, &land, |l| l < 0.03));
}

#[test]
fn presence_and_detail() {
    let img = fixture("landscape.jpg");
    let base_hf = hf(&img);
    for (key, v) in [("texture", 80.0), ("clarity", 80.0)] {
        assert!(hf(&run(&img, json!({ "presence": { key: v } }))) > base_hf, "{key} +");
        assert!(hf(&run(&img, json!({ "presence": { key: -v } }))) < base_hf, "{key} −");
    }
    let hazy = fixture("high-key.jpg");
    let dh = |v: f32| std_luma(&run(&hazy, json!({ "presence": { "dehaze": v } })));
    assert!(dh(-50.0) < dh(0.0) && dh(0.0) < dh(50.0));

    let sharp = |a: f32| hf(&run(&img, json!({ "detail": { "sharpen": { "amount": a } } })));
    assert!(sharp(0.0) < sharp(60.0) && sharp(60.0) < sharp(140.0));
    let masked = hf(&run(&img, json!({ "detail": { "sharpen": { "amount": 140, "masking": 90 } } })));
    assert!(masked < sharp(140.0) && masked >= base_hf);
    let nr = |v: f32| hf(&run(&img, json!({ "detail": { "noise": { "luma": v } } })));
    assert!(nr(80.0) < nr(30.0) && nr(30.0) < nr(0.0));
    let cn = run(&img, json!({ "detail": { "noise": { "color": 100 } } }));
    assert!(img.data.iter().zip(&cn.data).any(|(a, b)| a != b));
}

#[test]
fn effects() {
    let img = fixture("landscape.jpg");
    let corner = |i: &Image| {
        let w = i.width as usize;
        (0..8).flat_map(|y| (0..8).map(move |x| (y, x))).map(|(y, x)| { let p = &i.data[(y * w + x) * 4..][..3]; p.iter().map(|v| *v as f32).sum::<f32>() }).sum::<f32>()
    };
    let centre = |i: &Image| { let p = &i.data[((80 * i.width as usize) + 120) * 4..][..3]; p.iter().map(|v| *v as u32).sum::<u32>() };
    let dark = run(&img, json!({ "effects": { "vignette": { "amount": -80 } } }));
    assert!(corner(&dark) < corner(&img) * 0.8);
    assert_eq!(centre(&dark), centre(&img), "centre untouched");
    let light = run(&img, json!({ "effects": { "vignette": { "amount": 80 } } }));
    assert!(corner(&light) > corner(&img));

    let flat = Image { width: 64, height: 64, data: [128, 128, 128, 255].repeat(64 * 64) };
    let grain = |a: f32| hf(&run(&flat, json!({ "effects": { "grain": { "amount": a } } })));
    assert_eq!(grain(0.0), 0.0);
    assert!(grain(30.0) > 0.0 && grain(30.0) < grain(90.0));
    // Grain is tied to the original's pixels: a half-size proxy shows the same pattern, coarser.
    let full = run(&flat, json!({ "effects": { "grain": { "amount": 80 } } }));
    let proxy = render(&resize_area(&flat, 32, 32), &settings(json!({ "effects": { "grain": { "amount": 80 } } })), &RenderOptions { scale: 0.5, ..Default::default() });
    let small = resize_area(&full, 32, 32);
    let corr = small.data.chunks_exact(4).zip(proxy.data.chunks_exact(4)).filter(|(a, b)| (a[0] as i32 - 128).signum() == (b[0] as i32 - 128).signum()).count();
    assert!(corr > 32 * 32 * 6 / 10, "{corr}");
}

#[test]
fn geometry() {
    let img = fixture("landscape.jpg");
    let c = run(&img, json!({ "geometry": { "crop": [0.25, 0.5, 0.75, 1.0] } }));
    assert_eq!((c.width, c.height), (120, 80));
    // The crop's first pixel is the source pixel at (60, 80).
    let src = &img.data[(80 * 240 + 60) * 4..][..4];
    assert!(c.data[..4].iter().zip(src).all(|(a, b)| a.abs_diff(*b) <= 1));

    let f = run(&img, json!({ "geometry": { "flipH": true } }));
    let row = 10 * 240;
    assert!(f.data[row * 4..][..3].iter().zip(&img.data[(row + 239) * 4..][..3]).all(|(a, b)| a.abs_diff(*b) <= 1));

    let r = run(&img, json!({ "geometry": { "angle": 10 } }));
    assert_eq!(r.data[3], 0, "rotated corner falls outside the image");
    assert_eq!(r.data[((80 * 240) + 120) * 4 + 3], 255);
    // Counter-clockwise: the bright sky's right end (top right) moves towards the left.
    let p = run(&img, json!({ "geometry": { "angle": 90, "crop": [0.25, 0.0, 0.75, 1.0] } }));
    assert_eq!(p.data[(0 * 120 + 60) * 4 + 3], 255);
}

#[test]
fn layering_and_json() {
    let gallery: Recipe = serde_json::from_value(json!({ "exposure": 0.5, "presence": { "clarity": 20, "vibrance": 10 } })).unwrap();
    let image: Recipe = serde_json::from_value(json!({ "presence": { "clarity": -5 }, "geometry": { "crop": [0.1, 0.1, 0.9, 0.9] } })).unwrap();
    let s = Recipe::stack([&image, &gallery]).resolve();
    assert_eq!(s.exposure, 0.5);
    assert_eq!(s.presence.clarity, -5.0);
    assert_eq!(s.presence.vibrance, 10.0);
    assert_eq!(s.geometry.crop, [0.1, 0.1, 0.9, 0.9]);
    assert_eq!(s.contrast, 0.0);

    // Round trip; unset leaves and empty groups are omitted.
    let r = image.over(&gallery);
    let text = r.to_json();
    assert_eq!(Recipe::from_json(&text).unwrap(), r);
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert!(v.get("hsl").is_none() && v.get("contrast").is_none());
    assert_eq!(Recipe::default().to_json(), "{}");
    assert!(Recipe::from_json(r#"{"format":"oel-img-recipe@9"}"#).is_err());
    assert!(Recipe::from_json(r#"{"format":"oel-img-recipe@1","exposure":1}"#).is_ok());
}

#[test]
fn histogram_counts_opaque_pixels() {
    let img = fixture("alpha.png");
    let h = histogram(&img);
    let opaque = img.data.chunks_exact(4).filter(|p| p[3] > 0).count() as u32;
    assert_eq!(h.luma.iter().sum::<u32>(), opaque);
    assert!(opaque < img.width * img.height);
}
