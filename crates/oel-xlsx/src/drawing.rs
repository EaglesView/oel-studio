//! A worksheet's drawing part (`xl/drawings/drawingN.xml`) → [`Drawing`]s.
//!
//! Read-only: the editor shows pictures, shapes and chart frames over the
//! grid; the part itself is written back untouched by [`crate::write`].

use crate::model::{Drawing, DrawingMarker};
use oel_opc::package::{Package, resolve_target};
use oel_opc::xml::XElement;

pub const REL_DRAWING: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";

/// Theme colours in the order [`crate::styles::theme_colors`] returns them.
const SCHEME: [&str; 12] = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/// Every drawing of a worksheet part, in z-order (back to front).
pub fn read_drawings(pkg: &Package, sheet_part: &str, theme: &[String]) -> Vec<Drawing> {
    let mut out = Vec::new();
    for rel in pkg.rels(sheet_part).into_iter().filter(|r| r.rel_type == REL_DRAWING) {
        let part = resolve_target(sheet_part, &rel.target);
        let Some(doc) = pkg.get_xml(&part) else { continue };
        let ctx = Ctx { pkg, part: &part, theme };
        for anchor in doc.root.elements() {
            if let Some(d) = ctx.anchor(anchor) {
                out.push(d);
            }
        }
    }
    out
}

struct Ctx<'a> {
    pkg: &'a Package,
    part: &'a str,
    theme: &'a [String],
}

fn num(e: &XElement, k: &str) -> Option<i64> {
    e.attr(k).and_then(|v| v.trim().parse().ok())
}

fn child_num(e: &XElement, local: &str) -> i64 {
    e.child_local(local).and_then(|c| c.text_content().trim().parse().ok()).unwrap_or(0)
}

fn marker(e: &XElement) -> DrawingMarker {
    DrawingMarker {
        c: child_num(e, "col").max(0) as u32,
        dx: child_num(e, "colOff"),
        r: child_num(e, "row").max(0) as u32,
        dy: child_num(e, "rowOff"),
    }
}

/// First descendant with this local name (depth first).
fn desc<'a>(e: &'a XElement, local: &str) -> Option<&'a XElement> {
    for c in e.elements() {
        if c.local() == local {
            return Some(c);
        }
        if let Some(f) = desc(c, local) {
            return Some(f);
        }
    }
    None
}

impl Ctx<'_> {
    fn anchor(&self, a: &XElement) -> Option<Drawing> {
        let kind_of_anchor = a.local();
        if !matches!(kind_of_anchor, "twoCellAnchor" | "oneCellAnchor" | "absoluteAnchor") {
            return None;
        }
        // The object: the first element that is not a position or clientData.
        // Markup-compatibility blocks hold a choice for newer Excel (chartex) and a fallback.
        let mut obj = a.elements().find(|e| !matches!(e.local(), "from" | "to" | "pos" | "ext" | "clientData"))?;
        if obj.local() == "AlternateContent" {
            obj = obj.child_local("Choice").or_else(|| obj.child_local("Fallback"))?.elements().next()?;
        }
        let mut d = self.object(obj);
        match kind_of_anchor {
            "absoluteAnchor" => {
                // No cell: keep the offset from A1.
                let pos = a.child_local("pos");
                d.from = DrawingMarker { r: 0, c: 0, dx: pos.and_then(|p| num(p, "x")).unwrap_or(0), dy: pos.and_then(|p| num(p, "y")).unwrap_or(0) };
                d.edit_as = Some("absolute".into());
            }
            _ => {
                d.from = marker(a.child_local("from")?);
                d.to = a.child_local("to").map(marker);
                if kind_of_anchor == "oneCellAnchor" {
                    d.edit_as = Some("oneCell".into());
                } else {
                    d.edit_as = Some(a.attr("editAs").unwrap_or("twoCell").to_string());
                }
            }
        }
        if let Some(ext) = a.child_local("ext") {
            d.cx = num(ext, "cx").unwrap_or(0);
            d.cy = num(ext, "cy").unwrap_or(0);
        }
        Some(d)
    }

    fn object(&self, obj: &XElement) -> Drawing {
        let mut d = Drawing { kind: "other".into(), ..Default::default() };
        if let Some(nv) = desc(obj, "cNvPr") {
            d.name = nv.attr("name").unwrap_or_default().to_string();
            d.descr = nv.attr("descr").filter(|s| !s.is_empty()).map(String::from);
        }
        let sp_pr = obj.child_local("spPr");
        if let Some(xfrm) = sp_pr.and_then(|s| s.child_local("xfrm")).or_else(|| obj.child_local("xfrm")) {
            d.rot = num(xfrm, "rot").unwrap_or(0) as f64 / 60_000.0;
            d.flip_h = matches!(xfrm.attr("flipH"), Some("1") | Some("true"));
            d.flip_v = matches!(xfrm.attr("flipV"), Some("1") | Some("true"));
        }
        match obj.local() {
            "pic" => {
                d.kind = "picture".into();
                if let Some(blip) = obj.child_local("blipFill").and_then(|b| b.child_local("blip")) {
                    // Office 2016+ keeps an SVG next to the PNG fallback.
                    let svg = desc(blip, "svgBlip").and_then(|s| self.media(s));
                    let path = svg.or_else(|| self.media(blip));
                    if let Some(p) = path {
                        d.mime = Some(self.pkg.mime_of(&p)).filter(|m| m.starts_with("image/"));
                        d.media = Some(p);
                    }
                }
            }
            "sp" | "cxnSp" => {
                d.kind = "shape".into();
                let style = obj.child_local("style");
                d.geom = sp_pr.and_then(|s| s.child_local("prstGeom")).and_then(|g| g.attr("prst")).map(String::from);
                d.fill = self.fill(sp_pr, style);
                d.line = self.line(sp_pr, style);
                let text: Vec<String> = obj
                    .child_local("txBody")
                    .map(|b| b.children_local("p").map(|p| p.children_local("r").filter_map(|r| r.child_local("t")).map(|t| t.text_content()).collect::<String>()).collect())
                    .unwrap_or_default();
                if text.iter().any(|t| !t.trim().is_empty()) {
                    d.text = Some(text.join("\n"));
                }
            }
            "graphicFrame" => {
                let uri = desc(obj, "graphicData").and_then(|g| g.attr("uri")).unwrap_or_default();
                d.kind = if uri.contains("chart") { "chart" } else { "other" }.into();
            }
            _ => {}
        }
        d
    }

    /// `r:embed` of a blip → package path.
    fn media(&self, blip: &XElement) -> Option<String> {
        let id = blip.attrs.iter().find(|(k, _)| k.ends_with(":embed")).map(|(_, v)| v.as_str())?;
        let rel = self.pkg.rels(self.part).into_iter().find(|r| r.id == id)?;
        let path = resolve_target(self.part, &rel.target);
        self.pkg.has(&path).then_some(path)
    }

    fn fill(&self, sp_pr: Option<&XElement>, style: Option<&XElement>) -> Option<String> {
        if let Some(sp) = sp_pr {
            if sp.child_local("noFill").is_some() {
                return None;
            }
            if let Some(f) = sp.child_local("solidFill") {
                return f.elements().find_map(|c| self.color(c));
            }
            if let Some(g) = sp.child_local("gradFill") {
                return desc(g, "gs").and_then(|gs| gs.elements().find_map(|c| self.color(c)));
            }
        }
        // Theme style reference: its colour stands for the theme fill.
        style.and_then(|s| s.child_local("fillRef")).filter(|r| r.attr("idx") != Some("0")).and_then(|r| r.elements().find_map(|c| self.color(c)))
    }

    fn line(&self, sp_pr: Option<&XElement>, style: Option<&XElement>) -> Option<String> {
        if let Some(ln) = sp_pr.and_then(|s| s.child_local("ln")) {
            if ln.child_local("noFill").is_some() {
                return None;
            }
            if let Some(f) = ln.child_local("solidFill") {
                return f.elements().find_map(|c| self.color(c));
            }
        }
        style.and_then(|s| s.child_local("lnRef")).filter(|r| r.attr("idx") != Some("0")).and_then(|r| r.elements().find_map(|c| self.color(c)))
    }

    /// A DrawingML colour element with its transforms, as CSS.
    fn color(&self, el: &XElement) -> Option<String> {
        let hex = match el.local() {
            "srgbClr" => el.attr("val")?.to_string(),
            "sysClr" => el.attr("lastClr").map(String::from).or_else(|| match el.attr("val") {
                Some("window") => Some("FFFFFF".into()),
                Some("windowText") => Some("000000".into()),
                _ => None,
            })?,
            "schemeClr" => {
                let name = match el.attr("val")? {
                    "tx1" => "dk1",
                    "bg1" => "lt1",
                    "tx2" => "dk2",
                    "bg2" => "lt2",
                    other => other,
                };
                let i = SCHEME.iter().position(|s| *s == name)?;
                self.theme.get(i)?.clone()
            }
            "prstClr" => match el.attr("val")? {
                "black" => "000000",
                "white" => "FFFFFF",
                "red" => "FF0000",
                "green" => "008000",
                "blue" => "0000FF",
                "yellow" => "FFFF00",
                "gray" | "grey" => "808080",
                _ => return None,
            }
            .to_string(),
            _ => return None,
        };
        Some(transform(&hex, el)?)
    }
}

/// Apply `lumMod`/`lumOff`/`shade`/`tint`/`alpha` to `RRGGBB`.
fn transform(hex: &str, el: &XElement) -> Option<String> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let ch = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|v| v as f64 / 255.0);
    let (mut r, mut g, mut b, mut a) = (ch(0)?, ch(2)?, ch(4)?, 1.0);
    for t in el.elements() {
        let Some(v) = num(t, "val").map(|v| v as f64 / 100_000.0) else { continue };
        match t.local() {
            "lumMod" | "lumOff" => {
                let (hh, s, mut l) = to_hsl(r, g, b);
                if t.local() == "lumMod" {
                    l *= v;
                } else {
                    l += v;
                }
                (r, g, b) = from_hsl(hh, s, l.clamp(0.0, 1.0));
            }
            "shade" => (r, g, b) = (r * v, g * v, b * v),
            "tint" => (r, g, b) = (r * v + (1.0 - v), g * v + (1.0 - v), b * v + (1.0 - v)),
            "alpha" => a = v,
            _ => {}
        }
    }
    let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(if a >= 0.999 {
        format!("#{:02X}{:02X}{:02X}", byte(r), byte(g), byte(b))
    } else {
        format!("rgba({}, {}, {}, {})", byte(r), byte(g), byte(b), (a * 1000.0).round() / 1000.0)
    })
}

fn to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max - min < 1e-12 {
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

fn from_hsl(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s <= 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hue = |mut t: f64| {
        t = t.rem_euclid(1.0);
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
    (hue(h + 1.0 / 3.0), hue(h), hue(h - 1.0 / 3.0))
}
