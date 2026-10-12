//! GPU renderer (wgpu): the CPU reference's passes as fragment shaders (`passes.wgsl`), with the
//! same constants, blur levels and skip rules, on f16 intermediate textures.
//!
//! ```text
//! Renderer::new → set_source(image) → set_recipe(settings, options) → render_image() / render_to(view)
//! ```
//! Preview and export are the same passes. Histograms read back a ≤256-px rendering of the
//! output (one path for WebGPU, WebGL2 and native).

mod pool;
mod readback;

use crate::color::{srgb_to_working, working_to_output, OutputSpace};
use crate::cpu::{self, blur::kernel, blur::MAX_DIRECT_SIGMA, Histogram};
use crate::curve::{tone_luts, LUT_SIZE};
use crate::recipe::Settings;
use crate::{Image, RenderOptions};
use pool::{Pool, Tex};
use std::collections::HashMap;
use wgpu::util::DeviceExt;

/// Intermediate images: f16, stored in linear sRGB primaries (see `m_store` in passes.wgsl) so
/// the format renders everywhere, WebGL2 included.
const MAIN: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// Scalar planes: value + rounding residual (see `split` in passes.wgsl).
const PLANE: wgpu::TextureFormat = wgpu::TextureFormat::Rg16Float;
/// Format of `render_image` targets.
pub const OUTPUT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const PASS_SLOTS: u64 = 256;

#[repr(C)]
#[derive(Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    m_in: [[f32; 4]; 3],
    m_out: [[f32; 4]; 3],
    m_load: [[f32; 4]; 3],
    m_store: [[f32; 4]; 3],
    tone: [f32; 4],
    tone2: [f32; 4],
    flags: [f32; 4],
    flags2: [f32; 4],
    hsl_hue: [[f32; 4]; 2],
    hsl_sat: [[f32; 4]; 2],
    hsl_lum: [[f32; 4]; 2],
    grade_off: [[f32; 4]; 3],
    grade: [f32; 4],
    presence: [f32; 4],
    presence2: [f32; 4],
    detail: [f32; 4],
    detail2: [f32; 4],
    vignette: [f32; 4],
    grain: [f32; 4],
    geom: [f32; 4],
    geom2: [f32; 4],
    geom3: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
struct PassUniform {
    mode: [f32; 4],
    size: [f32; 4],
    k: [[f32; 4]; 10],
}

fn b(v: bool) -> f32 {
    if v { 1.0 } else { 0.0 }
}

fn row3(m: [[f32; 3]; 3]) -> [[f32; 4]; 3] {
    m.map(|r| [r[0], r[1], r[2], 0.0])
}

/// What the passes need from the settings, plus which passes run (the CPU's skip rules).
struct Plan {
    params: Params,
    luts: Option<[Vec<f32>; 3]>,
    shadows_highlights: bool,
    texture: bool,
    clarity: bool,
    dehaze_dark: bool,
    noise_luma: bool,
    noise_color: bool,
    sharpen: bool,
    out: (u32, u32),
}

impl Plan {
    fn new(s: &Settings, o: &RenderOptions, w: u32, h: u32) -> Self {
        let long = w.max(h) as f32;
        let mut p = Params {
            m_in: row3(cpu::input_matrix(s)),
            m_out: row3(working_to_output(o.output)),
            m_load: row3(srgb_to_working()),
            m_store: row3(working_to_output(OutputSpace::Srgb)),
            ..Default::default()
        };
        let (sh, hl, ct, wv, bv) = (s.shadows / 100.0, s.highlights / 100.0, s.contrast / 100.0, s.whites / 100.0, s.blacks / 100.0);
        p.tone = [sh, hl, ct, wv];
        p.tone2 = [bv, long, o.scale, 1.0];
        let c = &s.tone_curve;
        let luts = tone_luts(&c.rgb, &c.r, &c.g, &c.b);
        let x = &s.hsl;
        let bands = [&x.red, &x.orange, &x.yellow, &x.green, &x.aqua, &x.blue, &x.purple, &x.magenta];
        let has_hsl = !bands.iter().all(|b| b.hue == 0.0 && b.sat == 0.0 && b.lum == 0.0);
        for (i, band) in bands.iter().enumerate() {
            p.hsl_hue[i / 4][i % 4] = band.hue / 100.0;
            p.hsl_sat[i / 4][i % 4] = band.sat / 100.0;
            p.hsl_lum[i / 4][i % 4] = band.lum / 100.0;
        }
        let g = &s.grading;
        let wheels = [&g.shadows, &g.midtones, &g.highlights];
        let has_grading = !wheels.iter().all(|w| w.sat == 0.0 && w.lum == 0.0);
        for (i, wh) in wheels.iter().enumerate() {
            let off = cpu::wheel_offset(wh.hue, wh.sat, wh.lum);
            p.grade_off[i] = [off[0], off[1], off[2], 0.0];
        }
        p.grade = [g.blending / 100.0, g.balance / 100.0, 0.0, 0.0];
        let pr = &s.presence;
        let (tx, cl, dh, vib, sat) = (pr.texture / 100.0, pr.clarity / 100.0, pr.dehaze / 100.0, pr.vibrance / 100.0, pr.saturation / 100.0);
        p.presence = [tx, cl, dh, vib];
        p.presence2 = [sat, 0.0, 0.0, 0.0];
        p.flags = [b(sh != 0.0 || hl != 0.0), b(ct != 0.0 || wv != 0.0 || bv != 0.0), b(luts.is_some()), b(has_hsl)];
        p.flags2 = [b(has_grading), b(tx != 0.0 || cl != 0.0), b(dh != 0.0), b(vib != 0.0 || sat != 0.0)];
        let d = &s.detail;
        let (nl, nc) = (d.noise.luma / 100.0, d.noise.color / 100.0);
        p.detail = [nl, nc, d.sharpen.amount / 100.0 * cpu::SHARPEN_K, d.sharpen.detail / 100.0];
        p.detail2 = [d.sharpen.masking / 100.0 * 0.1, 0.0, 0.0, 0.0];
        let v = &s.effects.vignette;
        p.vignette = [v.amount / 100.0, 0.2 + 0.8 * v.midpoint / 100.0, 0.05 + 0.95 * v.feather / 100.0, v.roundness];
        let gr = &s.effects.grain;
        p.grain = [gr.amount, gr.size, gr.roughness, 0.0];
        let ge = &s.geometry;
        let (sin, cos) = ge.angle.to_radians().sin_cos();
        p.geom = [ge.crop[0], ge.crop[1], sin, cos];
        let out = cpu::output_size(s, w, h);
        p.geom2 = [b(ge.flip_h), b(ge.flip_v), out.0 as f32, out.1 as f32];
        p.geom3 = [(ge.rotate % 4) as f32, 0.0, 0.0, 0.0];
        Plan {
            params: p,
            luts,
            shadows_highlights: sh != 0.0 || hl != 0.0,
            texture: tx != 0.0,
            clarity: cl != 0.0,
            dehaze_dark: dh > 0.0,
            noise_luma: nl > 0.0,
            noise_color: nc > 0.0,
            sharpen: d.sharpen.amount > 0.0,
            out,
        }
    }
}

struct Source {
    tex: wgpu::Texture,
    w: u32,
    h: u32,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    info: wgpu::AdapterInfo,
    layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    module: wgpu::ShaderModule,
    pipelines: HashMap<(&'static str, wgpu::TextureFormat), wgpu::RenderPipeline>,
    params: wgpu::Buffer,
    passes: wgpu::Buffer,
    pass_stride: u64,
    dummy: wgpu::Texture,
    lut: wgpu::Texture,
    pool: Pool,
    sources: Vec<Option<Source>>,
    current: Option<usize>,
    settings: Settings,
    options: RenderOptions,
}

/// One frame being encoded: pass uniforms are collected, then written once before submit.
struct Frame {
    enc: wgpu::CommandEncoder,
    uniforms: Vec<u8>,
}

impl Renderer {
    /// Picks the most capable adapter (WebGPU / Vulkan / Metal / DX12, then GL).
    pub async fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })
            .await
            .map_err(|e| format!("Aucun processeur graphique disponible : {e}"))?;
        Self::from_adapter(&adapter).await
    }

    pub async fn from_adapter(adapter: &wgpu::Adapter) -> Result<Self, String> {
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("oel-img"),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()),
                ..Default::default()
            })
            .await
            .map_err(|e| format!("Processeur graphique inutilisable : {e}"))?;
        Ok(Self::from_device(device, queue, adapter.get_info()))
    }

    pub fn from_device(device: wgpu::Device, queue: wgpu::Queue, info: wgpu::AdapterInfo) -> Self {
        let tex_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let uniform_entry = |binding, dynamic: bool, size: usize| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: dynamic,
                min_binding_size: wgpu::BufferSize::new(size as u64),
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("oel-img passes"),
            entries: &[
                uniform_entry(0, false, size_of::<Params>()),
                uniform_entry(1, true, size_of::<PassUniform>()),
                tex_entry(2),
                tex_entry(3),
                tex_entry(4),
                tex_entry(5),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("oel-img passes"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("oel-img passes.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("passes.wgsl").into()),
        });
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oel-img params"),
            size: size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let align = device.limits().min_uniform_buffer_offset_alignment as u64;
        let pass_stride = (size_of::<PassUniform>() as u64).div_ceil(align) * align;
        let passes = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oel-img pass uniforms"),
            size: pass_stride * PASS_SLOTS,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let dummy = device.create_texture_with_data(
            &queue,
            &texture_desc("oel-img dummy", 1, 1, MAIN, wgpu::TextureUsages::TEXTURE_BINDING),
            wgpu::util::TextureDataOrder::LayerMajor,
            &vec![0; MAIN.block_copy_size(None).unwrap() as usize],
        );
        let lut = device.create_texture(&texture_desc(
            "oel-img tone LUT",
            LUT_SIZE as u32,
            3,
            wgpu::TextureFormat::R32Float,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        ));
        Self {
            device,
            queue,
            info,
            layout,
            pipeline_layout,
            module,
            pipelines: HashMap::new(),
            params,
            passes,
            pass_stride,
            dummy,
            lut,
            pool: Pool::default(),
            sources: Vec::new(),
            current: None,
            settings: Settings::default(),
            options: RenderOptions::default(),
        }
    }

    /// Adapter name and backend (`Vulkan`, `Metal`, `Dx12`, `Gl`, `BrowserWebGpu`).
    pub fn adapter(&self) -> &wgpu::AdapterInfo {
        &self.info
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// Largest source or output side this device accepts.
    pub fn max_size(&self) -> u32 {
        self.device.limits().max_texture_dimension_2d
    }

    /// Replaces every source with `img` (upright, sRGB) and uses it.
    pub fn set_source(&mut self, img: &Image) -> Result<(), String> {
        self.clear_sources();
        let id = self.add_source(img)?;
        self.use_source(id);
        Ok(())
    }

    /// Uploads another version of the source (e.g. the half-size proxy used while a slider is
    /// dragged) and returns its slot. Larger than [`max_size`](Self::max_size) is refused.
    pub fn add_source(&mut self, img: &Image) -> Result<usize, String> {
        let max = self.max_size();
        if img.width > max || img.height > max {
            return Err(format!("Image trop grande pour le processeur graphique ({} × {}, max {max})", img.width, img.height));
        }
        let tex = self.device.create_texture_with_data(
            &self.queue,
            &texture_desc("oel-img source", img.width, img.height, wgpu::TextureFormat::Rgba8Unorm, wgpu::TextureUsages::TEXTURE_BINDING),
            wgpu::util::TextureDataOrder::LayerMajor,
            &img.data,
        );
        self.sources.push(Some(Source { tex, w: img.width, h: img.height }));
        Ok(self.sources.len() - 1)
    }

    /// Renders from source slot `id` from now on (unknown slots are ignored).
    pub fn use_source(&mut self, id: usize) {
        if matches!(self.sources.get(id), Some(Some(_))) {
            self.current = Some(id);
        }
    }

    /// Drops every source and intermediate texture.
    pub fn clear_sources(&mut self) {
        self.sources.clear();
        self.current = None;
        self.pool.clear();
    }

    fn source(&self) -> Option<&Source> {
        self.current.and_then(|i| self.sources.get(i)).and_then(|s| s.as_ref())
    }

    pub fn set_recipe(&mut self, s: &Settings, o: &RenderOptions) {
        self.settings = s.clone();
        self.options = *o;
    }

    /// Output size for the current source and recipe (the crop at source resolution).
    pub fn output_size(&self) -> (u32, u32) {
        self.source().map_or((0, 0), |src| cpu::output_size(&self.settings, src.w, src.h))
    }

    /// Renders into `view` (a canvas or any texture of `format`), scaling the output to the
    /// view's `size` (same aspect expected).
    pub fn render_to(&mut self, view: &wgpu::TextureView, format: wgpu::TextureFormat, size: (u32, u32)) -> Result<(), String> {
        let frame = self.encode(view, format, size)?;
        self.submit(frame);
        Ok(())
    }

    /// Renders the full output and reads it back.
    pub async fn render_image(&mut self) -> Result<Image, String> {
        let size = self.output_size();
        self.start_image(size)?.finish().await
    }

    /// Renders the output scaled to `size` and reads it back (thumbnails, histogram proxies).
    pub async fn render_image_sized(&mut self, size: (u32, u32)) -> Result<Image, String> {
        self.start_image(size)?.finish().await
    }

    /// Encodes and submits a render of the output scaled to `size`; the returned readback
    /// no longer borrows the renderer, so other calls may run while it is awaited.
    pub fn start_image(&mut self, size: (u32, u32)) -> Result<PendingImage, String> {
        let target = self.device.create_texture(&texture_desc(
            "oel-img output",
            size.0,
            size.1,
            OUTPUT,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        ));
        let view = target.create_view(&Default::default());
        let mut frame = self.encode(&view, OUTPUT, size)?;
        let rb = readback::Readback::new(&self.device, &mut frame.enc, &target, size);
        self.submit(frame);
        Ok(PendingImage { rb, device: self.device.clone(), size })
    }

    /// Size of the ≤ 256-px rendering histograms are computed from.
    pub fn histogram_size(&self) -> (u32, u32) {
        let (w, h) = self.output_size();
        let k = (256.0 / w.max(h).max(1) as f32).min(1.0);
        (((w as f32 * k).round() as u32).max(1), ((h as f32 * k).round() as u32).max(1))
    }

    /// Histogram of the output, from a rendering at most 256 px on its long side.
    pub async fn histogram(&mut self) -> Result<Histogram, String> {
        let size = self.histogram_size();
        Ok(cpu::histogram(&self.start_image(size)?.finish().await?))
    }

    fn submit(&mut self, frame: Frame) {
        self.queue.write_buffer(&self.passes, 0, &frame.uniforms);
        self.queue.submit([frame.enc.finish()]);
    }

    fn pipeline(&mut self, entry: &'static str, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        if let Some(p) = self.pipelines.get(&(entry, format)) {
            return p.clone();
        }
        let p = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(entry),
            layout: Some(&self.pipeline_layout),
            vertex: wgpu::VertexState { module: &self.module, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &self.module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        self.pipelines.insert((entry, format), p.clone());
        p
    }

    /// Records one full-screen pass reading `inputs` (t0…t3) into `out`.
    fn pass(&mut self, f: &mut Frame, entry: &'static str, out: &wgpu::TextureView, format: wgpu::TextureFormat, inputs: &[&wgpu::Texture], u: PassUniform) -> Result<(), String> {
        let slot = (f.uniforms.len() as u64) / self.pass_stride;
        if slot >= PASS_SLOTS {
            return Err("Trop de passes de rendu".into());
        }
        f.uniforms.extend_from_slice(bytemuck::bytes_of(&u));
        f.uniforms.resize(((slot + 1) * self.pass_stride) as usize, 0);
        let pipeline = self.pipeline(entry, format);
        let views: Vec<wgpu::TextureView> = (0..4).map(|i| inputs.get(i).copied().unwrap_or(&self.dummy).create_view(&Default::default())).collect();
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(entry),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.params.as_entire_binding() },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &self.passes,
                        offset: 0,
                        size: wgpu::BufferSize::new(size_of::<PassUniform>() as u64),
                    }),
                },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&views[0]) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&views[1]) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(&views[2]) },
                wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(&views[3]) },
            ],
        });
        let mut rp = f.enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(entry),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: out,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        rp.set_pipeline(&pipeline);
        rp.set_bind_group(0, &bind, &[(slot * self.pass_stride) as u32]);
        rp.draw(0..3, 0..1);
        Ok(())
    }

    /// Pass into a new pooled texture of `w × h`.
    fn pass_new(&mut self, f: &mut Frame, entry: &'static str, w: u32, h: u32, format: wgpu::TextureFormat, inputs: &[Tex], u: PassUniform) -> Result<Tex, String> {
        let out = self.pool.take(&self.device, w, h, format);
        let view = self.pool.get(out).create_view(&Default::default());
        let tex: Vec<wgpu::Texture> = inputs.iter().map(|t| self.pool.get(*t).clone()).collect();
        let refs: Vec<&wgpu::Texture> = tex.iter().collect();
        self.pass(f, entry, &view, format, &refs, u)?;
        Ok(out)
    }

    fn mode(mode: f32) -> PassUniform {
        PassUniform { mode: [mode, 0.0, 0.0, 0.0], ..Default::default() }
    }

    /// Blur of `src` (consumed) with the CPU's level rule; returns a new texture.
    fn blur(&mut self, f: &mut Frame, src: Tex, sigma: f32) -> Result<Tex, String> {
        let (w, h, fmt) = self.pool.dims(src);
        if sigma < 0.3 {
            return Ok(src);
        }
        let split = if fmt == PLANE { 1.0 } else { 0.0 };
        if sigma > MAX_DIRECT_SIGMA && (w > 1 || h > 1) {
            let down = PassUniform { mode: [0.0, 0.0, split, 0.0], ..Default::default() };
            let small = self.pass_new(f, "fs_down", w.div_ceil(2), h.div_ceil(2), fmt, &[src], down)?;
            self.pool.release(src);
            let blurred = self.blur(f, small, sigma / 2.0)?;
            let (sw, sh, _) = self.pool.dims(blurred);
            let u = PassUniform { mode: [0.0, 0.0, split, 0.0], size: [sw as f32, sh as f32, w as f32, h as f32], ..Default::default() };
            let up = self.pass_new(f, "fs_up", w, h, fmt, &[blurred], u)?;
            self.pool.release(blurred);
            return Ok(up);
        }
        let taps = kernel(sigma);
        let mut u = PassUniform { mode: [0.0, (taps.len() / 2) as f32, split, 0.0], ..Default::default() };
        for (i, t) in taps.iter().enumerate() {
            u.k[i / 4][i % 4] = *t;
        }
        let tmp = self.pass_new(f, "fs_blur", w, h, fmt, &[src], u)?;
        self.pool.release(src);
        u.mode[0] = 1.0;
        let out = self.pass_new(f, "fs_blur", w, h, fmt, &[tmp], u)?;
        self.pool.release(tmp);
        Ok(out)
    }

    /// Plane extracted from `img` (mode: 0 luma, 1 encoded luma, 2 dark channel, 3 chroma), blurred.
    fn blurred_plane(&mut self, f: &mut Frame, img: Tex, mode: f32, sigma: f32) -> Result<Tex, String> {
        let (w, h, _) = self.pool.dims(img);
        let fmt = if mode == 3.0 { MAIN } else { PLANE };
        let plane = self.pass_new(f, "fs_extract", w, h, fmt, &[img], Self::mode(mode))?;
        self.blur(f, plane, sigma)
    }

    /// Runs `entry` on `img` (consumed) with extra inputs, releasing them; returns the result.
    fn step(&mut self, f: &mut Frame, entry: &'static str, img: Tex, extra: &[Tex], u: PassUniform) -> Result<Tex, String> {
        let (w, h, _) = self.pool.dims(img);
        let mut inputs = vec![img];
        inputs.extend_from_slice(extra);
        let out = self.pass_new(f, entry, w, h, MAIN, &inputs, u)?;
        for t in inputs {
            self.pool.release(t);
        }
        Ok(out)
    }

    fn encode(&mut self, target: &wgpu::TextureView, format: wgpu::TextureFormat, size: (u32, u32)) -> Result<Frame, String> {
        let src = self.source().ok_or("Aucune image chargée")?;
        let (w, h, src_tex) = (src.w, src.h, src.tex.clone());
        let long = w.max(h) as f32;
        let scale = self.options.scale;
        let mut plan = Plan::new(&self.settings, &self.options, w, h);
        plan.params.tone2[3] = plan.out.0 as f32 / size.0.max(1) as f32;
        plan.params.geom2[2] = size.0 as f32;
        plan.params.geom2[3] = size.1 as f32;
        self.queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&plan.params));
        if let Some(luts) = &plan.luts {
            let data: Vec<f32> = luts.iter().flatten().copied().collect();
            self.queue.write_texture(
                self.lut.as_image_copy(),
                bytemuck::cast_slice(&data),
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(LUT_SIZE as u32 * 4), rows_per_image: None },
                wgpu::Extent3d { width: LUT_SIZE as u32, height: 3, depth_or_array_layers: 1 },
            );
        }
        self.pool.release_all();
        let mut f = Frame { enc: self.device.create_command_encoder(&Default::default()), uniforms: Vec::new() };
        let p = &plan.params;

        // Input
        let out = self.pool.take(&self.device, w, h, MAIN);
        let view = self.pool.get(out).create_view(&Default::default());
        self.pass(&mut f, "fs_input", &view, MAIN, &[&src_tex], PassUniform::default())?;
        let mut img = out;

        // Tone
        if p.flags[0] > 0.0 || p.flags[1] > 0.0 {
            let base = if plan.shadows_highlights { vec![self.blurred_plane(&mut f, img, 0.0, cpu::TONE_BASE_SIGMA * long)?] } else { vec![] };
            img = self.step(&mut f, "fs_tone", img, &base, PassUniform::default())?;
        }
        // Colour: curves, HSL, grading
        if p.flags[2] > 0.0 || p.flags[3] > 0.0 || p.flags2[0] > 0.0 {
            let (w2, h2, _) = self.pool.dims(img);
            let out = self.pool.take(&self.device, w2, h2, MAIN);
            let view = self.pool.get(out).create_view(&Default::default());
            let a = self.pool.get(img).clone();
            let lut = self.lut.clone();
            self.pass(&mut f, "fs_color", &view, MAIN, &[&a, &self.dummy.clone(), &lut], PassUniform::default())?;
            self.pool.release(img);
            img = out;
        }
        // Texture / clarity (bases blurred from the same encoded luminance)
        if p.flags2[1] > 0.0 {
            let mut extra = vec![];
            extra.push(if plan.texture { self.blurred_plane(&mut f, img, 1.0, cpu::TEXTURE_SIGMA * long)? } else { self.pool.take(&self.device, 1, 1, PLANE) });
            extra.push(if plan.clarity { self.blurred_plane(&mut f, img, 1.0, cpu::CLARITY_SIGMA * long)? } else { self.pool.take(&self.device, 1, 1, PLANE) });
            img = self.step(&mut f, "fs_texture_clarity", img, &extra, PassUniform::default())?;
        }
        // Dehaze, vibrance, saturation
        if p.flags2[2] > 0.0 || p.flags2[3] > 0.0 {
            let extra = if plan.dehaze_dark { vec![self.blurred_plane(&mut f, img, 2.0, cpu::DEHAZE_SIGMA * long)?] } else { vec![] };
            img = self.step(&mut f, "fs_dehaze_vibrance", img, &extra, PassUniform::default())?;
        }
        // Noise reduction
        if plan.noise_luma {
            let base = self.blurred_plane(&mut f, img, 1.0, (0.5 + 1.5 * p.detail[0]) * scale)?;
            img = self.step(&mut f, "fs_noise", img, &[base], Self::mode(0.0))?;
        }
        if plan.noise_color {
            let chroma = self.blurred_plane(&mut f, img, 3.0, (1.0 + 3.0 * p.detail[1]) * scale)?;
            img = self.step(&mut f, "fs_noise", img, &[chroma], Self::mode(1.0))?;
        }
        // Sharpening
        if plan.sharpen {
            let base = self.blurred_plane(&mut f, img, 1.0, self.settings.detail.sharpen.radius * scale)?;
            img = self.step(&mut f, "fs_sharpen", img, &[base], PassUniform::default())?;
        }
        // Final
        let last = self.pool.get(img).clone();
        self.pass(&mut f, "fs_final", target, format, &[&last], PassUniform::default())?;
        self.pool.release(img);
        Ok(f)
    }
}

/// A submitted render waiting to be read back.
pub struct PendingImage {
    rb: readback::Readback,
    device: wgpu::Device,
    size: (u32, u32),
}

impl PendingImage {
    pub async fn finish(self) -> Result<Image, String> {
        let data = self.rb.read(&self.device).await?;
        Ok(Image { width: self.size.0, height: self.size.1, data })
    }
}

fn texture_desc(label: &str, w: u32, h: u32, format: wgpu::TextureFormat, usage: wgpu::TextureUsages) -> wgpu::TextureDescriptor<'_> {
    wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d { width: w.max(1), height: h.max(1), depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Renderer {
    /// Blocking constructor for native callers and tests.
    pub fn new_blocking() -> Result<Self, String> {
        pollster::block_on(Self::new())
    }

    /// Blocking full-size render for native callers and tests.
    pub fn render_blocking(&mut self) -> Result<Image, String> {
        pollster::block_on(self.render_image())
    }
}
