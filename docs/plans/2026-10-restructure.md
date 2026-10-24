# Restructure plan (to execute)

Written 2026-10-03 alongside [`ARCHITECTURE.md`](../../ARCHITECTURE.md). Each phase is
independent enough to ship on its own branch, keeps every feature working, and ends with
`oel-verify`. Do phases in order: 0 → 1 → 2 are prerequisites for the rest.
Ask the user before any commit, push, or deletion of a sibling directory.

Legend: `[ ]` todo · **Done when** = acceptance check · **Skills** = skills to update in the same change.

---

## Phase 0 — Secure the work (do first, ~30 min)

Nothing below is safe while `oel_opc_rs` and `oelxlsx_rs` are outside git and
`oeldocx_rs/src/ooxml/` is uncommitted.

- [x] `oeldocx_rs`: commit the ooxml codec, fixtures, `ooxml_roundtrip.rs`, bindings (branch `codec`), with the user's OK.
- [x] `oel_opc_rs`, `oelxlsx_rs`: `git init` + initial commit (they move into the monorepo in Phase 1; this preserves their history with `git subtree`/`filter-repo` if wanted).
- [x] `oel-studio`: commit current `docx` branch state; ask the user whether to add a GitHub remote under `OutilsEnLigne-ca`.

**Done when** `git status` is clean in all four repos.

## Phase 1 — Rust into the monorepo (~½ day)

- [x] Create `oel-studio/Cargo.toml` workspace (`members = ["crates/*"]`, shared `[profile.release] opt-level="s", lto=true`, `edition = "2024"`).
- [x] Move `oel_opc_rs` → `crates/oel-opc` (crate name unchanged).
- [x] Move `oelxlsx_rs` → `crates/oel-xlsx` (package name `oel-xlsx`, lib name `oelxlsx`). Replace `#[cfg(target_arch = "wasm32")]` with `#[cfg(feature = "wasm")]`, make `wasm-bindgen` optional.
- [x] Create `crates/oel-docx` from `oeldocx_rs/src/ooxml/*` + `fonts.rs` (if the codec uses it) + `tests/ooxml_roundtrip.rs` + fixtures. Write a new thin `src/wasm.rs` with `docx_to_pm`, `new_document_pm`, `pm_to_docx` (copied from `oeldocx_rs/src/wasm/bindings.rs` L399–444) behind `feature = "wasm"`. Drop `docx-rs`, `web-sys`, `getrandom` from this crate. Leave `oeldocx_rs` untouched for the old site.
- [x] `scripts/build-wasm.mjs` + root `npm run build:wasm`: for each crate with a `wasm` feature, `wasm-pack build crates/<c> --release --target web --out-dir ../../packages/wasm/<c>/web -- --features wasm` and the same with `--target nodejs` into `…/node`. Add `packages/wasm/` to `.gitignore`. Keep the generated module names stable (`oeldocx_rs`, `oelxlsx_rs`) or update imports in one go.
- [x] Replace every `file:../../../oeldocx_rs/pkg*` / `oelxlsx_rs/pkg*` dependency (`packages/engine`, `packages/sheets`, `apps/collab`) with workspace paths to `packages/wasm/...`; remove the sibling-repo entries from `apps/web/astro.config.mjs` `server.fs.allow`.
- [x] Root scripts: `"test": "cargo test --workspace && vitest run"`, `"predev"`/`"pretest"` run `build:wasm` only when sources are newer than outputs (cheap mtime check in the script).
- [x] Root `README.md`: layout section gains `crates/`; remove "sibling repos" wording.

**Status (2026-10-03)** done on branch `restructure`; fresh copy green (`npm install && npm run build:wasm && npm test && npm run build`). Browser round trip (Bureau .docx/.xlsx → edit → export → LibreOffice) left to the user. Sibling `oel_opc_rs`/`oelxlsx_rs` still on disk until the user OKs deleting them. `astro check` can't run under TS 7 (known gap).
**Done when** a fresh clone runs `npm install && npm run build:wasm && npm test && npm run build` green, and the Bureau imports a .docx and a .xlsx, edits and exports both (round trip opens in LibreOffice).
**Skills** `oel-rust-engine` (paths, build command), `oel-verify`, `oel-architecture`.

## Phase 2 — One contract, one corpus (~½ day)

- [x] Move fixtures to `oel-studio/fixtures/{docx,xlsx,csv}`; cargo tests and vitest both read from there (`CARGO_MANIFEST_DIR/../../fixtures`).
- [x] Add `ts-rs` (dev-only via a `ts` feature) to `oel-xlsx` model structs; `cargo test --features ts` exports into `packages/engine/src/generated/`. Replace hand-written `WorkbookJsonish`/`OelxlsxModule` shapes and the matching types in `packages/sheets/src/model/types.ts` with imports from `generated/`.
- [x] For `oel-docx`: export the node/mark attrs types the codec writes; `packages/docs/src/model/types.ts` imports them. Add a test that every node/mark name in the Tiptap schema has a codec counterpart and vice versa.
- [x] Payload version guard: `@oel/engine` refuses payloads whose `format` is unknown with a fr-CA error.

**Status (2026-10-03)** done on branch `restructure`. Checked: a serde rename on `Sheet.frozen_rows` and on `ParagraphAttrs.section_break` both fail `npm run typecheck` (docx also fails `cargo test`). docx types come from a declared `contract.rs` checked against the reader's `json!` output, not from the reader itself (it still builds `Value`s). `oeldocx-node`'s functions return `any` (JsValue), so `OeldocxModule` stays hand-written.
**Done when** changing a field name in Rust breaks `npm run typecheck`.
**Skills** `oel-rust-engine`.

## Phase 3 — Kind modules (~1 day)

> 2026-10-23: the server part (`apps/collab/src/kinds.ts`) is done on `feat/backend` (backend plan B-0), not yet on
> `main`. The app side has not started.

The big front-end scalability win (ARCHITECTURE §5).

- [ ] Define `KindModule` + `KINDS` in `apps/web/src/kinds/index.ts` (keep in the app for now; move to a package only if the tools site or desktop shell needs it).
- [ ] One folder per kind: `document`, `spreadsheet`, `form`, `slides`, `pdf`, `image`, `note`, `file`. Move into each: label/icon/size/blank preview from `bureau/model.ts`; thumbnail case from `Paper.tsx`; toolbar case from `ContextToolbar.tsx`; workspace from `bureau/workspaces/*`; payload→collab glue from `importFiles.ts`, `bureau/docs.ts`, `bureau/sheets.ts`, `bureau/forms.ts`.
- [ ] Make `Paper.tsx`, `ContextToolbar.tsx`, `OpenSheet.tsx`, `importFiles.ts`, `blankPaper`, `kindLabel`, `KIND_ICON`, `PAPER_SIZE` generic over `KINDS`. Target: `grep -n "kind ===\|case '" apps/web/src/bureau` returns only non-kind cases.
- [ ] Cross-kind behaviours (form ↔ linked sheet) live in the form module and talk to the sheet through a small exported API, not by reaching into sheet internals.
- [ ] Server side: `apps/collab/src/kinds.ts` table (`doc`, `sheet`; `form` in Phase 5) replaces the `kind === 'sheet' ? … : …` ternaries in `server.ts`.

**Done when** the manual B-section walkthrough (import each kind, open in place, full screen, Esc levels, toolbar actions, forms → sheet row) behaves exactly as before, and a throwaway `note`-like kind can be added by touching only `kinds/`.
**Skills** `oel-file-kind` (rewrite its "touchpoints" section to the new layout), `oel-architecture`.

## Phase 4 — Platform seam (~½ day)

- [ ] `packages/platform` (`@oel/platform`): interfaces `EngineTransport`, `FileAccess` (open, save, saveAs, download), `OfflineStore`, `CollabConfig`, `IdentityStore`; `web` implementation using today's code.
- [ ] `EngineHost` takes an `EngineTransport` (worker transport = current behaviour; in-process transport = current fallback).
- [ ] Route direct uses through the seam: `y-indexeddb` setup in `@oel/collab-client/local.ts`, file downloads/pickers in docs/sheets/forms UIs and `importFiles.ts`, `PUBLIC_COLLAB_URL` reads.
- [ ] Lint guard: no `indexedDB`, `showSaveFilePicker`, `URL.createObjectURL(…download…)` or `import.meta.env.PUBLIC_COLLAB_URL` outside `@oel/platform/web` (a vitest that greps sources is enough).

**Done when** the guard test passes and behaviour is unchanged.
**Skills** `oel-editor-feature` (use the platform seam for files/storage), `oel-architecture`.

## Phase 5 — Server by domain + real forms backend (~2 days)

> 2026-10-23: the domain split and the storage ports are done on `feat/backend` (B-0, B-1 with Postgres); accounts,
> forms, uploads and anti-abuse are planned there as B-2 onwards. Track this phase in `2026-10-backend-mvp.md`.

- [ ] Split `apps/collab/src/server.ts` into `domains/{documents,sharing,versions,media,exports}`; introduce `storage/Store` interface over the current SQLite `db.ts`.
- [ ] `domains/accounts`: email magic link (dev: log the link to the console; prod mailer TODO), session cookie; owner-token claiming.
- [ ] `domains/forms` + `HttpFormsBackend` in `@oel/forms` implementing `FormsBackend`; swap in `apps/web/src/forms/backend.ts` (local stub stays for tests). Responses append to the linked sheet's Y.Doc server-side (`SheetDoc`), so the sheet updates live.
- [ ] `domains/uploads` (form attachments, size/type limits) and `domains/abuse` (Turnstile verify hook, rate limits) — implement the `TODO(backend)` / `TODO(anti-abuse)` markers, deleting each marker as it's done.
- [ ] Hosting rewrite for `/f/<slug>` documented in README.

**Done when** the forms flow works across two browsers against the server (create → publish → respond from a private window → row appears live in the sheet), and `grep -rn "TODO(backend)" packages apps` lists only items explicitly deferred.
**Skills** `oel-collab-backend`.

## Phase 6 — CI (~2 h, after Phase 1)

- [x] Done 2026-10-23 (`.github/workflows/ci.yml`, backlog T0-6), except `cargo fmt --check` and `clippy`, which wait
  for a one-time reformat. Was: GitHub Actions: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`, `build:wasm`, `npm run typecheck`, `npm test`, `npm run build`. Cache `target/` and `~/.cargo`. LibreOffice round-trip tests behind a job with `libreoffice` installed (or skipped with a message when absent).

## Phase 7 — Desktop spike (~1 day, after Phase 4)

> 2026-10-24: superseded by `2026-10-desktop.md` (v1 keeps the WASM engines in the webview; native engines are a
> later, measured step). Phase 4 is taken in by its D-1.

- [ ] `apps/desktop` Tauri 2: `src-tauri` depends on `crates/oel-docx`, `crates/oel-xlsx` natively; commands `engine_import`, `engine_export`, `engine_create` mirroring the worker protocol.
- [ ] `@oel/platform/tauri`: `EngineTransport` over `invoke`, `FileAccess` over the dialog/fs plugins.
- [ ] Load `apps/web` build output; route `/bureau` as the start page.
- [ ] Measure: open/save a 5 MB .xlsx natively vs WASM; check the Tiptap editor and canvas grid in the macOS/Windows/Linux webviews.
- [ ] Decide with the user: offline-only mode, mobile (Tauri iOS/Android) next or not.

## Phase 8 — Later

- [ ] `oelimg-rs` → `crates/oel-img` (bump `image` 0.24 → current; `wasm` feature); wire crop/resize/filters into the image kind (removes the disabled-with-reason tools). Keep publishing the npm package from the monorepo if the old site still needs it. **Superseded by `docs/plans/2026-10-images.md`** (wgpu engine, atelier, galleries).
- [ ] Tools site → `apps/tools` on `@oel/emboss`; retire its PixiJS editor and the legacy `DocxController`; archive `oeldocx_rs`.
- [x] Slides kind: `crates/oel-pptx` on `oel-opc`, same codec pattern; `@oel/slides` editor.
- [ ] PDF: decide engine (pdfium via WASM vs pdf.js for view + Rust for edits) before building "convert to editable".
- [ ] Remove the 2-line re-export shims in `packages/docs/src/collab/*` and `packages/docs/src/ui/{MenuBar,SyncStatus}.tsx` once nothing imports them.
