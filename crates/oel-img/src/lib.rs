//! oel-img: non-destructive image editing for OutilsEnLigne.
//!
//! An image is its original bytes (content-hashed, never changed) plus a [`Recipe`]
//! (`oel-img-recipe@1`). [`cpu`] is the reference renderer; the wgpu pipeline (plan L-2) renders
//! the same passes on the GPU. Decoding (`decode` feature) is for native and server use; the
//! browser decodes with `createImageBitmap` and passes RGBA.

pub mod color;
pub mod cpu;
pub mod curve;
#[cfg(feature = "decode")]
pub mod decode;
pub mod recipe;
#[cfg(feature = "wasm")]
pub mod wasm;

pub use color::OutputSpace;
pub use recipe::{fields, FieldKind, FieldSpec, Layer, Recipe, Settings, RECIPE_FORMAT};

/// 8-bit RGBA, sRGB-encoded, straight alpha, upright (EXIF orientation applied).
#[derive(Debug, Clone, PartialEq)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderOptions {
    /// Source pixels per original pixel (1 for the original, 0.25 for a quarter-size proxy).
    /// Scales the pixel-sized controls (sharpening radius, noise reduction, grain).
    pub scale: f32,
    pub output: OutputSpace,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self { scale: 1.0, output: OutputSpace::Srgb }
    }
}
