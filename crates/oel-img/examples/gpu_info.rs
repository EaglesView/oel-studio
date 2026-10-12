//! Lists adapters and tries the renderer on each: `cargo run -p oel-img --features gpu --example gpu_info`
fn main() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    for a in pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())) {
        let i = a.get_info();
        let l = a.limits();
        let r = pollster::block_on(a.request_device(&wgpu::DeviceDescriptor::default()));
        println!("{} ({:?}, {:?}) max 2D {} → default device: {}", i.name, i.backend, i.device_type, l.max_texture_dimension_2d, r.as_ref().map(|_| "ok".to_string()).unwrap_or_else(|e| e.to_string()));
        drop(r);
        for f in [wgpu::TextureFormat::R32Float, wgpu::TextureFormat::Rg32Float, wgpu::TextureFormat::Rgba32Float, wgpu::TextureFormat::R16Float, wgpu::TextureFormat::Rgba16Float] {
            let ok = a.get_texture_format_features(f).allowed_usages.contains(wgpu::TextureUsages::RENDER_ATTACHMENT);
            println!("  {f:?} renderable: {ok}");
        }
        match pollster::block_on(oelimg::gpu::Renderer::from_adapter(&a)) {
            Ok(_) => println!("  renderer ok"),
            Err(e) => println!("  renderer: {e}"),
        }
    }
}
