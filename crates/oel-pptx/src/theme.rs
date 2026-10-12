//! A master's theme (colour scheme, fonts, format scheme) and the colour
//! mapping of the slide being read (`p:clrMap` overridden by `p:clrMapOvr`).

use crate::model::{GradientStop, Line, LineEnd, Paint, Shadow};
use oel_opc::color::{Rgba, color_of};
use oel_opc::package::Package;
use oel_opc::xml::XElement;
use std::collections::HashMap;

/// Scheme slots in the order of PowerPoint's colour picker.
pub const SLOTS: [&str; 12] = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

#[derive(Debug, Clone, Default)]
pub struct Theme {
    /// `dk1`, `lt1`, `accent1`… → `RRGGBB`.
    pub scheme: HashMap<String, String>,
    pub major: String,
    pub minor: String,
    pub fill_styles: Vec<XElement>,
    pub line_styles: Vec<XElement>,
    pub effect_styles: Vec<XElement>,
    pub bg_fill_styles: Vec<XElement>,
}

impl Theme {
    pub fn load(pkg: &Package, part: &str) -> Theme {
        let mut t = Theme { major: "Calibri Light".into(), minor: "Calibri".into(), ..Default::default() };
        let Some(doc) = pkg.get_xml(part) else { return t };
        let Some(elements) = doc.root.child_local("themeElements") else { return t };
        if let Some(cs) = elements.child_local("clrScheme") {
            for slot in cs.elements() {
                let Some(c) = slot.elements().next() else { continue };
                if let Some(rgba) = color_of(c, &|_| None) {
                    t.scheme.insert(slot.local().to_string(), rgba.to_hex());
                }
            }
        }
        if let Some(fs) = elements.child_local("fontScheme") {
            let latin = |name: &str| fs.child_local(name).and_then(|f| f.child_local("latin")).and_then(|l| l.attr("typeface")).filter(|s| !s.is_empty()).map(String::from);
            if let Some(f) = latin("majorFont") {
                t.major = f;
            }
            if let Some(f) = latin("minorFont") {
                t.minor = f;
            }
        }
        if let Some(fmt) = elements.child_local("fmtScheme") {
            let list = |name: &str| fmt.child_local(name).map(|l| l.elements().cloned().collect()).unwrap_or_default();
            t.fill_styles = list("fillStyleLst");
            t.line_styles = list("lnStyleLst");
            t.effect_styles = list("effectStyleLst");
            t.bg_fill_styles = list("bgFillStyleLst");
        }
        t
    }

    /// `+mj-lt` / `+mn-lt` (and the ea/cs variants) → the theme typeface.
    pub fn typeface(&self, face: &str) -> String {
        match face {
            f if f.starts_with("+mj") => self.major.clone(),
            f if f.starts_with("+mn") => self.minor.clone(),
            f => f.to_string(),
        }
    }
}

/// Default colour mapping (`p:clrMap` of a blank master).
pub fn default_map() -> HashMap<String, String> {
    let mut m = HashMap::new();
    for (k, v) in [("bg1", "lt1"), ("tx1", "dk1"), ("bg2", "lt2"), ("tx2", "dk2")] {
        m.insert(k.to_string(), v.to_string());
    }
    m
}

/// Apply a `p:clrMap` (or the `a:overrideClrMapping` of a `p:clrMapOvr`) over `map`.
pub fn apply_map(map: &mut HashMap<String, String>, el: &XElement) {
    for (k, v) in &el.attrs {
        if !k.contains(':') {
            map.insert(k.clone(), v.clone());
        }
    }
}

/// Everything needed to turn DrawingML colours and fills into CSS for one part.
#[derive(Clone)]
pub struct ColorCtx<'a> {
    pub theme: &'a Theme,
    pub map: &'a HashMap<String, String>,
    /// The colour a style reference gives `phClr`.
    pub ph: Option<Rgba>,
}

impl<'a> ColorCtx<'a> {
    pub fn with_ph(&self, ph: Option<Rgba>) -> ColorCtx<'a> {
        ColorCtx { theme: self.theme, map: self.map, ph }
    }

    pub fn scheme_hex(&self, name: &str) -> Option<String> {
        let slot = self.map.get(name).map(String::as_str).unwrap_or(name);
        self.theme.scheme.get(slot).cloned()
    }

    pub fn rgba(&self, el: &XElement) -> Option<Rgba> {
        if el.local() == "schemeClr" && el.attr("val") == Some("phClr") {
            return self.ph.map(|c| c.transform(el));
        }
        color_of(el, &|name| self.scheme_hex(name))
    }

    pub fn css(&self, el: &XElement) -> Option<String> {
        self.rgba(el).map(Rgba::to_css)
    }

    /// First colour child of `parent`, as CSS.
    pub fn child_css(&self, parent: &XElement) -> Option<String> {
        parent.elements().find_map(|c| self.css(c))
    }

    pub fn child_rgba(&self, parent: &XElement) -> Option<Rgba> {
        parent.elements().find_map(|c| self.rgba(c))
    }

    /// A fill element (`a:noFill`, `a:solidFill`, `a:gradFill`, `a:blipFill`, `a:pattFill`, `a:grpFill`).
    /// `blip` resolves an image relationship id to its media part.
    pub fn paint(&self, f: &XElement, blip: &dyn Fn(&str) -> Option<String>) -> Option<Paint> {
        Some(match f.local() {
            "noFill" => Paint::None,
            "solidFill" => Paint::Solid { color: self.child_css(f).unwrap_or_else(|| "#000000".into()) },
            "gradFill" => {
                let stops: Vec<GradientStop> = f
                    .child_local("gsLst")
                    .into_iter()
                    .flat_map(|l| l.elements())
                    .filter_map(|gs| Some(GradientStop { pos: num(gs, "pos").unwrap_or(0.0) / 100_000.0, color: self.child_css(gs)? }))
                    .collect();
                if stops.is_empty() {
                    return Some(Paint::None);
                }
                let angle = f.child_local("lin").and_then(|l| num(l, "ang")).map(|a| a / 60_000.0).unwrap_or(90.0);
                let path = f.child_local("path").and_then(|p| p.attr("path")).map(String::from);
                Paint::Gradient { angle, path, stops }
            }
            "blipFill" => {
                let b = f.child_local("blip")?;
                let rid = b.attr("r:embed")?;
                Paint::Image { media: blip(rid)?, crop: crop_of(f), tile: f.child_local("tile").is_some() }
            }
            "pattFill" => Paint::Pattern {
                prst: f.attr("prst").unwrap_or("pct50").to_string(),
                fg: f.child_local("fgClr").and_then(|c| self.child_css(c)).unwrap_or_else(|| "#000000".into()),
                bg: f.child_local("bgClr").and_then(|c| self.child_css(c)).unwrap_or_else(|| "#FFFFFF".into()),
            },
            "grpFill" => Paint::Group,
            _ => return None,
        })
    }

    /// The fill among the children of a properties element (`p:spPr`, `p:bgPr`, `a:tcPr`…).
    pub fn fill_in(&self, parent: &XElement, blip: &dyn Fn(&str) -> Option<String>) -> Option<Paint> {
        parent.elements().filter(|e| is_fill(e.local())).find_map(|e| self.paint(e, blip))
    }

    /// An `a:ln` element, field by field (only what it sets).
    pub fn line(&self, ln: &XElement) -> Line {
        let fill = ln.elements().find(|e| is_fill(e.local()));
        let paint = fill.and_then(|f| match f.local() {
            // A gradient outline shows as its first stop.
            "gradFill" => f.child_local("gsLst").and_then(|l| l.elements().next()).and_then(|gs| self.child_css(gs)).map(|color| Paint::Solid { color }),
            _ => self.paint(f, &|_| None),
        });
        let end = |name: &str| {
            ln.child_local(name).map(|e| LineEnd { kind: e.attr("type").unwrap_or("none").to_string(), w: e.attr("w").map(String::from), len: e.attr("len").map(String::from) })
        };
        Line {
            paint,
            width: num(ln, "w").map(|w| w as i64),
            dash: ln.child_local("prstDash").and_then(|d| d.attr("val")).map(String::from),
            cap: ln.attr("cap").map(String::from),
            head: end("headEnd"),
            tail: end("tailEnd"),
        }
    }

    /// The first shadow of an `a:effectLst`.
    pub fn shadow(&self, effects: &XElement) -> Option<Shadow> {
        let s = effects.elements().find(|e| matches!(e.local(), "outerShdw" | "innerShdw" | "prstShdw"))?;
        Some(Shadow {
            color: self.child_css(s).unwrap_or_else(|| "rgba(0, 0, 0, 0.35)".into()),
            blur: num(s, "blurRad").unwrap_or(0.0) as i64,
            dist: num(s, "dist").unwrap_or(0.0) as i64,
            dir: num(s, "dir").unwrap_or(0.0) / 60_000.0,
            inner: s.local() == "innerShdw",
        })
    }

    /// A theme style reference (`a:fillRef`, `a:lnRef`, `a:effectRef`): its colour
    /// becomes `phClr` of the referenced style.
    pub fn style_ref<'t>(&self, r: &XElement, list: &'t [XElement], bg: &'t [XElement]) -> Option<(ColorCtx<'a>, &'t XElement)> {
        let idx = num(r, "idx")? as usize;
        let style = match idx {
            0 => return None,
            1..=999 => list.get(idx - 1)?,
            _ => bg.get(idx - 1001)?,
        };
        Some((self.with_ph(self.child_rgba(r)), style))
    }
}

pub fn is_fill(local: &str) -> bool {
    matches!(local, "noFill" | "solidFill" | "gradFill" | "blipFill" | "pattFill" | "grpFill")
}

pub fn num(e: &XElement, k: &str) -> Option<f64> {
    e.attr(k).and_then(|v| v.trim().parse::<f64>().ok())
}

/// `a:srcRect` of a blip fill, as fractions; `None` when nothing is cut.
pub fn crop_of(blip_fill: &XElement) -> Option<crate::model::Crop> {
    let r = blip_fill.child_local("srcRect")?;
    let f = |k: &str| num(r, k).unwrap_or(0.0) / 100_000.0;
    let c = crate::model::Crop { l: f("l"), t: f("t"), r: f("r"), b: f("b") };
    if c.l == 0.0 && c.t == 0.0 && c.r == 0.0 && c.b == 0.0 { None } else { Some(c) }
}

/// Merge `over` into `base`, field by field.
pub fn merge_line(base: Option<Line>, over: Option<&Line>) -> Option<Line> {
    match (base, over) {
        (None, None) => None,
        (Some(b), None) => Some(b),
        (None, Some(o)) => Some(o.clone()),
        (Some(b), Some(o)) => Some(Line {
            paint: o.paint.clone().or(b.paint),
            width: o.width.or(b.width),
            dash: o.dash.clone().or(b.dash),
            cap: o.cap.clone().or(b.cap),
            head: o.head.clone().or(b.head),
            tail: o.tail.clone().or(b.tail),
        }),
    }
}
