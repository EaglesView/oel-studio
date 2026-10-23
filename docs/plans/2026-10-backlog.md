# Backlog — everything not done, broken or unverified, in tiers

Written 2026-10-23 on branch `updates`, after reading every plan in `docs/plans/`, the `TODO` markers, the collab
server, and an external static audit (ChatGPT, triaged at the end). It is an index, not a design: each item names
the plan that owns its detail, and that plan stays the source of truth. Tick an item here **and** in its plan when it
lands.

**How to pick work:** take the lowest tier first. Inside a tier, items are independent unless « needs » says so.
Sizes: **S** ≤ ½ day, **M** 1–2 days, **L** more. Items marked *good first issue* need little context.

Legend: `[ ]` todo · **Where** = files or plan · **Done when** = acceptance check.

---

## Tier 0 — Fix now: crashes, silent data loss, public-repo hygiene

The repository has been public since 13 Oct, and the solo build is the hosted product. These come before features.

- [x] **T0-1 · XML parser crashes on malformed input** (confirmed 2026-10-23 with a probe program) — S
  - **Done 2026-10-23**: bounds-safe lookahead, errors for an unterminated value and a close tag without `>`,
    `MAX_DEPTH` = 256 (deepest fixture part: 19; 256 levels parse and write back on a 1 MB stack even in a debug
    build, 512 overflowed it). Tests `xml::tests::{malformed_input_is_an_error, nesting_is_bounded}`.
  - Also done: markup after the root element (a trailing comment) was dropped on write. `XDocument.epilogue` keeps
    it verbatim; the .docx writer keeps each rebuilt part's prolog and epilogue. Test
    `markup_after_the_root_survives` (oel-docx).
  - `<a b="x` (unterminated attribute value) panics: `range start index 8 out of range for slice of length 7` at
    `crates/oel-opc/src/xml.rs:88`. The value loop stops at the end of input, then `self.i += 1` steps past it and
    the next `starts_with` slices out of bounds.
  - 200 000 nested elements overflow the stack (`element()` recurses once per level); in WASM that is a trap.
  - `<a></a` and `<a></a x>` are accepted: the closing tag's `>` is skipped without checking it.
  - Fix: `starts_with` through `self.s.get(self.i..)`; an error for an unterminated value and a bad close; a depth
    limit (e.g. 1 024) or an explicit stack. Same review for `parse_fragment` and `unescape`.
  - **Done when** a test per case in `crates/oel-opc` returns `Err`, and every fixture still round-trips byte for byte.
- [ ] **T0-2 · Unbounded decompression** (from reading the code; no bomb built yet) — S
  - `crates/oel-opc/src/package.rs:39` reserves `Vec::with_capacity(f.size())` from the archive's *declared* size
    and inflates every part eagerly with `read_to_end`: a crafted file can ask for gigabytes.
  - Add limits: entry count, per-part and total inflated bytes, and a capped reservation. The TS reader used for desk
    backups (`packages/engine/src/zip.ts`) needs the same output cap; it should also check offsets and lengths up
    front (today a bad offset throws a `RangeError` that `readBackup` turns into « not a zip », which is acceptable).
  - **Done when** a test archive declaring 4 GB and a 1 000:1 bomb both fail with a message, in Rust and in vitest.
- [ ] **T0-3 · A panic can leave the engine unusable until reload** (to verify first) — S
  - After a Rust panic, a wasm-bindgen instance is not guaranteed to work again, and `EngineHost`
    (`packages/engine/src/host.ts`) keeps the same worker. The collab server loads the Node codecs in-process, so
    there the same applies to every user of the server.
  - Check: import the T0-1 file, then a good file, in one tab. If the second fails, recreate the worker after any
    engine error (and isolate server exports, see T2-7).
- [ ] **T0-4 · Storage failures are silent in `solo`** — S
  - `localFiles.put` (`packages/collab-client/src/local.ts:37`) swallows every error with « the server copy is the
    fallback », but `solo` has no server. A full disk or a private window loses an original package without a word,
    and an export without its original can no longer copy untouched parts.
  - Surface `QuotaExceededError` (and failed y-indexeddb writes) as a lasting warning with « Exporter le bureau ».
  - **Done when** a vitest with a failing store shows the warning, and the S-2 browser check covers a full disk.
- [ ] **T0-5 · Fuzzing at the import boundary** — M, needs T0-1/T0-2
  - `cargo fuzz` targets for `XDocument::parse`, `parse_fragment`, `Package::read`, and each codec's import (docx,
    xlsx, pptx, chart), seeded with `fixtures/`. A short run in CI on each push, a longer one weekly.
  - **Done when** an hour per target finds nothing new, and each crash found has a regression test.
- [ ] **T0-6 · CI** (restructure Phase 6, solo-mvp R7) — M
  - GitHub Actions: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`, `npm run build:wasm`,
    `npm run typecheck`, `npm test`, `npm run build` and `PUBLIC_EDITION=equipe npm run build`. Cache `target/`.
  - LibreOffice round-trip job (open every export headless) in a separate job.
- [ ] **T0-7 · Reproducible builds** (audit #6) — S, *good first issue*
  - `rust-toolchain.toml` with an exact version and the `wasm32-unknown-unknown` target; `.do/site.Dockerfile` and
    `scripts/build-site.sh` install that version instead of `stable`. `.nvmrc` for Node 24. Pin the Docker base by
    digest. `wasm-pack` is already pinned through the lockfile.
- [ ] **T0-8 · Public-repo hygiene** (solo-mvp R5, never closed) — S, **user decision**
  - Fixture provenance: `fixtures/pptx/Presentation {1,2,3,5}.pptx`, `fixtures/docx/Document 4.docx`, `tesxte.docx`,
    `fixtures/xlsx/complex_sheet_graph.xlsx`. Check their content and licence, or replace them with generated ones.
  - Secrets scan of the whole history (`gitleaks detect`).
  - When `feat/backend` is merged (T2-1), its plan still holds the Figma file key that commit `3278cf5` removed elsewhere.
- [ ] **T0-9 · Documentation drift** — S, *good first issue*
  - README links `docs/plans/2026-10-backend-mvp.md`, which exists only on `feat/backend`.
  - README « Not yet: … a translated Bureau UI »: the Bureau has been bilingual since `feat/i18n`.
  - `docs/packages.md` table: « ranges and single values » listed as not yet, but I-4 and I-6 are done.
  - `2026-10-restructure.md`: Phases 3–7 still show `[ ]`; mark which parts `feat/backend` B-0 already did.

## Tier 1 — Verification debt: built, never checked in a browser

Many phases landed while the test browser was unavailable. Until they are checked, « done » means « typechecks and
passes unit tests ». One pass with `oel-verify` per row; record results in the owning plan.

| # | What to check | Plan | Risk if broken |
|---|---|---|---|
| T1-1 | Saved desk: reload, close tab mid-drag, « Exporter / Importer un bureau », « Réinitialiser la démo », « Vider le bureau », full disk (T0-4) | solo-mvp S-2 | **Data loss** |
| T1-2 | Demo desk and its two live links (edit a lap time → slide 3; retouch the logo → document) | S-4 | First impression |
| T1-3 | `solo` hides every team surface; `/document`, `/f`, `/connexion` redirect | S-5, S-6 | Dead buttons |
| T1-4 | Exports with linked charts open in **PowerPoint and Word** (LibreOffice shows a misplaced axis title) | S-7 R1 | Broken files |
| T1-5 | Generalised links I-1 → I-7 (images, tables, values, local edits, « Envoyer vers un tableur ») | generalised-links | Wrong copies |
| T1-6 | Toolbars and bottom bar at 1440 / 1024 / 720, keyboard only, reduced motion | toolbars, bottom-bar | Layout, a11y |
| T1-7 | .docx page fidelity Phases 1–5 against the reference renders | docx-page-fidelity | Layout |
| T1-8 | The four editor-ux fixes (table scrollbar, right-click menu, table bar, chart bar) | editor-ux-issues | — |
| T1-9 | Retouching pictures in slides and sheets | images L-7 | — |
| T1-10 | Touch O-1 → O-3 on a real phone and tablet | touch | — |

Automate what a browser check can't do on every change:
- [ ] **T1-11 · Recovery tests** — M: Y.Doc + IndexedDB with `fake-indexeddb` in vitest: write interrupted
  (`pagehide` before the 400 ms debounce), quota error, unreadable backup, two tabs on one desk.
- [ ] **T1-12 · Round-trip corpus** — M: the contract tests prove *untouched* files survive. Add « edit one
  paragraph / cell / shape, export, diff the package »: only the touched part changes, and the result opens in
  LibreOffice (CI job of T0-6). Ask the user for real-world files from Office to widen `fixtures/`.

## Tier 2 — Before any public team-edition server

Applies only to `PUBLIC_EDITION=equipe` and `apps/collab`. The hosted solo site has no server, so none of this
is exposed today. Most items are already decided in `docs/plans/2026-10-backend-mvp.md` (on `feat/backend`).

- [ ] **T2-1 · Bring `feat/backend` up to date** — M. B-0 (ports, domains, `kinds.ts`, production refuses a missing
  `COLLAB_SECRET`) and B-1 (Postgres) are 47 commits behind `updates`. Rebase or merge before building more server
  code, so the items below land on the new layout, not on the old `server.ts`.
- [ ] **T2-2 · Gate document creation** (audit #1) — S. `POST /docs` needs no token today. Until accounts (B-3)
  exist: `PROJECT_CREATION=closed` from the backend plan, or a deployment token.
- [ ] **T2-3 · Rate limits, quotas, retention** (audit #1, backend B-8) — M. Per IP and per token on `POST /docs`,
  `/media`, `/versions` and `/links`. Also unbounded today: manual versions (any editor can post them in a loop;
  only automatic ones are pruned), and media per document. Storage quota per document and per deployment; cleanup of
  documents never opened again.
- [ ] **T2-4 · Client address** (audit #2) — S. `clientIp` (`apps/collab/src/server.ts:57`) always trusts
  `X-Forwarded-For`: spoofable without a proxy, and without the header every client shares the bucket « direct ».
  Trust the header only with `TRUST_PROXY=1`, otherwise use the socket address.
- [ ] **T2-5 · Tokens out of URLs, expiry** (audit #3) — S. Remove the `?t=` fallback in `bearer()` (already decided:
  presigned download URLs). `Referrer-Policy: no-referrer`. Tokens carry an expiry field `x` that the server never
  sets: offer expiring links and rotation.
- [ ] **T2-6 · Check uploaded packages** (audit #1) — S. `POST /docs` only checks the first two bytes (`PK`). Open
  the package (after T0-1/T0-2) and check its content type matches `kind`; refuse otherwise.
- [ ] **T2-7 · Exports block the server** — M. `export.docx/xlsx/pptx` run synchronous WASM on the event loop: one
  big file stalls every live session, and a panic hits the shared instance (T0-3). Worker threads with a timeout.
- [ ] **T2-8 · Origins** — S. CORS echoes any origin (safe-ish, tokens are bearer, not cookies), and WebSockets have
  no origin check. Allow-list in production (backend B-8).
- [ ] **T2-9 · Access tests** — S. Revoking a link closes live sessions (`closeConnections`) and refuses reconnects;
  a viewer can't write through any route or the socket, for each kind. Add to `apps/collab/test`.
- [ ] **T2-10 · Then the backend plan proper**: B-2 object storage, B-3 accounts, B-4 projects (= N-3), B-5 shared
  desk (= N-2), B-6 forms backend (all `TODO(backend)` / `TODO(anti-abuse)` markers), B-7 deploy, B-8 load test.

## Tier 3 — Finish what is half-built

Grouped by area; each line is the « Not yet » of its plan. Sizes are rough.

**Small and self-contained** (*good first issues*)
- [ ] Missing-fonts dialog unreachable once its toast is gone (`TODO(ux)` in `DocsEditor.tsx:112`,
  `SlidesEditor.tsx:145`): add a menu entry. S
- [ ] « Voir la source » should highlight the chart or range (editor-ux, G3). S
- [ ] Orphan IndexedDB documents from earlier versions, and image originals no paper uses: a « Nettoyer » action
  next to the storage figure (S-2). S
- [ ] `Date Picker` not ported to `@oel/emboss`. S
- [ ] Re-export shims in `packages/docs/src/collab/*` and `ui/{MenuBar,SyncStatus}.tsx` (restructure Phase 8). S
- [ ] Note pin cursor and a shared split button in `@oel/emboss` (notes K-3). S

**Structure** (unblocks several areas)
- [ ] Kind modules, restructure Phase 3 — L. Links, galleries and new kinds still add `kind ===` branches across
  `bureau/`. Do before the PDF kind.
- [ ] Platform seam `@oel/platform`, restructure Phase 4 — M. Check what B-0 already did on `feat/backend`.

**Charts** (`2026-10-links-and-charts.md`)
- [ ] Phase 5 rest: sparklines, chart sheets, per-element selection and inspector, dragging range handles, chartEx
  editing.
- [ ] Phase 6: editing charts in slides and documents (embedded workbook writer). L
- [ ] Phase 8 rest: paste / drag / insert-from-target routes (G2b), delete-source dialog (G5), slideshow deferral
  (G7), « Changer la source… », link history, source range outline in the grid.
- [ ] Phase 9 = links I-8: link markers in .docx (`w:sdt`) and .pptx (extLst) and re-import; slide tables and
  pictures made by links written to .pptx. L

**Generalised links** (`2026-10-generalised-links.md`)
- [ ] I-3 rest: drag an image paper onto an open paper, crop as a local edit, « Relier à… », « Remplir / Ajuster ».
- [ ] Slides: linked table edits (I-7), « Envoyer vers un tableur » from slide tables (I-5), values in slide text (I-6).

**Images** (`2026-10-images.md`)
- [ ] L-8: « Cette copie / Style de la galerie » in the editor panel; linked copies in sheets.
- [ ] Tiled GPU export beyond `max_texture_dimension_2d` (WebGL2 guarantees 2 048 px); masks (« Bientôt »);
  colour wheels for grading; project styles (needs N).

**Desk** (`2026-10-notes-collees.md`, `2026-10-bottom-bar-and-menu.md`)
- [ ] K-4 mentions and notifications, rest of K-5.
- [ ] M-3 « Ranger », M-4 « Étaler » (greyed « Bientôt » in the bar today).
- [ ] Templates (« Ou partir d’un modèle », « Galerie vide » are greyed).
- [ ] Viewport culling in `DeskCanvas` for large desks (packages.md).

**Touch** (`2026-10-touch.md`)
- [ ] O-4 docked context bar and phone layout of the chrome; O-5 editors one by one; the J3 bottom sheet over the
  virtual keyboard.

**Documents** (`2026-10-docx-page-fidelity.md`, packages.md « Known gaps »)
- [ ] 3c shape editing (needs its own go-ahead).
- [ ] Footnotes at the foot of each page; headers and footers in print; floating images shown floating; tracked
  changes kept rather than accepted on import; font choices written to the file.

**Editors, shared**
- [ ] One action list behind toolbar and right-click menu; paragraph items and cell fill in the docs menu; slides and
  sheets onto the shared `ContextMenu` (editor-ux).
- [ ] Animations, transitions, SmartArt, group members, table structure in slides: kept, not editable.

**Projects** (`2026-10-projects.md`) — N-2 → N-6, needs Tier 2 (accounts and storage).

## Tier 4 — New capabilities (not started)

- [ ] **PDF engine**: decide pdfium (WASM) vs pdf.js + Rust edits, then view, annotate, sign, « Convertir pour
  modifier », « Un PDF de la sélection » (all unavailable-with-reason today). Needs kind modules.
- [ ] **Desktop app** (Tauri): restructure Phase 7, images L-9. Needs the platform seam.
- [ ] **Local version history** in `solo` (R8): Y.Doc snapshots in IndexedDB, same `VersionPanel`.
- [ ] **Publish the crates** on crates.io (R9): doc comments and a README per crate first; check names.
- [ ] Desk-wide comments (removed from papers, planned as a canvas feature).
- [ ] Crop / OCR / cut-out tools on images.
- [ ] Tools site moved to `apps/tools` on `@oel/emboss` (restructure Phase 8).
- [ ] Performance budgets: import, recalculation and image effects on large files (e.g. a 5 MB .xlsx, 200-page
  .docx), measured and kept in a benchmark.

---

## External audit (ChatGPT, static review, received 2026-10-23) — triage

The reviewer read a few files on GitHub without running anything. Each finding was checked against the code here.

| # | Finding | Verdict | Goes to |
|---|---|---|---|
| 1 | `POST /docs` creates documents without auth, no rate limit or quota | **Confirmed**, team edition only (the hosted solo build has no server). Gate, limits and package check were already decided in the backend plan, not yet built | T2-2, T2-3, T2-6 |
| 2 | Connection cap trusts `X-Forwarded-For` | **Confirmed**; also, with no proxy every client shares one bucket | T2-4 |
| 3 | Share tokens accepted in `?t=` | **Confirmed**; removal already decided in the backend plan. HMAC scheme is sound | T2-5 |
| 4 | Custom XML parser needs adversarial tests | **Confirmed, worse than stated**: two crashes reproduced (unterminated attribute → panic; deep nesting → stack overflow) | T0-1, T0-5 |
| 5 | TS ZIP reader lacks bounds and CRC checks | **Partly**: JS bounds errors throw and are caught; the real gap is no cap on inflated size. Only reads previews and the person's own backups | T0-2 |
| 6 | Hosting build installs an unpinned Rust | **Confirmed** (`build-site.sh` and the Dockerfile both use `stable`) | T0-7 |
| — | « What to audit next »: round trips, recovery, links, revocation, large files, CI | All valid; cycle refusal for links already exists (`createsCycle`, tested) | T1-11, T1-12, T2-9, Tier 4 perf, T0-6 |

Found while triaging, not in the audit: the unbounded reservation in `package.rs` (T0-2), engine state after a panic
(T0-3), silent storage failures in `solo` (T0-4), server exports blocking the event loop (T2-7), unbounded manual
versions (T2-3), the verification debt (Tier 1), and `feat/backend` drifting from the main line (T2-1).

## Status

- 2026-10-23: backlog written. `npm run build:wasm && npm test` green on `updates` (every crate; vitest 41 files,
  247 tests).
- 2026-10-23: T0-1 done (commits `oel-opc: refuse malformed XML…`, `oel-opc: keep markup that follows…`).
