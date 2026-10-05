//! `styles.xml`: `cellXfs` → flat [`CellStyle`]s (index = style id), and the
//! reverse for styles added while editing, which are *appended* so every
//! original index keeps its meaning.

use crate::model::{Align, Border, BorderSide, CellStyle, Color, Font};
use oel_opc::xml::{XDocument, XElement, XNode};

/// Built-in number formats (ECMA-376 §18.8.30) that files reference by id only.
pub fn builtin_num_fmt(id: u32) -> Option<&'static str> {
    Some(match id {
        0 => "General",
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        12 => "# ?/?",
        13 => "# ??/??",
        14 => "mm-dd-yy",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "m/d/yy h:mm",
        37 => "#,##0 ;(#,##0)",
        38 => "#,##0 ;[Red](#,##0)",
        39 => "#,##0.00;(#,##0.00)",
        40 => "#,##0.00;[Red](#,##0.00)",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        48 => "##0.0E+0",
        49 => "@",
        _ => return None,
    })
}

/// Excel's legacy indexed palette (`indexed="n"`).
const INDEXED: [&str; 64] = [
    "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000",
    "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF",
    "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00",
    "FFCC00", "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/// Theme colours in SpreadsheetML index order (lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink).
pub fn theme_colors(theme: Option<&XDocument>) -> Vec<String> {
    let fallback = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
    let mut out: Vec<String> = fallback.iter().map(|s| s.to_string()).collect();
    let Some(doc) = theme else { return out };
    let Some(scheme) = find_desc(&doc.root, "clrScheme") else { return out };
    let order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
    for (i, name) in order.iter().enumerate() {
        if let Some(e) = scheme.child_local(name) {
            let v = e
                .child_local("srgbClr")
                .and_then(|c| c.attr("val"))
                .or_else(|| e.child_local("sysClr").and_then(|c| c.attr("lastClr")))
                .map(|s| s.to_ascii_uppercase());
            if let Some(v) = v {
                out[i] = v;
            }
        }
    }
    out
}

/// The theme's body (minor) and heading (major) Latin fonts.
pub fn theme_fonts(theme: Option<&XDocument>) -> (Option<String>, Option<String>) {
    let Some(doc) = theme else { return (None, None) };
    let face = |which: &str| find_desc(&doc.root, which).and_then(|f| f.child_local("latin")).and_then(|l| l.attr("typeface")).filter(|t| !t.is_empty()).map(String::from);
    (face("minorFont"), face("majorFont"))
}

fn find_desc<'a>(e: &'a XElement, local: &str) -> Option<&'a XElement> {
    if e.local() == local {
        return Some(e);
    }
    e.elements().find_map(|c| find_desc(c, local))
}

fn hex_rgb(s: &str) -> Option<(f64, f64, f64)> {
    let s = s.trim_start_matches('#');
    let s = if s.len() == 8 { &s[2..] } else { s };
    if s.len() != 6 {
        return None;
    }
    let p = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).ok().map(|v| v as f64 / 255.0);
    Some((p(0)?, p(2)?, p(4)?))
}

fn to_hex(r: f64, g: f64, b: f64) -> String {
    let c = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02X}{:02X}{:02X}", c(r), c(g), c(b))
}

/// Excel's tint: shifts HSL luminance toward black (< 0) or white (> 0).
fn apply_tint(hex: &str, tint: f64) -> String {
    let Some((r, g, b)) = hex_rgb(hex) else { return format!("#{hex}") };
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let mut l = (max + min) / 2.0;
    let d = max - min;
    let (mut h, s) = if d == 0.0 {
        (0.0, 0.0)
    } else {
        let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
        let h = if max == r {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        (h / 6.0, s)
    };
    l = if tint < 0.0 { l * (1.0 + tint) } else { l * (1.0 - tint) + tint };
    if s == 0.0 {
        return to_hex(l, l, l);
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
    if h < 0.0 {
        h += 1.0;
    }
    to_hex(hue(h + 1.0 / 3.0), hue(h), hue(h - 1.0 / 3.0))
}

/// Read a `CT_Color` element; `None` for `auto` or an empty element.
pub fn read_color(e: &XElement, theme: &[String]) -> Option<Color> {
    if e.attr("auto") == Some("1") || e.attr("auto") == Some("true") {
        return None;
    }
    let tint = e.attr("tint").and_then(|t| t.parse::<f64>().ok()).filter(|t| *t != 0.0);
    let mut c = Color { tint, ..Default::default() };
    let base = if let Some(rgb) = e.attr("rgb") {
        c.rgb = Some(rgb.to_ascii_uppercase());
        let s = rgb.trim_start_matches('#');
        if s.len() == 8 { s[2..].to_ascii_uppercase() } else { s.to_ascii_uppercase() }
    } else if let Some(t) = e.attr("theme").and_then(|t| t.parse::<u32>().ok()) {
        c.theme = Some(t);
        theme.get(t as usize).cloned().unwrap_or_else(|| "000000".into())
    } else if let Some(i) = e.attr("indexed").and_then(|t| t.parse::<u32>().ok()) {
        c.indexed = Some(i);
        match i {
            64 => return None, // system foreground: automatic
            65 => "FFFFFF".into(),
            _ => INDEXED.get(i as usize).copied().unwrap_or("000000").to_string(),
        }
    } else {
        return None;
    };
    c.css = match tint {
        Some(t) => apply_tint(&base, t),
        None => format!("#{base}"),
    };
    Some(c)
}

/// Write a colour back: the original reference when there is one, else RGB.
pub fn color_el(name: &str, c: &Color) -> XElement {
    let mut e = XElement::new(name);
    if let Some(rgb) = &c.rgb {
        e.set_attr("rgb", rgb.clone());
    } else if let Some(t) = c.theme {
        e.set_attr("theme", t.to_string());
    } else if let Some(i) = c.indexed {
        e.set_attr("indexed", i.to_string());
    } else {
        e.set_attr("rgb", format!("FF{}", c.css.trim_start_matches('#').to_ascii_uppercase()));
    }
    if let Some(t) = c.tint {
        e.set_attr("tint", t.to_string());
    }
    e
}

fn flag(e: &XElement, name: &str) -> bool {
    match e.child_local(name) {
        Some(c) => !matches!(c.attr("val"), Some("0") | Some("false")),
        None => false,
    }
}

fn read_font(e: &XElement, theme: &[String]) -> Font {
    Font {
        name: e.child_local("name").and_then(|c| c.attr("val")).map(String::from),
        size: e.child_local("sz").and_then(|c| c.attr("val")).and_then(|v| v.parse().ok()),
        bold: flag(e, "b"),
        italic: flag(e, "i"),
        underline: e.child_local("u").map(|u| u.attr("val").unwrap_or("single").to_string()).filter(|u| u != "none"),
        strike: flag(e, "strike"),
        color: e.child_local("color").and_then(|c| read_color(c, theme)),
        vert_align: e.child_local("vertAlign").and_then(|c| c.attr("val")).filter(|v| *v != "baseline").map(String::from),
    }
}

fn read_fill(e: &XElement, theme: &[String]) -> Option<Color> {
    let p = e.child_local("patternFill")?;
    match p.attr("patternType") {
        None | Some("none") => None,
        Some("solid") => p.child_local("fgColor").and_then(|c| read_color(c, theme)),
        // Other patterns: show the foreground; the pattern itself is kept in the file.
        Some(_) => p.child_local("fgColor").or_else(|| p.child_local("bgColor")).and_then(|c| read_color(c, theme)),
    }
}

fn read_border(e: &XElement, theme: &[String]) -> Border {
    let side = |name: &str| {
        let s = e.child_local(name)?;
        let style = s.attr("style")?;
        (style != "none").then(|| BorderSide { style: style.to_string(), color: s.child_local("color").and_then(|c| read_color(c, theme)) })
    };
    Border { left: side("left").or_else(|| side("start")), right: side("right").or_else(|| side("end")), top: side("top"), bottom: side("bottom") }
}

/// Everything decoded from `styles.xml`.
pub struct StyleTable {
    pub styles: Vec<CellStyle>,
    pub dxfs: Vec<CellStyle>,
}

pub fn read_styles(doc: Option<&XDocument>, theme: &[String]) -> StyleTable {
    let Some(doc) = doc else {
        return StyleTable { styles: vec![CellStyle { num_fmt: "General".into(), locked: true, ..Default::default() }], dxfs: Vec::new() };
    };
    let root = &doc.root;
    let mut num_fmts = std::collections::HashMap::new();
    if let Some(nf) = root.child_local("numFmts") {
        for e in nf.elements() {
            if let (Some(id), Some(code)) = (e.attr("numFmtId").and_then(|v| v.parse::<u32>().ok()), e.attr("formatCode")) {
                num_fmts.insert(id, code.to_string());
            }
        }
    }
    let fmt = |id: u32| num_fmts.get(&id).cloned().or_else(|| builtin_num_fmt(id).map(String::from)).unwrap_or_else(|| "General".into());
    let fonts: Vec<Font> = root.child_local("fonts").map(|f| f.elements().map(|e| read_font(e, theme)).collect()).unwrap_or_default();
    let fills: Vec<Option<Color>> = root.child_local("fills").map(|f| f.elements().map(|e| read_fill(e, theme)).collect()).unwrap_or_default();
    let borders: Vec<Border> = root.child_local("borders").map(|f| f.elements().map(|e| read_border(e, theme)).collect()).unwrap_or_default();
    let idx = |e: &XElement, a: &str| e.attr(a).and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);

    let mut styles: Vec<CellStyle> = root
        .child_local("cellXfs")
        .map(|x| {
            x.elements()
                .filter(|e| e.local() == "xf")
                .map(|xf| {
                    let al = xf.child_local("alignment");
                    let a = |n: &str| al.and_then(|a| a.attr(n));
                    CellStyle {
                        num_fmt: fmt(idx(xf, "numFmtId") as u32),
                        font: fonts.get(idx(xf, "fontId")).cloned().unwrap_or_default(),
                        fill: fills.get(idx(xf, "fillId")).cloned().flatten(),
                        border: borders.get(idx(xf, "borderId")).cloned().unwrap_or_default(),
                        align: Align {
                            h: a("horizontal").filter(|v| *v != "general").map(String::from),
                            v: a("vertical").filter(|v| *v != "bottom").map(String::from),
                            wrap: matches!(a("wrapText"), Some("1") | Some("true")),
                            indent: a("indent").and_then(|v| v.parse().ok()).unwrap_or(0),
                            rotation: a("textRotation").and_then(|v| v.parse().ok()).unwrap_or(0),
                            shrink: matches!(a("shrinkToFit"), Some("1") | Some("true")),
                        },
                        locked: !matches!(xf.child_local("protection").and_then(|p| p.attr("locked")), Some("0") | Some("false")),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    if styles.is_empty() {
        styles.push(CellStyle { num_fmt: "General".into(), locked: true, ..Default::default() });
    }
    let dxfs = root
        .child_local("dxfs")
        .map(|d| {
            d.elements()
                .map(|e| CellStyle {
                    num_fmt: e.child_local("numFmt").and_then(|n| n.attr("formatCode")).unwrap_or("General").to_string(),
                    font: e.child_local("font").map(|f| read_font(f, theme)).unwrap_or_default(),
                    // dxf fills put the colour in bgColor for solid patterns.
                    fill: e.child_local("fill").and_then(|f| f.child_local("patternFill")).and_then(|p| p.child_local("bgColor").or_else(|| p.child_local("fgColor"))).and_then(|c| read_color(c, theme)),
                    border: e.child_local("border").map(|b| read_border(b, theme)).unwrap_or_default(),
                    align: Align::default(),
                    locked: true,
                })
                .collect()
        })
        .unwrap_or_default();
    StyleTable { styles, dxfs }
}

fn font_el(f: &Font) -> XElement {
    let mut e = XElement::new("font");
    let mut push = |c: XElement| e.children.push(XNode::Element(c));
    if f.bold {
        push(XElement::new("b"));
    }
    if f.italic {
        push(XElement::new("i"));
    }
    if f.strike {
        push(XElement::new("strike"));
    }
    if let Some(u) = &f.underline {
        let mut u_el = XElement::new("u");
        if u != "single" {
            u_el.set_attr("val", u.clone());
        }
        push(u_el);
    }
    if let Some(v) = &f.vert_align {
        push(XElement::new("vertAlign").with_attr("val", v.clone()));
    }
    push(XElement::new("sz").with_attr("val", fmt_num(f.size.unwrap_or(11.0))));
    // No colour element = automatic (black), valid with or without a theme part.
    if let Some(c) = &f.color {
        push(color_el("color", c));
    }
    push(XElement::new("name").with_attr("val", f.name.clone().unwrap_or_else(|| "Calibri".into())));
    push(XElement::new("family").with_attr("val", "2"));
    e
}

fn fill_el(c: &Option<Color>) -> XElement {
    let mut p = XElement::new("patternFill");
    match c {
        Some(c) => {
            p.set_attr("patternType", "solid");
            p.children.push(XNode::Element(color_el("fgColor", c)));
            p.children.push(XNode::Element(XElement::new("bgColor").with_attr("indexed", "64")));
        }
        None => p.set_attr("patternType", "none"),
    }
    let mut f = XElement::new("fill");
    f.children.push(XNode::Element(p));
    f
}

fn border_el(b: &Border) -> XElement {
    let mut e = XElement::new("border");
    for (name, side) in [("left", &b.left), ("right", &b.right), ("top", &b.top), ("bottom", &b.bottom)] {
        let mut s = XElement::new(name);
        if let Some(side) = side {
            s.set_attr("style", side.style.clone());
            if let Some(c) = &side.color {
                s.children.push(XNode::Element(color_el("color", c)));
            } else {
                s.children.push(XNode::Element(XElement::new("color").with_attr("indexed", "64")));
            }
        }
        e.children.push(XNode::Element(s));
    }
    e.children.push(XNode::Element(XElement::new("diagonal")));
    e
}

pub fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e15 { format!("{}", v as i64) } else { format!("{v}") }
}

fn ensure_list<'a>(root: &'a mut XElement, name: &str, before: &[&str]) -> &'a mut XElement {
    if root.child_local(name).is_none() {
        let pos = root
            .children
            .iter()
            .position(|n| matches!(n, XNode::Element(e) if before.contains(&e.local())))
            .unwrap_or(root.children.len());
        let mut list = XElement::new(name).with_attr("count", "0");
        list.apply_prefix(root.prefix().map(String::from).as_deref());
        root.children.insert(pos, XNode::Element(list));
    }
    root.child_local_mut(name).unwrap()
}

fn push_counted(list: &mut XElement, mut e: XElement) -> usize {
    let n = list.elements().count();
    e.apply_prefix(list.prefix().map(String::from).as_deref());
    list.children.push(XNode::Element(e));
    list.set_attr("count", (n + 1).to_string());
    n
}

/// Append styles `[base..]` to `styles.xml` (fonts, fills, borders, numFmts
/// and xfs are always new entries; existing ones are never rewritten).
pub fn append_styles(doc: &mut XDocument, styles: &[CellStyle], base: usize) {
    if styles.len() <= base {
        return;
    }
    const ORDER: [&str; 10] = ["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors"];
    let after = |name: &str| -> Vec<&'static str> { ORDER.iter().skip_while(|n| **n != name).skip(1).copied().chain(["extLst"]).collect() };
    let root = &mut doc.root;

    // Existing custom number formats, by code.
    let mut codes: Vec<(String, u32)> = root
        .child_local("numFmts")
        .map(|nf| nf.elements().filter_map(|e| Some((e.attr("formatCode")?.to_string(), e.attr("numFmtId")?.parse().ok()?))).collect())
        .unwrap_or_default();
    let mut next_fmt = codes.iter().map(|(_, id)| *id + 1).max().unwrap_or(164).max(164);

    for st in &styles[base..] {
        let num_fmt_id = match (0..50).find(|id| builtin_num_fmt(*id) == Some(st.num_fmt.as_str())) {
            Some(id) => id,
            None => match codes.iter().find(|(c, _)| *c == st.num_fmt) {
                Some((_, id)) => *id,
                None => {
                    let id = next_fmt;
                    next_fmt += 1;
                    let list = ensure_list(root, "numFmts", &after("numFmts"));
                    push_counted(list, XElement::new("numFmt").with_attr("numFmtId", id.to_string()).with_attr("formatCode", st.num_fmt.clone()));
                    codes.push((st.num_fmt.clone(), id));
                    id
                }
            },
        };
        let font_id = push_counted(ensure_list(root, "fonts", &after("fonts")), font_el(&st.font));
        let fill_id = push_counted(ensure_list(root, "fills", &after("fills")), fill_el(&st.fill));
        let border_id = push_counted(ensure_list(root, "borders", &after("borders")), border_el(&st.border));
        let mut xf = XElement::new("xf")
            .with_attr("numFmtId", num_fmt_id.to_string())
            .with_attr("fontId", font_id.to_string())
            .with_attr("fillId", fill_id.to_string())
            .with_attr("borderId", border_id.to_string())
            .with_attr("xfId", "0");
        if num_fmt_id != 0 {
            xf.set_attr("applyNumberFormat", "1");
        }
        xf.set_attr("applyFont", "1");
        xf.set_attr("applyFill", "1");
        xf.set_attr("applyBorder", "1");
        let a = &st.align;
        if a.h.is_some() || a.v.is_some() || a.wrap || a.indent > 0 || a.rotation > 0 || a.shrink {
            xf.set_attr("applyAlignment", "1");
            let mut al = XElement::new("alignment");
            if let Some(h) = &a.h {
                al.set_attr("horizontal", h.clone());
            }
            if let Some(v) = &a.v {
                al.set_attr("vertical", v.clone());
            }
            if a.wrap {
                al.set_attr("wrapText", "1");
            }
            if a.indent > 0 {
                al.set_attr("indent", a.indent.to_string());
            }
            if a.rotation > 0 {
                al.set_attr("textRotation", a.rotation.to_string());
            }
            if a.shrink {
                al.set_attr("shrinkToFit", "1");
            }
            xf.children.push(XNode::Element(al));
        }
        if !st.locked {
            xf.set_attr("applyProtection", "1");
            xf.children.push(XNode::Element(XElement::new("protection").with_attr("locked", "0")));
        }
        push_counted(ensure_list(root, "cellXfs", &after("cellXfs")), xf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tint() {
        // Excel: theme accent1 4472C4 at tint 0.3999 ≈ 8EA9DB.
        assert_eq!(apply_tint("4472C4", 0.3999755851924192), "#8FAADC");
        assert_eq!(apply_tint("FFFFFF", -0.1499984740745262), "#D9D9D9");
    }
}
