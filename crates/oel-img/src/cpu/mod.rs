//! CPU reference renderer: f32, linear working space, one function per pass. It is the
//! specification the GPU pipeline must match (±2/255), the no-GPU fallback and the server path.

pub mod blur;
mod pipeline;

pub use pipeline::{grain_noise, render, render_working};

use crate::color::{luma, srgb_eotf, srgb_oetf};
use crate::Image;

/// 256-bin histograms of a rendered (display-encoded) image; transparent pixels are skipped.
#[derive(Debug, Clone, PartialEq)]
pub struct Histogram {
    pub r: [u32; 256],
    pub g: [u32; 256],
    pub b: [u32; 256],
    pub luma: [u32; 256],
}

pub fn histogram(img: &Image) -> Histogram {
    let mut h = Histogram { r: [0; 256], g: [0; 256], b: [0; 256], luma: [0; 256] };
    for p in img.data.chunks_exact(4) {
        if p[3] == 0 {
            continue;
        }
        h.r[p[0] as usize] += 1;
        h.g[p[1] as usize] += 1;
        h.b[p[2] as usize] += 1;
        let l = 0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32;
        h.luma[(l.round() as usize).min(255)] += 1;
    }
    h
}

/// Area-average downscale in linear light with premultiplied alpha (previews, smaller exports).
pub fn resize_area(src: &Image, w: u32, h: u32) -> Image {
    let (sw, sh) = (src.width as usize, src.height as usize);
    let (w, h) = (w.max(1) as usize, h.max(1) as usize);
    if (w, h) == (sw, sh) {
        return src.clone();
    }
    let lin: Vec<[f32; 4]> = src
        .data
        .chunks_exact(4)
        .map(|p| {
            let a = p[3] as f32 / 255.0;
            let c = |i: usize| srgb_eotf(p[i] as f32 / 255.0) * a;
            [c(0), c(1), c(2), a]
        })
        .collect();
    let (fx, fy) = (sw as f32 / w as f32, sh as f32 / h as f32);
    let mut out = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        let (y0, y1) = (y as f32 * fy, (y + 1) as f32 * fy);
        for x in 0..w {
            let (x0, x1) = (x as f32 * fx, (x + 1) as f32 * fx);
            let mut acc = [0.0f32; 4];
            let mut area = 0.0;
            for sy in y0.floor() as usize..(y1.ceil() as usize).min(sh) {
                let cy = (y1.min(sy as f32 + 1.0) - y0.max(sy as f32)).max(0.0);
                for sx in x0.floor() as usize..(x1.ceil() as usize).min(sw) {
                    let c = cy * (x1.min(sx as f32 + 1.0) - x0.max(sx as f32)).max(0.0);
                    let p = lin[sy * sw + sx];
                    for i in 0..4 {
                        acc[i] += p[i] * c;
                    }
                    area += c;
                }
            }
            let a = acc[3] / area;
            for i in 0..3 {
                let v = if a > 0.0 { acc[i] / area / a } else { 0.0 };
                out.push((srgb_oetf(v.clamp(0.0, 1.0)) * 255.0).round() as u8);
            }
            out.push((a * 255.0).round() as u8);
        }
    }
    Image { width: w as u32, height: h as u32, data: out }
}

/// Mean Rec.2020 luminance of a rendered image's opaque pixels (tests and Auto).
pub fn mean_luma(img: &Image) -> f32 {
    let mut s = 0.0;
    let mut n = 0.0;
    for p in img.data.chunks_exact(4).filter(|p| p[3] > 0) {
        s += luma([0, 1, 2].map(|i| srgb_eotf(p[i] as f32 / 255.0)));
        n += 1.0;
    }
    if n > 0.0 { s / n } else { 0.0 }
}
