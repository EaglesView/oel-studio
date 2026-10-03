#!/usr/bin/env python3
"""Writes the minimal page-fidelity fixtures in fixtures/docx/ from hand-written
WordprocessingML, so each one exercises exactly one feature (see ../README.md).

    python3 fixtures/docx/src/make_fixtures.py

The output is deterministic (fixed zip timestamps). Check a change with
`node scripts/render-reference.mjs fixtures/docx/<name>.docx`.
"""
import struct
import zipfile
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent

NS = (
    'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:o="urn:schemas-microsoft-com:office:office" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:w10="urn:schemas-microsoft-com:office:word" '
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    'mc:Ignorable="w14 wp14"'
)
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
CT = "application/vnd.openxmlformats-officedocument.wordprocessingml."

THEME = DECL + """<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements>
<a:clrScheme name="Fixture"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Fixture"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>"""

STYLES = DECL + """<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>
<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
<w:style w:type="table" w:styleId="BandedAccent1"><w:name w:val="Banded Accent 1"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="4472C4"/></w:tblBorders></w:tblPr>
<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr>
<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr></w:style>
</w:styles>"""

SETTINGS = DECL + """<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">{extra}<w:defaultTabStop w:val="720"/>
<w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
<w:clrSchemeMapping w:bg1="light1" w:t1="dark1" w:bg2="light2" w:t2="dark2" w:accent1="accent1" w:accent2="accent2" w:accent3="accent3" w:accent4="accent4" w:accent5="accent5" w:accent6="accent6" w:hyperlink="hyperlink" w:followedHyperlink="followedHyperlink"/>
</w:settings>"""


def png(w, h):
    """A small RGB gradient, so a stretched or cropped picture is visible."""
    rows = b"".join(b"\x00" + bytes(v for x in range(w) for v in (40 + 200 * x // w, 90, 40 + 200 * y // h)) for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def p(text="", ppr="", runs=None):
    inner = runs if runs is not None else (f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>' if text else "")
    return f"<w:p>{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}{inner}</w:p>"


def page_break():
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def field(instr, shown):
    return (
        f'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> {instr} </w:instrText></w:r>'
        f'<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>{shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
    )


def build(name, body, rels=(), parts=(), settings_extra=""):
    """rels: (id, type, target); parts: (path, content type or None, bytes|str)."""
    overrides = [
        ("/word/document.xml", CT + "document.main+xml"),
        ("/word/styles.xml", CT + "styles+xml"),
        ("/word/settings.xml", CT + "settings+xml"),
        ("/word/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
    ] + [("/" + path, ct) for path, ct, _ in parts if ct]
    ct_xml = DECL + (
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
        + "".join(f'<Override PartName="{n}" ContentType="{t}"/>' for n, t in overrides)
        + "</Types>"
    )
    root_rels = DECL + (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{REL}officeDocument" Target="word/document.xml"/></Relationships>'
    )
    all_rels = [("rIdStyles", "styles", "styles.xml"), ("rIdSettings", "settings", "settings.xml"), ("rIdTheme", "theme", "theme/theme1.xml")] + list(rels)
    doc_rels = DECL + (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(f'<Relationship Id="{i}" Type="{REL}{t}" Target="{tg}"/>' for i, t, tg in all_rels)
        + "</Relationships>"
    )
    document = DECL + f"<w:document {NS}><w:body>{body}</w:body></w:document>"
    files = [
        ("[Content_Types].xml", ct_xml),
        ("_rels/.rels", root_rels),
        ("word/document.xml", document),
        ("word/_rels/document.xml.rels", doc_rels),
        ("word/styles.xml", STYLES),
        ("word/settings.xml", SETTINGS.format(extra=settings_extra)),
        ("word/theme/theme1.xml", THEME),
    ] + [(path, data) for path, _, data in parts]
    with zipfile.ZipFile(OUT / name, "w", zipfile.ZIP_DEFLATED) as z:
        for path, data in files:
            info = zipfile.ZipInfo(path, date_time=(2026, 10, 3, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode() if isinstance(data, str) else data)
    print("wrote", name)


def sect(inner, pg="", mar=""):
    pg = pg or '<w:pgSz w:w="12240" w:h="15840"/>'
    mar = mar or '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    return f"<w:sectPr>{inner[0]}{inner[1]}{pg}{mar}{inner[2]}<w:cols w:space=\"720\"/>{inner[3]}<w:docGrid w:linePitch=\"360\"/></w:sectPr>"


def sect_pr(refs="", kind="", pg="", mar="", pgnum="", title_pg=False):
    """sectPr children in schema order."""
    t = f'<w:type w:val="{kind}"/>' if kind else ""
    return sect((refs, t, pgnum, "<w:titlePg/>" if title_pg else ""), pg, mar)


def sections_margins():
    lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
    s1 = sect_pr(mar='<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>')
    landscape = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
    s2 = sect_pr(pg=landscape)
    s3 = sect_pr(kind="continuous", pg=landscape, mar='<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="2880" w:header="720" w:footer="720" w:gutter="0"/>')
    body = (
        p("Section 1 : Lettre portrait, marges de 0,5 po", '<w:pStyle w:val="Heading1"/>')
        + p(lorem * 4)
        + p("Fin de la section 1.", s1)
        + p("Section 2 : Lettre paysage, marges de 1 po", '<w:pStyle w:val="Heading1"/>')
        + p(lorem * 4)
        + p("Fin de la section 2 (la section 3 suit sans saut de page).", s2)
        + p("Section 3 : continue, marge gauche de 2 po", '<w:pStyle w:val="Heading1"/>')
        + p(lorem * 4)
        + s3
    )
    build("sections-margins.docx", body)


def sections_headers():
    def story(root, label, page=False):
        tag = "w:hdr" if root == "hdr" else "w:ftr"
        style = "Header" if root == "hdr" else "Footer"
        runs = f'<w:r><w:t xml:space="preserve">{label}</w:t></w:r>' + (f'<w:r><w:t xml:space="preserve"> · page </w:t></w:r>{field("PAGE", "1")}' if page else "")
        return DECL + f'<{tag} {NS}><w:p><w:pPr><w:pStyle w:val="{style}"/><w:jc w:val="center"/></w:pPr>{runs}</w:p></{tag}>'

    parts = [
        ("word/header1.xml", CT + "header+xml", story("hdr", "En-tête par défaut, section 1")),
        ("word/header2.xml", CT + "header+xml", story("hdr", "En-tête première page, section 1")),
        ("word/header3.xml", CT + "header+xml", story("hdr", "En-tête pages paires, section 1")),
        ("word/footer1.xml", CT + "footer+xml", story("ftr", "Pied de page, section 1", page=True)),
        ("word/footer2.xml", CT + "footer+xml", story("ftr", "Pied de page, section 3", page=True)),
    ]
    rels = [
        ("rIdH1", "header", "header1.xml"),
        ("rIdH2", "header", "header2.xml"),
        ("rIdH3", "header", "header3.xml"),
        ("rIdF1", "footer", "footer1.xml"),
        ("rIdF2", "footer", "footer2.xml"),
    ]
    refs1 = (
        '<w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/>'
        '<w:headerReference w:type="even" r:id="rIdH3"/><w:footerReference w:type="default" r:id="rIdF1"/>'
    )
    s1 = sect_pr(refs=refs1, pgnum='<w:pgNumType w:fmt="lowerRoman" w:start="1"/>', title_pg=True)
    s2 = sect_pr(pgnum='<w:pgNumType w:start="1"/>')
    s3 = sect_pr(refs='<w:footerReference w:type="default" r:id="rIdF2"/>')
    body = (
        p("Section 1, page i (première page : en-tête « première page »)", '<w:pStyle w:val="Heading1"/>')
        + page_break()
        + p("Section 1, page ii (paire : en-tête « pages paires »)")
        + page_break()
        + p("Section 1, page iii (impaire : en-tête par défaut)", s1)
        + p("Section 2, page 1 : hérite des en-têtes et pieds de la section 1, numérotation redémarre en arabe", '<w:pStyle w:val="Heading1"/>')
        + page_break()
        + p("Section 2, page 2")
        + page_break()
        + p("Section 2, page 3", s2)
        + p("Section 3, page 4 : son propre pied de page, en-têtes hérités", '<w:pStyle w:val="Heading1"/>')
        + page_break()
        + p("Section 3, page 5")
        + s3
    )
    build("sections-headers.docx", body, rels, parts, settings_extra="<w:evenAndOddHeaders/>")


def anchor(doc_id, name, pos_h, pos_v, cx, cy, graphic, behind=False, wrap="<wp:wrapNone/>", z=251659264, extra=""):
    return (
        f'<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="{z}" behindDoc="{1 if behind else 0}" locked="0" layoutInCell="1" allowOverlap="1">'
        f'<wp:simplePos x="0" y="0"/>{pos_h}{pos_v}<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{wrap}'
        f'<wp:docPr id="{doc_id}" name="{name}"{extra}/><wp:cNvGraphicFramePr/>{graphic}</wp:anchor>'
    )


def pos(axis, rel, offset=None, align=None):
    tag = "wp:positionH" if axis == "h" else "wp:positionV"
    inner = f"<wp:align>{align}</wp:align>" if align else f"<wp:posOffset>{offset}</wp:posOffset>"
    return f'<{tag} relativeFrom="{rel}">{inner}</{tag}>'


def wps(cx, cy, geom, fill, line="<a:ln><a:noFill/></a:ln>", txbx="", body_pr="<wps:bodyPr/>"):
    return (
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/>'
        f'<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom>{fill}{line}</wps:spPr>'
        f"{txbx}{body_pr}</wps:wsp></a:graphicData></a:graphic>"
    )


def anchors():
    emu = 914400  # per inch
    # 1. Behind-text rectangle relative to the page: theme colour with transforms.
    rect = anchor(
        1, "Fond", pos("h", "page", 0), pos("v", "page", 0), 2 * emu, 11 * emu,
        wps(2 * emu, 11 * emu, "rect", '<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:solidFill>'),
        behind=True, z=251658240,
    )
    # 2. Picture, square wrap, relative to the column.
    picture = anchor(
        2, "Image", pos("h", "column", align="right"), pos("v", "paragraph", 0), int(1.5 * emu), emu,
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{int(1.5 * emu)}" cy="{emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>',
        wrap='<wp:wrapSquare wrapText="bothSides"/>', z=251659265, extra=' descr="Dégradé de test"',
    )
    # 3. Text box (wps + txbx), in mc:AlternateContent with a VML fallback.
    txbx_content = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Zone de texte</w:t></w:r></w:p><w:p><w:r><w:t>Deuxième ligne</w:t></w:r></w:p>'
    textbox = anchor(
        3, "Zone de texte 3", pos("h", "margin", int(3.5 * emu)), pos("v", "paragraph", int(0.2 * emu)), 2 * emu, int(0.8 * emu),
        wps(2 * emu, int(0.8 * emu), "rect", '<a:solidFill><a:schemeClr val="accent2"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill>',
            '<a:ln w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>',
            txbx=f"<wps:txbx><w:txbxContent>{txbx_content}</w:txbxContent></wps:txbx>",
            body_pr='<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"/>'),
        wrap='<wp:wrapTopAndBottom/>', z=251659266,
    )
    textbox_ac = (
        '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' + textbox + '</w:drawing></mc:Choice>'
        '<mc:Fallback><w:pict><v:rect id="Zone 3" style="position:absolute;margin-left:252pt;margin-top:14.4pt;width:144pt;height:57.6pt;z-index:251659266" fillcolor="#fbe4d5" strokecolor="#ed7d31">'
        f'<v:textbox><w:txbxContent>{txbx_content}</w:txbxContent></v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent>'
    )
    # 4. Group: an ellipse and a rectangle.
    group = anchor(
        4, "Groupe 4", pos("h", "margin", 0), pos("v", "paragraph", int(0.1 * emu)), 3 * emu, emu,
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>'
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{3 * emu}" cy="{emu}"/><a:chOff x="0" y="0"/><a:chExt cx="{3 * emu}" cy="{emu}"/></a:xfrm></wpg:grpSpPr>'
        f'<wps:wsp><wps:cNvPr id="5" name="Ellipse 5"/><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu}" cy="{emu}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
        '<a:solidFill><a:schemeClr val="accent6"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
        f'<wps:wsp><wps:cNvPr id="6" name="Rectangle 6"/><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="{int(1.5 * emu)}" y="{int(0.25 * emu)}"/><a:ext cx="{int(1.5 * emu)}" cy="{int(0.5 * emu)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        '<a:solidFill><a:srgbClr val="FFC000"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
        '</wpg:wgp></a:graphicData></a:graphic>',
        wrap='<wp:wrapTopAndBottom/>', z=251659267,
    )
    # 5. Ellipse with a picture fill (like the template's cover photo).
    oval = anchor(
        7, "Ovale 7", pos("h", "page", int(4.5 * emu)), pos("v", "page", int(7 * emu)), int(3.5 * emu), int(3.5 * emu),
        wps(int(3.5 * emu), int(3.5 * emu), "ellipse", '<a:blipFill><a:blip r:embed="rIdImg"/><a:srcRect l="10000" r="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'),
        z=251659268,
    )
    lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
    run = lambda d: f"<w:r><w:drawing>{d}</w:drawing></w:r>"
    body = (
        p("Objets flottants", '<w:pStyle w:val="Heading1"/><w:ind w:left="2160"/>', runs='<w:r><w:t>Objets flottants</w:t></w:r>' + run(rect))
        + p(runs=run(picture) + f'<w:r><w:t xml:space="preserve">Une image ancrée à droite de la colonne, habillage carré. {lorem * 3}</w:t></w:r>', ppr='<w:ind w:left="2160"/>')
        + p(runs="<w:r>" + textbox_ac + "</w:r><w:r><w:t>Une zone de texte (habillage haut et bas) suit ce paragraphe.</w:t></w:r>", ppr='<w:ind w:left="2160"/>')
        + p(runs=run(group) + "<w:r><w:t>Un groupe : une ellipse et un rectangle.</w:t></w:r>", ppr='<w:ind w:left="2160"/>')
        + p(runs=run(oval) + "<w:r><w:t>Un ovale rempli d’une image, positionné par rapport à la page.</w:t></w:r>", ppr='<w:ind w:left="2160"/>')
        + sect_pr()
    )
    build("anchors.docx", body, [("rIdImg", "image", "media/image1.png")], [("word/media/image1.png", None, png(96, 64))])


def tables():
    def table(tbl_pr, rows, cols=3, cell_pr=lambda r, c: ""):
        grid = "".join('<w:gridCol w:w="3000"/>' for _ in range(cols))
        trs = ""
        for r in range(rows):
            tcs = "".join(f'<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>{cell_pr(r, c)}</w:tcPr><w:p><w:r><w:t>L{r + 1} C{c + 1}</w:t></w:r></w:p></w:tc>' for c in range(cols))
            trs += f"<w:tr>{tcs}</w:tr>"
        return f"<w:tbl><w:tblPr>{tbl_pr}</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{trs}</w:tbl>"

    look = '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
    red = lambda r, c: '<w:tcBorders><w:bottom w:val="double" w:sz="6" w:space="0" w:color="C00000"/></w:tcBorders>' if (r, c) == (1, 1) else ""
    body = (
        p("1. Sans bordures ni style", '<w:pStyle w:val="Heading1"/>')
        + table('<w:tblW w:w="0" w:type="auto"/>' + look, 2)
        + p("2. Style « Table Grid »", '<w:pStyle w:val="Heading1"/>')
        + table('<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' + look, 2)
        + p("3. Bordure de cellule (L2 C2, double rouge en bas), sans style", '<w:pStyle w:val="Heading1"/>')
        + table('<w:tblW w:w="0" w:type="auto"/>' + look, 3, cell_pr=red)
        + p("4. Style à bandes, première ligne en en-tête, largeur 100 %", '<w:pStyle w:val="Heading1"/>')
        + table('<w:tblStyle w:val="BandedAccent1"/><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/>' + look, 4)
        + p()
        + sect_pr()
    )
    build("table-borders.docx", body)


if __name__ == "__main__":
    sections_margins()
    sections_headers()
    anchors()
    tables()
