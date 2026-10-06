//! GPU vs CPU reference: every control on every fixture, max per-channel difference ≤ 2/255.
//!
//! Runs on a software adapter (lavapipe / WARP) when present, else the first adapter; skipped
//! with a message when there is none. `OEL_IMG_ADAPTERS=all` checks every adapter. The GL
//! backend (the WebGL2 path) runs only with `WGPU_BACKEND=gl … -- --test-threads=1`; on NVIDIA
//! add `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json`.

use oelimg::cpu::render;
use oelimg::decode::decode;
use oelimg::gpu::Renderer;
use oelimg::{Image, Recipe, RenderOptions};
use serde_json::json;

fn fixture(name: &str) -> Image {
    decode(&std::fs::read(format!("{}/../../fixtures/img/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap()
}

/// The instance must outlive its adapters (GL ties its context to it).
fn instance() -> &'static wgpu::Instance {
    static I: std::sync::OnceLock<wgpu::Instance> = std::sync::OnceLock::new();
    I.get_or_init(|| {
        let mut d = wgpu::InstanceDescriptor::new_without_display_handle_from_env();
        // GL only when asked (`WGPU_BACKEND=gl`): headless EGL is fragile with parallel tests.
        d.backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY);
        wgpu::Instance::new(d)
    })
}

fn adapters() -> Vec<wgpu::Adapter> {
    let instance = instance();
    let all = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    if std::env::var("OEL_IMG_ADAPTERS").as_deref() == Ok("all") {
        return all;
    }
    let cpu = all.iter().position(|a| a.get_info().device_type == wgpu::DeviceType::Cpu);
    all.into_iter().nth(cpu.unwrap_or(0)).into_iter().collect()
}

fn recipes() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("identity", json!({})),
        ("exposure", json!({ "exposure": 0.8 })),
        ("white balance", json!({ "whiteBalance": { "tempK": 8000, "tint": 30 } })),
        ("contrast", json!({ "contrast": 60 })),
        ("highlights/shadows", json!({ "highlights": -70, "shadows": 60 })),
        ("whites/blacks", json!({ "whites": 50, "blacks": -40 })),
        ("tone curve", json!({ "toneCurve": { "rgb": [[0, 0], [0.3, 0.2], [0.7, 0.85], [1, 1]], "b": [[0, 0.05], [1, 0.95]] } })),
        ("hsl", json!({ "hsl": { "red": { "hue": 40, "sat": -50 }, "blue": { "lum": 50 }, "green": { "sat": 60 } } })),
        ("grading", json!({ "grading": { "shadows": { "hue": 210, "sat": 60, "lum": -10 }, "highlights": { "hue": 40, "sat": 50 }, "balance": 20 } })),
        ("texture", json!({ "presence": { "texture": 70 } })),
        ("clarity", json!({ "presence": { "clarity": -60 } })),
        ("dehaze +", json!({ "presence": { "dehaze": 60 } })),
        ("dehaze −", json!({ "presence": { "dehaze": -60 } })),
        ("vibrance/saturation", json!({ "presence": { "vibrance": 60, "saturation": -20 } })),
        ("noise luma", json!({ "detail": { "noise": { "luma": 70 } } })),
        ("noise color", json!({ "detail": { "noise": { "color": 80 } } })),
        ("sharpen", json!({ "detail": { "sharpen": { "amount": 120, "radius": 1.5, "detail": 60, "masking": 30 } } })),
        ("vignette", json!({ "effects": { "vignette": { "amount": -60, "roundness": 40, "feather": 30 } } })),
        ("grain", json!({ "effects": { "grain": { "amount": 60, "size": 40, "roughness": 70 } } })),
        ("geometry", json!({ "geometry": { "crop": [0.1, 0.15, 0.85, 0.9], "angle": 7.5, "flipH": true } })),
        ("everything", json!({
            "exposure": 0.3, "contrast": 20, "highlights": -30, "shadows": 30, "whiteBalance": { "tempK": 5600 },
            "presence": { "clarity": 25, "vibrance": 20 }, "hsl": { "orange": { "sat": 20 } },
            "detail": { "sharpen": { "amount": 40 } }, "effects": { "vignette": { "amount": -20 } },
            "geometry": { "crop": [0.05, 0.05, 0.95, 0.95] }
        })),
    ]
}

#[test]
fn gpu_matches_cpu() {
    let adapters = adapters();
    if adapters.is_empty() {
        eprintln!("gpu_parity: aucun adaptateur graphique (installer lavapipe / mesa-vulkan-drivers) — test ignoré");
        return;
    }
    let fixtures = ["landscape.jpg", "portrait.jpg", "high-key.jpg", "low-key.jpg", "saturated.png", "alpha.png"];
    let mut failures = vec![];
    for adapter in adapters {
        let info = adapter.get_info();
        let mut r = pollster::block_on(Renderer::from_adapter(&adapter)).unwrap();
        eprintln!("gpu_parity on {} ({:?})", info.name, info.backend);
        for name in fixtures {
            let img = fixture(name);
            r.set_source(&img).unwrap();
            for (label, v) in recipes() {
                let s = serde_json::from_value::<Recipe>(v).unwrap().resolve();
                let o = RenderOptions::default();
                let cpu = render(&img, &s, &o);
                r.set_recipe(&s, &o);
                let gpu = r.render_blocking().unwrap();
                assert_eq!((gpu.width, gpu.height), (cpu.width, cpu.height), "{label} on {name}");
                let mut max = 0;
                let mut at = 0;
                for (i, (a, b)) in cpu.data.iter().zip(&gpu.data).enumerate() {
                    if a.abs_diff(*b) > max {
                        max = a.abs_diff(*b);
                        at = i;
                    }
                }
                if max > 2 {
                    let px = at / 4;
                    failures.push(format!(
                        "{}: {label} on {name}: max diff {max} at ({}, {}) channel {} — cpu {:?} gpu {:?}",
                        info.name, px % cpu.width as usize, px / cpu.width as usize, at % 4,
                        &cpu.data[px * 4..px * 4 + 4], &gpu.data[px * 4..px * 4 + 4]
                    ));
                }
            }
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn proxy_render_and_histogram() {
    let Some(adapter) = adapters().into_iter().next() else { return };
    let mut r = pollster::block_on(Renderer::from_adapter(&adapter)).unwrap();
    let img = fixture("landscape.jpg");
    r.set_source(&img).unwrap();
    r.set_recipe(&Default::default(), &Default::default());
    let small = pollster::block_on(r.render_image_sized((60, 40))).unwrap();
    assert_eq!((small.width, small.height), (60, 40));
    let h = pollster::block_on(r.histogram()).unwrap();
    assert_eq!(h.luma.iter().sum::<u32>(), 240 * 160);
}
