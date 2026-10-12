//! Times preview-sized renders per adapter:
//! `cargo run -p oel-img --release --features gpu --example gpu_bench [-- '<recipe>' …]`
use oelimg::{gpu::Renderer, Image, Recipe, RenderOptions};
use std::time::Instant;

fn main() {
    let (w, h) = (2400u32, 1600u32);
    let data = (0..w * h).flat_map(|i| [(i % 251) as u8, (i % 241) as u8, (i % 239) as u8, 255]).collect();
    let img = Image { width: w, height: h, data };
    let light = Recipe::from_json(r#"{"exposure":0.3,"contrast":20,"hsl":{"red":{"sat":20}}}"#).unwrap().resolve();
    let heavy = Recipe::from_json(r#"{"exposure":0.3,"contrast":20,"highlights":-30,"shadows":30,"presence":{"texture":20,"clarity":25,"dehaze":10,"vibrance":20},"detail":{"sharpen":{"amount":40},"noise":{"luma":20,"color":20}},"effects":{"vignette":{"amount":-20},"grain":{"amount":10}}}"#).unwrap().resolve();
    let cases: Vec<(String, oelimg::Settings)> = std::env::args().skip(1).map(|j| (j.clone(), Recipe::from_json(&j).unwrap().resolve())).collect();
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    for a in pollster::block_on(instance.enumerate_adapters(wgpu::Backends::PRIMARY)) {
        let mut r = pollster::block_on(Renderer::from_adapter(&a)).unwrap();
        r.set_source(&img).unwrap();
        let target = r.device().create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: oelimg::gpu::OUTPUT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = target.create_view(&Default::default());
        let default = vec![("light".to_string(), light.clone()), ("heavy".to_string(), heavy.clone())];
        for (label, s) in if cases.is_empty() { &default } else { &cases } {
            r.set_recipe(s, &RenderOptions::default());
            r.render_to(&view, oelimg::gpu::OUTPUT, (w, h)).unwrap();
            r.device().poll(wgpu::PollType::wait_indefinitely()).unwrap();
            let n = 20;
            let t = Instant::now();
            for _ in 0..n {
                r.render_to(&view, oelimg::gpu::OUTPUT, (w, h)).unwrap();
            }
            r.device().poll(wgpu::PollType::wait_indefinitely()).unwrap();
            println!("{} — {label} {w}×{h}: {:.1} ms/frame", a.get_info().name, t.elapsed().as_secs_f64() * 1000.0 / n as f64);
        }
    }
}
