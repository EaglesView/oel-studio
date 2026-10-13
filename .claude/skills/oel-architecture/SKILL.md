---
name: oel-architecture
description: Decide where a change belongs in OutilsEnLigne (oel-studio + Rust engines) and which other oel-* skill to follow. Use before any non-trivial feature, refactor, new package, new file type, or when unsure which layer (Rust engine, @oel/engine, editor package, Bureau, collab server) owns something.
---

# Where does this change go?

Read `ARCHITECTURE.md` at the repo root for the full picture and
`docs/plans/2026-10-restructure.md` for structural work in flight (check which phases are
done — the skills describe the layout *as it is now*).

## Layer rules (dependencies point down only)

| Layer | Lives in | Owns | Must not |
|---|---|---|---|
| Rust engines | `crates/oel-docx`, `crates/oel-xlsx`, `crates/oel-pptx`, `crates/oel-opc`, `crates/oel-chart`, `crates/oel-img` (WASM builds → `packages/wasm/`) | File formats (lossless), calc (IronCalc), image ops | Touch DOM, hold editor state, know about UI |
| Engine contract | `packages/engine` | `FileKind`, `Preview`, `ImportResult`, payload formats, `EngineRegistry`, `EngineHost`, WASM adapters | Import React or editors |
| Shared UI/infra | `packages/emboss` (kit), `packages/desk` (canvas), `packages/collab-client`, `packages/fonts` (fonts of opened files), `packages/img` (image engine host + recipes; must stay React-free — import `@oel/collab-client/local`, not its index) | Kit components/tokens, desk scene, sync/links/versions | Know file types (desk, emboss) |
| Editors | `packages/docs`, `packages/sheets`, `packages/slides`, `packages/forms` | `model/` (pure, Yjs), `ui/` (React), collab session | Import Bureau or `apps/*` |
| Product | `apps/web/src/bureau` (desk, kind glue, levels, saved desk `persist.ts` / `deskStorage.ts`, demo `demo.ts`), pages in `apps/web/src/pages` | Desk papers, kind glue, levels (Bureau → sur place → plein écran), the desk saved on the device | Contain file-format logic |
| Site | `apps/web/src/site` (home, docs, `i18n.ts`), `src/pages/{index,en,docs}` | Bilingual site (fr at `/`, en at `/en`), documentation | Import the Bureau's runtime (shared data like `bureau/shortcuts.ts` is fine) |
| Server | `apps/collab` | Yjs sync, share tokens, versions, media, exports, (forms/accounts next) | Be required for local-only editing |

## Decision shortcuts

- Parsing/writing a file format, or heavy computation → Rust. Follow `oel-rust-engine`.
- New desk paper type or changing how a type appears on the desk → `oel-file-kind`.
- Feature inside the document/spreadsheet/form editors → `oel-editor-feature`.
- Charts (reading, drawing, editing, writing, any chart type) → `oel-charts`.
- Anything that needs a server, accounts, emails, uploads, anti-abuse → `oel-collab-backend`.
- Every change ends with `oel-verify`.

## Invariants (do not break without asking the user)

- Codecs are lossless: unknown XML kept raw, untouched package parts copied byte for byte.
- Yjs is the live model; files are import/export. Offline (IndexedDB) must keep working.
- UI copy is French (fr-CA) and English, side by side through `@oel/i18n` (`messages`, `tr`, `locale()`); spreadsheet formulas are English (`,` args, `.` decimal).
- New icons come from Iconoir (`iconoir-react`), never hand-drawn; use `@oel/emboss` components and `--emboss-*` tokens, never raw colours.
- Behaviour follows the Figma design specs (a private file), page "Editor — Behaviors" (sections A–F). If code must differ from the spec, say so to the user.
- Editions: `apps/web/src/edition.ts` (`PUBLIC_EDITION=solo|equipe`, default `solo`) decides whether collaboration, forms and members show. Hide team features behind `features.*` in the app and a prop in packages (`collab={features.collab}`); never delete them, and never read the env var from a package.
- `apps/web` stays static (`output: 'static'`, editors as `client:only` islands) so a Tauri desktop app can serve it later.
- Anything a future native app would need to replace (file pickers, downloads, IndexedDB, worker creation, collab URL) should go through one small function, not be called inline in an editor.
