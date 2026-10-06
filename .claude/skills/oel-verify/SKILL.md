---
name: oel-verify
description: Definition of done for any OutilsEnLigne change — the Rust, TypeScript and test commands to run in oel-studio and the engine crates, plus the browser checks for the Bureau, Docs, Sheets and Forms. Use before reporting a feature or fix as finished.
---

# Verify a change

Run what applies, report actual results (paste failures, don't paraphrase them).

## Rust (if a crate changed)

```bash
cargo test --workspace           # from the oel-studio root
cargo clippy --workspace --all-targets -- -D warnings   # needs the clippy component (Fedora: dnf install clippy)
cargo check --workspace --target wasm32-unknown-unknown --features oel-docx/wasm,oel-xlsx/wasm,oel-pptx/wasm,oel-img/wasm,oel-img/gpu
cargo test -p oel-img --features gpu   # GPU vs CPU parity (lavapipe if installed; skips without an adapter)
# WebGL2-like path: WGPU_BACKEND=gl cargo test -p oel-img --features gpu --test gpu_parity -- --test-threads=1
#   (NVIDIA: prefix __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json)
npm run build:wasm               # web + node targets into packages/wasm/
```
A stale `packages/wasm/` is the most common cause of "works in Rust, broken in the app"
(`npm run dev|test|build` rebuild stale crates automatically).

## oel-studio

```bash
npm test                         # cargo test --workspace, then vitest: desk, engine, docs (+LibreOffice if soffice exists), sheets, forms, collab
npm run typecheck                # regenerates contract types (gen:types), then tsc per package; `astro check` cannot run under TypeScript 7 (known gap)
npm run build                    # static site; catches app-level type errors stripped by tsc runs
```

## Browser (`npm run dev` → http://localhost:4321, collab on :8787)

Pick the rows your change touches; use the `run` skill or the browser tools to drive it.

| Area | Check |
|---|---|
| Bureau `/bureau` | Import a .docx, .xlsx, .csv, PDF, image by drop; papers show progress then preview; zoom out (thumbnails), select, contextual toolbar |
| Levels | Double-click opens in place; Ctrl+Maj+Entrée full screen; Esc goes back one level at a time; URL per level |
| Docs `/document` | Edit, export .docx, reopen; share link in a private window (editor/viewer roles); offline edit with collab stopped then resync |
| Sheets `/tableur` | Formulas recalc, fill, copy/paste, export .xlsx/.csv and reopen |
| Slides `/presentation` | Open the `fixtures/pptx` decks (look matches PowerPoint), move/resize/type, new slide from a layout, notes, F5 slideshow + presenter window, export .pptx and reopen it in PowerPoint/LibreOffice |
| Forms | Create from sheet → publish → respond at `/f?s=…` → row appears in the sheet |
| Themes | Light and dark (`ThemeToggle`), keyboard focus rings visible |

Also check the browser console for errors.

## Before saying "done"

- Copy is fr-CA, icons Iconoir, kit tokens only.
- README tables ("What's real and what's stubbed", Figma ↔ code) updated if status changed.
- If the change completes a step of `docs/plans/2026-10-restructure.md`, tick it and update the skills that phase lists.
- Don't commit unless the user asked.
