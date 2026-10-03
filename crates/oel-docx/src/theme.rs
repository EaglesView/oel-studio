//! Theme colours: the related theme part's `a:clrScheme`, mapped through the
//! settings part's `w:clrSchemeMapping`, and DrawingML colour elements resolved
//! to CSS (`#RRGGBB`, or `rgba(…)` when an alpha transform applies).

use super::package::{DocxPackage, Package, REL_SETTINGS, REL_THEME};
use super::xml::XElement;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct Theme {
    /// `dk1`, `lt1`, `accent1`… → `RRGGBB`.
    pub scheme: HashMap<String, String>,
    /// `t1`, `bg1`, `accent1`… → scheme slot (`dk1`, `lt1`…), from `w:clrSchemeMapping`.
    pub mapping: HashMap<String, String>,
}

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

    fn to_hsl(self) -> (f64, f64, f64) {
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

    fn from_hsl(h: f64, s: f64, l: f64, a: f64) -> Rgba {
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

    fn map_linear(self, f: impl Fn(f64) -> f64) -> Rgba {
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

const PRESET: &[(&str, &str)] = &[
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

impl Theme {
    pub fn load(pkg: &Package) -> Theme {
        let mut t = Theme::default();
        if let Some(theme) = pkg.get_xml(&pkg.main_related(REL_THEME, "theme/theme1.xml")) {
            if let Some(cs) = theme.root.find("a:clrScheme") {
                for slot in cs.elements() {
                    let Some(c) = slot.elements().next() else { continue };
                    let hex = match c.local() {
                        "srgbClr" => c.attr("val"),
                        "sysClr" => c.attr("lastClr").or(match c.attr("val") {
                            Some("windowText") => Some("000000"),
                            Some("window") => Some("FFFFFF"),
                            _ => None,
                        }),
                        _ => None,
                    };
                    if let Some(h) = hex {
                        t.scheme.insert(slot.local().to_string(), h.to_ascii_uppercase());
                    }
                }
            }
        }
        if let Some(settings) = pkg.get_xml(&pkg.main_related(REL_SETTINGS, "settings.xml")) {
            if let Some(m) = settings.root.child("w:clrSchemeMapping") {
                for (k, v) in &m.attrs {
                    if let Some(key) = k.strip_prefix("w:") {
                        t.mapping.insert(key.to_string(), scheme_slot(v).to_string());
                    }
                }
            }
        }
        t
    }

    /// `RRGGBB` of a scheme colour name as used in DrawingML (`tx1`, `bg2`, `accent1`, `dk1`…).
    pub fn scheme_hex(&self, name: &str) -> Option<&str> {
        let slot = match name {
            "tx1" | "bg1" | "tx2" | "bg2" => {
                let key = match name {
                    "tx1" => "t1",
                    "bg1" => "bg1",
                    "tx2" => "t2",
                    _ => "bg2",
                };
                self.mapping.get(key).map(String::as_str).unwrap_or(match name {
                    "tx1" => "dk1",
                    "bg1" => "lt1",
                    "tx2" => "dk2",
                    _ => "lt2",
                })
            }
            other => other,
        };
        self.scheme.get(slot).map(String::as_str)
    }

    /// A colour element (`a:srgbClr`, `a:schemeClr`, `a:sysClr`, `a:prstClr`, `a:scrgbClr`, `a:hslClr`)
    /// with its transforms, as CSS. `None` for `phClr` and unknown names.
    pub fn resolve(&self, el: &XElement) -> Option<String> {
        self.rgba(el).map(Rgba::to_css)
    }

    pub fn rgba(&self, el: &XElement) -> Option<Rgba> {
        let base = match el.local() {
            "srgbClr" => Rgba::from_hex(el.attr("val")?),
            "schemeClr" => Rgba::from_hex(self.scheme_hex(el.attr("val")?)?),
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

    /// First colour child of a fill-like element (`a:solidFill`, `a:gs`…), resolved.
    pub fn resolve_child(&self, parent: &XElement) -> Option<String> {
        parent.elements().find_map(|c| self.resolve(c))
    }
}

/// `w:clrSchemeMapping` values (`light1`, `dark2`, `hyperlink`…) → `a:clrScheme` slot names.
fn scheme_slot(v: &str) -> &str {
    match v {
        "light1" => "lt1",
        "dark1" => "dk1",
        "light2" => "lt2",
        "dark2" => "dk2",
        "hyperlink" => "hlink",
        "followedHyperlink" => "folHlink",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::XDocument;

    fn theme() -> Theme {
        // complex_template.docx's scheme and mapping.
        let mut t = Theme::default();
        for (k, v) in [
            ("dk1", "000000"),
            ("lt1", "FFFFFF"),
            ("dk2", "2A2A2A"),
            ("lt2", "FBFBF8"),
            ("accent1", "F75952"),
            ("accent2", "6AC7C9"),
        ] {
            t.scheme.insert(k.into(), v.into());
        }
        for (k, v) in [("t1", "dk1"), ("bg1", "lt1"), ("t2", "dk2"), ("bg2", "lt2")] {
            t.mapping.insert(k.into(), v.into());
        }
        t
    }

    fn el(xml: &str) -> XElement {
        XDocument::parse(&format!("<a:x xmlns:a=\"a\">{xml}</a:x>")).unwrap().root.elements().next().unwrap().clone()
    }

    #[test]
    fn scheme_colour_with_lum_mod_and_off() {
        let c = el(r#"<a:schemeClr val="tx1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr>"#);
        assert_eq!(theme().resolve(&c).as_deref(), Some("#404040"));
    }

    #[test]
    fn mapping_is_followed() {
        let mut t = theme();
        t.mapping.insert("t1".into(), "lt1".into());
        assert_eq!(t.resolve(&el(r#"<a:schemeClr val="tx1"/>"#)).as_deref(), Some("#FFFFFF"));
        assert_eq!(theme().resolve(&el(r#"<a:schemeClr val="bg2"/>"#)).as_deref(), Some("#FBFBF8"));
    }

    #[test]
    fn lum_mod_darkens_an_accent() {
        // accent1 F75952: HSL (2.5°, 91 %, 64.5 %) → luminance × 0.85 = 54.8 %.
        let c = el(r#"<a:schemeClr val="accent1"><a:lumMod val="85000"/></a:schemeClr>"#);
        assert_eq!(theme().resolve(&c).as_deref(), Some("#F52C23"));
    }

    #[test]
    fn shade_tint_and_alpha() {
        assert_eq!(theme().resolve(&el(r#"<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>"#)).as_deref(), Some("#BCBCBC"));
        assert_eq!(theme().resolve(&el(r#"<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>"#)).as_deref(), Some("#BCBCBC"));
        assert_eq!(theme().resolve(&el(r#"<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>"#)).as_deref(), Some("rgba(255, 0, 0, 0.5)"));
    }

    #[test]
    fn sys_preset_and_placeholder() {
        assert_eq!(theme().resolve(&el(r#"<a:sysClr val="windowText" lastClr="000000"/>"#)).as_deref(), Some("#000000"));
        assert_eq!(theme().resolve(&el(r#"<a:prstClr val="white"/>"#)).as_deref(), Some("#FFFFFF"));
        assert_eq!(theme().resolve(&el(r#"<a:schemeClr val="phClr"/>"#)), None);
    }
}
