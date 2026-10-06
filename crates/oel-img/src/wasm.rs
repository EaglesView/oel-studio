//! Thin wasm-bindgen surface for `@oel/img`: the GPU view (feature `gpu`), the CPU fallback,
//! histograms and recipe layering.

use crate::cpu;
use crate::recipe::Recipe;
use crate::{Image, OutputSpace, RenderOptions};
use wasm_bindgen::prelude::*;

/// Panics (wgpu validation errors included) go to the console with their message instead of a
/// bare `unreachable`.
#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(|info| web_sys::console::error_1(&format!("oel-img : {info}").into())));
}

#[wasm_bindgen]
pub struct Rendered {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl Rendered {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    /// RGBA8, sRGB (or Display P3 when asked), straight alpha.
    #[wasm_bindgen(getter)]
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }
}

/// Renders `rgba` (`width × height`, upright sRGB) with the effective recipe `recipe_json`
/// (already layered). `scale` = source pixels per original pixel.
#[wasm_bindgen]
pub fn render_rgba(rgba: Vec<u8>, width: u32, height: u32, recipe_json: &str, scale: f32, display_p3: bool) -> Result<Rendered, JsError> {
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err(JsError::new("Taille d’image incohérente"));
    }
    let opts = RenderOptions { scale, output: if display_p3 { OutputSpace::DisplayP3 } else { OutputSpace::Srgb } };
    let out = cpu::render(&Image { width, height, data: rgba }, &settings(recipe_json)?, &opts);
    Ok(Rendered { width: out.width, height: out.height, pixels: out.data })
}

/// Layers recipes, most specific first (`[imageOverrides, galleryStyle]`), into one recipe.
#[wasm_bindgen]
pub fn stack_recipes(layers_json: &str) -> Result<String, JsError> {
    let layers: Vec<Recipe> = serde_json::from_str(layers_json).map_err(|e| JsError::new(&format!("Recettes illisibles : {e}")))?;
    Ok(Recipe::stack(&layers).to_json())
}

/// 256-bin histograms `[r…, g…, b…, luma…]` (1024 values) of RGBA pixels (CPU path).
#[wasm_bindgen]
pub fn histogram_rgba(rgba: Vec<u8>, width: u32, height: u32) -> Vec<u32> {
    flat_histogram(&cpu::histogram(&Image { width, height, data: rgba }))
}

fn flat_histogram(h: &cpu::Histogram) -> Vec<u32> {
    [h.r, h.g, h.b, h.luma].concat()
}

fn settings(recipe_json: &str) -> Result<crate::Settings, JsError> {
    Ok(Recipe::from_json(recipe_json).map_err(|e| JsError::new(&e))?.resolve())
}

#[cfg(all(feature = "gpu", target_arch = "wasm32"))]
pub use view::GpuView;

#[cfg(all(feature = "gpu", target_arch = "wasm32"))]
mod view {
    use super::*;
    use crate::gpu::Renderer;
    use std::cell::RefCell;
    use std::rc::Rc;
    use wasm_bindgen_futures::future_to_promise;

    /// The GPU renderer drawing into an `OffscreenCanvas` (in the image worker): WebGPU when the
    /// browser has it, else WebGL2.
    #[wasm_bindgen]
    pub struct GpuView {
        renderer: Rc<RefCell<Renderer>>,
        surface: wgpu::Surface<'static>,
        format: wgpu::TextureFormat,
        view_format: wgpu::TextureFormat,
        configured: (u32, u32),
        backend: &'static str,
    }

    #[wasm_bindgen]
    impl GpuView {
        /// `allow_webgpu = false` forces WebGL2 (testing the fallback).
        pub async fn create(canvas: web_sys::OffscreenCanvas, allow_webgpu: bool) -> Result<GpuView, JsError> {
            let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
            desc.backends = if allow_webgpu { wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL } else { wgpu::Backends::GL };
            let instance = wgpu::util::new_instance_with_webgpu_detection(desc).await;
            let surface = instance
                .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
                .map_err(|e| JsError::new(&format!("Canevas inutilisable : {e}")))?;
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: Some(&surface),
                    ..Default::default()
                })
                .await
                .map_err(|e| JsError::new(&format!("Aucun processeur graphique disponible : {e}")))?;
            let backend = match adapter.get_info().backend {
                wgpu::Backend::BrowserWebGpu => "webgpu",
                _ => "webgl2",
            };
            let renderer = Renderer::from_adapter(&adapter).await.map_err(|e| JsError::new(&e))?;
            let caps = surface.get_capabilities(&adapter);
            let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).or(caps.formats.first().copied()).ok_or_else(|| JsError::new("Canevas sans format"))?;
            // The passes write encoded values: draw through a non-sRGB view.
            let view_format = format.remove_srgb_suffix();
            Ok(GpuView { renderer: Rc::new(RefCell::new(renderer)), surface, format, view_format, configured: (0, 0), backend })
        }

        /// `webgpu` or `webgl2`.
        #[wasm_bindgen(getter)]
        pub fn backend(&self) -> String {
            self.backend.into()
        }

        /// Largest source side the device accepts.
        #[wasm_bindgen(getter, js_name = maxSize)]
        pub fn max_size(&self) -> u32 {
            self.renderer.borrow().max_size()
        }

        #[wasm_bindgen(js_name = setSource)]
        pub fn set_source(&self, rgba: Vec<u8>, width: u32, height: u32) -> Result<(), JsError> {
            self.renderer.borrow_mut().set_source(&Image { width, height, data: rgba }).map_err(|e| JsError::new(&e))
        }

        /// Adds another version of the source (proxy) and returns its slot.
        #[wasm_bindgen(js_name = addSource)]
        pub fn add_source(&self, rgba: Vec<u8>, width: u32, height: u32) -> Result<usize, JsError> {
            self.renderer.borrow_mut().add_source(&Image { width, height, data: rgba }).map_err(|e| JsError::new(&e))
        }

        #[wasm_bindgen(js_name = useSource)]
        pub fn use_source(&self, slot: usize) {
            self.renderer.borrow_mut().use_source(slot);
        }

        #[wasm_bindgen(js_name = clearSources)]
        pub fn clear_sources(&self) {
            self.renderer.borrow_mut().clear_sources();
        }

        #[wasm_bindgen(js_name = setRecipe)]
        pub fn set_recipe(&self, recipe_json: &str, scale: f32) -> Result<(), JsError> {
            self.renderer.borrow_mut().set_recipe(&settings(recipe_json)?, &RenderOptions { scale, ..Default::default() });
            Ok(())
        }

        /// Output size `[w, h]` at source resolution.
        #[wasm_bindgen(js_name = outputSize)]
        pub fn output_size(&self) -> Vec<u32> {
            let (w, h) = self.renderer.borrow().output_size();
            vec![w, h]
        }

        /// Draws the output into the canvas, resized to `width × height`.
        pub fn draw(&mut self, width: u32, height: u32) -> Result<(), JsError> {
            let r = self.renderer.clone();
            let mut r = r.borrow_mut();
            if self.configured != (width, height) {
                self.surface.configure(
                    r.device(),
                    &wgpu::SurfaceConfiguration {
                        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                        format: self.format,
                        width,
                        height,
                        present_mode: wgpu::PresentMode::Fifo,
                        desired_maximum_frame_latency: 2,
                        alpha_mode: wgpu::CompositeAlphaMode::Auto,
                        view_formats: if self.view_format != self.format { vec![self.view_format] } else { vec![] },
                        color_space: Default::default(),
                    },
                );
                self.configured = (width, height);
            }
            let frame = match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
                _ => return Ok(()),
            };
            let view = frame.texture.create_view(&wgpu::TextureViewDescriptor { format: Some(self.view_format), ..Default::default() });
            r.render_to(&view, self.view_format, (width, height)).map_err(|e| JsError::new(&e))?;
            r.queue().present(frame);
            Ok(())
        }

        /// Renders the output at `width × height` (0 × 0 = full size) and reads it back.
        pub fn render(&self, width: u32, height: u32) -> Result<js_sys::Promise, JsError> {
            let mut r = self.renderer.borrow_mut();
            let size = if width == 0 || height == 0 { r.output_size() } else { (width, height) };
            let pending = r.start_image(size).map_err(|e| JsError::new(&e))?;
            Ok(future_to_promise(async move {
                let img = pending.finish().await.map_err(|e| JsValue::from(JsError::new(&e)))?;
                Ok(Rendered { width: img.width, height: img.height, pixels: img.data }.into())
            }))
        }

        /// Histograms `[r…, g…, b…, luma…]` (1024 values) of the output.
        pub fn histogram(&self) -> Result<js_sys::Promise, JsError> {
            let mut r = self.renderer.borrow_mut();
            let size = r.histogram_size();
            let pending = r.start_image(size).map_err(|e| JsError::new(&e))?;
            Ok(future_to_promise(async move {
                let img = pending.finish().await.map_err(|e| JsValue::from(JsError::new(&e)))?;
                Ok(js_sys::Uint32Array::from(&flat_histogram(&cpu::histogram(&img))[..]).into())
            }))
        }
    }
}
