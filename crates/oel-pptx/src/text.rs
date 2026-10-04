//! Text bodies (`p:txBody`, `a:txBody`): paragraphs and runs with their
//! explicit properties, the inherited defaults per outline level, and the
//! text-box properties through the placeholder chain.
//!
//! PowerPoint's inheritance for a paragraph, weakest first: the presentation's
//! `defaultTextStyle`, the master's `titleStyle` / `bodyStyle` / `otherStyle`
//! (by placeholder kind), the master placeholder's `a:lstStyle`, the layout
//! placeholder's, the shape style's font reference, then the shape's own list
//! style; the paragraph's `a:pPr` and the run's `a:rPr` come last.

use crate::model::{BodyProps, Bullet, Level, Para, ParaProps, Run, RunProps, Spacing, TextBody};
use crate::theme::{ColorCtx, num};
use oel_opc::xml::XElement;

/// Levels a body carries: the deepest it uses plus one (to indent), at least one.
pub fn level_count(tx: Option<&XElement>, all: bool) -> usize {
    if all {
        return 9;
    }
    let deepest = tx
        .into_iter()
        .flat_map(|t| t.children_local("p"))
        .filter_map(|p| p.child_local("pPr").and_then(|pp| num(pp, "lvl")))
        .fold(0.0_f64, f64::max) as usize;
    (deepest + 2).min(9)
}

pub fn default_level() -> Level {
    Level {
        size: 18.0,
        font: "+mn-lt".into(),
        color: "#000000".into(),
        bold: false,
        italic: false,
        underline: "none".into(),
        strike: "noStrike".into(),
        caps: "none".into(),
        spacing: 0.0,
        align: "l".into(),
        mar_l: 0,
        indent: 0,
        line: Spacing { pct: Some(1.0), pts: None },
        before: Spacing { pct: None, pts: Some(0.0) },
        after: Spacing { pct: None, pts: Some(0.0) },
        bullet: Bullet { kind: "none".into(), ..Default::default() },
    }
}

fn on(v: &str) -> bool {
    matches!(v, "1" | "true" | "on")
}

fn spacing(el: &XElement) -> Option<Spacing> {
    if let Some(p) = el.child_local("spcPct") {
        return Some(Spacing { pct: num(p, "val").map(|v| v / 100_000.0), pts: None });
    }
    el.child_local("spcPts").map(|p| Spacing { pct: None, pts: num(p, "val").map(|v| v / 100.0) })
}

/// Bullet fields a `a:lvlNpPr` / `a:pPr` sets (`kind` empty when it sets none).
pub fn bullet_of(el: &XElement, cc: &ColorCtx) -> Option<Bullet> {
    let mut b = Bullet::default();
    let mut any = false;
    for c in el.elements() {
        match c.local() {
            "buNone" => (b.kind, any) = ("none".into(), true),
            "buChar" => {
                b.kind = "char".into();
                b.char = c.attr("char").map(String::from);
                any = true;
            }
            "buBlip" => {
                b.kind = "char".into();
                b.char = Some("•".into());
                any = true;
            }
            "buAutoNum" => {
                b.kind = "auto".into();
                b.scheme = c.attr("type").map(String::from);
                b.start = num(c, "startAt").map(|v| v as u32);
                any = true;
            }
            "buFont" => (b.font, any) = (c.attr("typeface").map(String::from), true),
            "buFontTx" => (b.font, any) = (Some(String::new()), true),
            "buClr" => (b.color, any) = (cc.child_css(c), true),
            "buClrTx" => (b.color, any) = (Some(String::new()), true),
            "buSzPct" => (b.size, any) = (num(c, "val").map(|v| v / 100_000.0), true),
            "buSzTx" => (b.size, any) = (Some(1.0), true),
            _ => {}
        }
    }
    any.then_some(b)
}

/// Overlay set bullet fields (empty strings reset a field to « follow the text »).
pub fn merge_bullet(base: &mut Bullet, over: &Bullet) {
    if !over.kind.is_empty() {
        base.kind = over.kind.clone();
        base.char = over.char.clone().or(base.char.take());
        base.scheme = over.scheme.clone().or(base.scheme.take());
        base.start = over.start.or(base.start);
    }
    for (slot, v) in [(&mut base.font, &over.font), (&mut base.color, &over.color)] {
        match v.as_deref() {
            Some("") => *slot = None,
            Some(x) => *slot = Some(x.to_string()),
            None => {}
        }
    }
    if over.size.is_some() {
        base.size = over.size;
    }
}

/// Run defaults of a `a:defRPr` / `a:rPr` onto a level.
fn apply_rpr(level: &mut Level, r: &XElement, cc: &ColorCtx, typeface: &dyn Fn(&str) -> String) {
    let p = run_props(r, cc, &|_| None);
    if let Some(v) = p.size {
        level.size = v;
    }
    if let Some(v) = p.bold {
        level.bold = v;
    }
    if let Some(v) = p.italic {
        level.italic = v;
    }
    if let Some(v) = p.underline {
        level.underline = v;
    }
    if let Some(v) = p.strike {
        level.strike = v;
    }
    if let Some(v) = p.caps {
        level.caps = v;
    }
    if let Some(v) = p.spacing {
        level.spacing = v;
    }
    if let Some(v) = p.color {
        level.color = v;
    }
    if let Some(v) = p.font {
        level.font = typeface(&v);
    }
}

/// One `a:lvlNpPr` (or `a:defPPr`) onto a level.
pub fn apply_level(level: &mut Level, el: &XElement, cc: &ColorCtx, typeface: &dyn Fn(&str) -> String) {
    if let Some(v) = el.attr("algn") {
        level.align = v.to_string();
    }
    if let Some(v) = num(el, "marL") {
        level.mar_l = v as i64;
    }
    if let Some(v) = num(el, "indent") {
        level.indent = v as i64;
    }
    for (name, slot) in [("lnSpc", &mut level.line), ("spcBef", &mut level.before), ("spcAft", &mut level.after)] {
        if let Some(s) = el.child_local(name).and_then(spacing) {
            *slot = s;
        }
    }
    if let Some(b) = bullet_of(el, cc) {
        merge_bullet(&mut level.bullet, &b);
    }
    if let Some(r) = el.child_local("defRPr") {
        apply_rpr(level, r, cc, typeface);
    }
}

/// Inherited levels from a chain of list styles (weakest first). `font_ref` is a
/// shape style's `a:fontRef` (typeface, colour), applied after the master's styles.
pub fn levels(chain: &[&XElement], font_ref: Option<(String, Option<String>)>, font_ref_at: usize, n: usize, cc: &ColorCtx, typeface: &dyn Fn(&str) -> String) -> Vec<Level> {
    (0..n)
        .map(|i| {
            let mut level = default_level();
            let name = format!("lvl{}pPr", i + 1);
            for (k, layer) in chain.iter().enumerate() {
                if k == font_ref_at
                    && let Some((face, color)) = &font_ref
                {
                    level.font = typeface(face);
                    if let Some(c) = color {
                        level.color = c.clone();
                    }
                }
                if let Some(d) = layer.child_local("defPPr") {
                    apply_level(&mut level, d, cc, typeface);
                }
                if let Some(l) = layer.child_local(&name) {
                    apply_level(&mut level, l, cc, typeface);
                }
            }
            if font_ref_at >= chain.len()
                && let Some((face, color)) = &font_ref
            {
                level.font = typeface(face);
                if let Some(c) = color {
                    level.color = c.clone();
                }
            }
            level.font = typeface(&level.font);
            level
        })
        .collect()
}

/// Explicit run properties of an `a:rPr` / `a:endParaRPr` / `a:defRPr`.
pub fn run_props(r: &XElement, cc: &ColorCtx, link: &dyn Fn(&str) -> Option<String>) -> RunProps {
    let fill = r.elements().find(|e| matches!(e.local(), "solidFill" | "gradFill" | "noFill"));
    let color = fill.and_then(|f| match f.local() {
        "solidFill" => cc.child_css(f),
        "gradFill" => f.child_local("gsLst").and_then(|l| l.elements().next()).and_then(|gs| cc.child_css(gs)),
        _ => Some("transparent".into()),
    });
    RunProps {
        bold: r.attr("b").map(on),
        italic: r.attr("i").map(on),
        underline: r.attr("u").map(String::from),
        strike: r.attr("strike").map(String::from),
        size: num(r, "sz").map(|v| v / 100.0),
        color,
        font: r.child_local("latin").and_then(|l| l.attr("typeface")).filter(|f| !f.is_empty()).map(String::from),
        baseline: num(r, "baseline").map(|v| v / 1000.0),
        caps: r.attr("cap").map(String::from),
        spacing: num(r, "spc").map(|v| v / 100.0),
        highlight: r.child_local("highlight").and_then(|h| cc.child_css(h)),
        link: r.child_local("hlinkClick").and_then(|h| h.attr("r:id")).and_then(link),
        xml: None,
    }
}

/// Explicit paragraph properties of an `a:pPr`.
pub fn para_props(p: &XElement, cc: &ColorCtx) -> ParaProps {
    ParaProps {
        align: p.attr("algn").map(String::from),
        mar_l: num(p, "marL").map(|v| v as i64),
        indent: num(p, "indent").map(|v| v as i64),
        line: p.child_local("lnSpc").and_then(spacing),
        before: p.child_local("spcBef").and_then(spacing),
        after: p.child_local("spcAft").and_then(spacing),
        bullet: bullet_of(p, cc),
        xml: Some(p.to_xml()),
    }
}

/// The paragraphs of a text body.
pub fn paras(tx: &XElement, cc: &ColorCtx, link: &dyn Fn(&str) -> Option<String>) -> Vec<Para> {
    tx.children_local("p")
        .map(|p| {
            let ppr = p.child_local("pPr");
            let mut runs = Vec::new();
            for c in p.elements() {
                let rp = |r: Option<&XElement>| {
                    r.map(|r| {
                        let mut props = run_props(r, cc, link);
                        props.xml = Some(r.to_xml());
                        props
                    })
                    .unwrap_or_default()
                };
                match c.local() {
                    "r" => runs.push(Run { kind: "text".into(), text: c.child_local("t").map(|t| t.text_content()).unwrap_or_default(), props: rp(c.child_local("rPr")), ..Default::default() }),
                    "br" => runs.push(Run { kind: "br".into(), props: rp(c.child_local("rPr")), ..Default::default() }),
                    "fld" => runs.push(Run {
                        kind: "field".into(),
                        text: c.child_local("t").map(|t| t.text_content()).unwrap_or_default(),
                        field: c.attr("type").map(String::from),
                        field_id: c.attr("id").map(String::from),
                        props: rp(c.child_local("rPr")),
                    }),
                    _ => {}
                }
            }
            let end = p
                .child_local("endParaRPr")
                .map(|r| {
                    let mut props = run_props(r, cc, link);
                    props.xml = Some(r.to_xml());
                    props
                })
                .unwrap_or_default();
            Para { lvl: ppr.and_then(|pp| num(pp, "lvl")).unwrap_or(0.0).clamp(0.0, 8.0) as u8, props: ppr.map(|pp| para_props(pp, cc)).unwrap_or_default(), runs, end }
        })
        .collect()
}

pub fn default_body() -> BodyProps {
    BodyProps {
        anchor: "t".into(),
        anchor_ctr: false,
        l: 91_440,
        t: 45_720,
        r: 91_440,
        b: 45_720,
        wrap: true,
        autofit: "none".into(),
        font_scale: 1.0,
        line_reduction: 0.0,
        vert: "horz".into(),
        cols: None,
    }
}

/// `a:bodyPr` layers (weakest first) → effective text-box properties.
pub fn body_props(chain: &[&XElement]) -> BodyProps {
    let mut b = default_body();
    for e in chain {
        if let Some(v) = e.attr("anchor") {
            b.anchor = v.to_string();
        }
        if let Some(v) = e.attr("anchorCtr") {
            b.anchor_ctr = on(v);
        }
        for (k, slot) in [("lIns", &mut b.l), ("tIns", &mut b.t), ("rIns", &mut b.r), ("bIns", &mut b.b)] {
            if let Some(v) = num(e, k) {
                *slot = v as i64;
            }
        }
        if let Some(v) = e.attr("wrap") {
            b.wrap = v != "none";
        }
        if let Some(v) = e.attr("vert") {
            b.vert = v.to_string();
        }
        if let Some(v) = num(e, "numCol") {
            b.cols = Some(v as u32).filter(|c| *c > 1);
        }
        if e.child_local("noAutofit").is_some() {
            (b.autofit, b.font_scale, b.line_reduction) = ("none".into(), 1.0, 0.0);
        }
        if let Some(n) = e.child_local("normAutofit") {
            b.autofit = "norm".into();
            b.font_scale = num(n, "fontScale").map(|v| v / 100_000.0).unwrap_or(1.0);
            b.line_reduction = num(n, "lnSpcReduction").map(|v| v / 100_000.0).unwrap_or(0.0);
        }
        if e.child_local("spAutoFit").is_some() {
            (b.autofit, b.font_scale, b.line_reduction) = ("shape".into(), 1.0, 0.0);
        }
    }
    b
}

/// Plain text of a body: paragraphs joined by `\n` (line breaks become spaces).
pub fn plain_text(tx: &XElement) -> String {
    tx.children_local("p")
        .map(|p| {
            p.elements()
                .map(|c| match c.local() {
                    "r" | "fld" => c.child_local("t").map(|t| t.text_content()).unwrap_or_default(),
                    "br" => " ".into(),
                    _ => String::new(),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// A text body, ready for the editor.
pub fn text_body(body: BodyProps, levels: Vec<Level>, paras: Vec<Para>, prompt: Option<String>) -> TextBody {
    TextBody { body, levels, paras, prompt }
}
