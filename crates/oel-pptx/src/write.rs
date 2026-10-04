//! Deck JSON + original package → `.pptx`.
//!
//! The original package is the base: a slide whose JSON equals what the
//! reader gives for its part is not touched (byte for byte); an edited slide
//! keeps its XML and gets only the changed facets of the changed elements
//! patched (box, geometry, fill, outline, text…). Elements, slides and notes
//! the editor created are generated; slides removed in the editor leave the
//! package with their notes. Masters, layouts, themes, media and everything
//! else are copied as they were.

use crate::model::*;
use crate::read::{self, Part, REL_LAYOUT, REL_NOTES_MASTER, REL_NOTES_SLIDE, REL_SLIDE, c_nv_pr, tree_items};
use crate::template;
use crate::theme::{is_fill, num};
use oel_opc::color::Rgba;
use oel_opc::package::{Package, REL_IMAGE, Rel, mime_for_ext, rels_path, resolve_target};
use oel_opc::xml::{XDocument, XElement, XNode, parse_fragment};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

const CT_SLIDE: &str = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const CT_NOTES: &str = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const NS_DECL: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const LANG: &str = "fr-CA";

/// Children of `a:rPr` in schema order.
const RPR_ORDER: &[&str] = &["ln", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"];
/// Children of `a:pPr` in schema order.
const PPR_ORDER: &[&str] = &["lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip", "tabLst", "defRPr", "extLst"];
/// Children of `p:spPr` in schema order.
const SPPR_ORDER: &[&str] = &["xfrm", "custGeom", "prstGeom", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"];
/// Children of `p:sp` in schema order.
const SP_ORDER: &[&str] = &["nvSpPr", "spPr", "style", "txBody", "extLst"];

pub fn export_pptx(deck: &Deck, original: Option<&[u8]>, media: HashMap<String, Vec<u8>>) -> Result<Vec<u8>, String> {
    let base = match original {
        Some(b) => b.to_vec(),
        None => template::package_bytes(),
    };
    let orig_pkg = Package::read(&base)?;
    let orig = read::import_package(&orig_pkg)?.deck;
    let mut w = Writer::new(orig_pkg, &orig)?;
    for (path, bytes) in media {
        let ext = path.rsplit('.').next().unwrap_or("png").to_ascii_lowercase();
        w.pkg.set(&path, bytes);
        w.pkg.ensure_default(&ext, mime_for_ext(&ext));
    }
    w.write(deck)?;
    w.pkg.write()
}

struct Writer<'o> {
    /// The package being written.
    pkg: Package,
    /// The package as it came (sources of copied slides and elements).
    orig_pkg: Package,
    orig: &'o Deck,
    pres_path: String,
    /// Original element models by (part, index).
    orig_elements: HashMap<(String, u32), &'o Element>,
    /// Shape-tree items of original parts, parsed once.
    trees: HashMap<String, Rc<Vec<XElement>>>,
}

/// Path of `abs` relative to the folder of `from` (`ppt/slides/slide1.xml`, `ppt/media/a.png` → `../media/a.png`).
pub fn rel_path(from: &str, abs: &str) -> String {
    let base: Vec<&str> = from.rsplit_once('/').map(|(d, _)| d.split('/').collect()).unwrap_or_default();
    let target: Vec<&str> = abs.split('/').collect();
    let common = base.iter().zip(target.iter()).take_while(|(a, b)| a == b).count();
    let mut out: Vec<&str> = vec![".."; base.len() - common];
    out.extend(&target[common..]);
    out.join("/")
}

fn set_or_remove(e: &mut XElement, k: &str, v: Option<String>) {
    match v {
        Some(v) => e.set_attr(k, v),
        None => e.remove_attr(k),
    }
}

/// Insert `child` among `parent`'s children keeping the schema `order`.
fn insert_ordered(parent: &mut XElement, child: XElement, order: &[&str]) {
    let rank = |n: &str| order.iter().position(|o| *o == n).unwrap_or(order.len());
    let r = rank(child.local());
    let at = parent.children.iter().position(|c| matches!(c, XNode::Element(e) if rank(e.local()) > r)).unwrap_or(parent.children.len());
    parent.children.insert(at, XNode::Element(child));
}

fn remove_local(parent: &mut XElement, pred: impl Fn(&str) -> bool) {
    parent.children.retain(|c| !matches!(c, XNode::Element(e) if pred(e.local())));
}

fn parse_el(xml: &str) -> Option<XElement> {
    parse_fragment(xml).ok()?.into_iter().find_map(|n| match n {
        XNode::Element(e) => Some(e),
        _ => None,
    })
}

fn fmt_num(v: f64) -> String {
    format!("{}", v.round() as i64)
}

/// `a:srgbClr` (with `a:alpha` when translucent) for a CSS colour.
fn color_el(css: &str) -> XElement {
    let c = Rgba::from_css(css).unwrap_or(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 1.0 });
    let mut e = XElement::new("a:srgbClr").with_attr("val", c.to_hex());
    if c.a < 0.999 {
        e.children.push(XNode::Element(XElement::new("a:alpha").with_attr("val", fmt_num(c.a * 100_000.0))));
    }
    e
}

impl<'o> Writer<'o> {
    fn new(orig_pkg: Package, orig: &'o Deck) -> Result<Self, String> {
        let pres_path = orig_pkg.office_document().ok_or("présentation sans partie principale")?;
        let mut orig_elements = HashMap::new();
        for s in &orig.slides {
            for e in &s.elements {
                if let Some(src) = &e.src {
                    orig_elements.insert((src.part.clone(), src.index), e);
                }
            }
        }
        Ok(Writer { pkg: orig_pkg.clone(), orig_pkg, orig, pres_path, orig_elements, trees: HashMap::new() })
    }

    fn write(&mut self, deck: &Deck) -> Result<(), String> {
        let pres_doc = self.pkg.get_xml(&self.pres_path).ok_or("presentation.xml illisible")?;
        let pres_rels = self.pkg.rels(&self.pres_path);
        let sld_ids: Vec<(String, u32)> = pres_doc
            .root
            .child_local("sldIdLst")
            .into_iter()
            .flat_map(|l| l.elements())
            .filter_map(|s| {
                let rid = s.attr("r:id")?;
                let rel = pres_rels.iter().find(|r| r.id == rid)?;
                Some((resolve_target(&self.pres_path, &rel.target), num(s, "id")? as u32))
            })
            .collect();
        let original_order: Vec<String> = sld_ids.iter().map(|(p, _)| p.clone()).collect();
        let mut next_id = sld_ids.iter().map(|(_, i)| *i).max().unwrap_or(255).max(255) + 1;
        let mut next_part = self.pkg.parts.iter().filter_map(|(n, _)| n.strip_prefix("ppt/slides/slide").and_then(|r| r.strip_suffix(".xml")).and_then(|n| n.parse::<u32>().ok())).max().unwrap_or(0) + 1;

        let mut used: HashSet<String> = HashSet::new();
        let mut order: Vec<(String, u32)> = Vec::new();
        for s in &deck.slides {
            let in_place = s.src.clone().filter(|p| original_order.contains(p) && !used.contains(p));
            let part = match &in_place {
                Some(p) => p.clone(),
                None => {
                    let p = format!("ppt/slides/slide{next_part}.xml");
                    next_part += 1;
                    p
                }
            };
            used.insert(part.clone());
            self.write_slide(&part, s, in_place.is_some())?;
            let id = match sld_ids.iter().find(|(p, _)| p == &part) {
                Some((_, id)) => *id,
                None => {
                    next_id += 1;
                    next_id - 1
                }
            };
            order.push((part, id));
        }

        // Slides deleted in the editor leave the package (with their notes).
        let removed: Vec<String> = original_order.iter().filter(|p| !used.contains(*p)).cloned().collect();
        for part in &removed {
            if let Some(notes) = Part::load(&self.pkg, part).and_then(|p| p.related(REL_NOTES_SLIDE)) {
                self.remove_part(&notes);
            }
            self.remove_part(part);
        }

        let new_order: Vec<String> = order.iter().map(|(p, _)| p.clone()).collect();
        if new_order != original_order {
            self.write_presentation(pres_doc, &order, &removed)?;
            self.update_app_counts(order.len());
        }
        Ok(())
    }

    fn remove_part(&mut self, part: &str) {
        let rels = rels_path(part);
        self.pkg.parts.retain(|(n, _)| n != part && n != &rels);
        let mut ct = self.pkg.content_types();
        let pn = format!("/{part}");
        ct.root.children.retain(|c| !matches!(c, XNode::Element(e) if e.local() == "Override" && e.attr("PartName") == Some(pn.as_str())));
        self.pkg.set_xml("[Content_Types].xml", &ct);
    }

    fn write_presentation(&mut self, mut doc: XDocument, order: &[(String, u32)], removed: &[String]) -> Result<(), String> {
        let pres = self.pres_path.clone();
        // Drop the relationships of removed slides, add those of new ones.
        let rels_part = rels_path(&pres);
        if let Some(mut rels) = self.pkg.get_xml(&rels_part) {
            rels.root.children.retain(|c| match c {
                XNode::Element(e) => !(e.attr("Type") == Some(REL_SLIDE) && removed.contains(&resolve_target(&pres, e.attr("Target").unwrap_or("")))),
                _ => true,
            });
            self.pkg.set_xml(&rels_part, &rels);
        }
        let mut list = XElement::new("p:sldIdLst");
        for (part, id) in order {
            let rid = self.pkg.add_rel(&pres, REL_SLIDE, &rel_path(&pres, part), false);
            list.children.push(XNode::Element(XElement::new("p:sldId").with_attr("id", id.to_string()).with_attr("r:id", rid)));
        }
        let root = &mut doc.root;
        let existing_rids: HashSet<String> = self.pkg.rels(&pres).into_iter().map(|r| r.id).collect();
        if let Some(slot) = root.children.iter_mut().find(|c| matches!(c, XNode::Element(e) if e.local() == "sldIdLst")) {
            *slot = XNode::Element(list);
        } else {
            // After the master/notes/handout id lists.
            let at = root.children.iter().position(|c| matches!(c, XNode::Element(e) if !matches!(e.local(), "sldMasterIdLst" | "notesMasterIdLst" | "handoutMasterIdLst"))).unwrap_or(root.children.len());
            root.children.insert(at, XNode::Element(list));
        }
        // Custom shows may name removed slides.
        if let Some(shows) = root.child_local_mut("custShowLst") {
            for show in shows.elements_mut() {
                if let Some(lst) = show.child_local_mut("sldLst") {
                    lst.children.retain(|c| !matches!(c, XNode::Element(e) if e.attr("r:id").is_some_and(|r| !existing_rids.contains(r))));
                }
            }
        }
        self.pkg.set_xml(&pres, &doc);
        Ok(())
    }

    fn update_app_counts(&mut self, slides: usize) {
        if let Some(s) = self.pkg.get_str("docProps/app.xml")
            && let (Some(a), Some(b)) = (s.find("<Slides>"), s.find("</Slides>"))
        {
            let out = format!("{}<Slides>{slides}{}", &s[..a], &s[b..]);
            self.pkg.set("docProps/app.xml", out.into_bytes());
        }
    }

    // -----------------------------------------------------------------------
    // Slides
    // -----------------------------------------------------------------------

    fn orig_slide(&self, src: Option<&String>) -> Option<&'o Slide> {
        let src = src?;
        self.orig.slides.iter().find(|s| s.src.as_ref() == Some(src))
    }

    fn write_slide(&mut self, part: &str, s: &Slide, in_place: bool) -> Result<(), String> {
        let orig = self.orig_slide(s.src.as_ref());
        if in_place && let Some(o) = orig {
            let same = o.layout == s.layout && o.hidden == s.hidden && o.hide_decorations == s.hide_decorations && o.background == s.background && o.elements == s.elements && o.notes == s.notes;
            if same {
                return Ok(());
            }
        }
        let mut doc = match (in_place, s.src.as_ref().and_then(|p| self.orig_pkg.get_xml(p))) {
            (_, Some(d)) => d,
            _ => XDocument::parse(&format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld {NS_DECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#))
            .map_err(|e| e.to_string())?,
        };
        if !in_place {
            // A new part: its own relationships (layout now; images as elements need them).
            self.pkg.set(&rels_path(part), br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_vec());
            self.pkg.ensure_override(part, CT_SLIDE);
            // A copy drops its source's notes reference (notes are written below).
        }
        if !in_place && let Some(src) = &s.src {
            // A copy: what the slide refers to outside its shapes (tags, sounds…) follows it.
            let mut root = doc.root.clone();
            self.remap_rels(&mut root, src, part);
            doc.root = root;
        }
        self.set_layout(part, &s.layout);
        set_or_remove(&mut doc.root, "show", s.hidden.then(|| "0".to_string()));
        set_or_remove(&mut doc.root, "showMasterSp", s.hide_decorations.then(|| "0".to_string()));

        let changed_bg = !in_place || orig.map(|o| &o.background) != Some(&s.background);
        if changed_bg {
            self.set_background(part, &mut doc.root, s.background.as_ref());
        }

        let changed_tree = !in_place || orig.map(|o| &o.elements) != Some(&s.elements);
        if changed_tree {
            self.write_tree(part, &mut doc, s)?;
        }
        self.pkg.set_xml(part, &doc);

        let orig_notes = if in_place { orig.map(|o| o.notes.as_str()).unwrap_or("") } else { "" };
        if s.notes != orig_notes {
            self.write_notes(part, &s.notes, in_place)?;
        }
        Ok(())
    }

    fn set_layout(&mut self, part: &str, layout: &str) {
        let rels_part = rels_path(part);
        let target = rel_path(part, layout);
        if let Some(mut rels) = self.pkg.get_xml(&rels_part) {
            let mut found = false;
            for e in rels.root.elements_mut() {
                if e.attr("Type") == Some(REL_LAYOUT) {
                    found = true;
                    if resolve_target(part, e.attr("Target").unwrap_or("")) != layout {
                        e.set_attr("Target", target.clone());
                    }
                }
            }
            if found {
                self.pkg.set_xml(&rels_part, &rels);
                return;
            }
        }
        self.pkg.add_rel(part, REL_LAYOUT, &target, false);
    }

    fn set_background(&mut self, part: &str, root: &mut XElement, bg: Option<&Paint>) {
        let paint = bg.and_then(|p| self.paint_el(part, p));
        let Some(c_sld) = root.child_local_mut("cSld") else { return };
        remove_local(c_sld, |n| n == "bg");
        if let Some(fill) = paint {
            let pr = XElement::new("p:bgPr").with_child(fill).with_child(XElement::new("a:effectLst"));
            c_sld.children.insert(0, XNode::Element(XElement::new("p:bg").with_child(pr)));
        }
    }

    fn write_tree(&mut self, part: &str, doc: &mut XDocument, s: &Slide) -> Result<(), String> {
        let tree = doc.root.child_local_mut("cSld").and_then(|c| c.child_local_mut("spTree")).ok_or("diapositive sans arbre de formes")?;
        let head: Vec<XNode> = tree.children.iter().filter(|c| matches!(c, XNode::Element(e) if matches!(e.local(), "nvGrpSpPr" | "grpSpPr"))).cloned().collect();
        let tail: Vec<XNode> = tree.children.iter().filter(|c| matches!(c, XNode::Element(e) if e.local() == "extLst")).cloned().collect();
        let srcs: Vec<SrcRef> = s.elements.iter().filter_map(|e| e.src.clone()).collect();
        let mut next_id = srcs.iter().filter_map(|src| self.src_xml(src)).filter_map(|x| max_id(&x)).fold(1.0_f64, f64::max) as u32 + 1;
        let mut items = Vec::new();
        for el in &s.elements {
            let x = match el.src.as_ref().and_then(|src| self.src_xml(src).map(|x| (src.clone(), x))) {
                Some((src, mut x)) => {
                    if src.part != part {
                        self.remap_rels(&mut x, &src.part, part);
                    }
                    if let Some(o) = self.orig_elements.get(&(src.part.clone(), src.index)).copied() {
                        self.patch(part, &mut x, o, el);
                    }
                    Some(x)
                }
                None => {
                    let id = next_id;
                    next_id += 1;
                    self.generate(part, el, id)
                }
            };
            if let Some(x) = x {
                items.push(XNode::Element(x));
            }
        }
        let tree = doc.root.child_local_mut("cSld").and_then(|c| c.child_local_mut("spTree")).ok_or("diapositive sans arbre de formes")?;
        tree.children = head.into_iter().chain(items).chain(tail).collect();
        Ok(())
    }

    /// The original XML of an element.
    fn src_xml(&mut self, src: &SrcRef) -> Option<XElement> {
        if !self.trees.contains_key(&src.part) {
            let items = self
                .orig_pkg
                .get_xml(&src.part)
                .and_then(|d| d.root.child_local("cSld").and_then(|c| c.child_local("spTree")).map(|t| tree_items(t).into_iter().cloned().collect()))
                .unwrap_or_default();
            self.trees.insert(src.part.clone(), Rc::new(items));
        }
        self.trees.get(&src.part)?.get(src.index as usize).cloned()
    }

    /// Re-point the relationships an element copied from `from` uses, in `to`.
    fn remap_rels(&mut self, x: &mut XElement, from: &str, to: &str) {
        let rels = self.orig_pkg.rels(from);
        self.remap_in(x, &rels, from, to);
    }

    fn remap_in(&mut self, x: &mut XElement, rels: &[Rel], from: &str, to: &str) {
        for (k, v) in x.attrs.iter_mut() {
            if !k.starts_with("r:") {
                continue;
            }
            let Some(rel) = rels.iter().find(|r| &r.id == v) else { continue };
            let target = if rel.external { rel.target.clone() } else { rel_path(to, &resolve_target(from, &rel.target)) };
            *v = self.pkg.add_rel(to, &rel.rel_type, &target, rel.external);
        }
        for c in x.elements_mut() {
            self.remap_in(c, rels, from, to);
        }
    }

    // -----------------------------------------------------------------------
    // Elements
    // -----------------------------------------------------------------------

    fn patch(&mut self, part: &str, x: &mut XElement, o: &Element, n: &Element) {
        if n.locked || o == n {
            return;
        }
        if let Some(c) = nv_mut(x).and_then(|nv| nv.child_local_mut("cNvPr")) {
            if o.name != n.name {
                c.set_attr("name", n.name.clone());
            }
            if o.descr != n.descr {
                set_or_remove(c, "descr", (!n.descr.is_empty()).then(|| n.descr.clone()));
            }
            if o.hidden != n.hidden {
                set_or_remove(c, "hidden", n.hidden.then(|| "1".to_string()));
            }
        }
        let boxed = |e: &Element| (e.x, e.y, e.cx, e.cy, e.rot, e.flip_h, e.flip_v);
        if boxed(o) != boxed(n) {
            set_xfrm(x, n);
        }
        if o.geom != n.geom
            && let Some(Geometry::Preset { prst, av }) = &n.geom
            && let Some(sp) = sp_pr_mut(x)
        {
            remove_local(sp, |l| l == "prstGeom" || l == "custGeom");
            insert_ordered(sp, preset_el(prst, av), SPPR_ORDER);
        }
        if o.fill != n.fill {
            let fill = n.fill.as_ref().and_then(|p| self.paint_el(part, p));
            if let Some(sp) = sp_pr_mut(x) {
                remove_local(sp, is_fill);
                if let Some(f) = fill {
                    insert_ordered(sp, f, SPPR_ORDER);
                }
            }
        }
        if o.line != n.line
            && let Some(sp) = sp_pr_mut(x)
        {
            match &n.line {
                None => remove_local(sp, |l| l == "ln"),
                Some(line) => {
                    let mut ln = sp.child_local("ln").cloned().unwrap_or_else(|| XElement::new("a:ln"));
                    patch_line(&mut ln, line);
                    remove_local(sp, |l| l == "ln");
                    insert_ordered(sp, ln, SPPR_ORDER);
                }
            }
        }
        if o.text != n.text
            && let Some(t) = &n.text
        {
            let existing = x.child_local("txBody").cloned();
            let body = write_body(existing.as_ref(), "p:txBody", t, o.text.as_ref());
            remove_local(x, |l| l == "txBody");
            insert_ordered(x, body, SP_ORDER);
        }
        if let (Some(oi), Some(ni)) = (&o.image, &n.image)
            && oi.media != ni.media
            && !ni.media.is_empty()
        {
            let rid = self.pkg.add_rel(part, REL_IMAGE, &rel_path(part, &ni.media), false);
            if let Some(b) = x.child_local_mut("blipFill").and_then(|b| b.child_local_mut("blip")) {
                b.set_attr("r:embed", rid);
                // The SVG alternative showed the old picture.
                remove_local(b, |l| l == "extLst");
            }
        }
        if let (Some(ot), Some(nt)) = (&o.table, &n.table)
            && ot != nt
            && let Some(tbl) = x.find_mut("a:tbl")
        {
            patch_table(tbl, ot, nt);
        }
    }

    /// XML for an element the editor created.
    fn generate(&mut self, part: &str, el: &Element, id: u32) -> Option<XElement> {
        let name = if el.name.is_empty() { format!("Forme {id}") } else { el.name.clone() };
        let mut c_nv = XElement::new("p:cNvPr").with_attr("id", id.to_string()).with_attr("name", name);
        if !el.descr.is_empty() {
            c_nv.set_attr("descr", el.descr.clone());
        }
        if el.hidden {
            c_nv.set_attr("hidden", "1");
        }
        let mut nv_pr = XElement::new("p:nvPr");
        if let Some(ph) = &el.ph {
            let mut p = XElement::new("p:ph");
            if ph.kind != "obj" {
                p.set_attr("type", ph.kind.clone());
            }
            if let Some(i) = ph.idx {
                p.set_attr("idx", i.to_string());
            }
            nv_pr.children.push(XNode::Element(p));
        }
        let mut sp = XElement::new("p:spPr");
        sp.children.push(XNode::Element(xfrm_el("a:xfrm", el)));
        let geom = match &el.geom {
            Some(Geometry::Preset { prst, av }) => Some(preset_el(prst, av)),
            None if el.ph.is_none() => Some(preset_el("rect", &[])),
            _ => None,
        };
        if let Some(g) = geom {
            sp.children.push(XNode::Element(g));
        }
        if let Some(f) = el.fill.as_ref().and_then(|p| self.paint_el(part, p)) {
            sp.children.push(XNode::Element(f));
        }
        if let Some(l) = &el.line {
            let mut ln = XElement::new("a:ln");
            patch_line(&mut ln, l);
            sp.children.push(XNode::Element(ln));
        }
        match el.kind {
            ElementKind::Shape => {
                let mut c_sp = XElement::new("p:cNvSpPr");
                if el.ph.is_some() {
                    c_sp.children.push(XNode::Element(XElement::new("a:spLocks").with_attr("noGrp", "1")));
                } else if el.fill.is_none() && el.line.is_none() {
                    c_sp.set_attr("txBox", "1");
                }
                let nv = XElement::new("p:nvSpPr").with_child(c_nv).with_child(c_sp).with_child(nv_pr);
                let mut out = XElement::new("p:sp").with_child(nv).with_child(sp);
                if let Some(t) = &el.text {
                    out.children.push(XNode::Element(write_body(None, "p:txBody", t, None)));
                }
                Some(out)
            }
            ElementKind::Connector => {
                let nv = XElement::new("p:nvCxnSpPr").with_child(c_nv).with_child(XElement::new("p:cNvCxnSpPr")).with_child(nv_pr);
                Some(XElement::new("p:cxnSp").with_child(nv).with_child(sp))
            }
            ElementKind::Picture => {
                let img = el.image.as_ref().filter(|i| !i.media.is_empty())?;
                let rid = self.pkg.add_rel(part, REL_IMAGE, &rel_path(part, &img.media), false);
                let locks = XElement::new("p:cNvPicPr").with_child(XElement::new("a:picLocks").with_attr("noChangeAspect", "1"));
                let nv = XElement::new("p:nvPicPr").with_child(c_nv).with_child(locks).with_child(nv_pr);
                let mut blip_fill = XElement::new("p:blipFill").with_child(XElement::new("a:blip").with_attr("r:embed", rid));
                if let Some(c) = &img.crop {
                    blip_fill.children.push(XNode::Element(crop_el(c)));
                }
                blip_fill.children.push(XNode::Element(XElement::new("a:stretch").with_child(XElement::new("a:fillRect"))));
                if !sp.elements().any(|e| e.local() == "prstGeom" || e.local() == "custGeom") {
                    sp.children.push(XNode::Element(preset_el("rect", &[])));
                }
                Some(XElement::new("p:pic").with_child(nv).with_child(blip_fill).with_child(sp))
            }
            // Groups, tables and graphics are only ever copied, never created.
            _ => None,
        }
    }

    /// A fill element for a paint (adds the image relationship when needed).
    fn paint_el(&mut self, part: &str, p: &Paint) -> Option<XElement> {
        Some(match p {
            Paint::None => XElement::new("a:noFill"),
            Paint::Solid { color } => XElement::new("a:solidFill").with_child(color_el(color)),
            Paint::Gradient { angle, path, stops } => {
                let mut list = XElement::new("a:gsLst");
                for s in stops {
                    list.children.push(XNode::Element(XElement::new("a:gs").with_attr("pos", fmt_num(s.pos * 100_000.0)).with_child(color_el(&s.color))));
                }
                let mut g = XElement::new("a:gradFill").with_attr("rotWithShape", "1").with_child(list);
                match path {
                    Some(kind) => {
                        let rect = XElement::new("a:fillToRect").with_attr("l", "50000").with_attr("t", "50000").with_attr("r", "50000").with_attr("b", "50000");
                        g.children.push(XNode::Element(XElement::new("a:path").with_attr("path", kind.clone()).with_child(rect)));
                    }
                    None => g.children.push(XNode::Element(XElement::new("a:lin").with_attr("ang", fmt_num(angle * 60_000.0)).with_attr("scaled", "0"))),
                }
                g
            }
            Paint::Image { media, crop, tile } => {
                if media.is_empty() {
                    return None;
                }
                let rid = self.pkg.add_rel(part, REL_IMAGE, &rel_path(part, media), false);
                let mut b = XElement::new("a:blipFill").with_attr("dpi", "0").with_attr("rotWithShape", "1").with_child(XElement::new("a:blip").with_attr("r:embed", rid));
                if let Some(c) = crop {
                    b.children.push(XNode::Element(crop_el(c)));
                }
                b.children.push(XNode::Element(if *tile { XElement::new("a:tile") } else { XElement::new("a:stretch").with_child(XElement::new("a:fillRect")) }));
                b
            }
            Paint::Pattern { prst, fg, bg } => XElement::new("a:pattFill")
                .with_attr("prst", prst.clone())
                .with_child(XElement::new("a:fgClr").with_child(color_el(fg)))
                .with_child(XElement::new("a:bgClr").with_child(color_el(bg))),
            Paint::Group => XElement::new("a:grpFill"),
        })
    }

    // -----------------------------------------------------------------------
    // Notes
    // -----------------------------------------------------------------------

    fn write_notes(&mut self, slide_part: &str, text: &str, in_place: bool) -> Result<(), String> {
        let existing = if in_place { Part::load(&self.pkg, slide_part).and_then(|p| p.related(REL_NOTES_SLIDE)) } else { None };
        let paras = notes_paras(text);
        if let Some(np) = existing {
            let mut doc = self.pkg.get_xml(&np).ok_or("notes illisibles")?;
            let body = doc
                .root
                .child_local_mut("cSld")
                .and_then(|c| c.child_local_mut("spTree"))
                .and_then(|t| t.elements_mut().find(|e| read::placeholder(e).is_some_and(|p| p.kind == "body")));
            if let Some(body) = body {
                let tb = body.child_local("txBody").cloned();
                let mut tx = tb.unwrap_or_else(|| XElement::new("p:txBody").with_child(XElement::new("a:bodyPr")).with_child(XElement::new("a:lstStyle")));
                remove_local(&mut tx, |l| l == "p");
                tx.children.extend(paras.into_iter().map(XNode::Element));
                remove_local(body, |l| l == "txBody");
                insert_ordered(body, tx, SP_ORDER);
                self.pkg.set_xml(&np, &doc);
                return Ok(());
            }
        }
        if text.trim().is_empty() {
            return Ok(());
        }
        let Some(master) = Part::load(&self.pkg, &self.pres_path).and_then(|p| p.related(REL_NOTES_MASTER)) else {
            return Ok(());
        };
        let n = self.pkg.parts.iter().filter_map(|(n, _)| n.strip_prefix("ppt/notesSlides/notesSlide").and_then(|r| r.strip_suffix(".xml")).and_then(|n| n.parse::<u32>().ok())).max().unwrap_or(0) + 1;
        let part = format!("ppt/notesSlides/notesSlide{n}.xml");
        let body: String = paras.iter().map(|p| p.to_xml()).collect();
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes {NS_DECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Image de la diapositive 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{body}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
        );
        self.pkg.set(&part, xml.into_bytes());
        self.pkg.ensure_override(&part, CT_NOTES);
        self.pkg.add_rel(&part, REL_NOTES_MASTER, &rel_path(&part, &master), false);
        self.pkg.add_rel(&part, REL_SLIDE, &rel_path(&part, slide_part), false);
        self.pkg.add_rel(slide_part, REL_NOTES_SLIDE, &rel_path(slide_part, &part), false);
        Ok(())
    }
}

/// Largest `cNvPr` id in an element (groups included).
fn max_id(x: &XElement) -> Option<f64> {
    let own = c_nv_pr(x).and_then(|c| num(c, "id"));
    x.elements().filter_map(max_id).chain(own).reduce(f64::max)
}

fn nv_mut(x: &mut XElement) -> Option<&mut XElement> {
    x.elements_mut().find(|e| e.local().starts_with("nv"))
}

fn sp_pr_mut(x: &mut XElement) -> Option<&mut XElement> {
    if x.elements().any(|e| matches!(e.local(), "spPr" | "grpSpPr")) {
        return x.elements_mut().find(|e| matches!(e.local(), "spPr" | "grpSpPr"));
    }
    if x.local() == "graphicFrame" {
        return None;
    }
    // A placeholder without shape properties gets an empty `p:spPr` after its non-visual part.
    let at = x.children.iter().position(|c| matches!(c, XNode::Element(e) if e.local().starts_with("nv"))).map(|i| i + 1).unwrap_or(0);
    x.children.insert(at, XNode::Element(XElement::new("p:spPr")));
    x.elements_mut().find(|e| e.local() == "spPr")
}

fn xfrm_el(name: &str, el: &Element) -> XElement {
    let mut x = XElement::new(name);
    if el.rot != 0.0 {
        x.set_attr("rot", fmt_num(el.rot * 60_000.0));
    }
    if el.flip_h {
        x.set_attr("flipH", "1");
    }
    if el.flip_v {
        x.set_attr("flipV", "1");
    }
    x.with_child(XElement::new("a:off").with_attr("x", el.x.to_string()).with_attr("y", el.y.to_string()))
        .with_child(XElement::new("a:ext").with_attr("cx", el.cx.max(0).to_string()).with_attr("cy", el.cy.max(0).to_string()))
}

/// Write an element's box into its transform (created when it inherited one).
fn set_xfrm(x: &mut XElement, el: &Element) {
    if x.local() == "graphicFrame" {
        let fresh = xfrm_el("p:xfrm", el);
        match x.child_local_mut("xfrm") {
            Some(old) => *old = fresh,
            None => {
                let at = x.children.iter().position(|c| matches!(c, XNode::Element(e) if e.local().starts_with("nv"))).map(|i| i + 1).unwrap_or(0);
                x.children.insert(at, XNode::Element(fresh));
            }
        }
        return;
    }
    let Some(sp) = sp_pr_mut(x) else { return };
    let mut fresh = xfrm_el("a:xfrm", el);
    if let Some(old) = sp.child_local("xfrm") {
        // Keep a group's child space (chOff/chExt): resizing the group scales its members.
        for c in old.elements().filter(|c| matches!(c.local(), "chOff" | "chExt")) {
            fresh.children.push(XNode::Element(c.clone()));
        }
        for (k, v) in &old.attrs {
            if !matches!(k.as_str(), "rot" | "flipH" | "flipV") {
                fresh.set_attr(k, v.clone());
            }
        }
    } else if sp.local() == "grpSpPr" {
        fresh.children.push(XNode::Element(XElement::new("a:chOff").with_attr("x", el.x.to_string()).with_attr("y", el.y.to_string())));
        fresh.children.push(XNode::Element(XElement::new("a:chExt").with_attr("cx", el.cx.to_string()).with_attr("cy", el.cy.to_string())));
    }
    remove_local(sp, |l| l == "xfrm");
    insert_ordered(sp, fresh, SPPR_ORDER);
}

fn preset_el(prst: &str, av: &[Guide]) -> XElement {
    let mut list = XElement::new("a:avLst");
    for g in av {
        list.children.push(XNode::Element(XElement::new("a:gd").with_attr("name", g.name.clone()).with_attr("fmla", g.fmla.clone())));
    }
    XElement::new("a:prstGeom").with_attr("prst", prst).with_child(list)
}

fn crop_el(c: &Crop) -> XElement {
    let mut e = XElement::new("a:srcRect");
    for (k, v) in [("l", c.l), ("t", c.t), ("r", c.r), ("b", c.b)] {
        if v != 0.0 {
            e.set_attr(k, fmt_num(v * 100_000.0));
        }
    }
    e
}

/// Set the modelled fields of an `a:ln`, keeping the rest (joins, compound lines…).
fn patch_line(ln: &mut XElement, l: &Line) {
    set_or_remove(ln, "w", l.width.map(|w| w.to_string()));
    set_or_remove(ln, "cap", l.cap.clone());
    const LN_ORDER: &[&str] = &["noFill", "solidFill", "gradFill", "pattFill", "prstDash", "custDash", "round", "bevel", "miter", "headEnd", "tailEnd", "extLst"];
    remove_local(ln, is_fill);
    if let Some(p) = &l.paint {
        let f = match p {
            Paint::None => Some(XElement::new("a:noFill")),
            Paint::Solid { color } => Some(XElement::new("a:solidFill").with_child(color_el(color))),
            _ => None,
        };
        if let Some(f) = f {
            insert_ordered(ln, f, LN_ORDER);
        }
    }
    remove_local(ln, |n| n == "prstDash");
    if let Some(d) = &l.dash {
        insert_ordered(ln, XElement::new("a:prstDash").with_attr("val", d.clone()), LN_ORDER);
    }
    for (name, end) in [("headEnd", &l.head), ("tailEnd", &l.tail)] {
        remove_local(ln, |n| n == name);
        if let Some(e) = end {
            let mut x = XElement::new(&format!("a:{name}")).with_attr("type", e.kind.clone());
            if let Some(w) = &e.w {
                x.set_attr("w", w.clone());
            }
            if let Some(len) = &e.len {
                x.set_attr("len", len.clone());
            }
            insert_ordered(ln, x, LN_ORDER);
        }
    }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

fn bool_attr(v: Option<bool>) -> Option<String> {
    v.map(|b| if b { "1".to_string() } else { "0".to_string() })
}

/// An `a:rPr` / `a:endParaRPr` from explicit run properties over the original element.
pub fn rpr_el(name: &str, p: &RunProps) -> XElement {
    let mut e = p.xml.as_deref().and_then(parse_el).unwrap_or_else(|| XElement::new(name).with_attr("lang", LANG).with_attr("dirty", "0"));
    e.name = name.to_string();
    set_or_remove(&mut e, "b", bool_attr(p.bold));
    set_or_remove(&mut e, "i", bool_attr(p.italic));
    set_or_remove(&mut e, "u", p.underline.clone());
    set_or_remove(&mut e, "strike", p.strike.clone());
    set_or_remove(&mut e, "sz", p.size.map(|s| fmt_num(s * 100.0)));
    set_or_remove(&mut e, "baseline", p.baseline.map(|b| fmt_num(b * 1000.0)));
    set_or_remove(&mut e, "cap", p.caps.clone());
    set_or_remove(&mut e, "spc", p.spacing.map(|s| fmt_num(s * 100.0)));
    remove_local(&mut e, |l| matches!(l, "noFill" | "solidFill" | "gradFill" | "blipFill" | "pattFill" | "grpFill"));
    if let Some(c) = &p.color {
        let f = if c == "transparent" { XElement::new("a:noFill") } else { XElement::new("a:solidFill").with_child(color_el(c)) };
        insert_ordered(&mut e, f, RPR_ORDER);
    }
    remove_local(&mut e, |l| l == "highlight");
    if let Some(h) = &p.highlight {
        insert_ordered(&mut e, XElement::new("a:highlight").with_child(color_el(h)), RPR_ORDER);
    }
    remove_local(&mut e, |l| l == "latin");
    if let Some(f) = &p.font {
        insert_ordered(&mut e, XElement::new("a:latin").with_attr("typeface", f.clone()), RPR_ORDER);
    }
    e
}

fn spacing_el(name: &str, s: &Spacing) -> XElement {
    let inner = match (s.pct, s.pts) {
        (Some(p), _) => XElement::new("a:spcPct").with_attr("val", fmt_num(p * 100_000.0)),
        (None, Some(p)) => XElement::new("a:spcPts").with_attr("val", fmt_num(p * 100.0)),
        _ => XElement::new("a:spcPts").with_attr("val", "0"),
    };
    XElement::new(&format!("a:{name}")).with_child(inner)
}

/// An `a:pPr` from explicit paragraph properties over the original element (`None` when empty).
pub fn ppr_el(lvl: u8, p: &ParaProps) -> Option<XElement> {
    let mut e = p.xml.as_deref().and_then(parse_el).unwrap_or_else(|| XElement::new("a:pPr"));
    set_or_remove(&mut e, "lvl", (lvl > 0).then(|| lvl.to_string()));
    set_or_remove(&mut e, "algn", p.align.clone());
    set_or_remove(&mut e, "marL", p.mar_l.map(|v| v.to_string()));
    set_or_remove(&mut e, "indent", p.indent.map(|v| v.to_string()));
    for (name, v) in [("lnSpc", &p.line), ("spcBef", &p.before), ("spcAft", &p.after)] {
        remove_local(&mut e, |l| l == name);
        if let Some(s) = v {
            insert_ordered(&mut e, spacing_el(name, s), PPR_ORDER);
        }
    }
    match &p.bullet {
        None => remove_local(&mut e, |l| l.starts_with("bu")),
        Some(b) => {
            if !b.kind.is_empty() {
                remove_local(&mut e, |l| matches!(l, "buNone" | "buAutoNum" | "buChar" | "buBlip"));
                let k = match b.kind.as_str() {
                    "char" => XElement::new("a:buChar").with_attr("char", b.char.clone().unwrap_or_else(|| "•".into())),
                    "auto" => {
                        let mut a = XElement::new("a:buAutoNum").with_attr("type", b.scheme.clone().unwrap_or_else(|| "arabicPeriod".into()));
                        if let Some(s) = b.start.filter(|s| *s != 1) {
                            a.set_attr("startAt", s.to_string());
                        }
                        a
                    }
                    _ => XElement::new("a:buNone"),
                };
                insert_ordered(&mut e, k, PPR_ORDER);
            }
            remove_local(&mut e, |l| l == "buFont" || l == "buFontTx");
            match b.font.as_deref() {
                Some("") => insert_ordered(&mut e, XElement::new("a:buFontTx"), PPR_ORDER),
                Some(f) => insert_ordered(&mut e, XElement::new("a:buFont").with_attr("typeface", f), PPR_ORDER),
                None => {}
            }
            remove_local(&mut e, |l| l == "buClr" || l == "buClrTx");
            match b.color.as_deref() {
                Some("") => insert_ordered(&mut e, XElement::new("a:buClrTx"), PPR_ORDER),
                Some(c) => insert_ordered(&mut e, XElement::new("a:buClr").with_child(color_el(c)), PPR_ORDER),
                None => {}
            }
            remove_local(&mut e, |l| matches!(l, "buSzTx" | "buSzPct" | "buSzPts"));
            if let Some(s) = b.size {
                insert_ordered(&mut e, XElement::new("a:buSzPct").with_attr("val", fmt_num(s * 100_000.0)), PPR_ORDER);
            }
        }
    }
    (!e.attrs.is_empty() || !e.children.is_empty()).then_some(e)
}

fn field_id() -> String {
    // Any GUID will do: PowerPoint only uses it to tell fields apart.
    "{5C1D6F3A-2B7E-4C1A-9F0E-0E1A0E1A0E1A}".to_string()
}

pub fn para_el(p: &Para) -> XElement {
    let mut e = XElement::new("a:p");
    if let Some(ppr) = ppr_el(p.lvl, &p.props) {
        e.children.push(XNode::Element(ppr));
    }
    for r in &p.runs {
        let rpr = rpr_el("a:rPr", &r.props);
        let x = match r.kind.as_str() {
            "br" => XElement::new("a:br").with_child(rpr),
            "field" => {
                let mut f = XElement::new("a:fld").with_attr("id", r.field_id.clone().unwrap_or_else(field_id));
                if let Some(t) = &r.field {
                    f.set_attr("type", t.clone());
                }
                let mut t = XElement::new("a:t");
                t.children.push(XNode::Text(r.text.clone()));
                f.with_child(rpr).with_child(t)
            }
            _ => {
                let mut t = XElement::new("a:t");
                t.children.push(XNode::Text(r.text.clone()));
                XElement::new("a:r").with_child(rpr).with_child(t)
            }
        };
        e.children.push(XNode::Element(x));
    }
    e.children.push(XNode::Element(rpr_el("a:endParaRPr", &p.end)));
    e
}

/// A text body: the original one with new paragraphs (and changed box settings), or a new one.
fn write_body(existing: Option<&XElement>, name: &str, t: &TextBody, orig: Option<&TextBody>) -> XElement {
    let mut tx = existing.cloned().unwrap_or_else(|| {
        let body = XElement::new("a:bodyPr").with_attr("wrap", if t.body.wrap { "square" } else { "none" }).with_attr("rtlCol", "0").with_attr("anchor", t.body.anchor.clone());
        let mut body = body;
        if t.body.autofit == "shape" {
            body.children.push(XNode::Element(XElement::new("a:spAutoFit")));
        }
        XElement::new(name).with_child(body).with_child(XElement::new("a:lstStyle"))
    });
    if let Some(o) = orig
        && let Some(b) = tx.child_local_mut("bodyPr")
    {
        if o.body.anchor != t.body.anchor {
            b.set_attr("anchor", t.body.anchor.clone());
        }
        if o.body.autofit != t.body.autofit || o.body.font_scale != t.body.font_scale {
            remove_local(b, |l| matches!(l, "noAutofit" | "normAutofit" | "spAutoFit"));
            let a = match t.body.autofit.as_str() {
                "norm" => {
                    let mut n = XElement::new("a:normAutofit");
                    if t.body.font_scale < 0.999 {
                        n.set_attr("fontScale", fmt_num(t.body.font_scale * 100_000.0));
                    }
                    if t.body.line_reduction > 0.0 {
                        n.set_attr("lnSpcReduction", fmt_num(t.body.line_reduction * 100_000.0));
                    }
                    n
                }
                "shape" => XElement::new("a:spAutoFit"),
                _ => XElement::new("a:noAutofit"),
            };
            // After prstTxWarp, before scene3d/sp3d/flatTx/extLst.
            let at = b.children.iter().position(|c| matches!(c, XNode::Element(e) if matches!(e.local(), "scene3d" | "sp3d" | "flatTx" | "extLst"))).unwrap_or(b.children.len());
            b.children.insert(at, XNode::Element(a));
        }
    }
    let at = tx.children.iter().position(|c| matches!(c, XNode::Element(e) if e.local() == "p")).unwrap_or_else(|| tx.children.iter().rposition(|c| matches!(c, XNode::Element(e) if matches!(e.local(), "bodyPr" | "lstStyle"))).map(|i| i + 1).unwrap_or(tx.children.len()));
    remove_local(&mut tx, |l| l == "p");
    let at = at.min(tx.children.len());
    let mut paras: Vec<XNode> = t.paras.iter().map(|p| XNode::Element(para_el(p))).collect();
    if paras.is_empty() {
        paras.push(XNode::Element(XElement::new("a:p").with_child(XElement::new("a:endParaRPr").with_attr("lang", LANG).with_attr("dirty", "0"))));
    }
    for (k, p) in paras.into_iter().enumerate() {
        tx.children.insert(at + k, p);
    }
    tx
}

fn notes_paras(text: &str) -> Vec<XElement> {
    let mut out: Vec<XElement> = text
        .split('\n')
        .map(|line| {
            let mut p = XElement::new("a:p");
            if !line.is_empty() {
                let mut t = XElement::new("a:t");
                t.children.push(XNode::Text(line.to_string()));
                p.children.push(XNode::Element(XElement::new("a:r").with_child(XElement::new("a:rPr").with_attr("lang", LANG).with_attr("dirty", "0")).with_child(t)));
            }
            p.children.push(XNode::Element(XElement::new("a:endParaRPr").with_attr("lang", LANG).with_attr("dirty", "0")));
            p
        })
        .collect();
    if out.is_empty() {
        out.push(XElement::new("a:p"));
    }
    out
}

/// Cell text edits into an `a:tbl` (the grid itself is not edited).
fn patch_table(tbl: &mut XElement, o: &Table, n: &Table) {
    for (r, tr) in tbl.elements_mut().filter(|e| e.local() == "tr").enumerate() {
        for (c, tc) in tr.elements_mut().filter(|e| e.local() == "tc").enumerate() {
            let (Some(oc), Some(nc)) = (o.rows.get(r).and_then(|x| x.cells.get(c)), n.rows.get(r).and_then(|x| x.cells.get(c))) else { continue };
            if oc.text.paras == nc.text.paras {
                continue;
            }
            let existing = tc.child_local("txBody").cloned();
            let body = write_body(existing.as_ref(), "a:txBody", &nc.text, Some(&oc.text));
            remove_local(tc, |l| l == "txBody");
            tc.children.insert(0, XNode::Element(body));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        assert_eq!(rel_path("ppt/slides/slide1.xml", "ppt/media/image1.png"), "../media/image1.png");
        assert_eq!(rel_path("ppt/slides/slide1.xml", "ppt/slides/slide2.xml"), "slide2.xml");
        assert_eq!(rel_path("ppt/presentation.xml", "ppt/slides/slide3.xml"), "slides/slide3.xml");
    }

    #[test]
    fn run_properties_keep_what_is_not_modelled() {
        let p = RunProps { bold: Some(true), size: Some(24.0), color: Some("#FF0000".into()), xml: Some(r#"<a:rPr lang="en-US" dirty="0"><a:effectLst/><a:latin typeface="Arial"/><a:hlinkClick r:id="rId3"/></a:rPr>"#.into()), font: Some("Arial".into()), ..Default::default() };
        let x = rpr_el("a:rPr", &p).to_xml();
        assert_eq!(x, r#"<a:rPr lang="en-US" dirty="0" b="1" sz="2400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/><a:latin typeface="Arial"/><a:hlinkClick r:id="rId3"/></a:rPr>"#);
    }

    #[test]
    fn paragraph_properties_in_schema_order() {
        let p = ParaProps { align: Some("ctr".into()), before: Some(Spacing { pct: None, pts: Some(6.0) }), bullet: Some(Bullet { kind: "char".into(), char: Some("–".into()), ..Default::default() }), ..Default::default() };
        assert_eq!(ppr_el(1, &p).unwrap().to_xml(), r#"<a:pPr lvl="1" algn="ctr"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buChar char="–"/></a:pPr>"#);
        assert!(ppr_el(0, &ParaProps::default()).is_none());
    }
}
