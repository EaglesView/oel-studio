---
name: oel-editor-feature
description: Add or modify a feature inside an OutilsEnLigne editor — the Docs editor (@oel/docs, Tiptap/ProseMirror + Yjs, DOCX), the Sheets editor (@oel/sheets, canvas grid + IronCalc worker, XLSX/CSV), or Forms (@oel/forms builder/filler). Covers model → Yjs → UI → file export → tests, and the kit/icon/copy conventions.
---

# Editor features

First locate the spec: Figma `Y3vDuuW4jfyTOjreIwDp6P`, page "Editor — Behaviors"
(E = Formulaires, F = Documents Word; sheets follow the same level/back-gesture rules).
If the user gave a Figma link, read it with the Figma tools before coding.

## Package anatomy (same for each editor)

| Folder | Contains | Rules |
|---|---|---|
| `model/` | Pure data + Yjs mapping (`ydoc.ts`), preview for the desk, blank doc | No React, no DOM: imported by `apps/collab` on the server |
| `ui/` | React components, toolbar, menus, dialogs, CSS | `@oel/emboss` components, `--emboss-*` tokens, Iconoir icons, fr-CA copy |
| `collab/` | Session on `@oel/collab-client` | Sharing/versions/sync UI comes from `@oel/collab-client`, don't fork it |

### Docs (`packages/docs`)
- Schema: `src/extensions/{nodes,marks,lists,pagination,editing,find}.ts` — mirrors the codec in `crates/oel-docx`. A new node/mark/attr that must survive save needs codec support (`oel-rust-engine`) and a schema test.
- UI: `DocsEditor.tsx` (variants: sheet = level 2, full = level 3), `DocsToolbar.tsx`, `MenuBar` spec in `actions.ts`, `PageView.tsx`, `StoryEditor.tsx` (headers/footers).
- Sections (Y.Doc format 2, `model/ydoc.ts`): section records live in the `sections` Y.Map by id; their **order is never stored**: it is the order of paragraph `section` attrs in the body, then `body` (`model/sections.ts` `sectionOrder`). Headers/footers are `story:<storyId>` fragments indexed by `stories` (`storyId → { part, side }`); a section holds only its own references and `effectiveStory` applies Word's inheritance (`first` only with `titlePg`, `even` only with `settings.evenAndOddHeaders`). Page numbers: `pageNumbers` / `formatPageNumber`. Edits to section records that should undo with the body go through a transaction with origin `SHARED_EDIT_ORIGIN` (the body editor's UndoManager also tracks the `sections` map). A stored document of another `formatVersion` is refused on open (`DocFormatError`, re-import the .docx).
- Pagination (`extensions/pagination.ts`) lays out **per section**: `storage.layout` (ordered sections, `frame`, section of each top-level block), `storage.pages: PageInfo[]` (size, margins, top, number/label per sheet). The body column spans the union of all text columns; blocks of a narrower section are inset by node decorations (transparent side borders on paragraphs so Word indents still apply, margins on other blocks). Use `usePages(editor)` / `sectionIndexAt(editor, pos)` rather than recomputing geometry.
- Floating objects: `wp:anchor` (also inside `mc:AlternateContent`) is the inline atom `anchor` (`kind`, `position`, size, wrap, `shape` look resolved to CSS by the codec, group `children`, raw `xml`). In the text it is only a marker (`.oel-anchor`, a float spacer when the wrap can be approximated: `anchorWrapStyle`); pagination records where each lands (`storage.anchors`) and `ui/Anchors.tsx` draws them on per-sheet layers behind/in front of the text (`anchorBox` = Word's reference frames). Header/footer anchors come from their story JSON. Editing shapes (move/resize/text boxes) is a separate pass (plan 3c).
- Fonts: the codec lists the document's fonts (`DocxJson.fonts`: substitute from `crates/oel-docx/src/fonts.rs` `SUBSTITUTES`, embedded faces de-obfuscated into the media). `ui/fonts.ts` registers embedded faces and, only for fonts the machine lacks, the self-hosted Fontsource substitute (woff2 URLs + FontFace, never a stylesheet at startup); keep `WEB_FONTS` in step with `SUBSTITUTES`. The font menu labels substitutions (`fontLabel`).
- Printing (`ui/print.ts`): Ctrl+P prints one page per laid-out sheet at its section's size (named `@page` per size) from clones of the sheets, anchor layers and the body blocks on each page; it prints in the main document so styles and FontFace fonts apply. Pageless mode falls back to the flow print (`printDocument`).
- Tables: the codec resolves Word's look (table style chain + `tblLook` conditional formats + table/row/cell properties, `crates/oel-docx/src/tables.rs`) into display-only `css` on `table` (width, `jc`, `tblInd`) and `tableCell` (borders, conditional shading/text, margins); `DocTableView` applies the table's, cells render theirs. Cells have no default border: `Affichage › Quadrillage des tableaux` shows a dashed screen-only grid; tables made in the editor (`tblPr` null, `data-new-table`) are drawn and exported with Table Grid borders.
- Tests: `test/schema.test.ts`, `test/editor.test.ts` (headless edit → .docx → LibreOffice when `soffice` is installed).

### Sheets (`packages/sheets`)
- Cells live in a Y.Doc keyed by stable row/col ids; formulas are stored with id refs (`model/formula.ts`) and shown as A1 (`model/a1.ts`). Never store A1 refs in Yjs.
- Calc runs in a worker (`calc/calc.worker.ts` → `WasmCalc` from oelxlsx). New functions = IronCalc support + `model/functions.ts` list for autocomplete.
- Grid is canvas (`grid/render.ts`, `geometry.ts`, `selection.ts`); interaction in `ui/controller.ts`. Keep the a11y mirror in `Grid.tsx` in sync.
- Tests: `test/{model,calc,fill}.test.ts`.

### Forms (`packages/forms`)
- Model in `src/model` (types, creation, validation, linked-sheet mapping `applyResponses`/`syncLink`).
- All server calls go through `FormsBackend` (`src/api/backend.ts`); never call `fetch` from UI. Server-side work → `oel-collab-backend`.
- Bureau glue (sheet sync, threads) is in `apps/web/src/bureau/forms.ts`.
- Tests: `test/forms.test.ts`, `test/render.test.ts` (happy-dom).

## Steps

1. Model change + unit test.
2. Yjs mapping (undo granularity, collaborative safety: two clients editing at once must converge).
3. UI using kit components; tooltip = name + shortcut + effect; disabled tools explain why.
4. Export path: does the feature survive `.docx`/`.xlsx`/`.csv` export and re-import? If not, the codec needs it, or the UI must say it won't be saved.
5. Offline: works with the collab server stopped (IndexedDB), syncs when it returns.
6. File pickers, downloads, storage: use the existing helpers (and `@oel/platform` once plan Phase 4 lands) — don't call `indexedDB` or create download links inline.
7. `oel-verify`. If behaviour now differs from Figma, tell the user (and offer to annotate the Figma section).
