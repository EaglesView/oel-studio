//! The passes, in order. Every constant here is part of the rendering spec: the WGSL shaders
//! (L-2) copy them, and `tests/gpu_parity.rs` holds both to the same output.
//!
//! Sizes: blur radii tied to the picture (tone base, clarity, dehaze) are fractions of the
//! source's long edge, so a preview proxy and the full export look alike; radii given in pixels
//! (sharpening, noise, grain) are full-resolution pixels multiplied by `RenderOptions::scale`.

use super::blur::{gaussian, Plane};
use crate::color::{
    decode, encode, hsv_to_rgb, luma, mix, mul, rgb_to_hsv, smoothstep, srgb_eotf, srgb_oetf, srgb_to_working,
    white_balance, working_to_output, Mat3, Vec3,
};
use crate::curve::{sample, tone_luts};
use crate::recipe::Settings;
use crate::{Image, RenderOptions};
use std::f32::consts::PI;

/// Rendered image in the working space before the output transform, plus its alpha.
pub struct Working {
    pub w: usize,
    pub h: usize,
    pub rgb: Vec<Vec3>,
    pub alpha: Vec<f32>,
}

/// Renders `src` (upright sRGB, straight alpha) with `s` and returns the cropped output.
pub fn render(src: &Image, s: &Settings, o: &RenderOptions) -> Image {
    let wk = render_working(src, s, o);
    finish(&wk, s, o)
}

/// All source-space passes (everything except geometry, vignette, grain and output).
pub fn render_working(src: &Image, s: &Settings, o: &RenderOptions) -> Working {
    let (w, h) = (src.width as usize, src.height as usize);
    let long = w.max(h) as f32;
    let input = input_matrix(s);
    let mut rgb = Vec::with_capacity(w * h);
    let mut alpha = Vec::with_capacity(w * h);
    for p in src.data.chunks_exact(4) {
        let lin = [0, 1, 2].map(|i| srgb_eotf(p[i] as f32 / 255.0));
        rgb.push(mul(&input, lin));
        alpha.push(p[3] as f32 / 255.0);
    }
    let mut wk = Working { w, h, rgb, alpha };
    tone(&mut wk, s, long);
    curves(&mut wk, s);
    hsl_mixer(&mut wk, s);
    grading(&mut wk, s);
    texture_clarity(&mut wk, s, long);
    dehaze(&mut wk, s, long);
    vibrance_saturation(&mut wk, s);
    noise_reduction(&mut wk, s, o.scale);
    sharpen(&mut wk, s, o.scale);
    wk
}

/// sRGB linear → working, white balance, exposure: one matrix.
pub fn input_matrix(s: &Settings) -> Mat3 {
    let wb = white_balance(s.white_balance.temp_k, s.white_balance.tint);
    let to_w = srgb_to_working();
    let k = s.exposure.exp2();
    let mut m = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = k * (0..3).map(|n| wb[i][n] * to_w[n][j]).sum::<f32>();
        }
    }
    m
}

fn luma_plane(wk: &Working, f: impl Fn(f32) -> f32) -> Plane {
    Plane::new(wk.w, wk.h, wk.rgb.iter().map(|c| f(luma(*c).max(0.0))).collect())
}

/// Scales a pixel so its luminance becomes `y2` (hue and saturation kept); a black pixel
/// becomes neutral grey.
fn set_luma(c: &mut Vec3, y2: f32) {
    let y = luma(*c);
    if y > 1e-6 {
        let k = y2 / y;
        *c = c.map(|v| v * k);
    } else {
        *c = [y2; 3];
    }
}

// ── Tone ────────────────────────────────────────────────────────────────────────────────────

pub const TONE_BASE_SIGMA: f32 = 0.03; // × long edge
pub const SHADOWS_HIGHLIGHTS_EV: f32 = 1.5;
pub const CONTRAST_K: f32 = 0.15;
pub const WHITES_BLACKS_K: f32 = 0.2;

/// Highlights / shadows: exposure gain from a blurred-luminance base (local, halo-free at this
/// scale); then contrast, whites, blacks as monotone curves on encoded luminance.
fn tone(wk: &mut Working, s: &Settings, long: f32) {
    let (sh, hl) = (s.shadows / 100.0, s.highlights / 100.0);
    if sh != 0.0 || hl != 0.0 {
        let base = gaussian(&luma_plane(wk, |y| y), TONE_BASE_SIGMA * long);
        for (c, b) in wk.rgb.iter_mut().zip(&base.data) {
            let lb = encode(b.max(0.0)).min(1.0);
            let ws = 1.0 - smoothstep(0.0, 0.6, lb);
            let wh = smoothstep(0.4, 1.0, lb);
            let g = (SHADOWS_HIGHLIGHTS_EV * (sh * ws + hl * wh)).exp2();
            *c = c.map(|v| v * g);
        }
    }
    let (ct, wv, bv) = (s.contrast / 100.0, s.whites / 100.0, s.blacks / 100.0);
    if ct != 0.0 || wv != 0.0 || bv != 0.0 {
        for c in wk.rgb.iter_mut() {
            let l = encode(luma(*c).max(0.0));
            set_luma(c, decode(tone_curve(l, ct, wv, bv).max(0.0)));
        }
    }
}

/// Contrast, then whites, then blacks on encoded luminance; each step is monotone, values
/// above 1 keep their excess.
pub fn tone_curve(l: f32, ct: f32, wv: f32, bv: f32) -> f32 {
    let lc = l.min(1.0);
    let mut t = lc + CONTRAST_K * ct * (2.0 * PI * (lc - 0.5)).sin();
    t += WHITES_BLACKS_K * wv * t.clamp(0.0, 1.0).powi(4);
    t += WHITES_BLACKS_K * bv * (1.0 - t.clamp(0.0, 1.0)).powi(4);
    t + (l - lc)
}

fn curves(wk: &mut Working, s: &Settings) {
    let c = &s.tone_curve;
    let Some(luts) = tone_luts(&c.rgb, &c.r, &c.g, &c.b) else { return };
    for p in wk.rgb.iter_mut() {
        for i in 0..3 {
            p[i] = decode(sample(&luts[i], encode(p[i].max(0.0))));
        }
    }
}

// ── Colour ──────────────────────────────────────────────────────────────────────────────────

/// Hue band centres (degrees): red, orange, yellow, green, aqua, blue, purple, magenta.
pub const BAND_CENTERS: [f32; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0];
pub const HSL_HUE_SHIFT: f32 = 30.0; // degrees at ±100
pub const HSL_LUM_EV: f32 = 1.0;

/// Weights of the eight bands at hue `h` (linear between neighbouring centres; sums to 1).
pub fn band_weights(h: f32) -> [f32; 8] {
    let mut w = [0.0; 8];
    let h = h.rem_euclid(360.0);
    for i in 0..8 {
        let a = BAND_CENTERS[i];
        let b = if i == 7 { 360.0 } else { BAND_CENTERS[i + 1] };
        if h >= a && h < b {
            let t = (h - a) / (b - a);
            w[i] = 1.0 - t;
            w[(i + 1) % 8] = t;
        }
    }
    w
}

fn hsl_mixer(wk: &mut Working, s: &Settings) {
    let x = &s.hsl;
    let bands = [&x.red, &x.orange, &x.yellow, &x.green, &x.aqua, &x.blue, &x.purple, &x.magenta];
    if bands.iter().all(|b| b.hue == 0.0 && b.sat == 0.0 && b.lum == 0.0) {
        return;
    }
    for c in wk.rgb.iter_mut() {
        let e = c.map(|v| encode(v.max(0.0)));
        let [h, sat, v] = rgb_to_hsv(e);
        if sat <= 0.0 {
            continue;
        }
        let wts = band_weights(h);
        let (mut dh, mut ds, mut dl) = (0.0, 0.0, 0.0);
        for (wt, b) in wts.iter().zip(bands) {
            dh += wt * b.hue / 100.0;
            ds += wt * b.sat / 100.0;
            dl += wt * b.lum / 100.0;
        }
        let e2 = hsv_to_rgb([h + dh * HSL_HUE_SHIFT, (sat * (1.0 + ds)).clamp(0.0, 1.0), v]);
        let k = (dl * sat * HSL_LUM_EV).exp2();
        *c = e2.map(|v| decode(v) * k);
    }
}

pub const GRADING_SAT_K: f32 = 0.25;
pub const GRADING_LUM_K: f32 = 0.25;

/// Region weights (shadows, midtones, highlights) at encoded luminance `l`.
pub fn grading_weights(l: f32, blending: f32, balance: f32) -> [f32; 3] {
    let (lo, hi) = (0.25 - 0.15 * balance, 0.75 - 0.15 * balance);
    let width = 0.05 + 0.45 * blending;
    let ws = 1.0 - smoothstep(lo - width, lo + width, l);
    let wh = smoothstep(hi - width, hi + width, l);
    [ws, (1.0 - ws - wh).max(0.0), wh]
}

/// Encoded offset of a wheel: chroma of its hue (luma removed) × sat, plus lum.
pub fn wheel_offset(hue: f32, sat: f32, lum: f32) -> Vec3 {
    let c = hsv_to_rgb([hue, 1.0, 1.0]);
    let y = luma(c);
    c.map(|v| (v - y) * sat / 100.0 * GRADING_SAT_K + lum / 100.0 * GRADING_LUM_K)
}

fn grading(wk: &mut Working, s: &Settings) {
    let g = &s.grading;
    let wheels = [&g.shadows, &g.midtones, &g.highlights];
    if wheels.iter().all(|w| w.sat == 0.0 && w.lum == 0.0) {
        return;
    }
    let offs = wheels.map(|w| wheel_offset(w.hue, w.sat, w.lum));
    for c in wk.rgb.iter_mut() {
        let l = encode(luma(*c).max(0.0)).min(1.0);
        let wts = grading_weights(l, g.blending / 100.0, g.balance / 100.0);
        let mut e = c.map(encode);
        for (wt, o) in wts.iter().zip(&offs) {
            for i in 0..3 {
                e[i] += wt * o[i];
            }
        }
        *c = e.map(decode);
    }
}

// ── Presence ────────────────────────────────────────────────────────────────────────────────

pub const TEXTURE_SIGMA: f32 = 0.003; // × long edge
pub const CLARITY_SIGMA: f32 = 0.015;
pub const TEXTURE_K: f32 = 1.0;
pub const CLARITY_K: f32 = 0.8;

fn texture_clarity(wk: &mut Working, s: &Settings, long: f32) {
    let (tx, cl) = (s.presence.texture / 100.0, s.presence.clarity / 100.0);
    if tx == 0.0 && cl == 0.0 {
        return;
    }
    let le = luma_plane(wk, encode);
    let bt = if tx != 0.0 { gaussian(&le, TEXTURE_SIGMA * long) } else { le.clone() };
    let bc = if cl != 0.0 { gaussian(&le, CLARITY_SIGMA * long) } else { le.clone() };
    for (i, c) in wk.rgb.iter_mut().enumerate() {
        let l = le.data[i];
        let m = (1.0 - (2.0 * l.min(1.0) - 1.0).powi(2)).max(0.0);
        let l2 = l + TEXTURE_K * tx * (l - bt.data[i]) + CLARITY_K * cl * m * (l - bc.data[i]);
        set_luma(c, decode(l2.max(0.0)));
    }
}

pub const DEHAZE_SIGMA: f32 = 0.02; // × long edge

/// Dark-channel dehaze against white airlight in encoded space; negative values add haze.
fn dehaze(wk: &mut Working, s: &Settings, long: f32) {
    let d = s.presence.dehaze / 100.0;
    if d == 0.0 {
        return;
    }
    if d > 0.0 {
        let dark = Plane::new(
            wk.w,
            wk.h,
            wk.rgb.iter().map(|c| encode(c[0].min(c[1]).min(c[2]).max(0.0)).min(1.0)).collect(),
        );
        let base = gaussian(&dark, DEHAZE_SIGMA * long);
        for (c, b) in wk.rgb.iter_mut().zip(&base.data) {
            let t = (1.0 - 0.95 * d * b).max(0.1);
            *c = c.map(|v| decode(((encode(v) - 1.0) / t + 1.0).max(0.0)));
        }
    } else {
        for c in wk.rgb.iter_mut() {
            *c = c.map(|v| decode(mix(encode(v), 0.85, -d * 0.5)));
        }
    }
}

/// Saturation scales chroma uniformly; vibrance favours dull colours and spares skin hues.
fn vibrance_saturation(wk: &mut Working, s: &Settings) {
    let (vib, sat) = (s.presence.vibrance / 100.0, s.presence.saturation / 100.0);
    if vib == 0.0 && sat == 0.0 {
        return;
    }
    for c in wk.rgb.iter_mut() {
        let e = c.map(|v| encode(v.max(0.0)));
        let l = luma(e);
        let [h, s_now, _] = rgb_to_hsv(e);
        let skin = (1.0 - (h - 25.0).abs() / 25.0).max(0.0);
        let f = ((1.0 + sat) * (1.0 + vib * (1.0 - s_now) * (1.0 - 0.5 * skin))).max(0.0);
        *c = e.map(|v| decode(l + (v - l) * f));
    }
}

// ── Detail ──────────────────────────────────────────────────────────────────────────────────

/// Edge-aware luminance smoothing, then chroma blur.
fn noise_reduction(wk: &mut Working, s: &Settings, scale: f32) {
    let (nl, nc) = (s.detail.noise.luma / 100.0, s.detail.noise.color / 100.0);
    if nl > 0.0 {
        let le = luma_plane(wk, encode);
        let base = gaussian(&le, (0.5 + 1.5 * nl) * scale);
        let r = 0.02 + 0.08 * nl;
        let amt = (2.0 * nl).min(1.0);
        for (i, c) in wk.rgb.iter_mut().enumerate() {
            let (l, b) = (le.data[i], base.data[i]);
            let k = (-(l - b).powi(2) / (2.0 * r * r)).exp();
            set_luma(c, decode((l + (b - l) * k * amt).max(0.0)));
        }
    }
    if nc > 0.0 {
        let e: Vec<Vec3> = wk.rgb.iter().map(|c| c.map(encode)).collect();
        let l: Vec<f32> = e.iter().map(|c| luma(*c)).collect();
        let sigma = (1.0 + 3.0 * nc) * scale;
        let chroma: [Plane; 3] = [0, 1, 2].map(|ch| {
            let p = Plane::new(wk.w, wk.h, e.iter().zip(&l).map(|(c, y)| c[ch] - y).collect());
            gaussian(&p, sigma)
        });
        for (i, c) in wk.rgb.iter_mut().enumerate() {
            *c = [0, 1, 2].map(|ch| decode(l[i] + mix(e[i][ch] - l[i], chroma[ch].data[i], nc)));
        }
    }
}

pub const SHARPEN_K: f32 = 1.5;

/// Unsharp mask on encoded luminance; `detail` widens the halo limit, `masking` restricts the
/// effect to edges of the blurred image.
fn sharpen(wk: &mut Working, s: &Settings, scale: f32) {
    let sp = &s.detail.sharpen;
    if sp.amount <= 0.0 {
        return;
    }
    let le = luma_plane(wk, encode);
    let base = gaussian(&le, sp.radius * scale);
    let lim = 0.02 + 0.3 * sp.detail / 100.0;
    let t = sp.masking / 100.0 * 0.1;
    let (w, h) = (wk.w, wk.h);
    for (i, c) in wk.rgb.iter_mut().enumerate() {
        let m = if t > 0.0 {
            let (x, y) = (i % w, i / w);
            let at = |x: usize, y: usize| base.data[y * w + x];
            let gx = at((x + 1).min(w - 1), y) - at(x.saturating_sub(1), y);
            let gy = at(x, (y + 1).min(h - 1)) - at(x, y.saturating_sub(1));
            smoothstep(0.5 * t, t, 0.5 * (gx * gx + gy * gy).sqrt())
        } else {
            1.0
        };
        let l = le.data[i];
        let hf = (l - base.data[i]).clamp(-lim, lim);
        set_luma(c, decode((l + sp.amount / 100.0 * SHARPEN_K * hf * m).max(0.0)));
    }
}

// ── Final pass: geometry, vignette, grain, output ──────────────────────────────────────────

/// Output size for a `w × h` source.
pub fn output_size(s: &Settings, w: u32, h: u32) -> (u32, u32) {
    let [x0, y0, x1, y1] = s.geometry.crop;
    (
        (((x1 - x0).abs() * w as f32).round() as u32).max(1),
        (((y1 - y0).abs() * h as f32).round() as u32).max(1),
    )
}

pub const GRAIN_K: f32 = 0.12;

/// Monochrome grain at original-resolution position `p` (pixels): value noise, two octaves.
pub fn grain_noise(p: [f32; 2], size: f32, roughness: f32) -> f32 {
    let cell = 1.0 + size / 100.0 * 3.0;
    let q = [p[0] / cell, p[1] / cell];
    let n1 = value_noise(q, 0);
    let n2 = value_noise([q[0] * 2.0, q[1] * 2.0], 1);
    mix(n1, n2, roughness / 100.0)
}

fn pcg(v: u32) -> u32 {
    let state = v.wrapping_mul(747796405).wrapping_add(2891336453);
    let word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277803737);
    (word >> 22) ^ word
}

fn lattice(x: i32, y: i32, seed: u32) -> f32 {
    let h = pcg((x as u32) ^ pcg((y as u32).wrapping_add(seed.wrapping_mul(0x9e37_79b9))));
    h as f32 / u32::MAX as f32 - 0.5
}

fn value_noise(p: [f32; 2], seed: u32) -> f32 {
    let (fx, fy) = (p[0].floor(), p[1].floor());
    let (tx, ty) = (p[0] - fx, p[1] - fy);
    let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
    let (x, y) = (fx as i32, fy as i32);
    let a = mix(lattice(x, y, seed), lattice(x + 1, y, seed), sx);
    let b = mix(lattice(x, y + 1, seed), lattice(x + 1, y + 1, seed), sx);
    mix(a, b, sy)
}

/// Vignette factor inputs: distance from the centre of the output, blended from the frame's
/// ellipse (roundness −100) to a circle (+100).
pub fn vignette_distance(u: f32, v: f32, aspect: f32, roundness: f32) -> f32 {
    let (px, py) = (u * 2.0 - 1.0, v * 2.0 - 1.0);
    let ellipse = (px * px + py * py).sqrt();
    let cx = px * aspect;
    let circle = (cx * cx + py * py).sqrt() / aspect.max(1.0);
    mix(ellipse, circle, (roundness / 100.0 + 1.0) / 2.0)
}

fn finish(wk: &Working, s: &Settings, o: &RenderOptions) -> Image {
    let (w, h) = (wk.w as f32, wk.h as f32);
    let (ow, oh) = output_size(s, wk.w as u32, wk.h as u32);
    let g = &s.geometry;
    let [x0, y0, ..] = g.crop;
    let (sin, cos) = (g.angle.to_radians()).sin_cos();
    let out_m = working_to_output(o.output);
    let v = &s.effects.vignette;
    let gr = &s.effects.grain;
    let v_start = 0.2 + 0.8 * v.midpoint / 100.0;
    let v_width = 0.05 + 0.95 * v.feather / 100.0;
    let mut data = Vec::with_capacity((ow * oh * 4) as usize);
    for oy in 0..oh {
        for ox in 0..ow {
            // Display frame (flipped, then rotated about the centre) → source pixel.
            let (px, py) = (x0 * w + ox as f32 + 0.5, y0 * h + oy as f32 + 0.5);
            let (dx, dy) = (px - w / 2.0, py - h / 2.0);
            let (mut sx, mut sy) = (w / 2.0 + cos * dx - sin * dy, h / 2.0 + sin * dx + cos * dy);
            if g.flip_h {
                sx = w - sx;
            }
            if g.flip_v {
                sy = h - sy;
            }
            let Some((mut c, a)) = sample_bilinear(wk, sx - 0.5, sy - 0.5) else {
                data.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            };
            if v.amount != 0.0 {
                let d = vignette_distance((ox as f32 + 0.5) / ow as f32, (oy as f32 + 0.5) / oh as f32, ow as f32 / oh as f32, v.roundness);
                let f = smoothstep(v_start, v_start + v_width, d) * v.amount / 100.0;
                c = if f < 0.0 { c.map(|x| x * (1.0 + f)) } else { c.map(|x| mix(x, 1.0, f)) };
            }
            if gr.amount > 0.0 {
                let n = grain_noise([px / o.scale, py / o.scale], gr.size, gr.roughness) * gr.amount / 100.0 * GRAIN_K;
                c = c.map(|x| decode(encode(x) + n));
            }
            let out = mul(&out_m, c);
            for x in out {
                data.push((srgb_oetf(x.clamp(0.0, 1.0)) * 255.0).round() as u8);
            }
            data.push((a * 255.0).round() as u8);
        }
    }
    Image { width: ow, height: oh, data }
}

/// Bilinear read at continuous pixel coordinates (centres on integers); `None` outside the image.
fn sample_bilinear(wk: &Working, x: f32, y: f32) -> Option<(Vec3, f32)> {
    let (w, h) = (wk.w as f32, wk.h as f32);
    if x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5 {
        return None;
    }
    let (x, y) = (x.clamp(0.0, w - 1.0), y.clamp(0.0, h - 1.0));
    let (x0, y0) = (x.floor() as usize, y.floor() as usize);
    let (x1, y1) = ((x0 + 1).min(wk.w - 1), (y0 + 1).min(wk.h - 1));
    let (tx, ty) = (x - x0 as f32, y - y0 as f32);
    let idx = |x: usize, y: usize| y * wk.w + x;
    let wts = [(idx(x0, y0), (1.0 - tx) * (1.0 - ty)), (idx(x1, y0), tx * (1.0 - ty)), (idx(x0, y1), (1.0 - tx) * ty), (idx(x1, y1), tx * ty)];
    let mut c = [0.0; 3];
    let mut a = 0.0;
    for (i, wt) in wts {
        if wt == 0.0 {
            continue;
        }
        for ch in 0..3 {
            c[ch] += wk.rgb[i][ch] * wt;
        }
        a += wk.alpha[i] * wt;
    }
    Some((c, a))
}
