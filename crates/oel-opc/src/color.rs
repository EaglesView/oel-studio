//! DrawingML colours shared by the codecs: an sRGB colour with alpha, the
//! colour transforms (`lumMod`, `shade`, `alpha`…) and the colour elements
//! (`a:srgbClr`, `a:schemeClr`, `a:sysClr`, `a:prstClr`, `a:scrgbClr`,
//! `a:hslClr`) resolved to CSS. Scheme names are looked up by the caller,
//! which knows the theme and its colour mapping.

use crate::xml::XElement;

/// An sRGB colour with alpha, all components in 0..=1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

impl Rgba {
    pub fn from_hex(hex: &str) -> Option<Rgba> {
        let h = hex.trim_start_matches('#');
        if h.len() != 6 {
            return None;
        }
        let c = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|v| v as f64 / 255.0);
        Some(Rgba { r: c(0)?, g: c(2)?, b: c(4)?, a: 1.0 })
    }

    pub fn to_css(self) -> String {
        let b = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        if self.a >= 0.999 {
            format!("#{:02X}{:02X}{:02X}", b(self.r), b(self.g), b(self.b))
        } else {
            format!("rgba({}, {}, {}, {})", b(self.r), b(self.g), b(self.b), (self.a.clamp(0.0, 1.0) * 1000.0).round() / 1000.0)
        }
    }

    pub fn to_hsl(self) -> (f64, f64, f64) {
        let (r, g, b) = (self.r, self.g, self.b);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        if (max - min).abs() < 1e-12 {
            return (0.0, 0.0, l);
        }
        let d = max - min;
        let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
        let h = if max == r {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        (h / 6.0, s, l)
    }

    pub fn from_hsl(h: f64, s: f64, l: f64, a: f64) -> Rgba {
        if s <= 0.0 {
            return Rgba { r: l, g: l, b: l, a };
        }
        let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
        let p = 2.0 * l - q;
        let hue = |mut t: f64| {
            if t < 0.0 {
                t += 1.0;
            }
            if t > 1.0 {
                t -= 1.0;
            }
            if t < 1.0 / 6.0 {
                p + (q - p) * 6.0 * t
            } else if t < 0.5 {
                q
            } else if t < 2.0 / 3.0 {
                p + (q - p) * (2.0 / 3.0 - t) * 6.0
            } else {
                p
            }
        };
        Rgba { r: hue(h + 1.0 / 3.0), g: hue(h), b: hue(h - 1.0 / 3.0), a }
    }

    pub fn map_linear(self, f: impl Fn(f64) -> f64) -> Rgba {
        let to_lin = |c: f64| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
        let to_srgb = |c: f64| {
            let c = c.clamp(0.0, 1.0);
            if c <= 0.003_130_8 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
        };
        Rgba { r: to_srgb(f(to_lin(self.r))), g: to_srgb(f(to_lin(self.g))), b: to_srgb(f(to_lin(self.b))), a: self.a }
    }

    /// Apply DrawingML colour transforms (children of the colour element), in document order.
    pub fn transform(mut self, el: &XElement) -> Rgba {
        for t in el.elements() {
            let Some(v) = t.attr("val").and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100_000.0) else { continue };
            match t.local() {
                "lumMod" | "lumOff" | "satMod" | "satOff" | "hueMod" | "hueOff" => {
                    let (mut h, mut s, mut l) = self.to_hsl();
                    match t.local() {
                        "lumMod" => l *= v,
                        "lumOff" => l += v,
                        "satMod" => s *= v,
                        "satOff" => s += v,
                        "hueMod" => h *= v,
                        // hueOff is in 60000ths of a degree, already divided by 100000.
                        _ => h += v * 100_000.0 / 60_000.0 / 360.0,
                    }
                    self = Rgba::from_hsl(h.rem_euclid(1.0), s.clamp(0.0, 1.0), l.clamp(0.0, 1.0), self.a);
                }
                "shade" => self = self.map_linear(|c| c * v),
                "tint" => self = self.map_linear(|c| c * v + (1.0 - v)),
                "alpha" => self.a = v,
                "alphaMod" => self.a *= v,
                "alphaOff" => self.a += v,
                _ => {}
            }
        }
        self
    }
}

pub const PRESET: &[(&str, &str)] = &[
    ("black", "000000"),
    ("white", "FFFFFF"),
    ("red", "FF0000"),
    ("green", "008000"),
    ("blue", "0000FF"),
    ("yellow", "FFFF00"),
    ("cyan", "00FFFF"),
    ("magenta", "FF00FF"),
    ("gray", "808080"),
    ("grey", "808080"),
    ("ltGray", "D3D3D3"),
    ("dkGray", "A9A9A9"),
    ("orange", "FFA500"),
    ("purple", "800080"),
    ("navy", "000080"),
];


impl Rgba {
    /// `RRGGBB` without alpha.
    pub fn to_hex(self) -> String {
        let b = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!("{:02X}{:02X}{:02X}", b(self.r), b(self.g), b(self.b))
    }

    /// A CSS colour as written by [`Rgba::to_css`] (`#RRGGBB` or `rgba(r, g, b, a)`).
    pub fn from_css(css: &str) -> Option<Rgba> {
        let s = css.trim();
        if s.starts_with('#') {
            return Rgba::from_hex(s);
        }
        let inner = s.strip_prefix("rgba(").or_else(|| s.strip_prefix("rgb("))?.strip_suffix(')')?;
        let parts: Vec<f64> = inner.split(',').filter_map(|p| p.trim().parse().ok()).collect();
        if parts.len() < 3 {
            return None;
        }
        Some(Rgba { r: parts[0] / 255.0, g: parts[1] / 255.0, b: parts[2] / 255.0, a: parts.get(3).copied().unwrap_or(1.0) })
    }
}

/// A colour element with its transforms. `scheme` maps a scheme colour name
/// (`accent1`, `tx1`, `phClr`…) to `RRGGBB`; `None` for unknown names.
pub fn color_of(el: &XElement, scheme: &dyn Fn(&str) -> Option<String>) -> Option<Rgba> {
    let base = match el.local() {
        "srgbClr" => Rgba::from_hex(el.attr("val")?),
        "schemeClr" => Rgba::from_hex(&scheme(el.attr("val")?)?),
        "sysClr" => Rgba::from_hex(el.attr("lastClr").or(match el.attr("val") {
            Some("windowText") => Some("000000"),
            Some("window") => Some("FFFFFF"),
            _ => None,
        })?),
        "prstClr" => PRESET.iter().find(|(n, _)| Some(*n) == el.attr("val")).and_then(|(_, h)| Rgba::from_hex(h)),
        "scrgbClr" => {
            let c = |k: &str| el.attr(k).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100_000.0);
            Some(Rgba { r: c("r")?, g: c("g")?, b: c("b")?, a: 1.0 }.map_linear(|c| c))
        }
        "hslClr" => {
            let c = |k: &str| el.attr(k).and_then(|v| v.parse::<f64>().ok());
            Some(Rgba::from_hsl(c("hue")? / 60_000.0 / 360.0, c("sat")? / 100_000.0, c("lum")? / 100_000.0, 1.0))
        }
        _ => None,
    }?;
    Some(base.transform(el))
}

/// The first colour child of a fill-like element (`a:solidFill`, `a:gs`…).
pub fn child_color(parent: &XElement, scheme: &dyn Fn(&str) -> Option<String>) -> Option<Rgba> {
    parent.elements().find_map(|c| color_of(c, scheme))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_round_trip() {
        let c = Rgba::from_css("rgba(255, 0, 0, 0.5)").unwrap();
        assert_eq!(c.to_css(), "rgba(255, 0, 0, 0.5)");
        assert_eq!(Rgba::from_css("#00FF7f").unwrap().to_hex(), "00FF7F");
    }
}
