//! Colour spaces and white balance shared by the CPU reference and the GPU uniforms.
//!
//! Working space: linear Rec.2020 primaries, D65 white. "Encoded" values (perceptual controls,
//! curves, HSL) use a pure 2.2 power, sign-preserving, so the GPU computes them identically.

pub type Vec3 = [f32; 3];
pub type Mat3 = [[f32; 3]; 3];

/// Rec.2020 luminance weights.
pub const LUMA: Vec3 = [0.2627, 0.6780, 0.0593];

pub fn luma(c: Vec3) -> f32 {
    c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
}

pub fn encode(x: f32) -> f32 {
    x.signum() * x.abs().powf(1.0 / 2.2)
}

pub fn decode(x: f32) -> f32 {
    x.signum() * x.abs().powf(2.2)
}

pub fn srgb_eotf(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

pub fn srgb_oetf(l: f32) -> f32 {
    if l <= 0.0031308 { l * 12.92 } else { 1.055 * l.powf(1.0 / 2.4) - 0.055 }
}

pub fn mul(m: &Mat3, c: Vec3) -> Vec3 {
    [
        m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
        m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
        m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2],
    ]
}

type M64 = [[f64; 3]; 3];

fn mm(a: &M64, b: &M64) -> M64 {
    let mut r = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            r[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    r
}

fn mv(m: &M64, v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
}

fn inv(m: &M64) -> M64 {
    let [[a, b, c], [d, e, f], [g, h, i]] = *m;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ]
}

fn to_f32(m: &M64) -> Mat3 {
    m.map(|r| r.map(|v| v as f32))
}

fn xy_to_xyz(x: f64, y: f64) -> [f64; 3] {
    [x / y, 1.0, (1.0 - x - y) / y]
}

const D65: (f64, f64) = (0.3127, 0.3290);

/// RGB → XYZ for primaries `[r, g, b]` (xy) and white `w`.
fn rgb_to_xyz(p: [(f64, f64); 3], w: (f64, f64)) -> M64 {
    let cols = p.map(|(x, y)| xy_to_xyz(x, y));
    let m = [0, 1, 2].map(|i| [cols[0][i], cols[1][i], cols[2][i]]);
    let s = mv(&inv(&m), xy_to_xyz(w.0, w.1));
    [0, 1, 2].map(|i| [m[i][0] * s[0], m[i][1] * s[1], m[i][2] * s[2]])
}

const SRGB: [(f64, f64); 3] = [(0.640, 0.330), (0.300, 0.600), (0.150, 0.060)];
const REC2020: [(f64, f64); 3] = [(0.708, 0.292), (0.170, 0.797), (0.131, 0.046)];
const P3: [(f64, f64); 3] = [(0.680, 0.320), (0.265, 0.690), (0.150, 0.060)];

/// Output encodings the renderer can target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutputSpace {
    #[default]
    Srgb,
    DisplayP3,
}

/// Linear sRGB → linear working space.
pub fn srgb_to_working() -> Mat3 {
    to_f32(&mm(&inv(&rgb_to_xyz(REC2020, D65)), &rgb_to_xyz(SRGB, D65)))
}

/// Linear working space → linear output primaries (both use the sRGB transfer curve).
pub fn working_to_output(space: OutputSpace) -> Mat3 {
    let p = match space {
        OutputSpace::Srgb => SRGB,
        OutputSpace::DisplayP3 => P3,
    };
    to_f32(&mm(&inv(&rgb_to_xyz(p, D65)), &rgb_to_xyz(REC2020, D65)))
}

/// CIE 1960 uv of the Planckian locus (Kim et al. 2002 xy fit; the 1/T polynomial extrapolates
/// smoothly above its 25 000 K validity bound).
fn planck_uv(t: f64) -> (f64, f64) {
    let t = t.clamp(1667.0, 50_000.0);
    let x = if t <= 4000.0 {
        -0.2661239e9 / t.powi(3) - 0.2343589e6 / t.powi(2) + 0.8776956e3 / t + 0.179910
    } else {
        -3.0258469e9 / t.powi(3) + 2.1070379e6 / t.powi(2) + 0.2226347e3 / t + 0.240390
    };
    let y = if t <= 2222.0 {
        -1.1063814 * x.powi(3) - 1.34811020 * x.powi(2) + 2.18555832 * x - 0.20219683
    } else if t <= 4000.0 {
        -0.9549476 * x.powi(3) - 1.37418593 * x.powi(2) + 2.09137015 * x - 0.16748867
    } else {
        3.0817580 * x.powi(3) - 5.87338670 * x.powi(2) + 3.75112997 * x - 0.37001483
    };
    let d = -2.0 * x + 12.0 * y + 3.0;
    (4.0 * x / d, 6.0 * y / d)
}

/// xy of the light described by the white-balance sliders: Planckian `temp_k`, moved off the
/// locus by `tint` (Duv = tint / 3000, positive = greener light, so the correction adds magenta).
pub fn white_xy(temp_k: f32, tint: f32) -> (f64, f64) {
    let t = temp_k as f64;
    let (u, v) = planck_uv(t);
    let (u2, v2) = planck_uv(t * 1.01);
    let (du, dv) = (u2 - u, v2 - v);
    let n = (du * du + dv * dv).sqrt();
    // Normal pointing towards green (+v side of the locus).
    let (nu, nv) = (-dv / n, du / n);
    let (nu, nv) = if nv < 0.0 { (-nu, -nv) } else { (nu, nv) };
    let duv = tint as f64 / 3000.0;
    let (u, v) = (u + nu * duv, v + nv * duv);
    let d = 2.0 * u - 8.0 * v + 4.0;
    (3.0 * u / d, 2.0 * v / d)
}

const BRADFORD: M64 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

/// Working-space matrix that corrects light `(temp_k, tint)` to neutral. Identity at 6500 K / 0.
pub fn white_balance(temp_k: f32, tint: f32) -> Mat3 {
    let src = white_xy(temp_k, tint);
    let dst = white_xy(6500.0, 0.0);
    let ls = mv(&BRADFORD, xy_to_xyz(src.0, src.1));
    let ld = mv(&BRADFORD, xy_to_xyz(dst.0, dst.1));
    let d = [[ld[0] / ls[0], 0.0, 0.0], [0.0, ld[1] / ls[1], 0.0], [0.0, 0.0, ld[2] / ls[2]]];
    let cat = mm(&inv(&BRADFORD), &mm(&d, &BRADFORD));
    let to_xyz = rgb_to_xyz(REC2020, D65);
    to_f32(&mm(&inv(&to_xyz), &mm(&cat, &to_xyz)))
}

/// HSV of non-negative RGB (any range): hue in degrees, saturation 0…1, value = max.
pub fn rgb_to_hsv(c: Vec3) -> Vec3 {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let d = max - min;
    if d <= 0.0 || max <= 0.0 {
        return [0.0, 0.0, max];
    }
    let h = if max == c[0] {
        (c[1] - c[2]) / d
    } else if max == c[1] {
        (c[2] - c[0]) / d + 2.0
    } else {
        (c[0] - c[1]) / d + 4.0
    };
    [(h * 60.0).rem_euclid(360.0), d / max, max]
}

pub fn hsv_to_rgb(hsv: Vec3) -> Vec3 {
    let [h, s, v] = hsv;
    let f = |n: f32| {
        let k = (n + h.rem_euclid(360.0) / 60.0).rem_euclid(6.0);
        v - v * s * k.min(4.0 - k).clamp(0.0, 1.0)
    };
    [f(5.0), f(3.0), f(1.0)]
}

pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &Mat3, b: &Mat3, eps: f32) -> bool {
        a.iter().flatten().zip(b.iter().flatten()).all(|(x, y)| (x - y).abs() < eps)
    }

    #[test]
    fn srgb_to_rec2020_matches_bt2087() {
        let m = srgb_to_working();
        let r = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]];
        assert!(close(&m, &r, 2e-4), "{m:?}");
    }

    #[test]
    fn neutral_white_balance_is_identity() {
        let id = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        assert!(close(&white_balance(6500.0, 0.0), &id, 1e-6));
    }

    #[test]
    fn warmer_temperature_raises_red_over_blue() {
        let grey = [0.2, 0.2, 0.2];
        let w = mul(&white_balance(9000.0, 0.0), grey);
        assert!(w[0] > w[2], "{w:?}");
        let m = mul(&white_balance(6500.0, 50.0), grey);
        assert!((m[0] + m[2]) / 2.0 > m[1], "{m:?}");
    }

    #[test]
    fn hsv_round_trip() {
        for c in [[0.9, 0.2, 0.1], [0.1, 0.5, 0.7], [0.3, 0.3, 0.3], [1.5, 0.4, 0.9]] {
            let r = hsv_to_rgb(rgb_to_hsv(c));
            assert!(c.iter().zip(r).all(|(a, b)| (a - b).abs() < 1e-5), "{c:?} → {r:?}");
        }
    }
}
