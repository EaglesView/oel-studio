# Packages in detail

What each package and app does, how it is built, and what is real or stubbed. Moved from the README
(plan `docs/plans/2026-10-solo-mvp.md`, S-9), which now gives the overview; layer rules are in
`ARCHITECTURE.md`. Sections describe the **team edition** where they mention sharing, presence,
versions or forms: the default single-user build (`PUBLIC_EDITION=solo`) hides those in the front end.

## @oel/emboss — the kit

- `styles/tokens.css` mirrors the Figma variables 1:1 (`emboss/surface` → `--emboss-surface`),
  both modes, plus `Spacing`, `Radius` and every `Emboss/*` effect style as a `--shadow-*`
  token. Theme follows the OS; `<html data-theme="dark|light">` forces it.
- Components wrap react-aria-components, so keyboard, focus management, ARIA and
  i18n come from Adobe's implementation; styling hooks onto RAC's `data-hovered`,
  `data-pressed`, `data-selected`, `data-focus-visible` states, which map directly onto
  the kit's Default/Hover/Pressed/Focused/Disabled variants. Motion uses the kit's
  durations and `cubic-bezier(0.22, 1, 0.36, 1)`, and `prefers-reduced-motion` zeroes them.
- Icons: the 28 kit icons are exported verbatim from Figma. Every other icon comes from
  [Iconoir](https://iconoir.com) (`iconoir-react`, MIT), drawn at the kit's 1.75 stroke;
  the same Iconoir SVGs are components in the Figma Icons frame. New icons: use Iconoir.
- Tool tooltips implement B3: name + shortcut + effect, and unavailable tools stay
  focusable and say *why* (`unavailableReason`) instead of going silent.

## @oel/i18n — interface language

The Bureau is French by default and English on request. Packages never choose the language: they
follow `<html lang>`, which `apps/web/src/layouts/Base.astro` sets before any module runs, from the
`oel-lang` cookie (or `?lang=fr|en` from the site's « Ouvrir le Bureau »). So a message table is
picked once, at module load: `messages(fr, en)` (English typed against French), `tr(fr, en)` for a
lone label, `plural`, and `locale()` (`fr-CA` / `en-CA`) for `Intl`. Changing the language reloads
the page (the desk is saved on `pagehide`). Web Workers learn it from their name
(`workerOptions`, `namedWorker` in the app). Key names in shortcuts are written once in French
(« Ctrl+Maj+L », « Échap ») and shown in English by `keyLabel` (`@oel/emboss`).

App side (`apps/web/src/lang.ts`, `bureau/Welcome.tsx`): the first visit opens a welcome dialog —
the language (unless it came from the site), links to the docs, and what is stored (the one
`oel-lang` cookie, local storage, files in the browser). The language changes in the menu,
« Paramètres ». A first visit that picks English gets the demo desk in English
(`fixtures/demo/en`).

## @oel/desk — the canvas

Why a separate package: the desk model (scene, camera, selection, history, spatial
navigation, levels of detail) has nothing to do with documents. Keeping it free of
React and of file types means a WASM engine, a collaboration layer (CRDT) or a different
renderer can drive the same `DeskStore`.

- **Core** (`@oel/desk`): `DeskStore` (subscribe/getState for `useSyncExternalStore`),
  gesture-level undo (`begin`/`end` = one step per drag), zoom limits (`zoom: { min, max }`,
  the min is a hard max zoom-out — there is no "fit everything"), `lodForZoom`
  (`thumbnail` below 50 %, `live` above), `wheelZoomFactor`, `nearestInDirection`, `readingOrder`.
- **React** (`@oel/desk/react`): `<DeskCanvas>` renders papers as **DOM**, not `<canvas>`,
  on purpose — that is what keeps it accessible:
  - the desk is a multi-select `listbox`; each paper is an `option` with a full label
    (title, type, stamp, status, comment count) and roving focus;
  - every pointer gesture has a key: arrows move between papers spatially, Space toggles
    selection, Enter opens, Alt+arrows move papers (WCAG 2.5.7), Shift+arrows pan,
    `+ −` zoom, `0` back to 100 %, Ctrl+Z/Ctrl+Shift+Z, Delete, Shift+F10 context menu;
  - zoom: Ctrl/⌘ + wheel or pinch, at the pointer; a wheel notch is a ~11 % step
    (`wheelZoomSpeed` prop); plain wheel pans;
  - a polite live region announces moves, selection counts, zoom, max zoom-out, undo;
  - selection outlines are drawn in screen space (always 2 px); `forced-colors` handled.
- `<Minimap>` is a pointer convenience and is `aria-hidden`; everything it does has a key.
- For very large desks, add viewport culling in `DeskCanvas` (render only nodes whose rect
  intersects the screen) before reaching for a GPU renderer.

The **list view** (Vue liste) is the required non-spatial alternative (note on *05 · Bureau*):
same store, same selection, a react-aria `GridList`.

## @oel/engine — where the WASM goes

The editor shell never parses files itself. It asks an `EngineHost` (main thread), which
posts the bytes to a **Web Worker** running an `EngineRegistry`. Each engine implements:

```ts
interface DocumentEngine {
  id: string;
  kinds: FileKind[];                     // document | slides | spreadsheet | pdf | image …
  import(req, onProgress): Promise<ImportResult>;   // preview + readOnly + reason
  export?(handle, format): Promise<Uint8Array>;
}
```

- `detectKind` picks the workspace (magic bytes beat extensions for PDF/images).
- `previewEngine` (JS) is the fallback: it reads .docx/.xlsx/.pptx/.odt/.ods/.odp text via a
  tiny ZIP reader + `DecompressionStream`, CSV/TSV/TXT/MD, PDF page count / scanned
  detection, image dimensions. Enough for the UX flow on real files today.
- `createWasmEngine` / `createOeldocxEngine` wrap a wasm-bindgen package and lazy-load it in
  the worker on first use. **oeldocx-rs** (`crates/oel-docx`, built into `packages/wasm/oel-docx/web`) is
  registered in `src/worker/engine.worker.ts` and takes over `.docx`: imports carry a
  `DocxPayload` (editor JSON, images, original file) and the engine also does
  `export({ kind, format: 'docx', data })` and `create('document')`.
  `npm run build:wasm` builds both targets (web for the workers, nodejs for the collab
  server and vitest) of every crate with a `wasm` feature.
  oelimg-rs plugs in the same way for `image`.

## @oel/docs — the document editor

A Google-Docs-like editor for real .docx files.

- **Schema** (`src/extensions`) mirrors the oeldocx-rs codec exactly. Paragraphs keep Word's
  model (`styleId`, `numId`/`ilvl` lists, spacing/indent in twips) and the original `pPr`/`rPr`
  XML; anything unmodelled is an opaque `ooxmlInline`/`ooxmlBlock`. The codec only rewrites
  what changed, so untouched formatting, styles, themes, fields and bookmarks survive.
- **Editing**: styles (Word's own style list), fonts, sizes, colours, highlight, sub/superscript,
  alignment, line/paragraph spacing, indents, bullet/numbered/check lists (Tab/Maj+Tab levels),
  tables (resize, merge/split, rows/columns, cell colour), images (paste, drop, URL, resize, alt
  text), links, page breaks, tabs, footnotes/endnotes, table of contents (Word TOC field),
  headers/footers with page numbers, special characters, find & replace (case, whole word,
  regex), format painter, clear formatting, Markdown shortcuts, French typography.
- **Page view**: line-by-line pagination (`extensions/pagination.ts`) with sheets, headers and
  footers drawn behind the text; pageless mode; zoom; outline; non-printing characters.
- **Files**: .docx (round trip through the engine worker), PDF via print, HTML, Markdown, text.
- **Collaboration** (`src/collab`): one `Y.Doc` per document (`model/ydoc.ts` documents the
  layout), IndexedDB offline copy (`y-indexeddb`), Hocuspocus sync, presence avatars, share
  links with roles, named and automatic versions with preview and restore. Without a server a
  document stays local and can be published later from « Partager ».

- **Levels** (Figma *Editor — Behaviors*, sections A, B and F): in the Bureau a document opens
  in place as a compact sheet (`DocsEditor variant="sheet"`: ribbon, « Plus » menu, « Reposer »,
  « Agrandir »), or in full screen (`variant="full"`: breadcrumb, menus, outline, status bar,
  « Réduire »). Each level has its URL (`/bureau?f=<id>`, `&vue=plein-ecran`) so the browser's
  Back does what Échap does; Échap first closes what is in progress (menu, find bar, header
  editing, format painter, focus mode — consumers `stopPropagation`, since ProseMirror
  `preventDefault`s every Échap). Ctrl+Maj+Entrée toggles levels, and opens the selection in full
  screen from the desk. Putting a file back commits its thumbnail from the shared document, keeps
  it selected and focused, and offers « Rouvrir ». Focus mode: Ctrl+Maj+F.

Remote cursors, comments and suggestion mode are not built yet; the Y.Doc layout leaves room.

## @oel/forms — forms

Figma *Editor — Behaviors* · section E. A form is a paper on the desk (dock « Formulaire »,
« Nouveau », or « Créer un formulaire » on a selected spreadsheet).

- **Builder** (`FormBuilder`): Questions · Réponses · Paramètres tabs; outline (drag, Alt+↑/↓),
  question cards (↑/↓ select, Ctrl+D duplicate, Suppr, « / » in an empty title picks the type),
  add rail (question, title + text, section = new step, import columns), inspector (type,
  required, « Autre », hide full choices, file rules, data link, choices from a sheet range).
  Paramètres: accent with the AA contrast guard, logo, cover, title font, rhythm, texts, live
  desktop/mobile preview. « Aperçu » = respondent view, nothing sent.
- **Linked spreadsheet** (`model/sheet.ts`): one question = one column (+ « Reçu le »), one
  response = one row, edits update their row, deleted questions archive their column,
  quotas read from ranges. In the Bureau, `bureau/forms.ts` keeps the sheet paper in step
  with responses for every published form and draws the « Réponses → … » thread.
- **Publishing** asks only for what is missing: a linked sheet, then an account (magic link,
  `/connexion` signs in every tab and publishing resumes), then the rules (identity, closing
  date, limit, one per verified email, copy, editable responses), link + QR (PNG/SVG).
- **Respondent page** (`FormFiller`, `/f?s=<slug>`): welcome, optional/verified email (6-digit
  code), steps with progress, validation on blur, GOV.UK-style error summary, drafts on the
  device, file uploads with per-file states, review, invisible human check with accessible
  fallback, rate limit countdown, confirmation with personal edit link and .ics.
- **Backend**: the UI only talks to `FormsBackend` (`api/backend.ts`). `createLocalBackend`
  implements it in the browser (localStorage + BroadcastChannel) so the flow works across tabs
  today. Every server responsibility is marked `TODO(backend)` / `TODO(anti-abuse)`
  (`grep -rn "TODO(" packages/forms apps/web/src/forms`).

## apps/collab — collaboration server

`npm run dev:collab` (port 8787, data in `apps/collab/data/`). Set `COLLAB_SECRET`,
`COLLAB_PUBLIC_URL` and `COLLAB_DATA_DIR` in production; the web app reads
`PUBLIC_COLLAB_URL` (default `http://localhost:8787`).

- No accounts: creating a document returns an **owner token**; the owner creates editor or
  viewer links (HMAC-signed tokens naming the document, role and link). Revoking a link
  disconnects its sessions and refuses its tokens. Viewers connect read-only.
- Stores Yjs state, the original .docx, images (unguessable ids), versions (automatic every
  10 min of activity, 50 kept; named ones kept forever) and exports .docx server-side.
- Share links look like `/document?d=<id>#t=<token>`: the token stays in the fragment
  (never sent to the web server) and is kept in the browser after the first visit.

## What's real and what's stubbed

| Area | State |
|---|---|
| Desk: select, lasso, drag, nudge, zoom/pan (25 %–400 %), minimap, threads, undo | Working |
| Papers ("windows") of every type: select, drag, zoom out to small thumbnails (refreshed every 15 s while zoomed out) | Working |
| Contextual toolbar per type (B2), multi-selection actions (B7) | Working |
| Comments | Removed from papers; planned as a canvas-wide feature |
| Documents (.docx): full editor, lossless round trip, offline, sharing, versions | Working (`@oel/docs` + `apps/collab`) |
| Presentations (.pptx): editor (filmstrip, shapes, text, pictures, layouts, notes), slideshow + presenter window, lossless round trip, offline, sharing, versions, `/presentation` | Working (`@oel/slides` + `crates/oel-pptx` + `apps/collab`). Kept but not editable: animations, transitions, SmartArt, group members, table structure. Charts are drawn (`@oel/charts`) but not yet editable in slides |
| Charts (`crates/oel-chart` + `@oel/charts`, Figma H): every Office chart type read and drawn (2-D, 3-D, stock, surface, radar, chartEx) in sheets, slides, documents and desk thumbnails; in sheets: insert (Alt+F1, gallery with live previews), select, move, resize, change type, colours, elements, data, format, written back to .xlsx (untouched charts byte for byte) | Working in sheets. Slides and documents: drawn from the file's cache, not yet editable. chartEx (treemap, cascade…) drawn and kept, not editable. |
| Fils de liaison (`@oel/links` + `apps/web/src/links`, Figma G): « Lier dans… » on a sheet chart puts a linked copy in a presentation (new or last slide) or a document (start or end); live by default, Manuel or Figé per link; copies update within a second of a cell edit; desk threads derived from the files (curved, coloured by state, focusable chips), thread popover (mode, « Transporte », update, open source/copy, cut), « Fils du bureau » panel (Ctrl+Maj+L), badges on copies, « Utilisé dans N fichiers » on the source chart; a deleted source chart → « Rompu », the copy keeps its last value | Working on one desk (in the browser). Linked charts are written into exported .pptx/.docx (as plain charts; the link itself stays on the desk). Ranges (linked tables in documents and slides) and single values (pasted into document text) work too (generalised-links I-4, I-6). **Not yet**: paste/drag/insert-from-target routes (G2b), values in slide text, delete-source dialog, slideshow deferral, « Changer la source… », history |
| Open in place (B4): image, note | Working |
| PDF | Kept on the desk with its page count; drawing, annotating, signing and « Convertir pour modifier » are unavailable tools that say why (PDF engine to come) |
| Import (B8): drop / file picker → worker → paper with progress, read-only states, toast | Working with the JS preview engine |
| Crop/OCR/cut-out, themes, export, "one PDF from selection" | Disabled tools that explain why (engines not wired) |
| Presence (avatars, named cursors) | Desk: static demo data. Documents: live avatars (no cursors yet) |
| Persistence | Everything in this browser (IndexedDB): the desk (one Y.Doc per project, `bureau/persist.ts`), documents, workbooks, decks, originals and thumbnails; « Exporter / Importer un bureau » (.zip, lossless). Team edition: documents also on the collab server |
| Projects (Figma N): project context (name, members, four roles), settings cascade OEL → compte → projet → fichier (`apps/web/src/project/`), import rules saved as project settings | **Local stub backend** (localStorage, one demo project + « Mon bureau »); no switching, routes or server yet (plan N-2 → N-6) |
| Forms: builder, linked sheet, publishing, respondent page, drafts, quotas, held responses | Working UI on a **local stub backend** (localStorage); server, emails, OAuth, uploads, Turnstile are `TODO(backend)` |

## Figma ↔ code

| Figma | Code |
|---|---|
| Color · emboss/* (Light/Dark), Spacing, Radius | `packages/emboss/src/styles/tokens.css` |
| Emboss/Raised, Pressed, Well, Sheet, Knob, Ink… effect styles | `--shadow-*` tokens |
| Button/Primary · Secondary · Ghost · Destructive · Success | `Button` (`variant`, `size`) |
| Ribbon, .Building Blocks/Toolbar Toggle, Toolbar Separator | `Toolbar`, `ToolbarToggle`, `ToolButton`, `ToolbarSeparator` |
| Text Field, Number Field (+ Stepper Key), Select (+ Menu, Option) | `TextField`, `NumberField`, `Select`/`SelectItem` |
| Checkbox, Radio/Radio Group, Switch, Slider, Tabs | same names |
| Tooltip, Popover, Dialog, Toast | `Tooltip`/`WithTooltip`, `Popover`, `SheetDialog`+`DialogOverlay`, `ToastRegion`/`toast()` |
| Badge (Stamp/Tinted), Card, Sidebar/Nav Item, Pagination | same names |
| Date Picker | not ported yet |
| B1 desk (papers, pills, dock, minimap, cursors) | `apps/web/src/bureau/*` (a new desk holds the demo: `bureau/demo.ts`, files in `fixtures/demo`) |

## Known gaps

- `npm run check` (astro check) cannot run with TypeScript 7 (native, no JS API): `npm run typecheck`
  runs `tsc -p apps/web` instead, which checks the app's TypeScript but not `.astro` templates.
- Footnotes are shown together at the end of the document, not at the bottom of each page.
- Print / PDF uses the browser's pagination and does not include headers and footers.
- Floating (anchored) images keep their position on export but are shown inline.
- Tracked changes in imported files are accepted on import.
- Missing fonts: the « Polices manquantes » dialog is only reachable from the toast shown the
  first time a file opens; once that toast is dismissed there is no way back to it yet
  (`TODO(ux)` in `SlidesEditor` and `DocsEditor`). Font choices only change the screen, in
  this browser; they are not written to the file.
