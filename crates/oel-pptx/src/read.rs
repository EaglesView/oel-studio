//! `.pptx` → [`Deck`]: the presentation, its slides, layouts and masters, with
//! everything PowerPoint inherits resolved for display.

use crate::model::*;
use crate::table;
use crate::text;
use crate::theme::{ColorCtx, Theme, apply_map, crop_of, default_map, is_fill, merge_line, num};
use oel_opc::fonts::{css_font, substitute_for};
use oel_opc::package::{Package, REL_HYPERLINK, REL_THEME, Rel, resolve_target};
use oel_opc::xml::{XDocument, XElement};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;

pub const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
pub const REL_SLIDE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
pub const REL_LAYOUT: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
pub const REL_MASTER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
pub const REL_NOTES_SLIDE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
pub const REL_NOTES_MASTER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
pub const REL_TABLE_STYLES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles";
pub const SVG_BLIP: &str = "svgBlip";

/// A parsed part and its relationships.
pub struct Part {
    pub path: String,
    pub doc: XDocument,
    pub rels: Vec<Rel>,
}

impl Part {
    pub fn load(pkg: &Package, path: &str) -> Option<Part> {
        Some(Part { path: path.to_string(), doc: pkg.get_xml(path)?, rels: pkg.rels(path) })
    }

    /// Internal target of a relationship id, resolved to a package path.
    pub fn target(&self, rid: &str) -> Option<String> {
        self.rels.iter().find(|r| r.id == rid && !r.external).map(|r| resolve_target(&self.path, &r.target))
    }

    pub fn related(&self, rel_type: &str) -> Option<String> {
        self.rels.iter().find(|r| r.rel_type == rel_type && !r.external).map(|r| resolve_target(&self.path, &r.target))
    }

    /// The shape tree (`p:cSld/p:spTree`).
    pub fn tree(&self) -> Option<&XElement> {
        self.doc.root.child_local("cSld")?.child_local("spTree")
    }
}

/// Children of a shape tree or group that are drawing elements (the index
/// space of [`SrcRef::index`]).
pub fn tree_items(tree: &XElement) -> Vec<&XElement> {
    tree.elements().filter(|e| !matches!(e.local(), "nvGrpSpPr" | "grpSpPr" | "extLst")).collect()
}

pub struct Master {
    pub part: Part,
    pub theme: Rc<Theme>,
    pub map: HashMap<String, String>,
    pub title_style: Option<XElement>,
    pub body_style: Option<XElement>,
    pub other_style: Option<XElement>,
    pub phs: Vec<XElement>,
}

pub struct LayoutPart {
    pub part: Part,
    pub master: Rc<Master>,
    pub map: HashMap<String, String>,
    pub phs: Vec<XElement>,
    pub show_master: bool,
    pub name: String,
}

/// Where an element is read: its part, colours and the placeholders it may inherit from.
struct Scope<'a> {
    part: &'a Part,
    cc: ColorCtx<'a>,
    master: &'a Master,
    layout_phs: &'a [XElement],
    master_phs: &'a [XElement],
}

pub struct Reader<'p> {
    pub pkg: &'p Package,
    pub pres: Part,
    default_style: Option<XElement>,
    table_styles: Option<XDocument>,
    masters: HashMap<String, Rc<Master>>,
    layouts: HashMap<String, Rc<LayoutPart>>,
    media: RefCell<BTreeMap<String, String>>,
    fonts: RefCell<BTreeSet<String>>,
    preserved: RefCell<BTreeMap<&'static str, (&'static str, u32)>>,
}

fn on(v: Option<&str>) -> bool {
    matches!(v, Some("1" | "true" | "on"))
}

/// The non-visual properties container of an element (`p:nvSpPr`, `p:nvPicPr`…).
pub fn nv(el: &XElement) -> Option<&XElement> {
    el.elements().find(|e| e.local().starts_with("nv"))
}

pub fn c_nv_pr(el: &XElement) -> Option<&XElement> {
    nv(el).and_then(|n| n.child_local("cNvPr"))
}

pub fn placeholder(el: &XElement) -> Option<Placeholder> {
    let ph = nv(el)?.child_local("nvPr")?.child_local("ph")?;
    Some(Placeholder { kind: ph.attr("type").unwrap_or("obj").to_string(), idx: num(ph, "idx").map(|v| v as u32) })
}

/// The shape properties (`p:spPr`, `p:grpSpPr`).
pub fn sp_pr(el: &XElement) -> Option<&XElement> {
    el.elements().find(|e| matches!(e.local(), "spPr" | "grpSpPr"))
}

fn xfrm_of(el: &XElement) -> Option<&XElement> {
    if el.local() == "graphicFrame" {
        return el.child_local("xfrm");
    }
    sp_pr(el)?.child_local("xfrm")
}

/// Text class of a placeholder type: which master text style it starts from.
fn ph_class(kind: &str) -> &'static str {
    match kind {
        "title" | "ctrTitle" => "title",
        "dt" => "dt",
        "ftr" => "ftr",
        "sldNum" => "sldNum",
        "hdr" => "hdr",
        _ => "body",
    }
}

/// The placeholder of `list` an element with `ph` inherits from.
pub fn match_ph<'x>(list: &'x [XElement], ph: &Placeholder, by_idx: bool) -> Option<&'x XElement> {
    let phs: Vec<(&XElement, Placeholder)> = list.iter().filter_map(|e| Some((e, placeholder(e)?))).collect();
    if by_idx
        && let Some(i) = ph.idx
        && let Some((e, _)) = phs.iter().find(|(_, p)| p.idx == Some(i))
    {
        return Some(e);
    }
    if let Some((e, _)) = phs.iter().find(|(_, p)| p.kind == ph.kind) {
        return Some(e);
    }
    let class = ph_class(&ph.kind);
    phs.iter().find(|(_, p)| ph_class(&p.kind) == class).map(|(e, _)| *e)
}

fn i(e: &XElement, k: &str) -> i64 {
    num(e, k).unwrap_or(0.0).round() as i64
}

impl<'p> Reader<'p> {
    pub fn new(pkg: &'p Package) -> Result<Self, String> {
        let pres_path = pkg.office_document().ok_or("pas une présentation : partie principale introuvable")?;
        let pres = Part::load(pkg, &pres_path).ok_or_else(|| format!("{pres_path} est illisible"))?;
        if pres.doc.root.local() != "presentation" {
            return Err("ce fichier n’est pas une présentation PowerPoint".into());
        }
        let default_style = pres.doc.root.child_local("defaultTextStyle").cloned();
        let table_styles = pres.related(REL_TABLE_STYLES).and_then(|p| pkg.get_xml(&p));
        Ok(Reader {
            pkg,
            pres,
            default_style,
            table_styles,
            masters: HashMap::new(),
            layouts: HashMap::new(),
            media: RefCell::new(BTreeMap::new()),
            fonts: RefCell::new(BTreeSet::new()),
            preserved: RefCell::new(BTreeMap::new()),
        })
    }

    fn keep(&self, kind: &'static str, label: &'static str, n: u32) {
        if n == 0 {
            return;
        }
        self.preserved.borrow_mut().entry(kind).or_insert((label, 0)).1 += n;
    }

    /// An image relationship of `part` → media part (recorded for the payload).
    fn blip(&self, part: &Part, rid: &str) -> Option<String> {
        let path = part.target(rid)?;
        if !self.pkg.has(&path) {
            return None;
        }
        let mime = self.pkg.mime_of(&path);
        self.media.borrow_mut().insert(path.clone(), mime);
        Some(path)
    }

    fn link(&self, part: &Part, rid: &str) -> Option<String> {
        part.rels.iter().find(|r| r.id == rid).map(|r| if r.rel_type == REL_HYPERLINK || r.external { r.target.clone() } else { String::new() })
    }

    pub fn master(&mut self, path: &str) -> Option<Rc<Master>> {
        if let Some(m) = self.masters.get(path) {
            return Some(m.clone());
        }
        let part = Part::load(self.pkg, path)?;
        let theme = Rc::new(part.related(REL_THEME).map(|t| Theme::load(self.pkg, &t)).unwrap_or_else(|| Theme::load(self.pkg, "")));
        let mut map = default_map();
        if let Some(m) = part.doc.root.child_local("clrMap") {
            apply_map(&mut map, m);
        }
        let styles = part.doc.root.child_local("txStyles");
        let style = |n: &str| styles.and_then(|s| s.child_local(n)).cloned();
        let phs = part.tree().map(|t| tree_items(t).into_iter().filter(|e| placeholder(e).is_some()).cloned().collect()).unwrap_or_default();
        let m = Rc::new(Master { title_style: style("titleStyle"), body_style: style("bodyStyle"), other_style: style("otherStyle"), part, theme, map, phs });
        self.masters.insert(path.to_string(), m.clone());
        Some(m)
    }

    pub fn layout(&mut self, path: &str) -> Option<Rc<LayoutPart>> {
        if let Some(l) = self.layouts.get(path) {
            return Some(l.clone());
        }
        let part = Part::load(self.pkg, path)?;
        let master = self.master(&part.related(REL_MASTER)?)?;
        let mut map = master.map.clone();
        if let Some(o) = part.doc.root.child_local("clrMapOvr").and_then(|o| o.child_local("overrideClrMapping")) {
            apply_map(&mut map, o);
        }
        let phs = part.tree().map(|t| tree_items(t).into_iter().filter(|e| placeholder(e).is_some()).cloned().collect()).unwrap_or_default();
        let show_master = part.doc.root.attr("showMasterSp") != Some("0");
        let name = part.doc.root.child_local("cSld").and_then(|c| c.attr("name")).unwrap_or("").to_string();
        let l = Rc::new(LayoutPart { part, master, map, phs, show_master, name });
        self.layouts.insert(path.to_string(), l.clone());
        Some(l)
    }

    // -----------------------------------------------------------------------
    // Deck
    // -----------------------------------------------------------------------

    pub fn read(mut self) -> Result<Imported, String> {
        let root = self.pres.doc.root.clone();
        let size = root.child_local("sldSz");
        let (width, height) = (size.map(|s| i(s, "cx")).unwrap_or(12_192_000), size.map(|s| i(s, "cy")).unwrap_or(6_858_000));

        let slide_paths: Vec<String> = root
            .child_local("sldIdLst")
            .into_iter()
            .flat_map(|l| l.elements())
            .filter_map(|s| s.attr("r:id").and_then(|rid| self.pres.target(rid)))
            .collect();
        let master_paths: Vec<String> = root
            .child_local("sldMasterIdLst")
            .into_iter()
            .flat_map(|l| l.elements())
            .filter_map(|s| s.attr("r:id").and_then(|rid| self.pres.target(rid)))
            .collect();

        let mut slides = Vec::new();
        for path in &slide_paths {
            if let Some(s) = self.slide(path) {
                slides.push(s);
            }
        }

        let mut layouts = Vec::new();
        for mp in &master_paths {
            let Some(m) = self.master(mp) else { continue };
            let lpaths: Vec<String> = m
                .part
                .doc
                .root
                .child_local("sldLayoutIdLst")
                .into_iter()
                .flat_map(|l| l.elements())
                .filter_map(|s| s.attr("r:id").and_then(|rid| m.part.target(rid)))
                .collect();
            for lp in lpaths {
                if let Some(l) = self.layout_model(&lp) {
                    layouts.push(l);
                }
            }
        }

        let first_master = master_paths.first().and_then(|p| self.master(p));
        let theme = first_master.as_ref().map(|m| m.theme.clone()).unwrap_or_default();
        let text_defaults = match (&first_master, &self.default_style) {
            (Some(m), Some(d)) => {
                let cc = ColorCtx { theme: &m.theme, map: &m.map, ph: None };
                let t = &m.theme;
                text::levels(&[d], None, usize::MAX, 9, &cc, &|f| t.typeface(f))
            }
            _ => vec![text::default_level()],
        };
        let colors = crate::theme::SLOTS.iter().filter_map(|s| Some(NamedColor { name: s.to_string(), color: format!("#{}", theme.scheme.get(*s)?) })).collect();
        {
            let mut f = self.fonts.borrow_mut();
            f.insert(theme.major.clone());
            f.insert(theme.minor.clone());
        }
        let (faces, mut font_media) = self.embedded_fonts();
        let fonts = {
            let mut names = self.fonts.borrow().clone();
            names.extend(faces.keys().cloned());
            names
                .into_iter()
                .filter(|n| !n.is_empty() && !n.starts_with('+'))
                .map(|n| DeckFont { substitute: substitute_for(&n).map(|s| s.open.to_string()), css: css_font(&n), embedded: faces.get(&n).cloned().unwrap_or_default(), name: n })
                .collect()
        };

        if self.pkg.parts.iter().any(|(n, _)| n.ends_with("vbaProject.bin")) {
            self.keep("macros", "Macros", 1);
        }
        let comments = self.pkg.parts.iter().filter(|(n, _)| n.starts_with("ppt/comments/")).count() as u32;
        self.keep("comments", "Commentaires", comments);
        let preserved = self.preserved.borrow().iter().map(|(k, (label, count))| Preserved { kind: k.to_string(), label: label.to_string(), count: *count }).collect();

        let title = self.pkg.get_xml("docProps/core.xml").and_then(|c| c.root.child_local("title").map(|t| t.text_content())).filter(|t| !t.trim().is_empty());
        let notes_master = root.child_local("notesMasterIdLst").is_some_and(|l| l.elements().next().is_some());

        let mut media: Vec<Media> = self
            .media
            .borrow()
            .iter()
            .filter_map(|(path, mime)| Some(Media { path: path.clone(), mime: mime.clone(), bytes: self.pkg.get(path)?.to_vec() }))
            .collect();
        media.append(&mut font_media);
        let deck = Deck {
            format_version: FORMAT_VERSION,
            width,
            height,
            slides,
            layouts,
            theme: ThemeInfo { major: theme.major.clone(), minor: theme.minor.clone(), colors },
            text_defaults,
            fonts,
            preserved,
            source: Source::Pptx,
            title,
            notes_master,
        };
        Ok(Imported { deck, media })
    }

    /// Fonts embedded in the presentation (`p:embeddedFontLst`), unwrapped for the browser.
    /// Faces the browser could not load (compressed EOT) are left out: the substitute shows.
    fn embedded_fonts(&self) -> (BTreeMap<String, Vec<EmbeddedFace>>, Vec<Media>) {
        let mut faces: BTreeMap<String, Vec<EmbeddedFace>> = BTreeMap::new();
        let mut media = Vec::new();
        let Some(list) = self.pres.doc.root.child_local("embeddedFontLst") else { return (faces, media) };
        for f in list.children_local("embeddedFont") {
            let Some(name) = f.child_local("font").and_then(|x| x.attr("typeface")).filter(|n| !n.is_empty()) else { continue };
            for (slot, weight, italic) in [("regular", 400, false), ("bold", 700, false), ("italic", 400, true), ("boldItalic", 700, true)] {
                let Some(part) = f.child_local(slot).and_then(|s| s.attr("r:id")).and_then(|rid| self.pres.target(rid)) else { continue };
                let Some(data) = self.pkg.get(&part).and_then(oel_opc::fonts::sfnt_from_embedded) else { continue };
                let (ext, mime) = oel_opc::fonts::font_kind(&data);
                let stem = part.rsplit('/').next().unwrap_or("font").split('.').next().unwrap_or("font").to_string();
                let path = format!("ppt/fonts/{stem}-{slot}.{ext}");
                faces.entry(name.to_string()).or_default().push(EmbeddedFace { path: path.clone(), weight, italic });
                media.push(Media { path, mime: mime.to_string(), bytes: data });
            }
        }
        (faces, media)
    }

    fn background(&self, part: &Part, cc: &ColorCtx) -> Option<Paint> {
        let bg = part.doc.root.child_local("cSld")?.child_local("bg")?;
        if let Some(pr) = bg.child_local("bgPr") {
            return cc.fill_in(pr, &|rid| self.blip(part, rid));
        }
        let r = bg.child_local("bgRef")?;
        let (cc2, style) = cc.style_ref(r, &cc.theme.fill_styles, &cc.theme.bg_fill_styles)?;
        cc2.paint(style, &|rid| self.blip(part, rid))
    }

    fn layout_model(&mut self, path: &str) -> Option<Layout> {
        let l = self.layout(path)?;
        let m = l.master.clone();
        let cc = ColorCtx { theme: &m.theme, map: &l.map, ph: None };
        let background = self.background(&l.part, &cc).or_else(|| self.background(&m.part, &cc));
        let mut decorations = Vec::new();
        if l.show_master {
            let sc = Scope { part: &m.part, cc: cc.clone(), master: &m, layout_phs: &[], master_phs: &[] };
            if let Some(t) = m.part.tree() {
                for (k, e) in tree_items(t).into_iter().enumerate() {
                    if placeholder(e).is_none()
                        && let Some(mut el) = self.element(e, k, &sc)
                    {
                        el.id = format!("m{}", el.id);
                        decorations.push(el);
                    }
                }
            }
        }
        let sc = Scope { part: &l.part, cc: cc.clone(), master: &m, layout_phs: &[], master_phs: &m.phs };
        let mut placeholders = Vec::new();
        if let Some(t) = l.part.tree() {
            for (k, e) in tree_items(t).into_iter().enumerate() {
                let Some(mut el) = self.element(e, k, &sc) else { continue };
                if el.ph.is_some() {
                    if let Some(tx) = el.text.as_mut() {
                        tx.prompt = custom_prompt(e);
                    }
                    placeholders.push(el);
                } else {
                    el.id = format!("l{}", el.id);
                    decorations.push(el);
                }
            }
        }
        Some(Layout { id: path.to_string(), name: l.name.clone(), master: m.part.path.clone(), background, decorations, placeholders })
    }

    fn slide(&mut self, path: &str) -> Option<Slide> {
        let part = Part::load(self.pkg, path)?;
        let lpath = part.related(REL_LAYOUT)?;
        let l = self.layout(&lpath)?;
        let m = l.master.clone();
        let mut map = l.map.clone();
        if let Some(o) = part.doc.root.child_local("clrMapOvr").and_then(|o| o.child_local("overrideClrMapping")) {
            apply_map(&mut map, o);
        }
        let cc = ColorCtx { theme: &m.theme, map: &map, ph: None };
        let sc = Scope { part: &part, cc: cc.clone(), master: &m, layout_phs: &l.phs, master_phs: &m.phs };
        let mut elements = Vec::new();
        if let Some(t) = part.tree() {
            for (k, e) in tree_items(t).into_iter().enumerate() {
                if let Some(el) = self.element(e, k, &sc) {
                    elements.push(el);
                }
            }
        }
        unique_ids(&mut elements);
        let background = self.background(&part, &cc);
        if part.doc.root.child_local("timing").is_some() {
            self.keep("animations", "Animations", 1);
        }
        if part.doc.root.elements().any(|e| e.local() == "transition" || (e.local() == "AlternateContent" && e.find("p:transition").is_some())) {
            self.keep("transitions", "Transitions", 1);
        }
        let notes = part
            .related(REL_NOTES_SLIDE)
            .and_then(|n| self.pkg.get_xml(&n))
            .and_then(|d| {
                let tree = d.root.child_local("cSld")?.child_local("spTree")?.clone();
                let body = tree_items(&tree).into_iter().find(|e| placeholder(e).is_some_and(|p| p.kind == "body")).cloned()?;
                body.child_local("txBody").map(text::plain_text)
            })
            .unwrap_or_default();
        Some(Slide {
            id: path.to_string(),
            src: Some(path.to_string()),
            layout: lpath,
            hidden: part.doc.root.attr("show") == Some("0"),
            background,
            hide_decorations: part.doc.root.attr("showMasterSp") == Some("0"),
            elements,
            notes: notes.trim_end_matches('\n').to_string(),
        })
    }

    // -----------------------------------------------------------------------
    // Elements
    // -----------------------------------------------------------------------

    fn element(&self, el: &XElement, index: usize, sc: &Scope) -> Option<Element> {
        let src = Some(SrcRef { part: sc.part.path.clone(), index: index as u32 });
        let mut out = match el.local() {
            "sp" => self.shape(el, sc, ElementKind::Shape),
            "cxnSp" => self.shape(el, sc, ElementKind::Connector),
            "pic" => self.picture(el, sc),
            "grpSp" => self.group(el, sc),
            "graphicFrame" => self.frame(el, sc),
            "AlternateContent" => {
                let choice = el.elements().filter(|c| c.local() == "Choice").find(|c| {
                    c.attr("Requires").is_some_and(|r| r.split_whitespace().all(|p| matches!(p, "p14" | "p15" | "a14" | "a15" | "a16" | "p159" | "v")))
                });
                let pick = choice.or_else(|| el.child_local("Fallback"))?.elements().next()?;
                let mut e = self.element(pick, index, sc)?;
                e.locked = true;
                e.label.get_or_insert_with(|| "Objet".into());
                Some(e)
            }
            "contentPart" => {
                self.keep("ink", "Encre", 1);
                Some(Element { id: format!("x{index}"), kind: ElementKind::Other, locked: true, label: Some("Encre".into()), ..Default::default() })
            }
            _ => None,
        }?;
        out.src = src;
        Some(out)
    }

    /// Placeholders this element inherits from (master's then layout's).
    fn ph_chain<'s>(&self, ph: Option<&Placeholder>, sc: &'s Scope) -> Vec<&'s XElement> {
        let Some(ph) = ph else { return Vec::new() };
        let layout = match_ph(sc.layout_phs, ph, true);
        // The master is matched by type; a layout placeholder brings its own type.
        let via = layout.and_then(placeholder).unwrap_or_else(|| ph.clone());
        let master = match_ph(sc.master_phs, &via, false);
        [master, layout].into_iter().flatten().collect()
    }

    fn base(&self, el: &XElement, kind: ElementKind, chain: &[&XElement]) -> Element {
        let c = c_nv_pr(el);
        let own = xfrm_of(el);
        let x = own.filter(|x| x.child_local("off").is_some()).or_else(|| chain.iter().rev().find_map(|e| xfrm_of(e).filter(|x| x.child_local("off").is_some())));
        let off = x.and_then(|x| x.child_local("off"));
        let ext = x.and_then(|x| x.child_local("ext"));
        Element {
            id: c.and_then(|c| c.attr("id")).unwrap_or("0").to_string(),
            kind,
            name: c.and_then(|c| c.attr("name")).unwrap_or("").to_string(),
            descr: c.and_then(|c| c.attr("descr")).unwrap_or("").to_string(),
            hidden: on(c.and_then(|c| c.attr("hidden"))),
            ph: placeholder(el),
            x: off.map(|o| i(o, "x")).unwrap_or(0),
            y: off.map(|o| i(o, "y")).unwrap_or(0),
            cx: ext.map(|e| i(e, "cx")).unwrap_or(0),
            cy: ext.map(|e| i(e, "cy")).unwrap_or(0),
            rot: x.and_then(|x| num(x, "rot")).map(|r| r / 60_000.0).unwrap_or(0.0),
            flip_h: on(x.and_then(|x| x.attr("flipH"))),
            flip_v: on(x.and_then(|x| x.attr("flipV"))),
            ..Default::default()
        }
    }

    fn geometry(&self, sp: Option<&XElement>, chain: &[&XElement]) -> Option<Geometry> {
        let pick = |s: &XElement| s.elements().find(|e| matches!(e.local(), "prstGeom" | "custGeom")).cloned();
        let g = sp.and_then(pick).or_else(|| chain.iter().rev().find_map(|e| sp_pr(e).and_then(pick)))?;
        Some(geometry_of(&g))
    }

    /// Fill, outline and shadow: explicit ones, and the inherited look.
    fn appearance(&self, el: &XElement, out: &mut Element, chain: &[&XElement], sc: &Scope) {
        let part = sc.part;
        let blip = |rid: &str| self.blip(part, rid);
        let own = sp_pr(el);
        out.fill = own.and_then(|s| s.elements().find(|e| is_fill(e.local()))).and_then(|f| sc.cc.paint(f, &blip));
        out.line = own.and_then(|s| s.child_local("ln")).map(|l| sc.cc.line(l));

        let style = el.child_local("style").or_else(|| chain.iter().rev().find_map(|e| e.child_local("style")));
        let theme = sc.cc.theme;
        let style_fill = style.and_then(|s| s.child_local("fillRef")).and_then(|r| sc.cc.style_ref(r, &theme.fill_styles, &theme.bg_fill_styles)).and_then(|(cc, f)| cc.paint(f, &blip));
        let style_line = style.and_then(|s| s.child_local("lnRef")).and_then(|r| sc.cc.style_ref(r, &theme.line_styles, &[])).map(|(cc, l)| cc.line(l));
        let style_shadow = style
            .and_then(|s| s.child_local("effectRef"))
            .and_then(|r| sc.cc.style_ref(r, &theme.effect_styles, &[]))
            .and_then(|(cc, e)| e.child_local("effectLst").and_then(|l| cc.shadow(l)));

        let inherited_fill = chain.iter().rev().find_map(|e| sp_pr(e).and_then(|s| s.elements().find(|f| is_fill(f.local()))).and_then(|f| sc.cc.paint(f, &blip)));
        out.look.fill = inherited_fill.or(style_fill);
        let mut line = style_line;
        for e in chain {
            line = merge_line(line, sp_pr(e).and_then(|s| s.child_local("ln")).map(|l| sc.cc.line(l)).as_ref());
        }
        out.look.line = line;
        let effects = own.and_then(|s| s.child_local("effectLst")).or_else(|| chain.iter().rev().find_map(|e| sp_pr(e).and_then(|s| s.child_local("effectLst"))));
        out.look.shadow = match effects {
            Some(l) => sc.cc.shadow(l),
            None => style_shadow,
        };
    }

    fn shape(&self, el: &XElement, sc: &Scope, kind: ElementKind) -> Option<Element> {
        let ph = placeholder(el);
        let chain = self.ph_chain(ph.as_ref(), sc);
        let mut out = self.base(el, kind, &chain);
        out.geom = self.geometry(sp_pr(el), &chain).or(Some(Geometry::Preset { prst: "rect".into(), av: Vec::new() }));
        self.appearance(el, &mut out, &chain, sc);
        if kind == ElementKind::Shape {
            out.text = Some(self.text(el, ph.as_ref(), &chain, sc));
        }
        Some(out)
    }

    fn text(&self, el: &XElement, ph: Option<&Placeholder>, chain: &[&XElement], sc: &Scope) -> TextBody {
        let own = el.child_local("txBody");
        let bodies: Vec<&XElement> = chain.iter().filter_map(|e| e.child_local("txBody").and_then(|t| t.child_local("bodyPr"))).chain(own.and_then(|t| t.child_local("bodyPr"))).collect();
        let body = text::body_props(&bodies);

        let mut layers: Vec<&XElement> = Vec::new();
        if let Some(d) = &self.default_style {
            layers.push(d);
        }
        if let Some(ph) = ph {
            let class = match ph_class(&ph.kind) {
                "title" => sc.master.title_style.as_ref(),
                "body" => sc.master.body_style.as_ref(),
                _ => sc.master.other_style.as_ref(),
            };
            if let Some(c) = class {
                layers.push(c);
            }
        }
        for e in chain {
            if let Some(l) = e.child_local("txBody").and_then(|t| t.child_local("lstStyle")) {
                layers.push(l);
            }
        }
        let font_ref_at = layers.len();
        if let Some(l) = own.and_then(|t| t.child_local("lstStyle")) {
            layers.push(l);
        }
        let font_ref = el.child_local("style").and_then(|s| s.child_local("fontRef")).and_then(|f| {
            let face = match f.attr("idx") {
                Some("major") => "+mj-lt",
                Some("minor") => "+mn-lt",
                _ => return sc.cc.child_css(f).map(|c| ("+mn-lt".to_string(), Some(c))),
            };
            Some((face.to_string(), sc.cc.child_css(f)))
        });
        let theme = sc.cc.theme;
        let typeface = |f: &str| theme.typeface(f);
        let n = text::level_count(own, ph.is_some_and(|p| ph_class(&p.kind) == "body"));
        let levels = text::levels(&layers, font_ref, font_ref_at, n, &sc.cc, &typeface);
        let part = sc.part;
        let paras = own.map(|t| text::paras(t, &sc.cc, &|rid| self.link(part, rid))).unwrap_or_default();
        {
            let mut fonts = self.fonts.borrow_mut();
            for l in &levels {
                fonts.insert(l.font.clone());
            }
            for p in &paras {
                for r in &p.runs {
                    if let Some(f) = &r.props.font {
                        fonts.insert(theme.typeface(f));
                    }
                }
            }
        }
        text::text_body(body, levels, paras, None)
    }

    fn picture(&self, el: &XElement, sc: &Scope) -> Option<Element> {
        let ph = placeholder(el);
        let chain = self.ph_chain(ph.as_ref(), sc);
        let mut out = self.base(el, ElementKind::Picture, &chain);
        out.geom = self.geometry(sp_pr(el), &chain);
        self.appearance(el, &mut out, &chain, sc);
        out.fill = None;
        let nvpr = nv(el).and_then(|n| n.child_local("nvPr"));
        if nvpr.is_some_and(|n| n.elements().any(|e| matches!(e.local(), "videoFile" | "audioFile" | "quickTimeFile")) || n.find("p14:media").is_some()) {
            self.keep("media", "Vidéos et sons", 1);
            out.label = Some("Média".into());
        }
        let bf = el.child_local("blipFill");
        let blip = bf.and_then(|b| b.child_local("blip"));
        let media = blip.and_then(|b| b.attr("r:embed")).and_then(|rid| self.blip(sc.part, rid)).unwrap_or_default();
        let svg = blip.and_then(|b| b.find_local(SVG_BLIP)).and_then(|s| s.attr("r:embed")).and_then(|rid| self.blip(sc.part, rid));
        let alpha = blip.and_then(|b| b.child_local("alphaModFix")).and_then(|a| num(a, "amt")).map(|v| v / 100_000.0);
        if !media.is_empty() {
            // A filled picture placeholder shows the picture, not the placeholder's fill.
            out.look.fill = None;
        }
        out.image = Some(Picture { mime: if media.is_empty() { String::new() } else { self.pkg.mime_of(&media) }, media, svg, crop: bf.and_then(crop_of), alpha });
        Some(out)
    }

    fn group(&self, el: &XElement, sc: &Scope) -> Option<Element> {
        let mut out = self.base(el, ElementKind::Group, &[]);
        let x = xfrm_of(el);
        let ch_off = x.and_then(|x| x.child_local("chOff"));
        let ch_ext = x.and_then(|x| x.child_local("chExt"));
        out.child_frame = Some(Frame {
            x: ch_off.map(|o| i(o, "x")).unwrap_or(out.x),
            y: ch_off.map(|o| i(o, "y")).unwrap_or(out.y),
            cx: ch_ext.map(|e| i(e, "cx")).unwrap_or(out.cx),
            cy: ch_ext.map(|e| i(e, "cy")).unwrap_or(out.cy),
        });
        out.fill = sp_pr(el).and_then(|s| s.elements().find(|e| is_fill(e.local()))).and_then(|f| sc.cc.paint(f, &|rid| self.blip(sc.part, rid)));
        let inner = Scope { part: sc.part, cc: sc.cc.clone(), master: sc.master, layout_phs: &[], master_phs: &[] };
        for (k, c) in tree_items(el).into_iter().enumerate() {
            if let Some(mut child) = self.element(c, k, &inner) {
                child.src = None;
                out.children.push(child);
            }
        }
        unique_ids(&mut out.children);
        Some(out)
    }

    fn frame(&self, el: &XElement, sc: &Scope) -> Option<Element> {
        let ph = placeholder(el);
        let chain = self.ph_chain(ph.as_ref(), sc);
        let mut out = self.base(el, ElementKind::Graphic, &chain);
        let data = el.child_local("graphic").and_then(|g| g.child_local("graphicData"));
        let uri = data.and_then(|d| d.attr("uri")).unwrap_or("");
        if uri.ends_with("/table")
            && let Some(tbl) = data.and_then(|d| d.child_local("tbl"))
        {
            out.kind = ElementKind::Table;
            let theme = sc.cc.theme;
            let typeface = |f: &str| theme.typeface(f);
            let part = sc.part;
            out.table = Some(table::read_table(tbl, self.default_style.as_ref(), self.table_styles.as_ref(), &sc.cc, &typeface, &|rid| self.link(part, rid)));
            return Some(out);
        }
        out.locked = true;
        let (kind, label) = if uri.contains("/chart") {
            ("charts", "Graphique")
        } else if uri.contains("/diagram") {
            ("smartart", "SmartArt")
        } else if uri.contains("/ole") {
            ("ole", "Objet incorporé")
        } else {
            ("objects", "Objet")
        };
        self.keep(
            kind,
            match kind {
                "charts" => "Graphiques",
                "smartart" => "SmartArt",
                "ole" => "Objets incorporés",
                _ => "Objets",
            },
            1,
        );
        out.label = Some(label.into());
        // An embedded object usually carries a picture of itself.
        if let Some(pic) = data.and_then(|d| d.find_local("pic"))
            && let Some(p) = self.picture(pic, sc)
        {
            out.image = p.image;
        }
        Some(out)
    }
}

/// Keep element ids unique within a list (duplicated `cNvPr` ids get the position appended).
fn unique_ids(list: &mut [Element]) {
    let mut seen = BTreeSet::new();
    for (k, e) in list.iter_mut().enumerate() {
        if !seen.insert(e.id.clone()) {
            e.id = format!("{}-{k}", e.id);
            seen.insert(e.id.clone());
        }
    }
}

/// The layout's own prompt text, when it set one (`hasCustomPrompt`).
fn custom_prompt(e: &XElement) -> Option<String> {
    let ph = nv(e)?.child_local("nvPr")?.child_local("ph")?;
    if !on(ph.attr("hasCustomPrompt")) {
        return None;
    }
    e.child_local("txBody").map(text::plain_text).map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

pub fn geometry_of(g: &XElement) -> Geometry {
    let guides = |name: &str| -> Vec<Guide> {
        g.child_local(name)
            .into_iter()
            .flat_map(|l| l.children_local("gd"))
            .map(|gd| Guide { name: gd.attr("name").unwrap_or("").to_string(), fmla: gd.attr("fmla").unwrap_or("").to_string() })
            .collect()
    };
    if g.local() == "prstGeom" {
        return Geometry::Preset { prst: g.attr("prst").unwrap_or("rect").to_string(), av: guides("avLst") };
    }
    let pt = |p: &XElement| [p.attr("x").unwrap_or("0").to_string(), p.attr("y").unwrap_or("0").to_string()];
    let paths = g
        .child_local("pathLst")
        .into_iter()
        .flat_map(|l| l.children_local("path"))
        .map(|p| {
            let cmds = p
                .elements()
                .filter_map(|c| {
                    let pts: Vec<String> = c.children_local("pt").flat_map(pt).collect();
                    Some(match c.local() {
                        "moveTo" => PathCmd::M { x: pts.first()?.clone(), y: pts.get(1)?.clone() },
                        "lnTo" => PathCmd::L { x: pts.first()?.clone(), y: pts.get(1)?.clone() },
                        "cubicBezTo" if pts.len() == 6 => PathCmd::C { p: pts },
                        "quadBezTo" if pts.len() == 4 => PathCmd::Q { p: pts },
                        "arcTo" => PathCmd::A {
                            wr: c.attr("wR").unwrap_or("0").into(),
                            hr: c.attr("hR").unwrap_or("0").into(),
                            st: c.attr("stAng").unwrap_or("0").into(),
                            sw: c.attr("swAng").unwrap_or("0").into(),
                        },
                        "close" => PathCmd::Z,
                        _ => return None,
                    })
                })
                .collect();
            GeomPath {
                w: num(p, "w"),
                h: num(p, "h"),
                fill: p.attr("fill").unwrap_or("norm").to_string(),
                stroke: p.attr("stroke") != Some("0") && p.attr("stroke") != Some("false"),
                cmds,
            }
        })
        .collect();
    Geometry::Custom(CustomGeometry { av: guides("avLst"), gd: guides("gdLst"), paths })
}

pub fn import_package(pkg: &Package) -> Result<Imported, String> {
    Reader::new(pkg)?.read()
}
