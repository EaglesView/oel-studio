# OutilsEnLigne · Studio

The multimodal editor ("Bureau") and the blind-emboss UI kit, built from the Figma file
[OutilsEnLigne.ca](https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca):
page **Embossed Component List** (49:134) and **Editor — Layout Explorations** (78:8),
mainly *05 · Bureau* and the *Bureau — Exploration* section (B1–B8).

```
npm install
npm run dev        # http://localhost:4321  →  /bureau, /composants
npm test           # desk core + engine unit tests (vitest)
npm run typecheck
npm run build      # static site in apps/web/dist
```

## Layout

```
packages/
  emboss/   @oel/emboss   UI kit on react-aria-components + Figma tokens (Light/Dark)
  desk/     @oel/desk     Infinite-desk canvas: framework-free core + React DOM renderer
  engine/   @oel/engine   Document-processing contract, Web Worker host, JS preview engine,
                          adapter for WASM engines (oeldocx-rs, oelimg-rs)
apps/
  web/      Astro site: /bureau (the editor), /composants (kit showcase)
```

Packages ship TypeScript source (`exports` → `src/`) and are compiled by the app's Vite.
Add a build step (tsup/tsdown) only if they need publishing outside this repo.

## @oel/emboss — the kit

- `styles/tokens.css` mirrors the Figma variables 1:1 (`emboss/surface` → `--emboss-surface`),
  both modes, plus `Spacing`, `Radius` and every `Emboss/*` effect style as a `--shadow-*`
  token. Theme follows the OS; `<html data-theme="dark|light">` forces it.
- Components wrap react-aria-components, so keyboard, focus management, ARIA and
  i18n come from Adobe's implementation; styling hooks onto RAC's `data-hovered`,
  `data-pressed`, `data-selected`, `data-focus-visible` states, which map directly onto
  the kit's Default/Hover/Pressed/Focused/Disabled variants. Motion uses the kit's
  durations and `cubic-bezier(0.22, 1, 0.36, 1)`, and `prefers-reduced-motion` zeroes them.
- Icons: the 28 kit icons are exported verbatim from Figma. `EXTRA` icons in
  `icons/Icon.tsx` were drawn on the same grid for the editor and are **not in Figma yet**.
- Tool tooltips implement B3: name + shortcut + effect, and unavailable tools stay
  focusable and say *why* (`unavailableReason`) instead of going silent.

## @oel/desk — the canvas

Why a separate package: the desk model (scene, camera, selection, history, spatial
navigation, levels of detail) has nothing to do with documents. Keeping it free of
React and of file types means a WASM engine, a collaboration layer (CRDT) or a different
renderer can drive the same `DeskStore`.

- **Core** (`@oel/desk`): `DeskStore` (subscribe/getState for `useSyncExternalStore`),
  gesture-level undo (`begin`/`end` = one step per drag), `lodForZoom` (B5: <40 % piles,
  40–80 % thumbnails, above: live content), `nearestInDirection`, `readingOrder`, `fitRect`.
- **React** (`@oel/desk/react`): `<DeskCanvas>` renders papers as **DOM**, not `<canvas>`,
  on purpose — that is what keeps it accessible:
  - the desk is a multi-select `listbox`; each paper is an `option` with a full label
    (title, type, stamp, status, comment count) and roving focus;
  - every pointer gesture has a key: arrows move between papers spatially, Space toggles
    selection, Enter opens, Alt+arrows move papers (WCAG 2.5.7), Shift+arrows pan,
    `+ − 0 1 2 3` zoom, Ctrl+Z/Ctrl+Shift+Z, Delete, Shift+F10 context menu;
  - a polite live region announces moves, selection counts, zoom level changes, undo;
  - focus is handed over when papers turn into piles and back;
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
  the worker on first use. To wire **oeldocx-rs** (sibling repo):
  1. add `"oeldocx-rs": "file:../../oeldocx_rs/pkg"` to `packages/engine/package.json`;
  2. in `src/worker/engine.worker.ts`:
     `registry.register(createOeldocxEngine(() => import('oeldocx-rs')))`;
  3. align the `EditorState → Preview` mapping in `engines/wasm.ts` with the crate's state.
  Registered engines take precedence over the preview engine for their kinds.
  oelimg-rs plugs in the same way for `image`.

In the document workspace the ribbon currently drives `contentEditable`/`execCommand`;
each command maps 1:1 onto `DocxController` (`set_bold`, `set_alignment_*`,
`toggle_bullet_list`, `apply_style`…), which is what replaces it.

## What's real and what's stubbed

| Area | State |
|---|---|
| Desk: select, lasso, drag, nudge, zoom/pan, LOD piles/thumbnails, minimap, threads, undo | Working |
| Contextual toolbar per type (B2), multi-selection actions (B7), comments | Working |
| Open in place (B4): document (rich text), slides (filmstrip + notes), spreadsheet (editable grid, live sum), PDF (read-only + annotate rail), image, note | Working UI; edits stay in memory |
| Import (B8): drop / file picker → worker → paper with progress, read-only states, toast | Working with the JS preview engine |
| PDF → editable document (06) | **Simulated progress**; the new document says so |
| Crop/OCR/cut-out, themes, export, "one PDF from selection" | Disabled tools that explain why (engines not wired) |
| Presence (avatars, named cursors) | Static demo data; no sync layer |
| Persistence | None yet (state is in memory) |

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
| B1 desk (papers, pills, dock, minimap, cursors) | `apps/web/src/bureau/*` (`seed.ts` reproduces B1) |
