---
name: oel-verify
description: Definition of done for any OutilsEnLigne change — the Rust, TypeScript and test commands to run in oel-studio and the engine crates, plus the browser checks for the Bureau, Docs, Sheets and Forms. Use before reporting a feature or fix as finished.
---

# Verify a change

Run what applies, report actual results (paste failures, don't paraphrase them).

## Rust (if a crate changed)

```bash
cargo test                       # in each changed crate (or `cargo test --workspace` after plan Phase 1)
cargo clippy -- -D warnings
```
Then rebuild WASM web + node targets (see `oel-rust-engine`) — stale `pkg/` is the most common cause of "works in Rust, broken in the app".

## oel-studio

```bash
npm test                         # vitest: desk, engine, docs (+LibreOffice if soffice exists), sheets, forms, collab
npm run typecheck                # tsc per package; `astro check` cannot run under TypeScript 7 (known gap)
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
| Forms | Create from sheet → publish → respond at `/f?s=…` → row appears in the sheet |
| Themes | Light and dark (`ThemeToggle`), keyboard focus rings visible |

Also check the browser console for errors.

## Before saying "done"

- Copy is fr-CA, icons Iconoir, kit tokens only.
- README tables ("What's real and what's stubbed", Figma ↔ code) updated if status changed.
- If the change completes a step of `docs/plans/2026-10-restructure.md`, tick it and update the skills that phase lists.
- Don't commit unless the user asked.
