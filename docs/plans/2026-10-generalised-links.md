# Generalised links (Figma I) — implementation plan

Figma: section **I · Liens généralisés**, page « Editor — Behaviors »
(https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=167-10452). Decisions: I6, recorded in
`docs/plans/2026-10-editor-ux-issues.md` § 1. Builds on links v1 (`docs/plans/2026-10-links-and-charts.md`, Part B).

## Where we start

- `@oel/links` knows one kind of value: a chart. `SourceRef` has `chart` and an unused `range`; `Carries` is
  `chart | chart-data`.
- `apps/web/src/links/resolver.ts` is chart-only: sources are spreadsheets (session + `CalcClient`), the value is a
  `ChartSpec`, targets write it into a slides element (`chart`) or a docs `ooxmlInline` node (`chart` attr, `oid`).
- Desk image papers have no backing document: `data.imageUrl` is an object URL, `fileName` the name. Nothing persists.
- Docs `image` nodes have no stable id (`src`, `path`, `rid`, `cx`, `cy`…); slides elements do (`Element.id`).
- Docs tables are Tiptap tables (`table/tableRow/tableCell`, cell `background`, `colwidth`); slides tables are
  `Element.table` (pptx model).

## Rules from the decisions (I6)

1. The source flows down to its copies; a copy's own edits stay local and never reach the source.
   A link records its copy's local edits (`edits[]`): view, undo, or « Appliquer à la source ».
2. A linked table takes the theme of the sheet or of the destination (`theme: 'source' | 'target'`). Style is edited
   in place for real; each style edit is a local edit (rule 1). Values are never edited in a copy.
3. A table too big for a slide: `view.overflow = 'truncate' | 'all' | 'rows'`, chosen from the table's floating bar.
4. Table → sheet copies the data once; the sheet owns the values from then on, the table becomes a linked copy.
5. Paste: an image copied from a desk file pastes **linked**; an image from the outside clipboard is **inserted**.

## Phases (each ends with typecheck + tests + a commit; browser checks per `oel-verify`)

### I-1 · Model (`packages/links`)
- `SourceRef` gains `image` (`{ kind: 'image'; objectId }`: a slide element, a doc image node `oid`, or a desk image
  paper id) and `cell` (`{ kind: 'cell'; sheetId; ids: { r, c } }`); `range` gets used.
- `Carries` gains `picture`, `table`, `value`.
- `LinkDef` gains optional `theme?: 'source' | 'target'`, `view?: { overflow: 'truncate' | 'all' | 'rows' }` and
  `edits?: LocalEdit[]` (`{ id, label, at, by, patch }`, the patch being kind-specific JSON).
- `LinkedValue` union: `{ kind: 'chart', spec }` · `{ kind: 'picture', media: { hash, mime, width, height } }` ·
  `{ kind: 'table', table: LinkedTable }` · `{ kind: 'value', text, num?, format? }`. `revOf` hashes it.
- `LinkedTable`: rows × cols of `{ text, num?, bold?, italic?, color?, fill?, align?, colSpan?, rowSpan? }`, column
  widths, header row count, the sheet theme (fonts, accent) — what both hosts need to draw a real table.
- Field list in `LinksDoc` extended; old links (no `theme`/`edits`) read as before. Tests: round-trip, `revOf` per kind.

### I-2 · Resolver by kind (`apps/web/src/links/`) — no behaviour change
- Split `resolver.ts` into the core (links, states, threads, backlinks, popover state) and adapters:
  `sources/{sheet,image}.ts` (`watch(docId) → read(ref) → LinkedValue`) and `targets/{slides,document}.ts`
  (`exists(objectId)`, `current(objectId)`, `apply(objectId, value, link)`, `insert(value, placement)`).
- The chart path moves onto them unchanged; the existing link tests and the manual chart route must still pass.
- This is also the shape the Phase-3 `KindModule` registry will absorb later.

### I-3 · Linked images (I1)
- Docs `image` node gets an `oid` attribute (editor-only, stripped before the codec, like `ooxmlInline.oid`).
- Image source adapter: a slide picture element, a doc image node, or a desk image paper. Desk image papers get a
  stable `imageId` + content hash in `PaperData` (they have no Y.Doc); their bytes are read from `imageUrl`.
- Target apply: put the bytes in the target's `MediaStore` (by hash, once) and point the element/node at it. The
  copy's own crop, size, rotation, wrap and border are kept on update; when they change, record a local edit.
- Routes: « Lier dans… » on an image paper and on a selected image (floating bar), drag of an image paper onto an
  open paper, and paste. The desk clipboard carries `{ docId, ref }`; paste of a desk image links (rule 5), the
  « Options de collage » chip offers « Incorporer (copie) ». Outside images insert, as today.
- Copy bar (`CopyImageBar`, docs + slides): Voir la source, Mettre à jour (Manuel), Recadrer, Lien.
- Edge cases (I5): image deleted → broken, last image kept, « Relier à… »; replaced → new version; narrower source →
  « Remplir / Ajuster ».

### I-4 · Range → linked table (I2)
- Sheet source reads a range by id-range: values as displayed (calc `format`), merges, styles, hidden rows/columns
  and filters skipped (option to include), a defined Excel table followed by its table id.
- Docs: build a real Tiptap table from `LinkedTable`, attributes `oid` + `linked`; values read-only (transaction
  filter on cell text; the I2 popover « Modifier dans le tableur / Délier et modifier »), style editable → local edit.
  Long tables paginate with a repeated header row.
- Slides: build `Element.table`; `view.overflow`: truncate (pill « 9 lignes sur 40 »), all (font down to fit),
  rows (opens the sheet on the range). « Affichage ▾ » in the table's floating bar.
- Theme: `source` copies the sheet's fonts/fills; `target` applies the destination's table style and font.
- « Lier dans… » on a range in the sheet (G2b d): Tableau lié / Graphique lié / Valeur.

### I-5 · Table → sheet (I3)
- « Envoyer vers un tableur… » in the table float bar and right-click menu (docs and slides).
- Dialog: new workbook (new paper next to the document) or new sheet in a desk workbook; « Le tableur commande »
  (default) or « Copie simple »; warnings for content that won't survive (images, lists → text). fr-CA number parsing.
- Commit: write the cells, then create the range link with the table as its copy; « Annuler » undoes both.
- Refused with a reason: already linked, nested table, read-only.

### I-6 · Linked value in text (I4)
- Docs inline atom `linkedValue` (`oid`, text) with the dotted underline for editors only; plain text in print/export.
- States: live, stale (amber), frozen (snowflake), broken (red). Hover card: source, Voir la source, Gérer le lien.
- Created from « Lier dans… › Valeur » on a single cell. Slides text runs come later.

### I-7 · Local edits in the link (I6, rule 1)
- Targets record local edits on copies (style, crop, theme switch) into `edits[]` with origin `person`.
- Link popover: « Modifications locales (n) » with undo per edit and « Appliquer à la source » (writes the patch to
  the source through its adapter: sheet styles for tables, crop for images, chart facets for charts).

### I-8 · Export (with Phase 9 of the links plan)
- docx: linked tables in `w:sdt` tagged `oel-link:<id>`; images and values as plain content with the same marker.
- pptx: `p:custDataLst`/extLst on the graphic frame. Re-import restores links.

## Order

I-1 → I-2 → I-3 → I-4 → I-7 → I-5 → I-6 → I-8. I-7 comes before I-5 because « style d'ici » tables and cropped images
need the edits list to be honest about what is local.

## Verification

- vitest: `@oel/links` model (kinds, revs, field round-trip, old links), table build (merges, hidden rows, theme),
  read-only cell filter, edits list undo/apply, fr-CA number parsing for table → sheet.
- Browser (Claudezilla, one attempt each; blocked → « non vérifié »): image paper → doc and slide, change the source
  image; range → doc table and slide table with overflow menu; table → new workbook and back; cell → value in text.
