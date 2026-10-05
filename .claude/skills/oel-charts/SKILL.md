---
name: oel-charts
description: Change how OutilsEnLigne reads, draws, edits or writes charts — the ChartSpec model and codec (crates/oel-chart, used by oel-xlsx/oel-pptx/oel-docx), the @oel/charts renderer (layouts per family, SVG/Canvas backends, catalogue of types, Excel number formats and axis scaling), and the hosts (sheets grid + chart tools, slides, docs, desk thumbnails). Use for any chart type, chart element, chart UI or chart export work.
---

# Charts

Spec: Figma `Y3vDuuW4jfyTOjreIwDp6P`, page « Editor — Behaviors », section **H · Graphiques**
(node 156:10341; H0 route, H1 gallery, H2 edit, H3 data, H4 3-D, H5 data in slides/docs,
H6 catalogue, H7 ideas). Links between files are section **G** (node 148:9523). Plan:
`docs/plans/2026-10-links-and-charts.md`.

## Where things are

| Layer | Files | Notes |
|---|---|---|
| Model + codec | `crates/oel-chart/src/{model,read,write}.rs` | `ChartSpec` (ts-rs → `packages/engine/src/generated/oelchart/`). `read_chart(pkg, part, &Theme)` handles `c:` and `cx:` (chartEx), palette from `cs:colorStyle` or Office's default. `write_chart(spec, externalData)` writes a full `c:chartSpace` (not chartEx), caches and explicit automatic colours (LibreOffice draws colourless series as invisible). |
| xlsx host | `crates/oel-xlsx/src/drawing.rs` (read: `Drawing.chart`, `Drawing.src` = anchor index), `drawing_write.rs` (export) | Untouched drawings → part byte for byte. Changed: anchors patched in place, edited charts rewritten, new charts get part + rel + anchor (+ drawing part). Caches filled from recalculated cells (`fill_caches`). chartEx `_xlchart.v1.N` names resolved in `read.rs::resolve_chart_names`. |
| pptx host | `crates/oel-pptx/src/read.rs::frame` → `Element.chart` | Graphic frame stays `locked`; part kept. Writing edited slide charts: not done yet. |
| docx host | `crates/oel-docx/src/read.rs::read_drawing` → `ooxmlInline` attrs `chart`, `cx`, `cy`, `floating` (also in `contract.rs`, always present, `null` when not a chart) | Raw XML written back; node view draws the chart. |
| Renderer | `packages/charts/src/` — `index.ts` (`renderChart`, `familyOf`), `data.ts` (resolver or cache), `refs.ts` (`parseRef`, `cellResolver`), `format.ts` (Excel codes), `scale.ts` (Excel bounds/units), `stats.ts` (trendlines, quartiles), `style.ts` (`Ctx`, defaults, `seriesLook`), `layout/{frame,cartesian,pie,radar,three,chartex}.ts`, `render/{svg,canvas}.ts`, `catalog.ts` (`CHART_TYPES`, `applyType`, `newChart`, `recommend`), `react/ChartView.tsx` | Framework-free core; React only in `./react`. Text measured by `canvasMeasure()` in browsers, estimated in tests. |
| Sheets | `packages/sheets/src/grid/charts.ts` (live resolver over the calc cache, scene cache, range colours), `ui/charts.ts` (commands), `ui/ChartTools.tsx` (bar, gallery, elements, data, format), `ui/Grid.tsx` (hit test, move/resize handles, keys), `model/ydoc.ts` (`setDrawings`, `updateDrawing`, id-based chart refs via `mapChartRefs`) | Chart refs are stored like formulas: row/column inserts move them; the original text is kept while a ref has not moved (byte-identical export). |
| Slides / docs | `packages/slides/src/ui/render.tsx` (`oel-el__chart`), `packages/docs/src/extensions/nodes.ts` (`OoxmlInline` node view) | Drawn from the file's cache. Charts made in the editor (linked copies): slides `chartFrame`/`chartSlide` (`model/ops.ts`), docs `insertChartParagraph`/`setChart` (`model/charts.ts`, node attr `oid`); not yet written by the pptx/docx codecs. |
| Links (Figma G) | `packages/links` (model), `apps/web/src/links/` (resolver, UI) | A copy's value = `withCaches(spec, sheetResolver)` with `part: ''`; « Données seulement » = `keepLook(copy, source)`. Sheet drawings carry an editor-only `oid` (`SheetDoc.drawingId`, `drawingById`), stripped in `toWorkbook`. |

## Rules

1. Untouched charts are never rewritten: hosts compare the editor's spec with the one read from the original part. Don't mutate a spec unless the user edited the chart (no cache refresh on read).
2. A new spec field: `model.rs` with the `ts` attrs of its neighbours → `npm run gen:types` → reader → writer (keep XML element order per the schema) → renderer → round-trip test (`crates/oel-chart/tests/chart.rs::write_then_read_gives_the_same_spec`).
3. A new chart type: `catalog.ts` entry (French label, group settings), a layout branch, a thumbnail in Figma H6, and a fixture chart if possible.
4. UI copy fr-CA, icons Iconoir (`axes`, `switch-rows`, `rotate-3d`, `snow-flake` were added for charts), emboss components.

## Verify

- `cargo test -p oel-chart -p oel-xlsx -p oel-pptx -p oel-docx`
- `npx vitest run packages/charts packages/sheets` — `CHART_SVG_DIR=/some/dir npx vitest run packages/charts` writes every fixture chart as SVG for a visual check (`magick montage` makes a contact sheet).
- Fixtures: `fixtures/charts/generated-charts.{pptx,xlsx,docx}` (from `make_charts.py`: python-pptx can't write 3-D types; openpyxl covers them). Office-made samples will join them.
- LibreOffice check of written charts: export, `soffice --headless --convert-to pdf`.
- Then `oel-verify`.
