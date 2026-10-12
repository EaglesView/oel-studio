//! Built-in package for new presentations: 16:9, one master with the Office
//! theme (Calibri Light / Calibri), six layouts with fr-CA names, a notes
//! master, and one title slide.

use oel_opc::package::Package;

const P: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
"#;
const RELS: &str = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#;
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CONTENT_TYPES: &str = r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>LAYOUTS<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#;

const CORE: &str = r#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>OutilsEnLigne.ca</dc:creator></cp:coreProperties>"#;

const APP: &str = r#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OutilsEnLigne.ca</Application><PresentationFormat>Grand écran</PresentationFormat><Slides>1</Slides></Properties>"#;

/// Paragraph defaults of the presentation and the master's text styles (levels 1–9).
fn levels(sizes: [u32; 9], first_indent: bool, bullets: bool, color: &str, face: &str, before: u32) -> String {
    (0..9)
        .map(|i| {
            let mar = if first_indent { 228_600 + i as u32 * 457_200 } else { i as u32 * 457_200 };
            let indent = if bullets { r#" indent="-228600""# } else { "" };
            let bu = if bullets { r#"<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/>"# } else { "<a:buNone/>" };
            let spc = if before > 0 { format!(r#"<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="{before}"/></a:spcBef>"#) } else { String::new() };
            format!(
                r#"<a:lvl{n}pPr marL="{mar}"{indent} algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">{spc}{bu}<a:defRPr sz="{sz}" kern="1200"><a:solidFill><a:schemeClr val="{color}"/></a:solidFill><a:latin typeface="{face}"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl{n}pPr>"#,
                n = i + 1,
                sz = sizes[i],
            )
        })
        .collect()
}

fn presentation() -> String {
    format!(
        r#"<p:presentation {P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="fr-CA"/></a:defPPr>{}</p:defaultTextStyle></p:presentation>"#,
        levels([1800; 9], false, false, "tx1", "+mn-lt", 0).replace(r#"<a:buNone/>"#, "")
    )
}

fn presentation_rels() -> String {
    format!(
        r#"{RELS}<Relationship Id="rId1" Type="{R}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="{R}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="{R}/notesMaster" Target="notesMasters/notesMaster1.xml"/><Relationship Id="rId4" Type="{R}/presProps" Target="presProps.xml"/><Relationship Id="rId5" Type="{R}/viewProps" Target="viewProps.xml"/><Relationship Id="rId6" Type="{R}/theme" Target="theme/theme1.xml"/><Relationship Id="rId7" Type="{R}/tableStyles" Target="tableStyles.xml"/></Relationships>"#
    )
}

const THEME_ELEMENTS: &str = r#"<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light" panose="020F0302020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>"#;

fn theme(name: &str) -> String {
    format!(r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="{name}"><a:themeElements>{THEME_ELEMENTS}</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"#)
}

/// A placeholder shape. `xfrm` = (x, y, cx, cy), or none to inherit it; `body` = `a:bodyPr` attributes.
fn ph(id: u32, name: &str, ph: &str, xfrm: Option<(i64, i64, i64, i64)>, body: &str, autofit: bool, lst: &str, text: &str) -> String {
    let x = xfrm
        .map(|(x, y, cx, cy)| format!(r#"<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>"#))
        .unwrap_or_default();
    let body = if autofit { format!("<a:bodyPr{body}><a:normAutofit/></a:bodyPr>") } else { format!("<a:bodyPr{body}/>") };
    let lst = if lst.is_empty() { "<a:lstStyle/>".to_string() } else { format!("<a:lstStyle>{lst}</a:lstStyle>") };
    let t = match text {
        "" => r#"<a:p><a:endParaRPr lang="fr-CA"/></a:p>"#.to_string(),
        "‹#›" => r#"<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="fr-CA"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="fr-CA"/></a:p>"#.to_string(),
        t => format!(r#"<a:p><a:r><a:rPr lang="fr-CA"/><a:t>{t}</a:t></a:r><a:endParaRPr lang="fr-CA"/></a:p>"#),
    };
    format!(r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph {ph}/></p:nvPr></p:nvSpPr><p:spPr>{x}</p:spPr><p:txBody>{body}{lst}{t}</p:txBody></p:sp>"#)
}

const TREE_HEAD: &str = r#"<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>"#;

fn footers(base: u32) -> String {
    [
        ph(base, "Date Placeholder", r#"type="dt" sz="half" idx="10""#, None, "", false, "", ""),
        ph(base + 1, "Footer Placeholder", r#"type="ftr" sz="quarter" idx="11""#, None, "", false, "", ""),
        ph(base + 2, "Slide Number Placeholder", r#"type="sldNum" sz="quarter" idx="12""#, None, "", false, "", "‹#›"),
    ]
    .concat()
}

const INS: &str = r#" vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0""#;
const INS_CTR: &str = r#" vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr""#;

fn master() -> String {
    let small = |algn: &str| format!(r#"<a:lvl1pPr algn="{algn}"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr>"#);
    let tree = [
        ph(2, "Title Placeholder 1", r#"type="title""#, Some((838_200, 365_125, 10_515_600, 1_325_563)), INS_CTR, true, "", "Modifiez le style du titre"),
        ph(3, "Text Placeholder 2", r#"type="body" idx="1""#, Some((838_200, 1_825_625, 10_515_600, 4_351_338)), INS, true, "", "Modifiez les styles du texte"),
        ph(4, "Date Placeholder 3", r#"type="dt" sz="half" idx="2""#, Some((838_200, 6_356_350, 2_743_200, 365_125)), INS_CTR, false, &small("l"), ""),
        ph(5, "Footer Placeholder 4", r#"type="ftr" sz="quarter" idx="3""#, Some((4_038_600, 6_356_350, 4_114_800, 365_125)), INS_CTR, false, &small("ctr"), ""),
        ph(6, "Slide Number Placeholder 5", r#"type="sldNum" sz="quarter" idx="4""#, Some((8_610_600, 6_356_350, 2_743_200, 365_125)), INS_CTR, false, &small("r"), "‹#›"),
    ]
    .concat();
    let title_style = r#"<a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr>"#;
    let body_style = levels([2800, 2400, 2000, 1800, 1800, 1800, 1800, 1800, 1800], true, true, "tx1", "+mn-lt", 1000);
    let other_style = format!(r#"<a:defPPr><a:defRPr lang="fr-CA"/></a:defPPr>{}"#, levels([1800; 9], false, false, "tx1", "+mn-lt", 0).replace("<a:buNone/>", ""));
    let ids: String = (1..=6).map(|i| format!(r#"<p:sldLayoutId id="{}" r:id="rId{i}"/>"#, 2_147_483_648u64 + i)).collect();
    format!(
        r#"<p:sldMaster {P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>{TREE_HEAD}{tree}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>{ids}</p:sldLayoutIdLst><p:txStyles><p:titleStyle>{title_style}</p:titleStyle><p:bodyStyle>{body_style}</p:bodyStyle><p:otherStyle>{other_style}</p:otherStyle></p:txStyles></p:sldMaster>"#
    )
}

fn master_rels() -> String {
    let layouts: String = (1..=6).map(|i| format!(r#"<Relationship Id="rId{i}" Type="{R}/slideLayout" Target="../slideLayouts/slideLayout{i}.xml"/>"#)).collect();
    format!(r#"{RELS}{layouts}<Relationship Id="rId7" Type="{R}/theme" Target="../theme/theme1.xml"/></Relationships>"#)
}

fn layout(kind: &str, name: &str, shapes: &str) -> String {
    format!(r#"<p:sldLayout {P} type="{kind}" preserve="1"><p:cSld name="{name}"><p:spTree>{TREE_HEAD}{shapes}{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"#, footers(20))
}

fn layouts() -> Vec<String> {
    let none = "";
    let center = r#"<a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr>"#;
    let sub = r#"<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr>"#;
    let section_body = r#"<a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr>"#;
    vec![
        layout(
            "title",
            "Diapositive de titre",
            &[
                ph(2, "Title 1", r#"type="ctrTitle""#, Some((1_524_000, 1_122_363, 9_144_000, 2_387_600)), r#" anchor="b""#, false, center, "Cliquez pour ajouter un titre"),
                ph(3, "Subtitle 2", r#"type="subTitle" idx="1""#, Some((1_524_000, 3_602_038, 9_144_000, 1_655_762)), none, false, sub, "Cliquez pour ajouter un sous-titre"),
            ]
            .concat(),
        ),
        layout("obj", "Titre et contenu", &[ph(2, "Title 1", r#"type="title""#, None, none, false, none, "Cliquez pour ajouter un titre"), ph(3, "Content Placeholder 2", r#"idx="1""#, None, none, false, none, "Cliquez pour ajouter du texte")].concat()),
        layout(
            "secHead",
            "En-tête de section",
            &[
                ph(2, "Title 1", r#"type="title""#, Some((831_850, 1_709_738, 10_515_600, 2_852_737)), r#" anchor="b""#, false, r#"<a:lvl1pPr><a:defRPr sz="6000"/></a:lvl1pPr>"#, "Cliquez pour ajouter un titre"),
                ph(3, "Text Placeholder 2", r#"type="body" idx="1""#, Some((831_850, 4_589_463, 10_515_600, 1_500_187)), none, false, section_body, "Cliquez pour ajouter du texte"),
            ]
            .concat(),
        ),
        layout(
            "twoObj",
            "Deux contenus",
            &[
                ph(2, "Title 1", r#"type="title""#, None, none, false, none, "Cliquez pour ajouter un titre"),
                ph(3, "Content Placeholder 2", r#"sz="half" idx="1""#, Some((838_200, 1_825_625, 5_181_600, 4_351_338)), none, false, none, "Cliquez pour ajouter du texte"),
                ph(4, "Content Placeholder 3", r#"sz="half" idx="2""#, Some((6_172_200, 1_825_625, 5_181_600, 4_351_338)), none, false, none, "Cliquez pour ajouter du texte"),
            ]
            .concat(),
        ),
        layout("titleOnly", "Titre seul", &ph(2, "Title 1", r#"type="title""#, None, none, false, none, "Cliquez pour ajouter un titre")),
        layout("blank", "Vide", ""),
    ]
}

fn layout_rels() -> String {
    format!(r#"{RELS}<Relationship Id="rId1" Type="{R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#)
}

fn slide() -> String {
    format!(
        r#"<p:sld {P}><p:cSld><p:spTree>{TREE_HEAD}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Titre 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-CA" dirty="0"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Sous-titre 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-CA" dirty="0"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
    )
}

fn notes_master() -> String {
    let lst = levels([1200; 9], false, false, "tx1", "+mn-lt", 0).replace("<a:buNone/>", "");
    format!(
        r#"<p:notesMaster {P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>{TREE_HEAD}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:endParaRPr lang="fr-CA"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle>{lst}</p:notesStyle></p:notesMaster>"#
    )
}

pub fn package() -> Package {
    let layout_ct: String = (1..=6).map(|i| format!(r#"<Override PartName="/ppt/slideLayouts/slideLayout{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>"#)).collect();
    let mut parts: Vec<(String, String)> = vec![
        ("[Content_Types].xml".into(), CONTENT_TYPES.replace("LAYOUTS", &layout_ct)),
        ("_rels/.rels".into(), format!("{RELS}{ROOT_RELS}")),
        ("docProps/core.xml".into(), CORE.into()),
        ("docProps/app.xml".into(), APP.into()),
        ("ppt/presentation.xml".into(), presentation()),
        ("ppt/_rels/presentation.xml.rels".into(), presentation_rels()),
        ("ppt/slideMasters/slideMaster1.xml".into(), master()),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels".into(), master_rels()),
    ];
    for (i, l) in layouts().into_iter().enumerate() {
        parts.push((format!("ppt/slideLayouts/slideLayout{}.xml", i + 1), l));
        parts.push((format!("ppt/slideLayouts/_rels/slideLayout{}.xml.rels", i + 1), layout_rels()));
    }
    parts.extend([
        ("ppt/slides/slide1.xml".into(), slide()),
        ("ppt/slides/_rels/slide1.xml.rels".into(), format!(r#"{RELS}<Relationship Id="rId1" Type="{R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#)),
        ("ppt/notesMasters/notesMaster1.xml".into(), notes_master()),
        ("ppt/notesMasters/_rels/notesMaster1.xml.rels".into(), format!(r#"{RELS}<Relationship Id="rId1" Type="{R}/theme" Target="../theme/theme2.xml"/></Relationships>"#)),
        ("ppt/theme/theme1.xml".into(), theme("Thème Office")),
        ("ppt/theme/theme2.xml".into(), theme("Thème Office")),
        ("ppt/presProps.xml".into(), format!(r#"<p:presentationPr {P}/>"#)),
        ("ppt/viewProps.xml".into(), format!(r#"<p:viewPr {P}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>"#)),
        ("ppt/tableStyles.xml".into(), r#"<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>"#.into()),
    ]);
    Package { parts: parts.into_iter().map(|(n, d)| (n, format!("{HEAD}{d}").into_bytes())).collect() }
}

pub fn package_bytes() -> Vec<u8> {
    package().write().expect("template package")
}
