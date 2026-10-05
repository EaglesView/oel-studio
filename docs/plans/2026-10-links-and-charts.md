# Linked assets (« fils de liaison ») + charts — plan

Figma (UX must be drawn here before any code): https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca — page « Editor — Behaviors », new sections **G · Fils de liaison** and **H · Graphiques** (next to A–F). File key `Y3vDuuW4jfyTOjreIwDp6P`.

## Context

The Bureau desk already draws dashed threads between papers (`DeskLink {id, from, to, label, state: fresh|stale|frozen}`, `packages/desk/src/core/types.ts:31`, rendered `DeskCanvas.tsx:459`, styled `desk.css:65-83`). Except for form → sheet (`apps/web/src/bureau/forms.ts:51`), they are decoration: seed threads like `Budget!B2:B8 → diapo 4` carry no data, the « Graphique » action on a sheet paper (`ContextToolbar.tsx:169`) is a toast, and the desk is not persisted.

Charts are kept byte-for-byte on save in xlsx/pptx/docx but never read or drawn: sheets paint a dashed placeholder (`packages/sheets/src/grid/drawings.ts:89`), slides show a locked « Graphique » frame (`oel-pptx/src/read.rs:687`), docs show a « Dessin » pill with no size (`oel-docx/src/drawing.rs:199`). No chart library is in the repo.

Goal: make the threads real. A user selects a range in a sheet, makes a chart, and links that chart into a deck and a document. When the data changes, the copies update, the thread shows its state, and the user can update, freeze, re-point or cut each link. This needs a chart feature that matches Microsoft Office: every Office chart type, including 3-D, read, drawn, edited and written back to OOXML.

Decisions taken in this session:
- **Updates:** live by default. Each link can be set to *Manuel*, where it goes stale and shows « Mettre à jour », or *Figé*, a snapshot that no longer updates.
- **Scope:** v1 links papers on one desk and their standalone pages. Links point at stable collab doc ids, so links across desks or users (through share tokens) can come later without a data migration.
- **Renderer:** our own `@oel/charts`, not ECharts.
- **Fixtures:** the user will provide a docx/xlsx/pptx containing every chart type.

---

## Step 0 — commit pending work (first action after approval)

Branch `feat/pptx` has uncommitted changes: the fonts dialog (`packages/collab-client/src/ui/FontsDialog.tsx`, new), and changes to `packages/fonts/src/index.ts` and its test, `DocsEditor.tsx`, `docs/ui/fonts.ts`, `SlidesEditor.tsx`, `collab-client` index/css/package.json, `README.md` and the lockfile.
- Run `npm test` and `npm run typecheck` first. Report any failure; don't hide it.
- Then make one commit, `fonts: dialog for missing fonts across docs and slides`, or split it per package if the diff reads better that way.
- Push nothing.
- Copy this plan into the repo as `docs/plans/2026-10-links-and-charts.md`.
- Add the Figma link and the new sections G/H to `.claude/skills/oel-editor-feature/SKILL.md`, next to the existing `Y3vDuuW4…` reference.

## Step 1 — Figma UX (before code, then we discuss)

**Status 2026-10-04: drawn.** G · Fils de liaison → https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=148-9523 ·
H · Graphiques → https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=156-10341.
Added while drawing (to confirm in the discussion): linked single value inside text (G2b d), « Transporte : graphique et style / données seulement »,
delete-source dialog with three outcomes (figer / rompre / supprimer les copies), updates deferred during a slideshow, 6 Iconoir icons
(Filter, Snow Flake, Rotate 3D, Palette, Switch Rows Columns, Axes) added to the Icons frame.

Build the frames from `@oel/emboss` kit instances and `emboss/*` variables, use Iconoir icons only, write copy in fr-CA, and load the `figma-use` skill before calling `use_figma`. Leave the user's own Editor page alone.

**G · Fils de liaison**
- G1 Anatomy of a thread on the desk:
  - source end and target end, with a chip at mid-length showing the label and a state glyph;
  - the states fresh (live), stale (manual with pending changes), updating, frozen and broken (red, dashed differently);
  - a hit area that is selectable and focusable.
- G2 Creating a link, in four ways:
  1. Copy a chart or range, then paste into a slide or doc. A paste-options chip offers « Lier (à jour) », « Lier les données, style d'ici », « Incorporer (copie) » and « Image ».
  2. Drag a chart, or a selection's border, out of an open sheet onto another paper on the desk. A drop-target highlight appears, then a placement step.
  3. Use « Envoyer vers… » on a chart or range: pick a paper, then choose « nouvelle diapo » or « diapo courante » / « à la fin » or « au curseur ».
  4. In a slide or doc, choose « Insérer › Graphique › À partir d'un tableur… ». A range picker opens on top of the source sheet.
- G3 Thread popover, opened by clicking the chip or by Enter on a focused thread. It shows:
  - source → target with thumbnails;
  - a mode segmented control: En direct / Manuel / Figé;
  - « Mettre à jour », « Ouvrir la source » (the range or chart is highlighted), « Ouvrir la cible », « Changer la source… », « Couper le lien » (keeps a frozen copy);
  - history: last update, and by whom.
- G4 Linked object inside a target editor:
  - chain badge and state chip on the object;
  - context toolbar: Mettre à jour, Modifier la source, Mode, Délier;
  - what editing a linked chart's style does: it is a local override when the « style d'ici » variant was chosen; otherwise the source owns the style.
- G5 Source side:
  - a dotted outline on linked ranges and a « Utilisé dans 2 fichiers » marker on the chart;
  - a confirmation when deleting a linked range or chart (« 2 fils dépendent de… », with the choice of freezing them or cancelling);
  - what happens to the link when rows are inserted inside or outside the range.
- G6 « Fils » panel: an accessible list of every link on the desk, with a filter by state and bulk « Tout mettre à jour ». This is also the screen-reader route, because the SVG layer is `aria-hidden`.
- G7 Edge cases:
  - the source is not on the desk, or the user has no access to it (snapshot plus a disabled « Ouvrir la source » with a reason);
  - two collaborators updating at once;
  - a cycle is refused (« un graphique ne peut pas dépendre de lui-même »);
  - offline;
  - export (what Word/PowerPoint will see).
- G8 Chains: range → chart in the sheet → linked into slide 4 and § 2 of the document. Show how the threads draw (a branch with two arrows) and how staleness propagates.

**H · Graphiques**
- H1 Insert-chart dialog:
  - « Recommandés » plus « Tous les graphiques » with families on the left;
  - live previews of the user's own selection, as in Excel.
- H2 Chart selected:
  - context toolbar: Type, Styles, Couleurs, Éléments « + » (titre, axes, titres d'axes, légende, étiquettes, quadrillage, table de données, barres d'erreur, courbe de tendance), Filtres, Sélectionner les données, Intervertir lignes/colonnes;
  - in a sheet, the source range is shown in colour: series name, categories and values, each with drag handles.
- H3 Element selection by click or Tab, and a format inspector with tabs per element:
  - Remplissage & trait, Effets, Série (chevauchement, espacement, axe secondaire);
  - Axe (bornes, unités, logarithmique, format de nombre, ordre inverse);
  - Étiquettes.
- H4 « Sélectionner les données »:
  - series list (add, remove, reorder);
  - name, values and category ranges;
  - empty cells shown as gaps, zero or connected;
  - hidden rows.
- H5 3-D: the « Rotation 3D » panel (X, Y, perspective, axes à angle droit, profondeur, hauteur), and direct rotation by dragging a corner handle.
- H6 Charts in slides and docs without a sheet: « Modifier les données » opens a small embedded grid in a sheet (the same grid as `@oel/sheets`), as in PowerPoint.
- H7 Desk thumbnails and LOD: how a chart paper or a linked chart appears zoomed out.

After Step 1 → **discussion with the user, no code until agreed.**

---

## Part A — Charts

### A1 Model: `ChartSpec` (mirrors OOXML `c:chartSpace` and `cx:chartSpace`)

The types are defined in Rust in a new crate and exported to `packages/engine/src/generated/oelchart/` with ts-rs, following the existing pattern.

- `ChartSpec`:
  - `{ title, autoTitleDeleted, plotArea, legend, plotVisOnly, dispBlanksAs, style, colors, view3D?, floor?, sideWall?, backWall?, roundedCorners, spPr, txPr, lang, extra }`
  - `extra` keeps unknown XML raw, per facet, which keeps the lossless rule.
- `plotArea.groups: ChartGroup[]`. Several groups make a combo chart.
  - Each group: `{ type, grouping: clustered|stacked|percentStacked|standard, varyColors, barDir, gapWidth, overlap, shape, holeSize, firstSliceAng, ofPieType, splitType, bubbleScale, radarStyle, scatterStyle, wireframe, axisIds, series }`.
- `Series`:
  - `{ idx, order, name: DataRef, cat: DataRef, val: DataRef, xVal, yVal, bubbleSize, spPr, marker, dPt[], dLbls, trendline[], errBars[], smooth, explosion, invertIfNegative, extra }`.
- `DataRef { f?: string /* A1, sheet-qualified */, cache: {formatCode, pts[]} , lit? }`.
  - The cache is what Office shows when it has no calculation engine. We always write it.
- `Axis`:
  - kinds: `cat | val | date | ser`;
  - fields: `delete, pos, crosses, crossesAt, orientation, min/max, majorUnit/minorUnit, logBase, numFmt {code, sourceLinked}, majorGridlines, minorGridlines, tickLblPos, majorTickMark, title, dispUnits, baseTimeUnit`.
- chartEx (`cx:`) uses `ChartExSeries` with `layoutId: treemap|sunburst|waterfall|funnel|boxWhisker|clusteredColumn(histogram/pareto)|regionMap` and its layout properties (binning, subtotals, quartile method, parent label layout).
- In TS each host stores the spec in Yjs as a **Y.Map of facets**: `type`, `series:<id>`, `axes`, `legend`, `title`, `style`, `view3D`, `data`.
  - This is the same facet LWW pattern as `packages/slides/src/model/ydoc.ts:11-44`, so two users can style different parts at once.

### A2 Chart types to support (parity with Office 365)

| Family | Variants |
|---|---|
| Colonne / Barre | clustered, stacked, 100 % · 3-D clustered, 3-D stacked, 3-D 100 %, 3-D column (true depth axis) · legacy shapes box/cylinder/cone/pyramid (read and draw) |
| Ligne | line, stacked, 100 %, each ± markers · 3-D line |
| Secteurs | pie, exploded, 3-D pie, pie of pie, bar of pie · doughnut, exploded doughnut |
| Aires | area, stacked, 100 % · 3-D variants |
| Nuages de points (XY) | markers only, smooth lines (± markers), straight lines (± markers) |
| Bulles | bubble, 3-D-effect bubble |
| Boursier | high-low-close, open-high-low-close, volume-HLC, volume-OHLC (up/down bars, hi-low lines) |
| Surface | 3-D surface, wireframe 3-D surface, contour, wireframe contour (band colours) |
| Radar | radar, with markers, filled |
| Combiné | any mix of groups, secondary axes |
| chartEx | treemap, sunburst, histogram, Pareto, box & whisker, waterfall, funnel |
| Carte | filled region map: read, kept, drawn from the cached fallback image only (geodata service out of scope) |
| Sparklines | line, column, win/loss inside cells (`x14:sparklineGroups`), sheets only |

Chart elements: titles, axis titles, legend (positions plus manual layout), data labels (value, category, series, percentage, bubble size, from cells via `c15:datalabelsRange`, leader lines, callouts), gridlines, data table, trendlines (linear, exp, log, poly 2–6, power, moving average, with equation/R²), error bars (fixed, %, std dev, std err, custom), drop lines, high-low lines, up/down bars, series lines, markers (all 10 symbols plus picture), gradient, pattern and picture fills, shadow/glow/soft edges (approximated), chart styles 201–354 and colour palettes (`chartStyle`/`colors` parts), date axes, logarithmic scales, display units, reversed order, number formats.

### A3 Codec: new crate `crates/oel-chart`

- Shared by `oel-xlsx`, `oel-pptx` and `oel-docx`. Built on `oel-opc`:
  - add `REL_CHART`, `REL_CHART_EX`, `REL_CHART_STYLE`, `REL_CHART_COLORS`, `REL_PACKAGE` (embedded workbook) and the content types to `crates/oel-opc/src/package.rs`;
  - use `oel_opc::color` for every colour;
  - move `oel-xlsx/src/drawing.rs:228`'s private resolver onto `oel_opc::color` while we're there.
- `read_chart(pkg, part) -> ChartSpec`. It covers `c:`, `cx:` (chartEx through `mc:AlternateContent`, which `drawing.rs:113` already follows), `c14`/`c15`/`c16` extLst, theme colour resolution, and the style/colour parts.
- `write_chart`:
  - **Patch-on-original** for existing charts. Re-read the original part and rewrite only the facets that changed. A chart that was not edited stays byte-identical, the same contract as `oel-pptx/src/write.rs`.
  - **Full write** for new charts. Emit the `c:chartSpace`, the style/colour parts and the caches.
  - In pptx/docx, also write `c:externalData` with an **embedded workbook** (`ppt/embeddings/Microsoft_Excel_Worksheet{n}.xlsx`, `word/embeddings/…`), generated by `oel-xlsx` from the chart data. Word and PowerPoint can then « Modifier les données » natively.
- Range refs:
  - In Yjs, sheet charts store refs as **id-ranges**, reusing `encodeFormula`/`decodeFormula` (`packages/sheets/src/model/formula.ts:306/337`). Row/column inserts move them the same way they move formulas.
  - The writer re-emits A1 `c:f` and updates drawing anchors from the id markers (`ydoc.ts:102`). This fixes today's stale-ranges warning (`dialogs.tsx:642`), which is then removed.
- Hosts:
  - `oel-xlsx`: `Drawing.kind=chart` gains `chart: Option<ChartRef {part, spec}>`, and chart sheets become read-only `Sheet { kind: chartsheet }`.
  - `oel-pptx`: a new `ElementKind::Chart` replaces the locked `Graphic` for chart URIs (`read.rs:687-735`). It is editable: box, spec facets. Copying a slide must now **duplicate** the chart part instead of sharing it (`remap_rels`, `write.rs:379`).
  - `oel-docx`:
    - `read_anchor` (`drawing.rs:173`) learns `c:chart` and `cx:chart`, producing a `chart` node with `wp:extent`, inline or anchored, and wrap;
    - keep the raw XML for patch writing;
    - `understood_choice` (`:20`) accepts `cx`.
- Payload format bumps, with guards in `packages/engine/src/payload.ts`: `oelxlsx-workbook@2`, `oelpptx-deck@2`, `oeldocx-pm@3`.

### A4 Renderer: new package `packages/charts` (`@oel/charts`)

Framework-free core, plus a small React wrapper.
- `layout(spec, data, size, fonts) -> Scene`:
  - **Office-like auto layout**: plot area inset, legend placement, title sizing;
  - **Excel's axis auto-scaling**: min at 0 unless the data range is narrow (the « 5/6 » rule), major unit from {1, 2, 5}·10ⁿ, about 5–10 ticks; date axis base unit; log axes;
  - label overlap: rotate, then skip;
  - text measured with the metrics from `@oel/fonts`.
- `Scene`: a flat list of marks (rect, path, polygon, text, image, group) with element ids. The same ids drive hit-testing for element selection, tooltips and accessibility.
- Backends:
  - `toSVG(scene)` is used by the DOM editors (slides, docs, popovers), print and PDF export, and desk thumbnails as a data URL;
  - `paintCanvas(ctx, scene)` paints inside the sheets canvas grid, replacing `paintChartFrame` (`grid/drawings.ts:89`) in the same pass and per frozen pane.
- **3-D**: projected polygons with depth sorting (painter's algorithm), which is how Office draws its 3-D charts. It is an orthographic or perspective camera from `view3D` (`rotX`, `rotY`, `perspective`, `rAngAx`, `depthPercent`, `hPercent`). No WebGL is needed and the output stays vector. Surface charts are a triangulated mesh with band colours, and contour is a 2-D band projection. *(This refines « SVG + WebGL » from the question. Matching Office's look argues for projection. Revisit three.js only if interactive free rotation of large surfaces is too slow.)*
- Theme: the host gives theme colours and fonts. Chart style and colour ids (`chartStyle`/`colors`) map to Office's tables. That data is generated once from Office's built-in style list in a script and checked into `packages/charts/src/styles/`.
- Number formatting: the calc worker formats with the Excel format code. Add a calc op `format {code, values}` next to `values` (`packages/sheets/src/calc/protocol.ts:7`), so ticks and labels match the cells exactly. Hosts that have no worker load the engine format function in-process.
- Accessibility: `role="img"` with an `aria-label` summary, and a hidden data table (« Afficher les données ») for screen readers.

### A5 Chart editing UI (shared, in `@oel/charts/ui`)

`ChartToolbar`, `ChartGallery` (the insert dialog with live previews), `ElementsMenu`, `FormatInspector` (per-element tabs), `SelectDataDialog`, `Rotation3DPanel`, and element hit-test selection (click, then Tab cycles through elements). All of them use `@oel/emboss`, Iconoir and fr-CA copy. Every spec change goes through one `applyChartOp(op)` that writes Yjs facets, so undo works per host undo manager.

### A6 Per host

- **Sheets** (`packages/sheets`):
  - enable the disabled `chart` button (Alt+F1, `SheetsToolbar.tsx:180`), which inserts the recommended chart from the selection;
  - drawings become hit-testable in `controller.ts`: select, move, resize, delete, copy/paste;
  - the colour range highlight with drag handles;
  - data is read through `CalcClient.prefetch/values`, and the chart re-renders on `subscribe`;
  - sparklines;
  - copying a sheet keeps its drawings (today they are dropped, `ydoc.ts:406`).
- **Slides** (`packages/slides`):
  - a `chart` element kind with facets `box` + `chart`, replacing the locked frame (`render.tsx:378`);
  - insert from the toolbar;
  - an embedded data grid dialog;
  - the `chart` placeholder prompt (`render.tsx:48`) becomes clickable.
- **Docs** (`packages/docs`):
  - a Tiptap `chart` node (inline or anchored, reusing the `DocAnchor` positioning in `extensions/nodes.ts:444` and `ui/Anchors.tsx`), so the chart takes its real size on the page;
  - same embedded data dialog;
  - charts in pagination and print.
- **Desk**: chart thumbnails come from `toSVG` (`thumbnails.tsx`, `Paper.tsx`).

---

## Part B — Links

### B1 Model: new package `packages/links` (`@oel/links`)

```ts
type SourceRef =
  | { kind: 'range';  sheetId: string; ids: IdRange }        // stable row/col ids from sheets ydoc
  | { kind: 'name';   name: string }                          // defined name
  | { kind: 'chart';  chartId: string }                       // sheet drawing / slide element / doc node id
  | { kind: 'table';  tableId: string }                       // Excel table
  | { kind: 'slide';  slideId: string }                       // later: slide as picture
  | { kind: 'block';  blockId: string };                      // later: doc paragraph/section (needs stable block ids)

interface LinkDef {
  id: string;
  source: { docId: string; docKind: DocKind; ref: SourceRef; title: string };
  target: { objectId: string };          // element/node in THIS doc that renders the link
  carries: 'chart' | 'chart-data' | 'table' | 'values' | 'picture';  // what flows
  mode: 'live' | 'manual' | 'frozen';
  snapshot: { rev: string; at: number; by: string };   // rev = hash of source content used
  grant?: string;                          // later: read-only token for cross-desk sources
}
```

- **Storage**:
  - Links are stored in the **target** doc's Y.Doc as a `links` Y.Map. The target owns the embed and must render without the source.
  - The linked object keeps its last value: a `ChartSpec` with data caches, or table cells. So viewers, exports, offline use and users without access to the source still see the content.
  - The source doc gets a `backlinks` Y.Map (`linkId → {docId, objectId, title}`). It drives « Utilisé dans… », delete warnings and stale propagation.
  - Both are written in one user action. If they diverge, the resolver repairs them, and the target always wins.
- **Desk threads become derived**: `DeskLink[]` = for each paper with a `docId`, its `links` mapped onto paper ids. `SEED_LINKS` and hand-made threads go away; the form thread moves to the same derivation later. `DeskLink.state` gains `updating` and `broken`. Because links live in the docs, they persist even though the desk itself does not yet.
- **Cycles**: links form a DAG. `createLink` refuses an edge that closes a cycle, including through a chart's own ranges.

### B2 Resolver: `apps/web/src/links/` (Bureau and standalone pages)

- Interfaces that each kind implements, ready for the Phase-3 `KindModule` registry in the restructure plan (doing Phase 3 first is recommended, so links are not added as yet another kind switch):
  - `LinkSource { describe(ref) → label; read(ref) → LinkedValue; subscribe(ref, cb); reveal(ref) /* open + highlight */; rev(ref) → hash; onDelete(ref) }`
  - `LinkTarget { insert(value, carries, placement) → objectId; apply(objectId, value, origin='link'); badge(objectId, state) }`
- Sessions are opened through the existing per-kind caches (`docs.ts:28 sessionFor`, `sheets.ts:36`, `slides.ts:40`).
- **Live flow**: the source changes → debounce (300 ms) → compute `rev` → for each live backlink, `apply` the new value into the target with Yjs origin `'link'`. That origin is excluded from users' undo stacks. A *manual* link just compares `rev` and shows *stale*.
- **Who writes**: whichever client has both docs open. The write is idempotent because it is keyed by `rev`, so concurrent collaborators converge (LWW on identical content). With no client holding both, nothing updates, and the link shows *stale* when it is next opened.
- **Range → table**: values plus formatting at that moment. **Chart → chart**: full spec plus data caches, unless `carries='chart-data'`, which keeps the target's style and takes only series data.
- **Range → chart in a target** (a chart in a slide whose data comes from a sheet): the target chart's series point at the link, not at a local workbook.

### B3 Manipulation (UX per Figma G)

- **Create**:
  - paste options after copying a chart or range. The sheets internal clip (`controller.ts:694`) and the slides clip (`slides/controller.ts:28`) gain a `{docId, ref}` origin, and a cross-editor desk clipboard in `apps/web` carries it;
  - drag-out from an open paper onto another paper;
  - « Envoyer vers… »;
  - « Insérer › À partir d'un tableur… » with a range picker;
  - the mock in `ContextToolbar.tsx:169` becomes the real thing.
- **Desk threads**:
  - selectable: a hit path is added and `pointer-events: none` is removed for it;
  - a curved path instead of a straight line, avoiding overlapping papers when it's cheap to do so;
  - the label chip is drawn (today it never is);
  - the popover (G3);
  - keyboard: Tab into threads after papers;
  - « Fils » panel (G6);
  - the existing « Afficher/Masquer les fils » toggle stays.
- **In editors**: badge and state chip on linked objects, context actions (update, open source, mode, unlink), and the source-side outline and markers.
- **Delete source** → confirm → the links become *broken*. The last snapshot stays, and « Relier à… » re-points the link.
- **Re-point**: « Changer la source… » opens the range picker and keeps the same link id.

### B4 Files and export

- **xlsx**: a chart in the sheet is native (`c:f`). A sheet → sheet range link across workbooks is out of v1 (later: `externalLink` parts).
- **pptx/docx**: the linked chart is written as a normal chart, with caches and an embedded workbook, so Office shows it correctly. Our link metadata goes in the chart's `c:extLst` (`<oel:link id=… src=… mode=…/>`, our own namespace, which Office ignores and keeps). Re-import then restores the link.
- **Tables**: in docx, a `w:sdt` with tag `oel-link:<id>`; in pptx, `p:custDataLst` or extLst on the graphicFrame.
- We do not write Office's file-path « paste link » (`TargetMode="External"` to `C:\…`), because it is meaningless for web docs.

### B5 Later (designed for, not built in v1)

- Cross-desk and cross-user sources:
  - the target stores a `grant`, a read-only token for the source doc, created at link time from the user's own access;
  - the server (`apps/collab`) resolves links for exports and revocations (Phase 5 domains), and a revoked grant gives *broken* (« accès retiré »).
- Doc block and slide sources need stable block ids in docs.
- Form → sheet moves onto `@oel/links`.

---

## Status (2026-10-05)

- Phase 3 done: `crates/oel-chart` reads every generated fixture chart (classic + chartEx), writes classic charts.
- Phase 4 done: `@oel/charts` draws 2-D, 3-D (projected polygons), stock, surface, radar, chartEx; placeholders replaced in sheets, slides, docs, sheet thumbnails.
- Phase 5 mostly done (sheets): Alt+F1 / gallery insert, select, move, resize, delete, duplicate, type, colours, elements, data, format, 3-D rotation; xlsx export (new/edited/moved/removed; untouched byte for byte); id-based refs. Not yet: sparklines, chart sheets, per-element click selection and inspector, dragging the coloured range handles, chartEx editing.
- Phase 6 not started: editing charts in slides and documents (embedded workbook writer).
- Phase 7 done, Phase 8 started (2026-10-05, branch `feat/links`), without the Phase 3 `KindModule` prerequisite (the resolver keeps per-kind branches, to move onto kind modules later):
  - `@oel/links`: `LinkDef`/`Backlink` in Y.Docs (`oel-links`, `oel-backlinks`, one Y.Map per link so mode and updates merge), `revOf`, `linkState`, `createsCycle`, `deriveThreads`, `linkHost()` for editors; tests.
  - `apps/web/src/links/resolver.ts`: watches sources (sheet session + its own `CalcClient`, 300 ms debounce, retry when the engine reloads), writes live copies, `Manuel` → stale, `Figé`, broken when the chart is deleted (computed, so Ctrl+Z in the source restores it); copies deleted in the target drop their link.
  - Desk: curved threads edge to edge, states fresh/updating/stale/frozen/broken/waiting, focusable chips (Tab after papers, Entrée popover, Suppr cut); `SEED_LINKS` removed; form threads kept as they were.
  - UI: « Lier dans… » from the sheet chart bar (G2 step 2: file list with refusals, placement, style), popover (G3), « Fils du bureau » panel (G6, Ctrl+Maj+L, dock « Fils »), badges on copies in slides and documents (G4), « Utilisé dans N fichiers » on the source chart (G5).
  - Model changes: sheet drawings get an editor-only `oid` (stripped before the codec), docx `ooxmlInline` gets `oid` (contract + reader emit `null`), `@oel/charts` `withCaches`/`chartName`/`keepLook`, slides `chartFrame`/`chartSlide`, docs `insertChartParagraph`/`setChart`.
  - Not yet: export of copies to .pptx/.docx (new charts aren't written by those codecs — Phase 6 + 9), paste / drag / insert-from-target routes (G2b), range and single-value links, delete-source dialog with three choices (G5), slideshow deferral (G7), « Changer la source… », history, read-only viewers, the source range outline in the grid.
- Phases 9–10 not started. Fixtures from Office still to come.

## Phasing (each phase ends with `oel-verify` and a commit)

0. Commit pending work, copy the plan into the repo, add the Figma link to the skill (Step 0).
1. Figma G + H, then the discussion.
2. *(Recommended prerequisite)* restructure Phase 3, `KindModule`, so link sources and targets plug in per kind.
3. `oel-chart` crate: read every type from the fixtures, plus golden JSON tests; byte-identical round trip when untouched.
4. `@oel/charts` 2-D renderer for all classic types, then chartEx, then 3-D and surface. Replace the placeholders read-only in sheets, slides and docs. This is the first value visible to users.
5. Chart editing in sheets: create from the selection, edit, id-range refs, writer patches, sparklines.
6. Charts in slides and docs: insert, edit, embedded data grid, full writer with embedded workbook.
7. `@oel/links` model, resolver and derived desk threads; thread popover and panel.
8. Link creation paths (paste options, drag-out, Envoyer vers, range picker); badges; source markers; delete and broken handling.
9. Link round trip in OOXML (extLst / sdt), export checks in LibreOffice and, via the user, Office.
10. New skill `.claude/skills/oel-charts` (ChartSpec, renderer, where hosts plug in, Figma H link). Update `oel-editor-feature`, `oel-file-kind` and `ARCHITECTURE.md` (cross-kind links section).

## Critical files

- New: `crates/oel-chart/`, `packages/charts/`, `packages/links/`, `apps/web/src/links/`.
- Changed:
  - `crates/oel-opc/src/package.rs`
  - `crates/oel-xlsx/src/{drawing,model,write}.rs`
  - `crates/oel-pptx/src/{model,read,write}.rs`
  - `crates/oel-docx/src/{drawing,read,write}.rs`
  - `packages/engine/src/payload.ts`
  - `packages/sheets/src/{grid/drawings.ts,model/ydoc.ts,ui/controller.ts,ui/SheetsToolbar.tsx,calc/protocol.ts}`
  - `packages/slides/src/{model/ydoc.ts,ui/render.tsx,ui/controller.ts}`
  - `packages/docs/src/extensions/nodes.ts`
  - `packages/desk/src/{core/types.ts,react/DeskCanvas.tsx,react/desk.css}`
  - `apps/web/src/bureau/{ContextToolbar.tsx,seed.ts,BureauApp.tsx,forms.ts}`

## Verification

- **Fixtures**: the user's all-chart-types files go in `fixtures/charts/{all-charts.xlsx,all-charts.pptx,all-charts.docx}`. Also ask for **PDF exports of the same files from Office**. They are the visual reference: renderer snapshot tests rasterise `toSVG` and compare against each page, with a tolerance, and the diffs are reviewed by eye.
- **Rust**:
  - untouched files round-trip byte-identical;
  - reading gives golden `ChartSpec` JSON per chart;
  - a written new chart opens in LibreOffice headless (the existing LibreOffice round-trip job), and the embedded workbook is valid.
- **TS** (vitest):
  - axis scaling cases against Excel's choices;
  - Yjs convergence for concurrent facet edits;
  - id-range refs survive row inserts and deletes;
  - link DAG cycle refusal;
  - live update idempotence (two resolvers on one target);
  - mode transitions.
- **Browser** (Claudezilla, one attempt per the test-tooling rule):
  1. select B2:B8 in the Budget sheet and insert a column chart;
  2. paste it linked into slide 4 and into the document;
  3. change B5: both update and the threads stay fresh;
  4. switch the doc link to Manuel, change B6: the doc thread goes stale, then « Mettre à jour » updates it;
  5. delete the chart in the sheet: confirm, and the threads turn broken;
  6. export the pptx and docx and reopen them: the charts and links are restored.
  Anything blocked goes under « non vérifié ».
