//! Import → edit → export → import over the shared fixtures (`fixtures/pptx`).

use oel_opc::package::Package;
use oelpptx::model::*;
use oelpptx::{export_pptx, import_pptx, new_deck};
use std::collections::HashMap;

fn fixture(n: u32) -> Vec<u8> {
    std::fs::read(format!("{}/../../fixtures/pptx/Presentation {n}.pptx", env!("CARGO_MANIFEST_DIR"))).expect("fixture")
}

fn texts(e: &Element) -> Vec<String> {
    e.text.as_ref().map(|t| t.paras.iter().map(|p| p.runs.iter().map(|r| r.text.as_str()).collect::<String>()).collect()).unwrap_or_default()
}

fn part_map(bytes: &[u8]) -> HashMap<String, Vec<u8>> {
    Package::read(bytes).unwrap().parts.into_iter().collect()
}

#[test]
fn imports_the_fixtures() {
    for (n, slides, layouts) in [(1, 8, 8), (2, 15, 17), (3, 3, 1)] {
        let imp = import_pptx(&fixture(n)).unwrap();
        assert_eq!(imp.deck.slides.len(), slides, "Presentation {n}");
        assert_eq!(imp.deck.layouts.len(), layouts, "Presentation {n}");
        assert_eq!(imp.deck.source, Source::Pptx);
        for s in &imp.deck.slides {
            assert!(imp.deck.layouts.iter().any(|l| l.id == s.layout), "{} has a known layout", s.id);
        }
        // Every picture's media travels with the deck.
        for s in &imp.deck.slides {
            for e in &s.elements {
                if let Some(img) = e.image.as_ref().filter(|i| !i.media.is_empty()) {
                    assert!(imp.media.iter().any(|m| m.path == img.media), "{} in media", img.media);
                }
            }
        }
    }
}

#[test]
fn placeholders_inherit_from_layout_and_master() {
    let deck = import_pptx(&fixture(1)).unwrap().deck;
    let title = &deck.slides[0].elements[0];
    assert_eq!(title.ph.as_ref().unwrap().kind, "ctrTitle");
    assert_eq!(texts(title), ["Celebrating"]);
    let lvl = &title.text.as_ref().unwrap().levels[0];
    // Layout says 88 pt centred; the master's title style gives the theme's heading font and colour.
    assert_eq!(lvl.size, 88.0);
    assert_eq!(lvl.align, "ctr");
    assert_eq!(lvl.font, "Kunstler Script");
    // Picture placeholder clipped to the layout's freeform.
    let pic = deck.slides[0].elements.iter().find(|e| e.kind == ElementKind::Picture).unwrap();
    assert!(matches!(pic.geom, Some(Geometry::Custom(_))));
    assert_eq!(deck.slides.len(), 8);
    // Master background through the layout.
    assert!(deck.layouts[0].background.is_some());
}

#[test]
fn tables_and_groups() {
    let deck = import_pptx(&fixture(2)).unwrap().deck;
    let table = deck.slides[14].elements.iter().find(|e| e.kind == ElementKind::Table).unwrap().table.as_ref().unwrap();
    assert_eq!(table.cols.len(), 2);
    assert_eq!(table.rows[0].cells[0].text.paras[0].runs[0].text, "Art Piece");
    // Light Style 1: the header row is bold with a rule under it.
    assert!(table.rows[0].cells[0].text.levels[0].bold);
    assert!(table.rows[0].cells[0].borders.b.as_ref().and_then(|l| l.paint.as_ref()).is_some_and(|p| matches!(p, Paint::Solid { .. })));

    let deck = import_pptx(&fixture(3)).unwrap().deck;
    assert_eq!(deck.width, 6_858_000);
    let group = deck.slides[0].elements.iter().find(|e| e.kind == ElementKind::Group).unwrap();
    assert!(!group.children.is_empty());
    assert!(group.child_frame.is_some());
}

#[test]
fn unchanged_export_is_byte_identical() {
    for n in [1, 2, 3] {
        let bytes = fixture(n);
        let deck = import_pptx(&bytes).unwrap().deck;
        // Through JSON, as the editor sends it.
        let deck: Deck = serde_json::from_str(&serde_json::to_string(&deck).unwrap()).unwrap();
        let out = export_pptx(&deck, Some(&bytes), HashMap::new()).unwrap();
        let (a, b) = (part_map(&bytes), part_map(&out));
        assert_eq!(a.len(), b.len(), "Presentation {n}: same parts");
        for (name, data) in &a {
            assert!(b.get(name) == Some(data), "Presentation {n}: {name} unchanged");
        }
    }
}

#[test]
fn text_edit_patches_only_that_shape() {
    let bytes = fixture(1);
    let mut deck = import_pptx(&bytes).unwrap().deck;
    let title = &mut deck.slides[0].elements[0];
    title.text.as_mut().unwrap().paras[0].runs[0].text = "Célébrons & fêtons".into();
    title.text.as_mut().unwrap().paras[0].runs[0].props.bold = Some(true);
    deck.slides[0].elements[1].x += 12_700;
    let out = export_pptx(&deck, Some(&bytes), HashMap::new()).unwrap();
    let (a, b) = (part_map(&bytes), part_map(&out));
    for (name, data) in &a {
        if name != "ppt/slides/slide1.xml" {
            assert!(b.get(name) == Some(data), "{name} unchanged");
        }
    }
    let again = import_pptx(&out).unwrap().deck;
    let t = &again.slides[0].elements[0];
    assert_eq!(texts(t), ["Célébrons & fêtons"]);
    assert_eq!(t.text.as_ref().unwrap().paras[0].runs[0].props.bold, Some(true));
    assert_eq!(again.slides[0].elements[1].x, deck.slides[0].elements[1].x);
    // The other shapes of the slide are written back as they were.
    let xml = String::from_utf8(b["ppt/slides/slide1.xml"].clone()).unwrap();
    assert!(xml.contains(r#"<a:srcRect/><a:stretch/></p:blipFill>"#));
    assert!(xml.contains("Célébrons &amp; fêtons"));
}

#[test]
fn slides_are_reordered_duplicated_added_and_removed() {
    let bytes = fixture(2);
    let mut deck = import_pptx(&bytes).unwrap().deck;
    let first_title = texts(&deck.slides[0].elements[0]);
    // Remove the second slide, move the last one first, duplicate the (new) second one.
    let removed = deck.slides.remove(1);
    let last = deck.slides.pop().unwrap();
    deck.slides.insert(0, last.clone());
    let mut dup = deck.slides[1].clone();
    dup.id = "copie".into();
    dup.elements[0].text.as_mut().unwrap().paras[0].runs[0].text = "Copie".into();
    deck.slides.insert(2, dup);
    // A new slide from a layout with a title placeholder.
    let layout = deck.layouts.iter().find(|l| l.placeholders.iter().any(|p| p.ph.as_ref().is_some_and(|ph| ph.kind == "title"))).unwrap().clone();
    let mut title = layout.placeholders.iter().find(|p| p.ph.as_ref().is_some_and(|ph| ph.kind == "title")).unwrap().clone();
    title.src = None;
    title.id = "n1".into();
    title.text.as_mut().unwrap().paras = vec![Para { runs: vec![Run { kind: "text".into(), text: "Nouvelle diapo".into(), ..Default::default() }], ..Default::default() }];
    let mut text_box = Element { id: "n2".into(), kind: ElementKind::Shape, x: 914_400, y: 914_400, cx: 3_000_000, cy: 600_000, ..Default::default() };
    text_box.text = Some(TextBody { body: oelpptx::text::default_body(), levels: vec![oelpptx::text::default_level()], paras: vec![Para { runs: vec![Run { kind: "text".into(), text: "Zone de texte".into(), ..Default::default() }], ..Default::default() }], prompt: None });
    deck.slides.push(Slide { id: "neuve".into(), src: None, layout: layout.id.clone(), hidden: true, hide_decorations: false, background: Some(Paint::Solid { color: "#123456".into() }), elements: vec![title, text_box], notes: "Ne pas oublier\nla conclusion".into() });

    let out = export_pptx(&deck, Some(&bytes), HashMap::new()).unwrap();
    let again = import_pptx(&out).unwrap().deck;
    assert_eq!(again.slides.len(), deck.slides.len());
    assert_eq!(texts(&again.slides[0].elements[0]), texts(&last.elements[0]));
    assert_eq!(texts(&again.slides[1].elements[0]), first_title);
    assert_eq!(texts(&again.slides[2].elements[0]), ["Copie"]);
    let neuve = again.slides.last().unwrap();
    assert!(neuve.hidden);
    assert_eq!(neuve.background, Some(Paint::Solid { color: "#123456".into() }));
    assert_eq!(texts(&neuve.elements[0]), ["Nouvelle diapo"]);
    assert_eq!(texts(&neuve.elements[1]), ["Zone de texte"]);
    assert_eq!(neuve.notes, "Ne pas oublier\nla conclusion");
    // The removed slide's part is gone; its pictures' media stay for the others.
    let parts = part_map(&out);
    assert!(!parts.contains_key(removed.src.as_ref().unwrap()));
    let ct = String::from_utf8(parts["[Content_Types].xml"].clone()).unwrap();
    for s in &again.slides {
        assert!(ct.contains(&format!("/{}", s.id)), "{} has a content type", s.id);
    }
    // The copy's pictures point at the same media through its own relationships.
    let copy = &again.slides[2];
    for e in copy.elements.iter().filter(|e| e.kind == ElementKind::Picture) {
        assert!(parts.contains_key(&e.image.as_ref().unwrap().media));
    }
}

#[test]
fn notes_are_created_and_edited() {
    let bytes = fixture(1);
    let mut deck = import_pptx(&bytes).unwrap().deck;
    deck.slides[3].notes = "Raconter l’histoire du lac".into();
    let out = export_pptx(&deck, Some(&bytes), HashMap::new()).unwrap();
    let mut again = import_pptx(&out).unwrap().deck;
    assert_eq!(again.slides[3].notes, "Raconter l’histoire du lac");
    again.slides[3].notes = "Deux\nlignes".into();
    let out2 = export_pptx(&again, Some(&out), HashMap::new()).unwrap();
    assert_eq!(import_pptx(&out2).unwrap().deck.slides[3].notes, "Deux\nlignes");
}

#[test]
fn new_presentations_round_trip() {
    let imp = new_deck();
    assert_eq!(imp.deck.slides.len(), 1);
    assert_eq!(imp.deck.layouts.len(), 6);
    assert_eq!(imp.deck.layouts[0].name, "Diapositive de titre");
    assert!(imp.deck.notes_master);
    let mut deck = imp.deck;
    let title = &mut deck.slides[0].elements[0];
    assert_eq!(title.ph.as_ref().unwrap().kind, "ctrTitle");
    // Inherited from the layout: centred, 60 pt.
    assert_eq!(title.text.as_ref().unwrap().levels[0].size, 60.0);
    title.text.as_mut().unwrap().paras[0].runs.push(Run { kind: "text".into(), text: "Bonjour".into(), ..Default::default() });
    let out = export_pptx(&deck, None, HashMap::new()).unwrap();
    let again = import_pptx(&out).unwrap().deck;
    assert_eq!(texts(&again.slides[0].elements[0]), ["Bonjour"]);
}

#[test]
fn pictures_added_in_the_editor_are_written() {
    let bytes = fixture(3);
    let mut deck = import_pptx(&bytes).unwrap().deck;
    let png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    deck.slides[0].elements.push(Element {
        id: "img".into(),
        kind: ElementKind::Picture,
        name: "Image".into(),
        descr: "Un logo".into(),
        x: 100,
        y: 200,
        cx: 1_000_000,
        cy: 500_000,
        image: Some(Picture { media: "ppt/media/oel-abc.png".into(), mime: "image/png".into(), ..Default::default() }),
        ..Default::default()
    });
    let out = export_pptx(&deck, Some(&bytes), HashMap::from([("ppt/media/oel-abc.png".to_string(), png)])).unwrap();
    let imp = import_pptx(&out).unwrap();
    let pic = imp.deck.slides[0].elements.last().unwrap();
    assert_eq!(pic.kind, ElementKind::Picture);
    assert_eq!(pic.descr, "Un logo");
    assert_eq!(pic.image.as_ref().unwrap().media, "ppt/media/oel-abc.png");
    assert!(imp.media.iter().any(|m| m.path == "ppt/media/oel-abc.png" && m.mime == "image/png"));
}

#[test]
fn embedded_fonts_reach_the_editor() {
    // Presentation 3 with an embedded font (EOT-wrapped, XOR-encrypted, as PowerPoint's .fntdata).
    let mut pkg = Package::read(&fixture(3)).unwrap();
    let ttf: Vec<u8> = [&[0u8, 1, 0, 0][..], &[9u8; 64][..]].concat();
    let mut eot = vec![0u8; 82];
    eot[0..4].copy_from_slice(&((82 + ttf.len()) as u32).to_le_bytes());
    eot[4..8].copy_from_slice(&(ttf.len() as u32).to_le_bytes());
    eot[12..16].copy_from_slice(&0x1000_0000u32.to_le_bytes());
    eot[34..36].copy_from_slice(&0x504Cu16.to_le_bytes());
    eot.extend(ttf.iter().map(|b| b ^ 0x50));
    pkg.set("ppt/fonts/font1.fntdata", eot);
    pkg.ensure_default("fntdata", "application/x-fontdata");
    let rid = pkg.add_rel("ppt/presentation.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font", "fonts/font1.fntdata", false);
    let pres = pkg.get_str("ppt/presentation.xml").unwrap().replace("<p:defaultTextStyle>", &format!(r#"<p:embeddedFontLst><p:embeddedFont><p:font typeface="Brasserie"/><p:regular r:id="{rid}"/></p:embeddedFont></p:embeddedFontLst><p:defaultTextStyle>"#));
    pkg.set("ppt/presentation.xml", pres.into_bytes());
    let bytes = pkg.write().unwrap();

    let imp = import_pptx(&bytes).unwrap();
    let font = imp.deck.fonts.iter().find(|f| f.name == "Brasserie").expect("embedded font listed");
    assert_eq!(font.embedded.len(), 1);
    assert_eq!((font.embedded[0].weight, font.embedded[0].italic), (400, false));
    let media = imp.media.iter().find(|m| m.path == font.embedded[0].path).expect("font among the media");
    assert_eq!(media.bytes, ttf);
    assert_eq!(media.mime, "font/ttf");
    // The package keeps the original .fntdata through an edit.
    let mut deck = imp.deck;
    deck.slides[0].hidden = true;
    let out = export_pptx(&deck, Some(&bytes), HashMap::new()).unwrap();
    assert_eq!(part_map(&out).get("ppt/fonts/font1.fntdata"), part_map(&bytes).get("ppt/fonts/font1.fntdata"));
}

#[test]
fn svg_only_graphics_are_pictures() {
    // Presentation 1's title layout draws Office graphics that carry only an SVG.
    let deck = import_pptx(&fixture(1)).unwrap().deck;
    let layout = deck.layouts.iter().find(|l| l.id == deck.slides[0].layout).unwrap();
    let graphics: Vec<_> = layout.decorations.iter().filter(|e| e.kind == ElementKind::Picture).collect();
    assert!(!graphics.is_empty());
    for g in graphics {
        let img = g.image.as_ref().unwrap();
        assert!(img.media.ends_with(".svg"), "{} draws its SVG", g.name);
    }
}

#[test]
fn chart_frames_carry_their_chart() {
    let bytes = std::fs::read(format!("{}/../../fixtures/charts/generated-charts.pptx", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let imp = import_pptx(&bytes).unwrap();
    let charts: Vec<&Element> = imp.deck.slides.iter().flat_map(|s| &s.elements).filter(|e| e.chart.is_some()).collect();
    assert_eq!(charts.len(), 29);
    let kinds: std::collections::BTreeSet<String> = charts.iter().map(|e| e.chart.as_ref().unwrap().groups[0].kind.clone()).collect();
    for k in ["bar", "line", "pie", "doughnut", "area", "scatter", "bubble", "radar"] {
        assert!(kinds.contains(k), "{k} in {kinds:?}");
    }
    // Chart parts are written back untouched.
    let out = export_pptx(&imp.deck, Some(&bytes), HashMap::new()).unwrap();
    let (a, b) = (part_map(&bytes), part_map(&out));
    for (name, data) in a.iter().filter(|(n, _)| n.starts_with("ppt/charts/")) {
        assert_eq!(Some(data), b.get(name), "{name}");
    }
}
