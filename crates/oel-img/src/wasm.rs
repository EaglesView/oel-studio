//! Thin wasm-bindgen surface: CPU fallback rendering and recipe resolution for `@oel/img`.

use crate::cpu;
use crate::recipe::Recipe;
use crate::{Image, OutputSpace, RenderOptions};
use wasm_bindgen::prelude::*;

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
    let recipe = Recipe::from_json(recipe_json).map_err(|e| JsError::new(&e))?;
    let opts = RenderOptions { scale, output: if display_p3 { OutputSpace::DisplayP3 } else { OutputSpace::Srgb } };
    let out = cpu::render(&Image { width, height, data: rgba }, &recipe.resolve(), &opts);
    Ok(Rendered { width: out.width, height: out.height, pixels: out.data })
}

/// Layers recipes, most specific first (`[imageOverrides, galleryStyle]`), into one recipe.
#[wasm_bindgen]
pub fn stack_recipes(layers_json: &str) -> Result<String, JsError> {
    let layers: Vec<Recipe> = serde_json::from_str(layers_json).map_err(|e| JsError::new(&format!("Recettes illisibles : {e}")))?;
    Ok(Recipe::stack(&layers).to_json())
}
