//! Native decoding: JPEG, PNG, WebP → upright sRGB [`Image`] (EXIF orientation applied,
//! embedded ICC profiles converted to sRGB).

use crate::Image;
use image::{DynamicImage, ImageDecoder, ImageReader};
use moxcms::{ColorProfile, Layout, TransformOptions};
use std::io::Cursor;

pub fn decode(bytes: &[u8]) -> Result<Image, String> {
    let err = |e: &dyn std::fmt::Display| format!("Image illisible : {e}");
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| err(&e))?
        .into_decoder()
        .map_err(|e| err(&e))?;
    let orientation = decoder.orientation().map_err(|e| err(&e))?;
    let icc = decoder.icc_profile().ok().flatten();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| err(&e))?;
    img.apply_orientation(orientation);
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut data = rgba.into_raw();
    if let Some(icc) = icc {
        to_srgb(&icc, &mut data);
    }
    Ok(Image { width, height, data })
}

/// Converts RGBA pixels from `icc` to sRGB in place; an unreadable or non-RGB profile is
/// ignored (pixels are taken as sRGB, as browsers do).
fn to_srgb(icc: &[u8], data: &mut [u8]) {
    let Ok(src) = ColorProfile::new_from_slice(icc) else { return };
    let dst = ColorProfile::new_srgb();
    let Ok(t) = src.create_transform_8bit(Layout::Rgba, &dst, Layout::Rgba, TransformOptions::default()) else { return };
    let input = data.to_vec();
    let _ = t.transform(&input, data);
}
