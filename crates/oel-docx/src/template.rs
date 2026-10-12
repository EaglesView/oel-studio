//! Built-in package for new documents, and the style/numbering definitions
//! added to imported documents when the editor uses something they lack.
//! Defaults follow Google Docs (Arial 11, 1.15 spacing, its heading sizes).

use super::package::Package;
use super::xml::XElement;

pub const SECT_PR: &str = r#"<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/>"#;

pub const DOCUMENT_XML: &str = concat!(
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
    "\n<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" mc:Ignorable=\"w14\">",
    "<w:body><w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/><w:cols w:space=\"720\"/><w:docGrid w:linePitch=\"360\"/></w:sectPr></w:body></w:document>"
);

pub const NUMBERING_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></w:numbering>"#;

fn para_style(id: &str, name: &str, ppr: &str, rpr: &str, outline: Option<u8>) -> String {
    let ol = outline.map(|o| format!("<w:outlineLvl w:val=\"{o}\"/>")).unwrap_or_default();
    format!(
        r#"<w:style w:type="paragraph" w:styleId="{id}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>{ppr}{ol}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>"#
    )
}

pub static STYLES_XML: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let mut s = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-CA" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>"#);
    s.push_str(&para_style("Title", "Title", r#"<w:spacing w:after="60"/>"#, r#"<w:sz w:val="52"/><w:szCs w:val="52"/>"#, None));
    s.push_str(&para_style("Subtitle", "Subtitle", r#"<w:spacing w:after="320"/>"#, r#"<w:color w:val="666666"/><w:sz w:val="30"/><w:szCs w:val="30"/>"#, None));
    let headings = [
        (1, "400", "120", "40", ""),
        (2, "360", "120", "32", ""),
        (3, "320", "80", "28", "<w:color w:val=\"434343\"/>"),
        (4, "280", "80", "24", "<w:color w:val=\"666666\"/>"),
        (5, "240", "80", "22", "<w:color w:val=\"666666\"/>"),
        (6, "240", "80", "22", "<w:i/><w:color w:val=\"666666\"/>"),
    ];
    for (l, before, after, sz, extra) in headings {
        let rpr = format!("{extra}<w:sz w:val=\"{sz}\"/><w:szCs w:val=\"{sz}\"/>");
        s.push_str(&para_style(&format!("Heading{l}"), &format!("heading {l}"), &format!(r#"<w:spacing w:before="{before}" w:after="{after}"/>"#), &rpr, Some(l - 1)));
    }
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="1155CC"/><w:u w:val="single"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>"#);
    s.push_str(r#"<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>"#);
    s.push_str(r#"<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>"#);
    s.push_str("</w:styles>");
    s
});

/// Template style id for a Docs role, used when the document has no such style.
pub fn style_id_for_role(role: &str) -> Option<&'static str> {
    Some(match role {
        "normal" => "Normal",
        "title" => "Title",
        "subtitle" => "Subtitle",
        "heading1" => "Heading1",
        "heading2" => "Heading2",
        "heading3" => "Heading3",
        "heading4" => "Heading4",
        "heading5" => "Heading5",
        "heading6" => "Heading6",
        "listParagraph" => "ListParagraph",
        "footnoteText" => "FootnoteText",
        "footnoteReference" => "FootnoteReference",
        "endnoteText" => "EndnoteText",
        "endnoteReference" => "EndnoteReference",
        "hyperlink" => "Hyperlink",
        "header" => "Header",
        "footer" => "Footer",
        _ => return None,
    })
}

/// Nine-level list definition for lists created in the editor.
pub fn abstract_num(id: i64, kind: &str) -> XElement {
    let mut a = XElement::new("w:abstractNum").with_attr("w:abstractNumId", id.to_string());
    a = a.with_child(XElement::new("w:multiLevelType").with_attr("w:val", "hybridMultilevel"));
    for l in 0..9i64 {
        let (fmt, text) = match kind {
            "decimal" => match l % 3 {
                0 => ("decimal", format!("%{}.", l + 1)),
                1 => ("lowerLetter", format!("%{}.", l + 1)),
                _ => ("lowerRoman", format!("%{}.", l + 1)),
            },
            "check" => ("bullet", "☐".to_string()),
            "checked" => ("bullet", "☑".to_string()),
            _ => ("bullet", ["●", "○", "■"][(l % 3) as usize].to_string()),
        };
        let left = 720 * (l + 1);
        let lvl = XElement::new("w:lvl")
            .with_attr("w:ilvl", l.to_string())
            .with_child(XElement::new("w:start").with_attr("w:val", "1"))
            .with_child(XElement::new("w:numFmt").with_attr("w:val", fmt))
            .with_child(XElement::new("w:lvlText").with_attr("w:val", text))
            .with_child(XElement::new("w:lvlJc").with_attr("w:val", "left"))
            .with_child(XElement::new("w:pPr").with_child(XElement::new("w:ind").with_attr("w:left", left.to_string()).with_attr("w:hanging", "360")));
        a = a.with_child(lvl);
    }
    a
}

pub fn package() -> Package {
    let ct = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#;
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>"#;
    let settings = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>"#;
    let core = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title></dc:title><dc:creator>OutilsEnLigne</dc:creator></cp:coreProperties>"#;
    let app = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OutilsEnLigne Studio</Application></Properties>"#;
    Package {
        parts: vec![
            ("[Content_Types].xml".into(), ct.as_bytes().to_vec()),
            ("_rels/.rels".into(), rels.as_bytes().to_vec()),
            ("docProps/core.xml".into(), core.as_bytes().to_vec()),
            ("docProps/app.xml".into(), app.as_bytes().to_vec()),
            ("word/document.xml".into(), DOCUMENT_XML.as_bytes().to_vec()),
            ("word/_rels/document.xml.rels".into(), doc_rels.as_bytes().to_vec()),
            ("word/styles.xml".into(), STYLES_XML.as_bytes().to_vec()),
            ("word/settings.xml".into(), settings.as_bytes().to_vec()),
        ],
    }
}
