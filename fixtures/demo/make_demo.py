"""Builds the demo Bureau's files (plan docs/plans/2026-10-solo-mvp.md, S-3).

    python -m venv venv && venv/bin/pip install openpyxl python-pptx python-docx
    venv/bin/python fixtures/demo/make_demo.py

Needs `cargo` (the workbook is baked through oel-xlsx: openpyxl writes formulas without their
results and charts without caches). `logo.png` is made once from `logo.svg` (the site's
favicon, same mark as `packages/emboss/src/icons/Logo.tsx`):

    magick -background none -density 3072 fixtures/demo/logo.svg -resize 1024x1024 -depth 8 fixtures/demo/logo.png

- « Chronos — tours de piste.xlsx »: lap times (sheet « Tours ») and results read from them
  with MINIFS, AVERAGEIFS, RANK.EQ, XLOOKUP and COUNTA (sheet « Résultats »), plus a chart.
- « Bienvenue dans le Bureau.pptx »: intro with the logo, three tips, the race results (a
  chart named « Graphique du tableur », replaced on the desk by a linked copy of the
  workbook's chart), « Merci ! » in white on black.
- « À propos du Bureau.docx »: the logo and a short text about the Bureau, with a shortcut table.

French text, English formulas. Fictional runners. Author « OutilsEnLigne », fixed dates, so a
run gives the same content.
"""
import datetime as dt
import subprocess
import tempfile
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt as PPt

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
LOGO = HERE / "logo.png"
AUTHOR = "OutilsEnLigne"
WHEN = dt.datetime(2026, 10, 11, 9, 0)

XLSX = HERE / "Chronos — tours de piste.xlsx"
PPTX = HERE / "Bienvenue dans le Bureau.pptx"
DOCX = HERE / "À propos du Bureau.docx"

# 400 m, three laps each (seconds).
LAPS = {
    "Léa": (61.4, 60.2, 59.8),
    "Samuel": (66.1, 64.9, 65.3),
    "Maya": (58.7, 58.1, 59.0),
    "Noah": (70.2, 68.8, 69.5),
    "Zoé": (63.0, 62.4, 61.7),
    "Félix": (74.6, 72.9, 73.3),
}
LAP_DATES = (dt.date(2026, 10, 1), dt.date(2026, 10, 3), dt.date(2026, 10, 6))
RUNNERS = list(LAPS)
BEST = {r: min(t) for r, t in LAPS.items()}
MEAN = {r: round(sum(t) / len(t), 2) for r, t in LAPS.items()}

INK = "34333D"
VIOLET = "7859C5"
HEADER_FILL = PatternFill("solid", fgColor="EDE8F7")


# ── Workbook ────────────────────────────────────────────────────────────────────────────────


def header(ws, cells):
    for c in cells:
        c.font = Font(bold=True, color=INK)
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center")


def make_xlsx() -> None:
    wb = Workbook()
    res = wb.active
    res.title = "Résultats"
    laps = wb.create_sheet("Tours")

    laps.append(["Coureur", "Tour", "Temps (s)", "Date"])
    header(laps, laps[1])
    for runner, times in LAPS.items():
        for i, t in enumerate(times):
            laps.append([runner, i + 1, t, LAP_DATES[i]])
    for row in laps.iter_rows(min_row=2):
        row[2].number_format = "0.0"
        row[3].number_format = "yyyy-mm-dd"
    for col, width in zip("ABCD", (14, 8, 12, 13)):
        laps.column_dimensions[col].width = width
    laps.freeze_panes = "A2"

    last = 1 + sum(len(t) for t in LAPS.values())
    names, times = f"Tours!$A$2:$A${last}", f"Tours!$C$2:$C${last}"
    res.append(["Coureur", "Meilleur tour", "Moyenne", "Écart au meilleur", "Rang"])
    header(res, res[1])
    n = len(RUNNERS)
    for i, runner in enumerate(RUNNERS, start=2):
        res.append(
            [
                runner,
                f"=MINIFS({times},{names},A{i})",
                f"=AVERAGEIFS({times},{names},A{i})",
                f"=B{i}-MIN($B$2:$B${n + 1})",
                f"=RANK.EQ(B{i},$B$2:$B${n + 1},1)",
            ]
        )
        res[f"B{i}"].number_format = "0.0"
        res[f"C{i}"].number_format = "0.00"
        res[f"D{i}"].number_format = '+0.0;-0.0;"—"'
        res[f"E{i}"].alignment = Alignment(horizontal="center")

    res["G1"] = "En bref"
    header(res, [res["G1"], res["H1"]])
    summary = [
        ("Tour le plus rapide (s)", f"=MIN({times})", "0.0"),
        ("Par", f"=XLOOKUP(MIN({times}),{times},{names})", None),
        ("Tours enregistrés", f"=COUNTA({names})", "0"),
        ("Moyenne du groupe (s)", f"=AVERAGE({times})", "0.00"),
    ]
    for r, (label, formula, fmt) in enumerate(summary, start=2):
        res[f"G{r}"] = label
        res[f"H{r}"] = formula
        if fmt:
            res[f"H{r}"].number_format = fmt
    for col, width in zip("ABCDEFGH", (14, 14, 11, 17, 8, 3, 24, 12)):
        res.column_dimensions[col].width = width

    chart = BarChart()
    chart.type = "col"
    chart.grouping = "clustered"
    chart.title = "Meilleur tour par coureur"
    chart.y_axis.title = "Secondes"
    chart.y_axis.scaling.min = 50
    chart.y_axis.number_format = "0"
    chart.add_data(Reference(res, min_col=2, max_col=3, min_row=1, max_row=n + 1), titles_from_data=True)
    chart.set_categories(Reference(res, min_col=1, min_row=2, max_row=n + 1))
    chart.width, chart.height = 18, 9
    res.add_chart(chart, "A10")

    wb.active = 0
    wb.properties.creator = AUTHOR
    wb.properties.created = wb.properties.modified = WHEN
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.xlsx"
        wb.save(raw)
        subprocess.run(
            ["cargo", "run", "-q", "-p", "oel-xlsx", "--example", "recalc", "--", str(raw), str(XLSX)],
            cwd=ROOT,
            check=True,
        )


# ── Deck ────────────────────────────────────────────────────────────────────────────────────


def text_props(frame, size, bold=False, color=None, align=None):
    for p in frame.paragraphs:
        if align is not None:
            p.alignment = align
        for r in p.runs:
            r.font.size = PPt(size)
            r.font.bold = bold
            if color:
                r.font.color.rgb = RGBColor.from_string(color)


def make_pptx() -> None:
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    W, H = prs.slide_width, prs.slide_height
    title_layout, content_layout, title_only, blank = (prs.slide_layouts[i] for i in (0, 1, 5, 6))

    # 1 · Intro with the logo.
    s = prs.slides.add_slide(title_layout)
    logo = Inches(1.9)
    s.shapes.add_picture(str(LOGO), (W - logo) // 2, Inches(0.9), logo, logo).name = "Logo"
    s.shapes.title.text = "OutilsEnLigne · Bureau"
    s.shapes.title.left, s.shapes.title.top, s.shapes.title.width, s.shapes.title.height = Inches(1), Inches(3.1), W - Inches(2), Inches(1.4)
    text_props(s.shapes.title.text_frame, 48, bold=True, color=INK, align=PP_ALIGN.CENTER)
    sub = s.placeholders[1]
    sub.text = "Tous vos fichiers sur un seul bureau"
    sub.left, sub.top, sub.width, sub.height = Inches(1), Inches(4.6), W - Inches(2), Inches(0.9)
    text_props(sub.text_frame, 24, color=VIOLET, align=PP_ALIGN.CENTER)

    # 2 · Three tips.
    s = prs.slides.add_slide(content_layout)
    s.shapes.title.text = "Comment l’utiliser"
    text_props(s.shapes.title.text_frame, 40, bold=True, color=INK)
    body = s.placeholders[1]
    body.left, body.top, body.width, body.height = Inches(0.9), Inches(1.9), W - Inches(1.8), Inches(4.6)
    tips = [
        "Double-cliquez sur un texte pour le modifier.",
        "Ajoutez une diapo avec « + » dans la pellicule.",
        "Changez un temps dans le tableur : le graphique de la diapo 3 suit.",
    ]
    tf = body.text_frame
    tf.text = tips[0]
    for t in tips[1:]:
        tf.add_paragraph().text = t
    for p in tf.paragraphs:
        p.space_after = PPt(18)
    text_props(tf, 28, color=INK)

    # 3 · Race results: the workbook's numbers, replaced on the desk by a linked copy of its chart.
    s = prs.slides.add_slide(title_only)
    s.shapes.title.text = "Résultats de la course"
    text_props(s.shapes.title.text_frame, 40, bold=True, color=INK)
    data = CategoryChartData()
    data.categories = RUNNERS
    data.add_series("Meilleur tour", [BEST[r] for r in RUNNERS])
    data.add_series("Moyenne", [MEAN[r] for r in RUNNERS])
    frame = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1.2), Inches(1.8), W - Inches(2.4), Inches(5.0), data)
    frame.name = "Graphique du tableur"
    chart = frame.chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    chart.value_axis.minimum_scale = 50
    chart.value_axis.has_title = True
    chart.value_axis.axis_title.text_frame.text = "Secondes"

    # 4 · Thank-you, white on black.
    s = prs.slides.add_slide(blank)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = RGBColor(0, 0, 0)
    box = s.shapes.add_textbox(Inches(1), (H - Inches(1.6)) // 2, W - Inches(2), Inches(1.6))
    box.name = "Merci"
    box.text_frame.text = "Merci !"
    text_props(box.text_frame, 72, bold=True, color="FFFFFF", align=PP_ALIGN.CENTER)

    prs.core_properties.author = prs.core_properties.last_modified_by = AUTHOR
    prs.core_properties.title = "Bienvenue dans le Bureau"
    prs.core_properties.created = prs.core_properties.modified = WHEN
    prs.save(PPTX)


# ── Document ────────────────────────────────────────────────────────────────────────────────


SHORTCUTS = [
    ("Ouvrir un fichier sur place", "Entrée ou double-clic"),
    ("Plein écran, et retour", "Ctrl + Maj + Entrée"),
    ("Revenir au bureau", "Échap"),
    ("Nouvelle note", "N"),
    ("Tous les raccourcis", "?"),
]


def make_docx() -> None:
    doc = Document()
    doc.add_heading("À propos du Bureau", level=0)
    pic = doc.add_paragraph()
    pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic.add_run().add_picture(str(LOGO), width=Cm(4))
    for text in (
        "Le Bureau d’OutilsEnLigne pose tous les fichiers d’un projet côte à côte, comme du papier sur une table : "
        "documents, présentations, tableurs, images et notes. Les outils suivent ce que vous touchez.",
        "Tout reste dans votre navigateur : vos fichiers ne quittent pas cet appareil. Pour en garder une copie, "
        "exportez le bureau depuis le menu, « Ouvrir et importer ».",
        "Chaque fichier se télécharge dans son format d’origine, Word, PowerPoint ou Excel ; ce que vous n’avez pas "
        "modifié y reste tel quel.",
    ):
        p = doc.add_paragraph(text)
        p.paragraph_format.space_after = Pt(8)
    doc.add_heading("Raccourcis", level=1)
    table = doc.add_table(rows=1, cols=2)
    table.style = "Light Grid Accent 1"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.rows[0].cells[0].text, table.rows[0].cells[1].text = "Pour", "Touches"
    for what, keys in SHORTCUTS:
        row = table.add_row().cells
        row[0].text, row[1].text = what, keys
    # Word ends the body with a paragraph, never a table.
    doc.add_paragraph().paragraph_format.space_before = Pt(8)
    doc.paragraphs[-1].add_run("Ce document est un fichier Word ordinaire : il s’ouvre aussi dans Word ou LibreOffice.")

    doc.core_properties.author = doc.core_properties.last_modified_by = AUTHOR
    doc.core_properties.title = "À propos du Bureau"
    doc.core_properties.created = doc.core_properties.modified = WHEN
    doc.save(DOCX)


if __name__ == "__main__":
    if not LOGO.exists():
        raise SystemExit(f"{LOGO} manque : voir l’en-tête de ce script (magick).")
    make_xlsx()
    make_pptx()
    make_docx()
    for f in (XLSX, PPTX, DOCX):
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size:,} o")
