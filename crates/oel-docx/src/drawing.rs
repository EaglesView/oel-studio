//! Floating objects (`wp:anchor`): pictures, shapes (`wps:wsp`), text boxes
//! and groups (`wpg:wgp`) → the `anchor` node. Fills and lines are resolved
//! to CSS with the theme; text boxes are read with the block reader. The
//! original run is kept as `xml` and written back while nothing changed.

use super::read::{ReadCtx, read_blocks};
use super::xml::XElement;
use serde_json::{Map, Value, json};

fn num(e: &XElement, k: &str) -> Option<i64> {
    e.attr(k).and_then(|v| v.parse::<f64>().ok()).map(|v| v as i64)
}

/// Whether a `w:drawing` holds a floating object.
pub fn is_anchor(drawing: &XElement) -> bool {
    drawing.elements().next().is_some_and(|w| w.name == "wp:anchor")
}

/// The `w:drawing` of an `mc:AlternateContent` choice we understand (Word 2010 shapes and groups).
pub fn understood_choice(ac: &XElement) -> Option<&XElement> {
    ac.elements()
        .filter(|c| c.name == "mc:Choice")
        .find(|c| c.attr("Requires").is_some_and(|r| r.split_whitespace().all(|p| matches!(p, "wps" | "wpg" | "wp14" | "a14"))))
        .and_then(|c| c.find("w:drawing"))
        .filter(|d| is_anchor(d))
}

fn position(anchor: &XElement) -> Value {
    let simple = matches!(anchor.attr("simplePos"), Some("1" | "true"));
    let axis = |tag: &str| -> (String, Option<i64>, Option<String>) {
        let p = anchor.child(tag);
        let rel = p.and_then(|p| p.attr("relativeFrom")).unwrap_or(if tag.ends_with('H') { "column" } else { "paragraph" }).to_string();
        let off = p.and_then(|p| p.child("wp:posOffset")).and_then(|o| o.text_content().trim().parse::<i64>().ok());
        let align = p.and_then(|p| p.child("wp:align")).map(|a| a.text_content().trim().to_string());
        (rel, off, align)
    };
    let (rel_h, h, align_h) = axis("wp:positionH");
    let (rel_v, v, align_v) = axis("wp:positionV");
    if simple {
        let sp = anchor.child("wp:simplePos");
        return json!({ "relH": "page", "h": sp.and_then(|s| num(s, "x")).unwrap_or(0), "alignH": null, "relV": "page", "v": sp.and_then(|s| num(s, "y")).unwrap_or(0), "alignV": null });
    }
    json!({ "relH": rel_h, "h": if align_h.is_some() { None } else { Some(h.unwrap_or(0)) }, "alignH": align_h, "relV": rel_v, "v": if align_v.is_some() { None } else { Some(v.unwrap_or(0)) }, "alignV": align_v })
}

/// A CSS fill from a shape's properties (`spPr`), falling back to its style's `fillRef`.
fn fill_css(ctx: &mut ReadCtx, sp_pr: Option<&XElement>, style: Option<&XElement>) -> (Option<String>, Option<Value>) {
    let theme = &ctx.styles.theme;
    if let Some(sp) = sp_pr {
        for f in sp.elements() {
            match f.name.as_str() {
                "a:noFill" => return (None, None),
                "a:solidFill" => return (theme.resolve_child(f), None),
                "a:gradFill" => {
                    let stops: Vec<String> = f
                        .child("a:gsLst")
                        .into_iter()
                        .flat_map(|l| l.elements())
                        .filter_map(|gs| Some(format!("{} {}%", theme.resolve_child(gs)?, num(gs, "pos").unwrap_or(0) as f64 / 1000.0)))
                        .collect();
                    if stops.is_empty() {
                        return (None, None);
                    }
                    let angle = f.child("a:lin").and_then(|l| num(l, "ang")).map(|a| a as f64 / 60000.0).unwrap_or(0.0);
                    let css = if f.child("a:path").is_some() { format!("radial-gradient({})", stops.join(", ")) } else { format!("linear-gradient({}deg, {})", angle + 90.0, stops.join(", ")) };
                    return (Some(css), None);
                }
                "a:blipFill" => return (None, picture_fill(ctx, f)),
                "a:pattFill" => return (f.child("a:fgClr").and_then(|c| theme.resolve_child(c)), None),
                _ => {}
            }
        }
    }
    // No fill of its own: the theme fill the shape style points at (phClr = the ref's colour).
    let r = style.and_then(|s| s.child("a:fillRef")).filter(|r| num(r, "idx").unwrap_or(0) > 0);
    (r.and_then(|r| theme.resolve_child(r)), None)
}

fn line_css(ctx: &ReadCtx, sp_pr: Option<&XElement>, style: Option<&XElement>) -> Option<String> {
    let theme = &ctx.styles.theme;
    let ln = sp_pr.and_then(|s| s.child("a:ln"));
    let width = ln.and_then(|l| num(l, "w")).map(|w| w as f64 / 12700.0);
    let dash = ln.and_then(|l| l.child("a:prstDash")).and_then(|d| d.attr("val")).map(|v| if v.contains("ot") && !v.contains("ash") { "dotted" } else if v == "solid" { "solid" } else { "dashed" }).unwrap_or("solid");
    let color = match ln {
        Some(l) if l.child("a:noFill").is_some() => return None,
        Some(l) => l.child("a:solidFill").and_then(|f| theme.resolve_child(f)),
        None => None,
    };
    let color = color.or_else(|| style.and_then(|s| s.child("a:lnRef")).filter(|r| num(r, "idx").unwrap_or(0) > 0).and_then(|r| theme.resolve_child(r)))?;
    Some(format!("{}pt {dash} {color}", (width.unwrap_or(0.75) * 100.0).round() / 100.0))
}

fn picture_fill(ctx: &mut ReadCtx, blip_fill: &XElement) -> Option<Value> {
    let rid = blip_fill.child("a:blip").and_then(|b| b.attr("r:embed"))?;
    let (path, external) = ctx.rel_target_pub(rid)?;
    if external {
        return None;
    }
    ctx.media.insert(path.clone());
    let crop = blip_fill.child("a:srcRect").and_then(|r| {
        let f = |k: &str| num(r, k).unwrap_or(0) as f64 / 100_000.0;
        let c = json!({ "l": f("l"), "t": f("t"), "r": f("r"), "b": f("b") });
        if ["l", "t", "r", "b"].iter().all(|k| c[k] == 0.0) { None } else { Some(c) }
    });
    Some(json!({ "path": path, "src": format!("media:{path}"), "tile": blip_fill.child("a:tile").is_some(), "crop": crop }))
}

/// Look of one `wps:wsp` or `pic:pic`.
fn shape_look(ctx: &mut ReadCtx, el: &XElement) -> Value {
    let (sp_pr, style) = match el.name.as_str() {
        "pic:pic" => (el.child("pic:spPr"), None),
        _ => (el.child("wps:spPr"), el.child("wps:style")),
    };
    let xfrm = sp_pr.and_then(|s| s.child("a:xfrm"));
    let geometry = sp_pr.and_then(|s| s.child("a:prstGeom")).and_then(|g| g.attr("prst")).map(String::from);
    let (mut fill, mut picture) = fill_css(ctx, sp_pr, style);
    if el.name == "pic:pic" {
        picture = el.child("pic:blipFill").and_then(|b| picture_fill(ctx, b));
        fill = None;
    }
    let line = line_css(ctx, sp_pr, style);
    let text = el.child("wps:txbx").and_then(|t| t.child("w:txbxContent")).map(|content| {
        let blocks = read_blocks(ctx, content);
        let body = el.child("wps:bodyPr");
        let ins = |k: &str, d: i64| body.and_then(|b| num(b, k)).unwrap_or(d);
        json!({
            "doc": { "type": "doc", "content": blocks },
            "insets": { "l": ins("lIns", 91440), "t": ins("tIns", 45720), "r": ins("rIns", 91440), "b": ins("bIns", 45720) },
            "anchor": body.and_then(|b| b.attr("anchor")).unwrap_or("t"),
        })
    });
    json!({
        "geometry": geometry,
        "rotation": xfrm.and_then(|x| num(x, "rot")).map(|r| r as f64 / 60000.0).unwrap_or(0.0),
        "flipH": xfrm.is_some_and(|x| matches!(x.attr("flipH"), Some("1" | "true"))),
        "flipV": xfrm.is_some_and(|x| matches!(x.attr("flipV"), Some("1" | "true"))),
        "fill": fill,
        "line": line,
        "picture": picture,
        "text": text,
    })
}

/// Members of a group, flattened into the outer group's box (EMU).
fn group_children(ctx: &mut ReadCtx, group: &XElement, outer: (f64, f64, f64, f64, f64, f64), out: &mut Vec<Value>) {
    // outer = (offset x, y in the anchor box, scale x, y, child origin x, y)
    let (ox, oy, sx, sy, cx0, cy0) = outer;
    for c in group.elements() {
        let sp_pr = c.child("wps:spPr").or_else(|| c.child("pic:spPr")).or_else(|| c.child("wpg:grpSpPr"));
        let Some(x) = sp_pr.and_then(|s| s.child("a:xfrm")) else { continue };
        let off = x.child("a:off");
        let ext = x.child("a:ext");
        let px = off.and_then(|o| num(o, "x")).unwrap_or(0) as f64;
        let py = off.and_then(|o| num(o, "y")).unwrap_or(0) as f64;
        let w = ext.and_then(|e| num(e, "cx")).unwrap_or(0) as f64;
        let h = ext.and_then(|e| num(e, "cy")).unwrap_or(0) as f64;
        let (ax, ay) = (ox + (px - cx0) * sx, oy + (py - cy0) * sy);
        match c.name.as_str() {
            "wps:wsp" | "pic:pic" => out.push(json!({ "x": ax.round() as i64, "y": ay.round() as i64, "cx": (w * sx).round() as i64, "cy": (h * sy).round() as i64, "shape": shape_look(ctx, c) })),
            "wpg:grpSp" => {
                let ch_off = x.child("a:chOff");
                let ch_ext = x.child("a:chExt");
                let cw = ch_ext.and_then(|e| num(e, "cx")).unwrap_or(w as i64).max(1) as f64;
                let chh = ch_ext.and_then(|e| num(e, "cy")).unwrap_or(h as i64).max(1) as f64;
                let inner = (ax, ay, sx * w / cw, sy * h / chh, ch_off.and_then(|o| num(o, "x")).unwrap_or(0) as f64, ch_off.and_then(|o| num(o, "y")).unwrap_or(0) as f64);
                group_children(ctx, c, inner, out);
            }
            _ => {}
        }
    }
}

/// `anchor` node attrs for a `w:drawing` holding a `wp:anchor`; `xml` is the run to write back.
pub fn read_anchor(ctx: &mut ReadCtx, drawing: &XElement, xml: String) -> Option<Map<String, Value>> {
    let a = drawing.child("wp:anchor")?;
    let data = a.child("a:graphic").and_then(|g| g.child("a:graphicData"))?;
    let obj = data.elements().next()?;
    let extent = a.child("wp:extent");
    let (cx, cy) = (extent.and_then(|e| num(e, "cx")).unwrap_or(0), extent.and_then(|e| num(e, "cy")).unwrap_or(0));
    let mut children = Vec::new();
    let (kind, shape) = match obj.name.as_str() {
        "pic:pic" => ("picture", shape_look(ctx, obj)),
        "wps:wsp" => (if obj.child("wps:txbx").is_some() { "textbox" } else { "shape" }, shape_look(ctx, obj)),
        "wpg:wgp" => {
            let x = obj.child("wpg:grpSpPr").and_then(|s| s.child("a:xfrm"));
            let ext = x.and_then(|x| x.child("a:ext"));
            let ch_ext = x.and_then(|x| x.child("a:chExt"));
            let ch_off = x.and_then(|x| x.child("a:chOff"));
            let w = ext.and_then(|e| num(e, "cx")).unwrap_or(cx) as f64;
            let h = ext.and_then(|e| num(e, "cy")).unwrap_or(cy) as f64;
            let cw = ch_ext.and_then(|e| num(e, "cx")).unwrap_or(w as i64).max(1) as f64;
            let chh = ch_ext.and_then(|e| num(e, "cy")).unwrap_or(h as i64).max(1) as f64;
            // The group's own box is the anchor's extent.
            let scale = (cx as f64 / w.max(1.0), cy as f64 / h.max(1.0));
            let frame = (0.0, 0.0, scale.0 * w / cw, scale.1 * h / chh, ch_off.and_then(|o| num(o, "x")).unwrap_or(0) as f64, ch_off.and_then(|o| num(o, "y")).unwrap_or(0) as f64);
            group_children(ctx, obj, frame, &mut children);
            let rot = x.and_then(|x| num(x, "rot")).map(|r| r as f64 / 60000.0).unwrap_or(0.0);
            ("group", json!({ "geometry": null, "rotation": rot, "flipH": false, "flipV": false, "fill": null, "line": null, "picture": null, "text": null }))
        }
        _ => return None,
    };
    let wrap_el = a.elements().find(|e| e.name.starts_with("wp:wrap"));
    let wrap = match wrap_el.map(|w| w.name.as_str()) {
        Some("wp:wrapSquare") => "square",
        Some("wp:wrapTight") => "tight",
        Some("wp:wrapThrough") => "through",
        Some("wp:wrapTopAndBottom") => "topAndBottom",
        _ => "none",
    };
    let doc_pr = a.child("wp:docPr");
    let mut m = Map::new();
    m.insert("kind".into(), Value::from(kind));
    m.insert("position".into(), position(a));
    m.insert("cx".into(), Value::from(cx));
    m.insert("cy".into(), Value::from(cy));
    m.insert("behindDoc".into(), Value::from(matches!(a.attr("behindDoc"), Some("1" | "true"))));
    m.insert("wrap".into(), Value::from(wrap));
    m.insert("wrapSide".into(), wrap_el.and_then(|w| w.attr("wrapText")).map(Value::from).unwrap_or(Value::Null));
    m.insert("dist".into(), json!({ "t": num(a, "distT").unwrap_or(0), "b": num(a, "distB").unwrap_or(0), "l": num(a, "distL").unwrap_or(0), "r": num(a, "distR").unwrap_or(0) }));
    m.insert("z".into(), Value::from(num(a, "relativeHeight").unwrap_or(0)));
    m.insert("shape".into(), shape);
    m.insert("children".into(), Value::Array(children));
    m.insert("xml".into(), Value::from(xml));
    m.insert("alt".into(), Value::from(doc_pr.and_then(|p| p.attr("descr")).unwrap_or("")));
    m.insert("title".into(), Value::from(doc_pr.and_then(|p| p.attr("title")).unwrap_or("")));
    Some(m)
}

/// `w:framePr` → the paragraph's `frame` attr.
pub fn frame_json(frame: &XElement) -> Value {
    let mut m = Map::new();
    for (xml, key) in [("w:wrap", "wrap"), ("w:hAnchor", "hAnchor"), ("w:vAnchor", "vAnchor"), ("w:xAlign", "xAlign"), ("w:yAlign", "yAlign")] {
        if let Some(v) = frame.attr(xml) {
            m.insert(key.into(), Value::from(v));
        }
    }
    for (xml, key) in [("w:x", "x"), ("w:y", "y"), ("w:w", "w"), ("w:h", "h")] {
        if let Some(v) = num(frame, xml) {
            m.insert(key.into(), Value::from(v));
        }
    }
    Value::Object(m)
}
