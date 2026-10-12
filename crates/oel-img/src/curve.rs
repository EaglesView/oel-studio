//! Tone curves → lookup tables. The GPU uploads the same tables, and both sides read them with
//! [`sample`] (manual linear interpolation, so no float-texture filtering is needed on WebGL2).

/// Entries per channel table.
pub const LUT_SIZE: usize = 1024;

/// Monotone cubic (Fritsch–Carlson) through control points in 0…1, evaluated at `x`.
pub struct MonotoneCubic {
    xs: Vec<f32>,
    ys: Vec<f32>,
    ms: Vec<f32>,
}

impl MonotoneCubic {
    pub fn new(points: &[[f32; 2]]) -> Self {
        let mut p: Vec<[f32; 2]> = points.iter().map(|[x, y]| [x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)]).collect();
        p.sort_by(|a, b| a[0].total_cmp(&b[0]));
        p.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-6);
        if p.is_empty() {
            p = vec![[0.0, 0.0], [1.0, 1.0]];
        }
        if p.len() == 1 {
            p.push([p[0][0] + 1e-3, p[0][1]]);
        }
        let xs: Vec<f32> = p.iter().map(|q| q[0]).collect();
        let ys: Vec<f32> = p.iter().map(|q| q[1]).collect();
        let n = xs.len();
        let d: Vec<f32> = (0..n - 1).map(|i| (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])).collect();
        let mut ms = vec![0.0; n];
        ms[0] = d[0];
        ms[n - 1] = d[n - 2];
        for i in 1..n - 1 {
            ms[i] = if d[i - 1] * d[i] <= 0.0 { 0.0 } else { (d[i - 1] + d[i]) / 2.0 };
        }
        for i in 0..n - 1 {
            if d[i] == 0.0 {
                ms[i] = 0.0;
                ms[i + 1] = 0.0;
                continue;
            }
            let a = ms[i] / d[i];
            let b = ms[i + 1] / d[i];
            let s = a * a + b * b;
            if s > 9.0 {
                let t = 3.0 / s.sqrt();
                ms[i] = t * a * d[i];
                ms[i + 1] = t * b * d[i];
            }
        }
        Self { xs, ys, ms }
    }

    pub fn eval(&self, x: f32) -> f32 {
        let n = self.xs.len();
        if x <= self.xs[0] {
            return self.ys[0];
        }
        if x >= self.xs[n - 1] {
            return self.ys[n - 1];
        }
        let i = self.xs.partition_point(|&v| v <= x) - 1;
        let h = self.xs[i + 1] - self.xs[i];
        let t = (x - self.xs[i]) / h;
        let (t2, t3) = (t * t, t * t * t);
        (2.0 * t3 - 3.0 * t2 + 1.0) * self.ys[i]
            + (t3 - 2.0 * t2 + t) * h * self.ms[i]
            + (-2.0 * t3 + 3.0 * t2) * self.ys[i + 1]
            + (t3 - t2) * h * self.ms[i + 1]
    }
}

pub fn is_identity(points: &[[f32; 2]]) -> bool {
    points.iter().all(|[x, y]| (x - y).abs() < 1e-6)
}

/// Per-channel tables `[r, g, b]`, each `channel ∘ rgb`, or `None` when all four curves are identity.
pub fn tone_luts(rgb: &[[f32; 2]], r: &[[f32; 2]], g: &[[f32; 2]], b: &[[f32; 2]]) -> Option<[Vec<f32>; 3]> {
    if [rgb, r, g, b].iter().all(|c| is_identity(c)) {
        return None;
    }
    let master = MonotoneCubic::new(rgb);
    Some([r, g, b].map(|c| {
        let ch = MonotoneCubic::new(c);
        (0..LUT_SIZE).map(|i| ch.eval(master.eval(i as f32 / (LUT_SIZE - 1) as f32))).collect()
    }))
}

/// Reads a table at `x` in 0…1 (clamped).
pub fn sample(lut: &[f32], x: f32) -> f32 {
    let p = x.clamp(0.0, 1.0) * (lut.len() - 1) as f32;
    let i = (p.floor() as usize).min(lut.len() - 2);
    let t = p - i as f32;
    lut[i] + (lut[i + 1] - lut[i]) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_points_and_stays_monotone() {
        let c = MonotoneCubic::new(&[[0.0, 0.0], [0.25, 0.15], [0.75, 0.9], [1.0, 1.0]]);
        assert!((c.eval(0.25) - 0.15).abs() < 1e-6);
        assert!((c.eval(0.75) - 0.9).abs() < 1e-6);
        let mut prev = -1.0;
        for i in 0..=200 {
            let y = c.eval(i as f32 / 200.0);
            assert!(y >= prev - 1e-6);
            prev = y;
        }
    }

    #[test]
    fn identity_curves_have_no_lut() {
        let id = [[0.0, 0.0], [1.0, 1.0]];
        assert!(tone_luts(&id, &id, &id, &id).is_none());
        let lut = tone_luts(&[[0.0, 0.0], [0.5, 0.6], [1.0, 1.0]], &id, &id, &id).unwrap();
        assert!((sample(&lut[0], 0.5) - 0.6).abs() < 1e-3);
    }
}
