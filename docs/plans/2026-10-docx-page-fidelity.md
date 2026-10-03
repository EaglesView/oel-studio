# Page-layout fidelity for .docx (plan approved 2026-10-03, in progress)

Written 2026-10-03 after importing `fixtures/docx/complex_template.docx` (a Word "report"
template) into the Bureau. Text, styles and the round trip are right (and since
`fix/docx-part-lookup`, the theme fonts too), but the **page** looks nothing like Word.
This plan fixes that. Execute only after the user approves it; ask before commits (see
`CLAUDE.md` for how to commit). Each phase ends with `oel-verify`.

Legend: `[ ]` todo · **Done when** = acceptance check · **Skills** = skills to update in the same change.

---

## What is wrong, and why

Measured on `complex_template.docx` (5 sections, 6 floating shapes, 8 text boxes, 3 frames):

| # | Symptom in the editor | Cause | Where |
|---|---|---|---|
| 1 | The cover uses a 2" left margin and the cover table overflows on the right | Only the **last** section's page setup is read (`page_json(body sectPr)`); every page uses it. The cover section has 0.5" margins (text 7.5" wide), sections 2–5 have a 2" left margin | `crates/oel-docx/src/lib.rs`, `read.rs::page_json`; `PageView.tsx` (one `W`, one margin box); `pagination.ts` (one `PageGeometry`) |
| 2 | Table of contents starts on the cover page; "Page 1 sur 3" where Word has more pages | Section breaks are ignored: each section's default `w:type` is `nextPage`. Paragraph-level `w:sectPr` is only kept raw (`sectionBreak: true`) | `read.rs::paragraph_attrs`, `pagination.ts` |
| 3 | No headers or footers on any page | Header/footer references are read from the last section only, which has none: Word **inherits** them from earlier sections (section 2 defines `default` footer `rId10`, section 3 `rId13`; 4–5 inherit) | `lib.rs::import_package` (`header_footer_refs(body sectPr)`), `ydoc.ts` (`story:<side>:<kind>`, one set per document) |
| 4 | Page numbers wrong | `w:pgNumType` (format `lowerRoman`, restart at 1 per section) is not read; `PAGE` is always the absolute arabic page number | `read.rs`, `PageView.tsx::Fields` |
| 5 | "Dessin" chips instead of the cover background, the big oval and the dark sidebar bands | Anchored drawings (`wp:anchor` + `wps:wsp` shapes, text boxes) become `ooxmlInline` placeholders. Even pictures that float are drawn inline | `read.rs::read_drawing` / `read_run`, `nodes.ts::OoxmlInline`, `DocImage` |
| 6 | Shapes would be the wrong colour even if drawn | Fills use theme colours with DrawingML transforms (`schemeClr tx1` + `lumMod 75000` + `lumOff 25000`); the codec reads only theme **fonts**, not the colour scheme or `w:clrSchemeMapping` | `styles.rs::Styles::load` |
| 7 | Black grid lines around the cover table (Word shows none) | The editor CSS gives every cell `border: 1px solid #000`; the table has no `tblBorders` and no table style, so Word draws nothing. Table styles (`w:tblStyle`, conditional `firstRow`…) are not resolved | `docs.css` `.oel-doc td`, codec has no table-border model |
| 8 | Headings in a heavy fallback face | Felix Titling / Century Gothic are not on the machine and there is no substitute stack or web font for them | `styles.rs` font stack, `@oel/docs` CSS |
| 9 | Some paragraphs mispositioned | `w:framePr` frames (3) are flowed as normal paragraphs | `read.rs` |
| 10 | "No images": the cover photo is missing | The photo is a **picture fill** of the cover oval (`a:blipFill` → `media/image1.png`), and `media/image22.png` is a VML image fill (`v:fill`) in a fallback shape; neither is a `pic:pic`, so nothing draws them | `read.rs::read_drawing` (only `pic:pic` blips become images) |
| 11 | The Bureau paper is always the same size; landscape or other formats don't show | Desk papers use a fixed `PAPER_SIZE.document` (420×594) whatever the page size/orientation; in-place and thumbnails don't follow page setup | `apps/web/src/bureau/model.ts` (`PAPER_SIZE`), `importFiles.ts`, `Paper.tsx` |

What is **not** wrong: export. Everything above is kept raw and written back byte for byte,
so `pm_to_docx` reproduces the file (round-trip test `round_trip_complex_template`). The
work is to **model and render** what is already preserved, without weakening that
guarantee: every new attr follows the codec rule "modelled attrs + raw XML; unchanged
attrs leave the raw XML untouched".

## Principles

- **Rust decides, the editor draws.** Inheritance (sections, headers, table styles, theme
  colours) is resolved in the codec into plain values the editor can render, the way
  paragraph CSS already is. The editor never parses OOXML.
- **Contract first.** Each phase starts by extending `crates/oel-docx/src/contract.rs` +
  `npm run gen:types`; `tests/contract.rs` and `schema.test.ts` keep both sides honest.
  A breaking JSON change bumps `PAYLOAD_FORMATS.docx` to `oeldocx-pm@2` and the Y.Doc
  `formatVersion`. Stored documents are dev data only: no migration, re-import instead
  (decision 3).
- **Small, real fixtures.** Besides `complex_template.docx`, add one minimal fixture per
  feature (made in Word or LibreOffice, listed in `fixtures/docx/README.md` with what each
  exercises), so a failure points at one thing.
- **Reference renders.** LibreOffice is the reference we can run here:
  `scripts/render-reference.mjs <file.docx>` → `soffice --convert-to pdf` → `pdftoppm` →
  PNG per page under `fixtures/reference/` (git-ignored). Browser checks compare the editor
  against these images. Per the user, if a browser check cannot be run, say so and move on
  (the user checks visually).

---

## Phase 0: Groundwork (~½ day)

- [x] `scripts/render-reference.mjs` (LibreOffice → PNG per page) + `fixtures/reference/` in `.gitignore`.
- [x] `fixtures/docx/README.md`: one line per fixture.
- [x] New minimal fixtures: `sections-margins.docx` (3 sections: different margins, one landscape, one `continuous`), `sections-headers.docx` (inheritance, `titlePg`, even/odd + `evenAndOddHeaders`, `pgNumType` roman + restart), `anchors.docx` (behind-text rectangle relative to page, picture with square wrap relative to column, text box, group), `table-borders.docx` (no borders, `Table Grid` style, per-cell borders, banded style with `firstRow`).
- [x] Theme colour model in Rust: parse `a:clrScheme` from the related theme part and `w:clrSchemeMapping` from the related settings part. `Theme::resolve(&XElement) -> Option<String>` for `a:srgbClr | a:schemeClr | a:sysClr | a:prstClr` with transforms `lumMod lumOff shade tint satMod alpha` (HSL maths as in the spec). Unit tests with the template's values (`tx1` + 75/25 → `#404040`).

**Done when** the reference PNGs exist for every fixture and the colour tests pass.

## Phase 1: Sections and page size (~2½ days): fixes symptoms 1–4, 11

### 1a Codec + contract

- [x] `contract.rs`: `DocxJson.sections: Vec<Section>` (document order; the last is the body's
      final `sectPr`), replacing `DocxJson.page` (kept as an alias of the last section's page
      for one version, then removed). `Section { id, page: PageSetup, kind: SectionKind
      (nextPage | continuous | evenPage | oddPage | nextColumn), titlePg, pgNum: { fmt, start: Option<i64> },
      cols: { num, space, equalWidth }, headers: { default?, first?, even? → story id },
      footers: {…}, sectPr }`. Header/footer slots hold only **explicit** references (needed
      to write back what Word had); inheritance is computed, not stored.
- [x] `ParagraphAttrs.sectionBreak: bool` → `section: Option<String>` (id of the section that
      ends at this paragraph). Ids are stable strings (`s1`… on import, random for new ones) so
      concurrent edits in Yjs don't shift them.
- [x] Stories are keyed by **part**, not by kind: `DocxJson.stories: Map<storyId, StoryPart>`
      (`headers`/`footers` maps go away). The same part may be referenced by several sections.
- [x] `DocxJson.settings: { evenAndOddHeaders, defaultTabStop, mirrorMargins }` from the related settings part.
- [x] Reader: walk the body, read each paragraph `w:sectPr` into a `Section`, plus the body one.
- [x] Writer: for each section, patch its own `sectPr` (pgSz, pgMar, type, titlePg, pgNumType,
      cols, header/footer references) only where the modelled values changed (same rule as
      today's final `sectPr` patch); new stories create parts + relationships (relative
      targets, `main_related`); removed section breaks drop that paragraph's `sectPr`.
- [x] Rust tests: `sections_are_read` (complex_template: 5 sections, margins and `lowerRoman`
      on s1, explicit refs on s2/s3, none on s4/s5); `editing_a_section_patches_its_sectPr`;
      `adding_and_removing_a_section_break`; round trips of the new fixtures; contract test on all.

### 1b Shared document (Y.Doc), format v2

- [x] `ydoc.ts`: `meta.sections` becomes a `Y.Map<sectionId, Section>` + `meta.sectionOrder`
      is **not** stored (order = order of `section` attrs in the body, plus `body` last), so
      two people inserting breaks cannot desynchronise a list. Stories: `story:<storyId>`
      fragments + `stories` index `storyId → part`.
- [x] Pure helpers in `@oel/docs/model/sections.ts` (unit-tested in vitest):
      `sectionOrder(doc)`, `effectiveStory(sections, i, side, kind, settings)` (Word rules:
      own reference, else the previous section's, recursively; `first` only if `titlePg`;
      `even` only if `evenAndOddHeaders`), `formatPageNumber(n, fmt)` (decimal, lowerRoman,
      upperRoman, lowerLetter, upperLetter, decimalZero…), `pageNumberAt(pages, i)` honouring
      restarts.
- [ ] Delete local dev data (`apps/collab/data/`, IndexedDB): left to the user (older documents are refused with the re-import message meanwhile).
- [x] No migration (decision 3): documents seeded at `formatVersion` 1 are refused on open
      with a fr-CA message asking to re-import the file; `asDocxPayload` accepts
      `oeldocx-pm@2` only and the engine produces @2. Delete local dev data
      (`apps/collab/data/`, IndexedDB) after this lands.
- [x] `exportJsonFromYDoc` / collab server export emit the new shape (server test in `apps/collab/test`).

### 1c Layout and page view

- [x] `pagination.ts`: geometry **per section**. Units carry their section; a section of
      kind `nextPage` forces a break before its first block (`oddPage`/`evenPage` may insert
      an empty page); `continuous` doesn't. `storage.pages` becomes `PageInfo[]`
      (`{ section, width, height, margins, number }`) instead of a count.
- [x] Text width per section: the body wrap spans the widest page; top-level blocks of section
      *i* get a node decoration setting `margin-left`/`width` from that section's margins, so
      the cover's table fits its 7.5" and chapters get their 2" left margin. Mixed sizes and
      orientations: each sheet has its own size and is **centred** like in Word; section
      blocks are offset by `(widest − width) / 2` so text stays on its sheet.
- [x] Page size and orientation actually change the canvas: the page setup dialog (paper
      size, Portrait/Paysage, margins) applies per section and the sheets, pagination and
      header/footer zones follow immediately (vitest on the geometry helpers + browser check
      switching the template's chapter section to landscape).
- [x] `continuous` sections with different margins: they start on the same page with the new
      text width (Word does the same); different **page size** in a continuous section applies
      from the next page (Word's rule).
- [x] `PageView.tsx`: sheets drawn from `PageInfo[]`; header/footer per page via
      `effectiveStory`; `PAGE` fields use `formatPageNumber`, `NUMPAGES` the total,
      `SECTIONPAGES` the section's count.
- [x] Header/footer editing: the bar shows « Section 2 · Pied de page », and « Lier au
      précédent » (Word's "Link to previous"): on = drop this section's reference (inherit),
      off = copy the inherited story into a new part. Editing a story used by several
      sections says so (« Utilisé par les sections 3 à 5 »).
- [x] Page setup dialog (`dialogs.tsx`): « Appliquer à : cette section / tout le document ».
      `setPage` becomes `setSectionPage(session, sectionId | 'all', patch)`.
- [x] Insertion menu: « Saut de section » › « Page suivante » / « Continu ». Deleting the
      paragraph that carries a break merges the two sections (the merged text takes the
      **following** section's setup, as in Word); undo restores it.
- [x] Status bar: « Page 3 sur 12 · Section 2 ».
- [x] Bureau paper follows the document (symptom 11): the desk paper's aspect ratio comes
      from the document's first page (`PageInfo` of page 1; landscape papers are wide), set
      at import and updated when page setup changes in place; `PAPER_SIZE.document` becomes
      the default for new blank documents only. Thumbnails render at that ratio.

Notes (as built): `DocxJson.page` was removed outright rather than kept as an alias (no
migration, nothing reads it); section ids are `s1…` and `body` for the final `sectPr`;
paragraphs of a narrower section are inset with transparent side borders, so a paragraph
with its own left/right border inside such a section loses that border on screen. The
browser check below is pending (browser tooling was unavailable).

**Done when**, compared with the reference render: `complex_template.docx` shows the cover
alone on page 1 with 0.5" margins and the table inside the page, each chapter starts on a new
page with its 2" left margin, footers/page numbers appear where Word puts them (roman on the
cover section); `sections-*.docx` match their references; editing a section's margins and
exporting gives a file whose other sections are byte-identical; switching a section to
landscape or Legal changes its sheets in place and on the desk paper; a v1 document is refused
with the re-import message.
**Skills** `oel-rust-engine` (sections in the contract), `oel-editor-feature` (sections,
per-section pagination, story ids), `oel-collab-backend` (format v2, export), `oel-file-kind`
(paper size from the document).

## Phase 2: Table fidelity (~1 day): fixes symptom 7

- [x] Codec: resolve borders per cell from `tcPr/tcBorders` → `tblPrEx` → `tblPr/tblBorders`
      → table style (`w:tblStyle` chain incl. `basedOn`) with conditional formatting
      (`firstRow`, `lastRow`, `firstColumn`, `band1Horz`… gated by `tblLook`), plus table
      width (`tblW`, pct/dxa), alignment (`jc`), indent (`tblInd`) and cell margins
      (`tblCellMar`/`tcMar`). Expose display-only `css` on `table` and `tableCell` (like
      paragraphs), contract + Tiptap attrs (`rendered: false`, applied by `renderHTML`).
- [x] Editor: remove the default `1px solid #000`; when a table or cell has no visible
      border, draw a light dashed gridline on screen only (« Affichage › Quadrillage des
      tableaux », on by default, never printed or exported), like Word.
- [x] Editing borders stays out of scope (table border UI is its own feature); new tables
      created in the editor get the `Table Grid` style so they look as before.

Notes (as built): table-style paragraph/run properties become scoped rules in `stylesCss`
(`table[data-tstyle] .oel-p` for unstyled/Normal paragraphs, Word's precedence); conditional
`insideH/insideV` borders are approximated per cell edge. Browser comparison pending.

**Done when** `table-borders.docx` and the template's tables match their references, and
tables created in the editor still show borders and export with them.
**Skills** `oel-editor-feature`.

## Phase 3: Floating objects (~3 days for 3a+3b): fixes symptoms 5, 6, 9, 10

### 3a Model (codec + contract)

- [ ] New inline atom node **`anchor`** (replaces `ooxmlInline` for `wp:anchor`; inline
      `wp:inline` pictures stay `image`). Attrs: `kind` (picture | shape | textbox | group),
      `position: { relH: page|margin|column|character|leftMargin|rightMargin…, h: offset EMU | align,
      relV: page|margin|paragraph|line|topMargin…, v: offset | align }`, `cx`, `cy`,
      `behindDoc`, `wrap: none|square|tight|through|topAndBottom` + `wrapSide`, `dist`
      (`distT/B/L/R`), `z` (`relativeHeight`), `rotation`, `flip`, `geometry`
      (`prstGeom` name; custom geometry → bounding box), `fill`/`line` resolved to CSS by the
      Phase 0 theme resolver (solid, no fill, simple gradients as CSS gradient),
      `picture: { path }` for pictures **and picture fills** (`a:blipFill` on a shape, with
      `stretch`/`tile` and `srcRect` crop; VML `v:fill` with `r:id` in fallback shapes), media
      registered like other images so the editor resolves them, `text: PMDoc | null` for text boxes (read with the same
      block reader, so text boxes render with real styles), `xml` (raw, written back while
      unchanged), `alt`/`title`.
- [ ] `mc:AlternateContent`: use `mc:Choice` (wps/wpg) when understood, else keep the VML
      fallback as a labelled placeholder (`ooxmlInline`, as today).
- [ ] Anchors in headers/footers are read the same way (the template's sidebar band on chapter
      first pages lives in `footer22.xml`, positioned relative to the page).
- [ ] Frames: `w:framePr` → paragraph attr `frame: { wrap, hAnchor, vAnchor, x, y, w, h, xAlign, yAlign }`
      (display-only; rendered as a float or an absolutely positioned block).
- [ ] Writer: an unchanged anchor writes `xml` as is; changed position/size/alt patch
      `wp:positionH/V`, `wp:extent` + `a:ext`, `wp:docPr` in that XML; text box text edits
      rewrite only `w:txbxContent` (also in the VML fallback when present, or drop the
      fallback with a recorded reason).

### 3b Rendering

- [ ] `pagination.ts` already knows which page each block lands on; it also records, per
      `anchor`, its page and the top of its anchor paragraph/line. An **anchor layer** per sheet
      (in `PageView`, below the text for `behindDoc`, above it otherwise, ordered by `z`) draws
      each object at its resolved box: page/margin/column offsets from the page's section
      geometry, paragraph/line offsets from the measured anchor position. Shapes as
      absolutely positioned elements with CSS (`border-radius: 50%` for `ellipse`, SVG for
      other presets: a small preset table, rect/roundRect/ellipse/triangle/line first);
      text boxes render their PM JSON with the document CSS; pictures as `<img>`; picture fills
      as `background-image` (`cover`/tile, crop via `background-position/size`) clipped to the
      shape geometry (the template's cover photo in its oval).
- [ ] The inline `anchor` node itself renders as a zero-width marker (an anchor icon when
      selected or when « Afficher les ancres » is on).
- [ ] Text wrap: `none`/behind/in front: no effect on flow (covers the template).
      `square`/`tight`/`through` around a column- or paragraph-relative object: approximated
      with a `float` spacer inserted at the anchor paragraph (`shape-outside` for `tight`
      ellipses); page-relative wraps that don't align with the anchor paragraph fall back
      to no wrap, with a tooltip saying so. `topAndBottom`: block spacer.
- [ ] Anchors in headers/footers drawn on every page that uses that story.

### 3c Interaction: separate pass (decision 1: rendering first, editing after)

Not part of this plan's execution: started only after 3a/3b are accepted, with its own
go-ahead.


- [ ] Select (click on the object in the layer, or Tab/arrows to the anchor), move by drag
      or Alt+arrows (updates offsets in the anchor's own reference frame), resize with
      handles (Shift = keep ratio), delete, alt text in a dialog. Keyboard and screen-reader
      labels per B3/B8 conventions (fr-CA).
- [ ] Edit text inside text boxes: a nested `StoryEditor` on the box, saved back into the
      `text` attr (single-user editing of that attr; real Yjs sub-fragments are a later step).
- [ ] Insertion menu: « Forme » (rect/ellipse/line) and « Zone de texte », inserted behind or
      in front of text with no wrap.

**Done when** (3a+3b) the template's cover shows the dark full-page background with the
oval, its photo and its text, every chapter page shows the dark sidebar band with its number, colours match the
reference, `anchors.docx` matches its reference, and export stays byte-identical for
unchanged shapes.
**Skills** `oel-rust-engine`, `oel-editor-feature`, `oel-file-kind` (desk thumbnail draws behind-text fills).

## Phase 4: Fonts (~½ day): fixes symptom 8

- [ ] Substitution table in `styles.rs` (already has metric-compatible fallbacks for Office
      fonts) extended with open fonts close to common template fonts (e.g. Century Gothic →
      TeX Gyre Adventor / Questrial; Felix Titling → Cinzel; Gill Sans → Lato…), each listed
      with its licence (OFL).
- [ ] Self-host those web fonts in `@oel/docs` (approved, decision 2) (`@fontsource/*`, loaded on demand when a
      document's stack needs them; never at startup), so every machine renders alike.
- [ ] Embedded fonts (`word/fonts/*.odttf`, obfuscated with the font key from `fontTable`):
      de-obfuscate in Rust and hand them to the editor as `FontFace`s (the legacy
      `oeldocx_rs/src/fonts.rs` has the de-obfuscation to port).
- [ ] The font menu shows « Felix Titling (remplacée par Cinzel) » when substituted.

**Done when** the template's headings and body render in the substitute faces with line
breaks close to the reference, and a document with embedded fonts uses them.

## Phase 5: Desk thumbnails and printing (~½ day)

- [ ] Desk preview (`model/preview.ts`): first page geometry + behind-text background colour
      from the first section, so the cover thumbnail is dark like the document.
- [ ] Print (`Ctrl+P`): the print stylesheet uses the per-page sizes (`@page` per section via
      named pages) and draws the anchor layers.

---

## Order and estimates

Phase 0 → 1 → 2 → 3 (3a + 3b) → 4 → 5 (≈ 8 days). 1 and 2 are independent after Phase 0
and could be swapped; 3 needs 1 (positions are relative to section geometry). 3c (shape
editing) is outside this estimate, by decision 1.

Fits with `2026-10-restructure.md`: this work stays inside `crates/oel-docx` and
`@oel/docs`; do it before restructure Phase 3 (kind modules) or rebase the page view
onto the document kind module afterwards. The Y.Doc migration (1b) must land before any
production data exists on a server, or ship with it.

## Decisions (2026-10-03)

1. **Shapes:** rendering first (3a + 3b); editing (3c) is a later, separate pass.
2. **Fonts:** bundling OFL substitutes, loaded on demand, is approved.
3. **Format bump:** `oeldocx-pm@2`, no migration: stored documents are dev data and are
   re-imported. Note for later: document storage is expected to become a compressed package
   of all of a document's files (docx-like) rather than today's Y.Doc + parts; keep the
   sections/stories model independent of the storage format so that change doesn't touch it.
4. **Approximations accepted:** wrap around page-relative objects not reflowed, custom
   geometry drawn as its bounding box. **Not** accepted: page size/orientation must really
   change the canvas and the desk paper (symptom 11), and mixed orientations are centred
   like Word.
