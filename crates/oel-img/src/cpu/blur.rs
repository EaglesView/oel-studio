//! The blur every pass uses, defined so the GPU can repeat it exactly: halve the plane (2×2
//! mean) while σ > 6, run a separable Gaussian (radius ⌈3σ⌉, clamp-to-edge), then upsample
//! bilinearly level by level. σ < 0.3 is a copy.

#[derive(Debug, Clone, PartialEq)]
pub struct Plane {
    pub w: usize,
    pub h: usize,
    pub data: Vec<f32>,
}

impl Plane {
    pub fn new(w: usize, h: usize, data: Vec<f32>) -> Self {
        debug_assert_eq!(data.len(), w * h);
        Self { w, h, data }
    }

    fn at(&self, x: isize, y: isize) -> f32 {
        let x = x.clamp(0, self.w as isize - 1) as usize;
        let y = y.clamp(0, self.h as isize - 1) as usize;
        self.data[y * self.w + x]
    }
}

pub const MAX_DIRECT_SIGMA: f32 = 6.0;

pub fn gaussian(p: &Plane, sigma: f32) -> Plane {
    if sigma < 0.3 || p.w == 0 || p.h == 0 {
        return p.clone();
    }
    if sigma > MAX_DIRECT_SIGMA && (p.w > 1 || p.h > 1) {
        let small = gaussian(&downsample(p), sigma / 2.0);
        return upsample(&small, p.w, p.h);
    }
    let k = kernel(sigma);
    let r = (k.len() / 2) as isize;
    let mut tmp = vec![0.0; p.w * p.h];
    for y in 0..p.h {
        for x in 0..p.w {
            tmp[y * p.w + x] = k.iter().enumerate().map(|(i, w)| w * p.at(x as isize + i as isize - r, y as isize)).sum();
        }
    }
    let tmp = Plane::new(p.w, p.h, tmp);
    let mut out = vec![0.0; p.w * p.h];
    for y in 0..p.h {
        for x in 0..p.w {
            out[y * p.w + x] = k.iter().enumerate().map(|(i, w)| w * tmp.at(x as isize, y as isize + i as isize - r)).sum();
        }
    }
    Plane::new(p.w, p.h, out)
}

/// Normalised Gaussian taps, radius ⌈3σ⌉.
pub fn kernel(sigma: f32) -> Vec<f32> {
    let r = (3.0 * sigma).ceil() as isize;
    let k: Vec<f32> = (-r..=r).map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma)).exp()).collect();
    let s: f32 = k.iter().sum();
    k.into_iter().map(|v| v / s).collect()
}

/// Half size (rounded up), each texel the mean of its 2×2 block (edges clamped).
pub fn downsample(p: &Plane) -> Plane {
    let (w, h) = (p.w.div_ceil(2), p.h.div_ceil(2));
    let mut out = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            let (sx, sy) = (2 * x as isize, 2 * y as isize);
            out[y * w + x] = (p.at(sx, sy) + p.at(sx + 1, sy) + p.at(sx, sy + 1) + p.at(sx + 1, sy + 1)) * 0.25;
        }
    }
    Plane::new(w, h, out)
}

/// Bilinear resample of `p` to `w × h` with aligned pixel centres.
pub fn upsample(p: &Plane, w: usize, h: usize) -> Plane {
    let (fx, fy) = (p.w as f32 / w as f32, p.h as f32 / h as f32);
    let mut out = vec![0.0; w * h];
    for y in 0..h {
        let sy = (y as f32 + 0.5) * fy - 0.5;
        let (y0, ty) = (sy.floor(), sy - sy.floor());
        for x in 0..w {
            let sx = (x as f32 + 0.5) * fx - 0.5;
            let (x0, tx) = (sx.floor(), sx - sx.floor());
            let (x0, y0) = (x0 as isize, y0 as isize);
            let top = p.at(x0, y0) * (1.0 - tx) + p.at(x0 + 1, y0) * tx;
            let bot = p.at(x0, y0 + 1) * (1.0 - tx) + p.at(x0 + 1, y0 + 1) * tx;
            out[y * w + x] = top * (1.0 - ty) + bot * ty;
        }
    }
    Plane::new(w, h, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blur_preserves_constant_planes_and_mean() {
        let flat = Plane::new(9, 7, vec![0.4; 63]);
        for s in [0.5, 2.0, 9.0, 40.0] {
            assert!(gaussian(&flat, s).data.iter().all(|v| (v - 0.4).abs() < 1e-5));
        }
        let mut d = vec![0.0; 21 * 21];
        d[10 * 21 + 10] = 1.0;
        let b = gaussian(&Plane::new(21, 21, d), 1.5);
        assert!((b.data.iter().sum::<f32>() - 1.0).abs() < 1e-4);
        assert!(b.data[10 * 21 + 10] < 0.2);
    }
}
