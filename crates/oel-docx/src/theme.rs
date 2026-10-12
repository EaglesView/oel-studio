//! Theme colours: the related theme part's `a:clrScheme`, mapped through the
//! settings part's `w:clrSchemeMapping`, and DrawingML colour elements resolved
//! to CSS (`#RRGGBB`, or `rgba(…)` when an alpha transform applies).

use super::package::{DocxPackage, Package, REL_SETTINGS, REL_THEME};
use super::xml::XElement;
use std::collections::HashMap;

pub use oel_opc::color::Rgba;

#[derive(Debug, Clone, Default)]
pub struct Theme {
    /// `dk1`, `lt1`, `accent1`… → `RRGGBB`.
    pub scheme: HashMap<String, String>,
    /// `t1`, `bg1`, `accent1`… → scheme slot (`dk1`, `lt1`…), from `w:clrSchemeMapping`.
    pub mapping: HashMap<String, String>,
}

/// The theme's body (minor) and heading (major) Latin fonts.
pub fn theme_fonts(pkg: &Package) -> (Option<String>, Option<String>) {
    let Some(theme) = pkg.get_xml(&pkg.main_related(REL_THEME, "theme/theme1.xml")) else { return (None, None) };
    let face = |which: &str| theme.root.find_local(which).and_then(|f| f.child_local("latin")).and_then(|l| l.attr("typeface")).filter(|t| !t.is_empty()).map(String::from);
    (face("minorFont"), face("majorFont"))
}

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
        oel_opc::color::color_of(el, &|name| self.scheme_hex(name).map(String::from))
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
