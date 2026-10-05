# Editor UX issues after links v1 — early plan

Raised 2026-10-05 while testing a sheet chart linked into a deck and a document.
Figma file: https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca, page « Editor — Behaviors »
(sections G · Fils de liaison `148-9523`, H · Graphiques `156-10341`). Items marked **Figma first** need frames there
before any code; then we discuss and turn each into a plan.

## Done on `fix/editor-ux` (2026-10-05)

- **Tables in complex_template showed a horizontal scrollbar.** Cause: Tiptap's `.tableWrapper` had `overflow-x: auto`,
  and the 2px column-resize handle sits outside the last cell (Word tables can also be a few points wider than the
  text column). The wrapper now overflows visibly. Commit `docs: tables never show a scrollbar`.
- **Documents had no right-click menu.** Added: cut / copy / paste / paste without formatting, link, image options,
  clear formatting; in a table, rows, columns, merge, header row, delete. A right-click outside the selection moves the
  caret first (like Word); Shift+right-click keeps the browser menu. The shared `ContextMenu` lives in
  `@oel/collab-client` next to `MenuBar`.
- **The table bar pushed the layout down.** Replaced by a compact icon bar floating over the table's top edge
  (`packages/docs/src/ui/Floats.tsx`), with cell fill; the same actions are in the right-click menu.
- **Charts in documents and slides had no tools.** A shared `CopyChartBar` (`@oel/charts/ui`) floats over a selected
  chart: variant within the same family, colours, elements; on a linked copy, « Voir la source », « Mettre à jour » and
  the link popover. Restyling a copy that carries the source's style switches it to « Données seulement ».

Still to do around these:
- Browser check of all four (the test browser was unavailable this session).
- « Voir la source » opens the source paper but doesn't yet highlight the chart (G3 « la plage ou le graphique est
  mis en évidence »).
- The bar is locked on charts that come from the .docx/.pptx file, because their export isn't written yet (Phase 6).
- The right-click menu could gain paragraph items (style, spacing) and a cell-fill submenu; waits for the toolbar
  redesign below so menu and toolbar share one action list.
- Slides and sheets keep their own context menus; move them onto the shared `ContextMenu` when it's convenient.

## 1. Generalised links — **Figma first**

**Drawn 2026-10-05:** section **I · Liens généralisés** → https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=167-10452
(I0 matrix of sources × targets, I1 image liée, I2 plage → tableau lié, I3 tableau → tableur, I4 valeur dans le texte,
I5 cas particuliers, I6 decisions). Next: write the implementation plan.

**Decided with the user (2026-10-05, recorded in I6):**
1. Source edits flow to the copies; edits made in a copy stay local and never touch the source. The link keeps the
   list of local edits: view them, undo them, or « Appliquer à la source » (writes the edit to the source, so every
   copy gets it).
2. A linked table takes the theme of the sheet or of the destination document (user's choice). Its style is really
   editable in place, and each style change is a local edit (rule 1). Custom table styles in docs/slides later.
3. A table too big for a slide: the table's floating bar has « Affichage ▾ » with Tronquer / Tout afficher /
   Choisir les lignes…, so people can experiment.
4. Table → sheet: a copy of the data; the sheet then owns the values, the table keeps only style and font (rule 2).
5. Pasting an image copied from a desk file links it; an image from the outside clipboard is inserted.

Links v1 carries a sheet chart into slides and documents. Next, extend them to most objects:

| Source → target | Carries | Notes / edge cases to draw |
|---|---|---|
| Desk image → document / slide | picture | Image replaced on the desk or edited in the image tool (crop, filters): update or keep? Size and crop in the target are the target's own. |
| Image in a file → another file | picture | Same as above; image deleted in the source → broken, last image kept. |
| Sheet range → document / slide | table | Values and formatting at link time; merged cells; rows or columns inserted inside / outside the range (id ranges); range bigger than the page or slide; number formats; formulas show values only. |
| Doc / slide table → sheet | range | Which side owns it after linking; merged cells; rows added in the doc table; header row. Needs stable table ids in docs (blocks have none today). |
| Single cell → text in a doc / slide | value | Plan G2b d (already drawn). |

To design for each one: the creation routes (paste options, drag-out, « Lier dans… », « Insérer › À partir de… »),
what the copy's bar offers (as for charts: source, update, mode, local style), the « Données seulement » meaning for
that kind, deleting the source, cycles (table → range → table), and what Word / PowerPoint / Excel see on export.

Model work this implies (for the plan after Figma): `SourceRef` kinds `image`, `table`, `block`; `Carries` gains
`picture`, `table`, `values`; resolver per kind (ideally on the Phase-3 `KindModule` registry); docx `w:sdt` and pptx
extLst link markers (plan B4).

## 2. Toolbar overflow and redesign — **Figma first**

**Drawn 2026-10-05:** section **J · Barres d'outils** → https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=173-10495
(J0 five rules, J1 groups and fold priorities, J2 three widths, J3 « Plus » and docking, J4 new Document / Tableur /
Présentation bars, J5 keyboard and accessibility, J6 decisions). Next: plan the `@oel/emboss` Toolbar overflow.

**Decided with the user (2026-10-05, recorded in J3/J4/J6):**
- « Plus » **pushes** the page by default, and the hidden groups open as a **grid of named sections** (three columns,
  wide groups span two; one column under 560 px), not as extra one-line rows.
- The overlay mode is dropped. Instead an « Ancrer en bas » button docks the **whole toolbar at the bottom** of the
  window (better for touch); a ✕ at its end puts it back at the top. Under 600 px or on touch-only screens the bar is
  docked at the bottom by default. Shortcuts: Alt+Maj+↓ (expand), Alt+Maj+B (dock).
- Slides: « Présenter » is a split button outside the overflow; the main part starts the last used mode, the arrow
  offers Présenter / Mode présentateur.
- The Texte group in slides stays greyed when no text box is selected; clicking it shows « Sélectionnez une zone de
  texte pour changer la police ».
- Imprimer and zoom leave the document bar; Barré and Liste de contrôle go to « Plus ».
- Nine Iconoir icons added to the Figma Icons frame: Borders, Wrap Text, Sort, Shape, Play, Currency, Percent,
  Dock Bottom (AlignBottomBox), Presenter (Presentation).

Today each editor's toolbar is one line; when it overflows it scrolls horizontally
(`.oel-docs__toolbar > .emb-toolbar { overflow-x: auto }`, same idea in sheets and slides).

Wanted:
- A « Plus » / show-more button that expands the toolbar to as many rows as it needs, with a smooth animation.
  Decided: push with a grid of sections, plus docking the whole bar at the bottom (see above).
- New layouts for the docs, sheets and slides toolbars (they were built quickly): grouping, which tools are always
  visible at each width, which go into the overflow, contextual groups (table, image, chart) and how they relate to
  the floating bars above.

Implementation notes for later: measure groups with a `ResizeObserver` and move whole groups into the overflow
(never single buttons), keep roving focus across rows, respect `prefers-reduced-motion`, and put the shared logic in
`@oel/emboss` (`Toolbar` with `overflow="wrap" | "menu"`) so all three editors use it.

## Order once Figma is ready

1. Browser-check the four fixes above.
2. Toolbar component in `@oel/emboss` + the three new layouts (needs Figma frames).
3. Links: image (desk → file, file → file), then range → table, then table → range, then single values.
