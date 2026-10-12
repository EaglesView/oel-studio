"""Builds interim chart fixtures (one chart per Office chart type) until files
saved by Microsoft Office are added next to them.

    python -m venv venv && venv/bin/pip install python-pptx openpyxl
    venv/bin/python fixtures/charts/make_charts.py

- generated-charts.pptx: one slide per python-pptx chart type (title = the type).
- generated-charts.xlsx: one sheet per openpyxl chart kind, data in A1:D7.
- generated-charts.docx: three inline charts (columns, lines, pie) whose chart
  parts are copied from the pptx, wired the way Word writes them.
"""
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import BubbleChartData, CategoryChartData, XyChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.util import Inches

HERE = Path(__file__).parent

CATS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin"]
SERIES = {"Nord": (44.8, 43.1, 44.5, 42.7, 44.1, 42.4), "Sud": (33.1, 31.4, 32.8, 31.0, 32.4, 33.8), "Ouest": (19.4, 20.8, 19.1, 20.5, 18.7, 20.1)}


def category_data(n_series=3):
    d = CategoryChartData()
    d.categories = CATS
    for name, vals in list(SERIES.items())[:n_series]:
        d.add_series(name, vals)
    return d


def xy_data():
    d = XyChartData()
    for k, name in enumerate(["Mesures A", "Mesures B"]):
        s = d.add_series(name)
        for i in range(8):
            s.add_data_point(i * 1.5 + k, (i * 7 + 13 * k) % 23 + 2)
    return d


def bubble_data():
    d = BubbleChartData()
    for k, name in enumerate(["Régions", "Villes"]):
        s = d.add_series(name)
        for i in range(5):
            s.add_data_point(i * 2 + k, (i * 5 + 3 * k) % 11 + 1, (i * 3 + k) % 7 + 2)
    return d


def pptx():
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    layout = prs.slide_layouts[5]
    single = {"PIE", "PIE_EXPLODED", "THREE_D_PIE", "THREE_D_PIE_EXPLODED", "BAR_OF_PIE", "PIE_OF_PIE", "DOUGHNUT", "DOUGHNUT_EXPLODED"}
    for t in XL_CHART_TYPE:
        name = t.name
        if name.startswith("SURFACE") or name.startswith("STOCK"):
            continue  # not supported by python-pptx's XML writer
        if name.startswith("XY_SCATTER"):
            data = xy_data()
        elif name.startswith("BUBBLE"):
            data = bubble_data()
        else:
            data = category_data(1 if name in single else 3)
        slide = prs.slides.add_slide(layout)
        slide.shapes.title.text = name
        try:
            gf = slide.shapes.add_chart(t, Inches(0.8), Inches(1.5), Inches(11.5), Inches(5.5), data)
        except NotImplementedError:  # 3-D, cone, pyramid, of-pie: python-pptx can't write them
            ids = prs.slides._sldIdLst  # noqa: SLF001
            rid = ids[-1].rId
            prs.part.drop_rel(rid)
            ids.remove(ids[-1])
            continue
        chart = gf.chart
        chart.has_legend = name not in single or True
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    prs.save(HERE / "generated-charts.pptx")


def xlsx():
    from openpyxl import Workbook
    from openpyxl.chart import (AreaChart, AreaChart3D, BarChart, BarChart3D, BubbleChart, DoughnutChart, LineChart, LineChart3D,
                                PieChart, PieChart3D, ProjectedPieChart, RadarChart, Reference, ScatterChart, Series, StockChart,
                                SurfaceChart, SurfaceChart3D)

    wb = Workbook()
    wb.remove(wb.active)

    def sheet(title):
        ws = wb.create_sheet(title)
        ws.append(["Mois", *SERIES.keys()])
        for i, c in enumerate(CATS):
            ws.append([c, *(v[i] for v in SERIES.values())])
        return ws

    def place(ws, chart, title, n=3):
        data = Reference(ws, min_col=2, max_col=1 + n, min_row=1, max_row=7)
        cats = Reference(ws, min_col=1, min_row=2, max_row=7)
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        chart.title = title
        ws.add_chart(chart, "F2")

    for kind, grouping in [("col", "clustered"), ("col", "stacked"), ("col", "percentStacked"), ("bar", "clustered"), ("bar", "stacked")]:
        ws = sheet(f"Barres {kind} {grouping}"[:31])
        c = BarChart(); c.type = kind; c.grouping = grouping
        if grouping != "clustered":
            c.overlap = 100
        place(ws, c, f"{kind} {grouping}")
    ws = sheet("Barres 3D"); c = BarChart3D(); place(ws, c, "Barres 3D")
    for grouping in ["standard", "stacked", "percentStacked"]:
        ws = sheet(f"Courbes {grouping}"); c = LineChart(); c.grouping = grouping; place(ws, c, f"Courbes {grouping}")
    ws = sheet("Courbes 3D"); c = LineChart3D(); place(ws, c, "Courbes 3D")
    for grouping in ["standard", "stacked", "percentStacked"]:
        ws = sheet(f"Aires {grouping}"); c = AreaChart(); c.grouping = grouping; place(ws, c, f"Aires {grouping}")
    ws = sheet("Aires 3D"); c = AreaChart3D(); place(ws, c, "Aires 3D")
    for cls, title in [(PieChart, "Secteurs"), (PieChart3D, "Secteurs 3D"), (DoughnutChart, "Anneau"), (ProjectedPieChart, "Secteurs de secteur")]:
        ws = sheet(title); place(ws, cls(), title, n=1)
    ws = sheet("Radar"); c = RadarChart(); c.type = "marker"; place(ws, c, "Radar")
    ws = sheet("Radar plein"); c = RadarChart(); c.type = "filled"; place(ws, c, "Radar plein")
    ws = sheet("Surface"); place(ws, SurfaceChart(), "Contour")
    ws = sheet("Surface 3D"); place(ws, SurfaceChart3D(), "Surface 3D")

    ws = sheet("Nuage de points")
    c = ScatterChart(); c.title = "Nuage de points"; c.style = 13
    x = Reference(ws, min_col=2, min_row=2, max_row=7)
    for col in (3, 4):
        s = Series(Reference(ws, min_col=col, min_row=1, max_row=7), x, title_from_data=True)
        s.marker.symbol = "circle"
        c.series.append(s)
    ws.add_chart(c, "F2")

    ws = sheet("Bulles")
    c = BubbleChart(); c.title = "Bulles"
    s = Series(values=Reference(ws, min_col=3, min_row=2, max_row=7), xvalues=Reference(ws, min_col=2, min_row=2, max_row=7),
               zvalues=Reference(ws, min_col=4, min_row=2, max_row=7), title="Régions")
    c.series.append(s)
    ws.add_chart(c, "F2")

    ws = wb.create_sheet("Boursier")
    ws.append(["Date", "Ouverture", "Haut", "Bas", "Fermeture"])
    for i in range(8):
        o = 20 + (i * 7) % 9
        ws.append([f"J{i + 1}", o, o + 4, o - 3, o + (2 if i % 2 else -1)])
    c = StockChart(); c.title = "Ouverture-haut-bas-fermeture"
    c.add_data(Reference(ws, min_col=2, max_col=5, min_row=1, max_row=9), titles_from_data=True)
    c.set_categories(Reference(ws, min_col=1, min_row=2, max_row=9))
    from openpyxl.chart.updown_bars import UpDownBars
    from openpyxl.chart.axis import ChartLines
    c.hiLowLines = ChartLines(); c.upDownBars = UpDownBars()
    for s in c.series:
        s.graphicalProperties.line.noFill = True
    ws.add_chart(c, "G2")

    wb.save(HERE / "generated-charts.xlsx")


def docx():
    import re
    import zipfile
    from docx import Document

    tmp = HERE / "_tmp.docx"
    doc = Document()
    doc.add_heading("Graphiques dans un document", 1)
    markers = []
    for title in ["Colonnes groupées", "Courbes", "Secteurs"]:
        doc.add_paragraph(title)
        markers.append(doc.add_paragraph(f"@@CHART{len(markers) + 1}@@"))
        doc.add_paragraph("Texte après le graphique.")
    doc.save(tmp)
    src = zipfile.ZipFile(HERE / "generated-charts.pptx")
    names = src.namelist()
    # chart parts of the pptx slides: columns (1st), lines (a LINE slide), pie.
    def chart_for(kind):
        for n in sorted(names):
            if re.match(r"ppt/slides/slide\d+\.xml$", n) and f">{kind}<" in src.read(n).decode():
                rels = src.read(n.replace("slides/", "slides/_rels/") + ".rels").decode()
                target = re.search(r'Target="\.\./charts/(chart\d+\.xml)"', rels).group(1)
                return src.read(f"ppt/charts/{target}")
        raise SystemExit(f"no {kind} slide")
    charts = [chart_for("COLUMN_CLUSTERED"), chart_for("LINE_MARKERS"), chart_for("PIE")]
    zin = zipfile.ZipFile(tmp)
    out = zipfile.ZipFile(HERE / "generated-charts.docx", "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            xml = data.decode()
            for i in range(1, 4):
                drawing = (
                    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
                    '<wp:extent cx="5486400" cy="3200400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
                    f'<wp:docPr id="{100 + i}" name="Graphique {i}"/><wp:cNvGraphicFramePr/>'
                    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
                    f'<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
                    f'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart{i}"/>'
                    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
                )
                xml = re.sub(rf"<w:r>(?:(?!<w:r>).)*?@@CHART{i}@@.*?</w:r>", drawing, xml, count=1, flags=re.S)
            if "xmlns:wp=" not in xml:
                xml = xml.replace("<w:document ", '<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ', 1)
            data = xml.encode()
        elif item.filename == "word/_rels/document.xml.rels":
            rels = data.decode()
            add = "".join(f'<Relationship Id="rIdChart{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart{i}.xml"/>' for i in range(1, 4))
            data = rels.replace("</Relationships>", add + "</Relationships>").encode()
        elif item.filename == "[Content_Types].xml":
            ct = data.decode()
            add = "".join(f'<Override PartName="/word/charts/chart{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' for i in range(1, 4))
            data = ct.replace("</Types>", add + "</Types>").encode()
        out.writestr(item, data)
    for i, c in enumerate(charts, start=1):
        # The pptx charts point at an embedded workbook we do not copy.
        c = re.sub(rb"<c:externalData .*?</c:externalData>", b"", c, flags=re.S)
        out.writestr(f"word/charts/chart{i}.xml", c)
    out.close()
    tmp.unlink()


if __name__ == "__main__":
    pptx()
    xlsx()
    docx()
    print("ok")
