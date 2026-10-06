# OutilsEnLigne · Architecture

Status: reviewed 2026-10-03. Covers `oel-studio` (web editor), the Rust engines
(`oel_opc_rs`, `oeldocx_rs`, `oelxlsx_rs`, `oelimg-rs`) and the legacy tools site
(`vite-outilsenligne-ca-frontend`). The restructuring steps live in
[`docs/plans/2026-10-restructure.md`](docs/plans/2026-10-restructure.md).

## 1. Verdict: are we on the right path?

Yes. The load-bearing decisions are sound and should not be revisited:

| Decision | Why it holds up |
|---|---|
| **Rust = file formats + computation only** (codecs, calc, image ops); **TS = editing, UI, collaboration** | Rust code that never touches the DOM runs unchanged in a browser worker (WASM), in Node (collab exports), and natively in a desktop/mobile app. |
| **Lossless codecs** (unknown XML kept raw, untouched parts copied byte for byte) via a shared `oel-opc` | The only realistic way to "edit Word/Excel files" without corrupting them. Shared plumbing means PPTX later costs a codec, not a new stack. |
| **Engines behind a contract** (`@oel/engine`: `DocumentEngine`, `EngineRegistry`, `EngineHost` → worker, lazy WASM load) | The shell never imports a codec. The transport (worker) can be swapped for a native one in an app. |
| **Yjs as the live model** (Tiptap/ProseMirror for docs, id-keyed cells for sheets), files are import/export | Offline, collaboration and versions come from one mechanism for every kind. |
| **`@oel/desk` knows nothing about file types**, `@oel/emboss` knows nothing about the product | Both stay reusable (app, tools site, embeds). |
| **One collab server** (`apps/collab`) keyed by document `kind` | Docs and sheets already share auth, links, versions, storage. |

What is *not* yet right is mostly **plumbing that will hurt as features multiply**:

1. **Source control & repo boundaries.** `oel_opc_rs` and `oelxlsx_rs` are not in git at all; `oeldocx_rs` has the whole new codec (`src/ooxml/`) uncommitted. Crates are wired with `file:../../../…/pkg` paths and `path = "../oel_opc_rs"`, and the WASM `pkg/` outputs are hand-built. One lost directory = lost work; one forgotten `wasm-pack` = stale engine.
2. **Kind-specific logic is scattered in `apps/web/src/bureau`.** Adding or changing a kind touches `model.ts` (labels, icons, sizes, blank previews), `Paper.tsx` (thumbnails), `ContextToolbar.tsx` (actions), `OpenSheet.tsx` (workspace switch), `importFiles.ts` (payload → collab doc), `docs.ts`/`sheets.ts`/`forms.ts` (glue). ~50 `switch`/`kind ===` sites. This is the main scalability bottleneck.
3. **The JS ↔ Rust contract is hand-copied.** `OeldocxModule`/`OelxlsxModule` and the JSON shapes (`oeldocx-pm@1`, `oelxlsx-workbook@1`) are re-typed in TS; drift is caught only by round-trip tests.
4. **No platform seam for an app.** Persistence (IndexedDB), file pickers/downloads, worker creation, collab URL and identity are called directly from editors and pages.
5. **Rust crates mix core and bindings.** `oeldocx-rs` depends on `wasm-bindgen`/`web-sys` unconditionally and still carries the legacy `DocxController` editing path (used only by the old site). `oelxlsx-rs` already does it right (`#[cfg(target_arch = "wasm32")] mod wasm`).
6. **Server is one file per concern but not per domain.** Forms backend, accounts (magic link), uploads and anti-abuse are about to land on `apps/collab`; `server.ts` has `doc|sheet` hard-coded.

None of these require rewriting features. They are moves, seams and registries.

## 2. Layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Shells           apps/web (Astro, static)   apps/desktop (Tauri 2, later)│
│                  apps/tools (legacy tools site, migrated later)          │
├──────────────────────────────────────────────────────────────────────────┤
│ Product          Bureau (desk + papers) · kind modules (one per kind)    │
├──────────────────────────────────────────────────────────────────────────┤
│ Editors          @oel/docs  @oel/sheets  @oel/forms  (@oel/slides, …)    │
│                  each: model/ (pure, Yjs) · ui/ (React) · collab/        │
├──────────────────────────────────────────────────────────────────────────┤
│ Shared           @oel/emboss (kit)  @oel/desk (canvas)                   │
│                  @oel/collab-client (sync, links, versions)              │
│                  @oel/platform (storage, files, engine transport, auth)  │
├──────────────────────────────────────────────────────────────────────────┤
│ Engine contract  @oel/engine: FileKind, Preview, ImportResult, payload   │
│                  formats, EngineRegistry, EngineHost(transport)          │
├──────────────────────────────────────────────────────────────────────────┤
│ Rust engines     oel-opc · oel-docx · oel-xlsx · oel-img (pure Rust)     │
│                  bindings: `wasm` feature (browser/Node) · native (app)  │
├──────────────────────────────────────────────────────────────────────────┤
│ Server           apps/collab: Hocuspocus + Hono, domains: documents,     │
│                  sharing, versions, media, exports, forms, accounts      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows only point down. Editors never import Bureau; the desk and kit
never import editors or engines; Rust core crates never import `wasm-bindgen`.

## 3. Target repository layout

One repo (`oel-studio`), one Cargo workspace beside the npm workspaces:

```
oel-studio/
  Cargo.toml                 [workspace] members = ["crates/*"]
  crates/
    oel-opc/                 lossless XML DOM + OPC package          (from oel_opc_rs)
    oel-docx/                DOCX ↔ ProseMirror-JSON codec           (from oeldocx_rs/src/ooxml + fonts)
    oel-xlsx/                XLSX/CSV codec + IronCalc calc          (from oelxlsx_rs)
    oel-img/                 image recipe (oel-img-recipe@1) + CPU reference renderer; wgpu next (plan L)
    oel-pptx/                PPTX ↔ deck-JSON codec
    oel-chart/               DrawingML charts (c: and cx: chartSpace) ↔ ChartSpec, shared by the three codecs
  packages/
    wasm/                    GENERATED, gitignored: wasm-pack output per crate
                             (web + node targets), built by `npm run build:wasm`
    engine/ emboss/ desk/ collab-client/ docs/ sheets/ slides/ forms/
    charts/                  @oel/charts: ChartSpec → scene of marks → SVG / Canvas (every Office chart type)
    links/                   @oel/links: linked copies between files — LinkDef in the target Y.Doc, backlinks in the source, states, cycles, desk threads
    img/                     @oel/img: image engine host — oel-img (wgpu) in a worker on an OffscreenCanvas, WebGPU → WebGL2 → CPU; recipes, originals by hash
    platform/                NEW: platform seam (web impl now, tauri impl later)
  apps/
    web/  collab/
    desktop/                 LATER: Tauri 2 shell reusing apps/web's build
  fixtures/                  shared .docx/.xlsx/.pptx/.csv corpus used by cargo AND vitest (charts/: chart samples)
  docs/plans/                execution plans
  .claude/skills/            how-to skills for changing features (see §8)
```

Each Rust crate keeps the shape `oelxlsx-rs` already uses:

```toml
[features]
wasm = ["dep:wasm-bindgen", "dep:js-sys"]       # browser + Node bindings
[lib] crate-type = ["cdylib", "rlib"]
```

```rust
#[cfg(feature = "wasm")] pub mod wasm;          // thin: JSON/bytes in, JSON/bytes out
```

**Old repos.** `oeldocx_rs` stays on GitHub frozen with the legacy `DocxController` for the
old site until that editor is retired; only the `ooxml` codec moves (it has no dependency
on the legacy modules). `oelimg-rs` keeps its npm releases for the old site; `crates/oel-img` replaces it for OEL
(a linear-light rewrite, not a move — `docs/plans/2026-10-images.md`).

## 4. The engine contract (Rust ↔ TS)

Rules that keep the boundary cheap and portable:

1. **Stateless codecs, bytes and JSON strings across the boundary.** `xlsx_to_model(bytes) → json`, `model_to_xlsx(json, original?) → bytes`. No handles, no callbacks. (Stateful exception: the calc engine `WasmCalc`, which lives in its own worker.)
2. **Versioned payload formats.** `format: 'oeldocx-pm@1' | 'oelxlsx-workbook@1'`. Breaking JSON changes bump the version and the TS side refuses unknown versions with a clear error.
3. **Types generated, not copied.** Rust model structs derive `ts_rs::TS` (or `tsify`) and export into `packages/engine/src/generated/`. Hand-written TS keeps only the adapter logic. (Docs JSON is ProseMirror-shaped and validated by the schema; generate the attrs types at least.)
4. **One fixture corpus** (`fixtures/`) read by `cargo test` (round trip, byte-identical untouched parts) and by vitest (import → edit → export → LibreOffice check, already in `packages/docs/test`).
5. **Transport is pluggable.** `EngineHost` takes a `transport` (today: Web Worker; tests: in-process; app: Tauri `invoke` calling the native crate). Editors only see `EngineHost`.

## 5. Kind modules (front-end scalability)

Every desk kind becomes one module that the Bureau iterates instead of switching on:

```ts
// packages/<kind> or apps/web/src/kinds/<kind>/index.ts
export interface KindModule<P = unknown> {
  kind: PaperKind;                          // 'document' | 'spreadsheet' | 'form' | …
  label: string; icon: IconName;            // fr-CA, Iconoir/kit
  size: { w: number; h: number };           // B1 · 3
  blank(): { title: string; preview: Preview };
  Thumbnail: ComponentType<{ paper: Paper }>;          // Paper.tsx content
  toolbar(ctx: ToolbarCtx): ToolbarItem[];             // ContextToolbar (B2)
  Workspace?: ComponentType<WorkspaceProps>;           // OpenSheet (B4, levels 2/3)
  fromImport?(r: ImportResult): Promise<Partial<PaperData>>;   // payload → collab doc
  collabKind?: 'doc' | 'sheet' | 'form' | …;           // server document kind
  standaloneRoute?: string;                            // /document, /tableur, /f
}
export const KINDS: Record<PaperKind, KindModule> = { document, spreadsheet, form, slides, pdf, image, note, file };
```

`model.ts`, `Paper.tsx`, `ContextToolbar.tsx`, `OpenSheet.tsx` and `importFiles.ts` then
become generic. Adding a kind = one folder + one registry line (+ an engine if it parses
files + a server kind if it collaborates). The server mirrors it with a
`kinds: Record<DocKind, { mime, exportFormats, exporter(ydoc) }>` table.

**Cross-kind links** (« fils de liaison », Figma G) sit beside the kinds, not inside them:
`@oel/links` is the model (a `LinkDef` per copy in the **target** file's Y.Doc, backlinks
in the source's, written with `LINK_ORIGIN` so no one's undo replays them), and
`apps/web/src/links/resolver.ts` is the one place that knows both ends — it reads a sheet
chart with its own calc engine, writes copies into slides/documents, and derives the desk
threads. Editors only render badges through `linkHost()` and raise « Lier dans… » through a
callback. When Phase 3 lands, the per-kind `readRef`/`apply` branches become
`LinkSource`/`LinkTarget` entries on the kind modules.

## 6. Server

`apps/collab` stays the single backend for now (one process, SQLite, cheap to host), but
is organised by domain so it can split later:

```
apps/collab/src/
  main.ts                         config, wiring
  http.ts                         Hono app, CORS, limits, error shape
  domains/
    documents/  sharing/  versions/  media/  exports/     (today's server.ts, split)
    forms/      accounts/ (magic link)  uploads/  abuse/  (the TODO(backend) list)
  storage/                        Store interface; sqlite impl now, Postgres/S3 later
  kinds.ts                        server kind table (mime, export, Y.Doc → file)
```

- `FormsBackend` (`packages/forms/src/api/backend.ts`) is the contract: implement it as
  `HttpFormsBackend` in `@oel/forms`, served by `domains/forms`. The local stub stays for tests.
- Exports keep using the Node WASM builds of the crates. If CPU becomes an issue, swap to
  native addons (napi-rs) over the same crates; nothing upstream changes.
- Accounts arrive as an *upgrade* of today's anonymous owner tokens, not a replacement:
  a signed-in user "claims" the owner tokens held in the browser.

## 7. The app (desktop / mobile)

Recommendation: **Tauri 2**, reusing the web front end, with the Rust crates linked
**natively** (no WASM) in the app process.

- Why Tauri: the editors (Tiptap, canvas grid, desk) are TS/React; a native-UI rewrite
  would duplicate them. Tauri gives desktop now and iOS/Android from the same project,
  and its backend is Rust — the crates are called directly as functions.
- What the app needs from the web code is exactly the `@oel/platform` seam:

| Seam | Web | App (Tauri) |
|---|---|---|
| `engine` transport | Web Worker + WASM | `invoke('engine_import', …)` → native crate |
| `files` open/save | `<input type=file>`, download blob | native dialogs, real paths, "Save" overwrites the original |
| `storage` offline | IndexedDB (y-indexeddb) | SQLite/files in app data dir (or keep IndexedDB in the webview) |
| `collab` | `PUBLIC_COLLAB_URL` | same server; offline-first works unchanged |
| `identity` | anonymous + magic link | same + OS keychain for tokens |

- `apps/web` must therefore stay **static** (`output: 'static'`, `client:only` islands):
  Tauri serves the built files. Avoid server-only Astro features in the editor routes.
- Open question to settle before starting the app: offline-only mode (no account,
  no server) as a first-class product for the app? It changes defaults, not architecture.

## 8. Skills (how features get changed)

Project skills live in `oel-studio/.claude/skills/` and encode the touchpoints and checks
for recurring changes, so a feature change follows the same path every time:

| Skill | Use it for |
|---|---|
| `oel-architecture` | Where does this change belong? Layer rules, packages, decisions. Start here when unsure. |
| `oel-rust-engine` | Changing a Rust codec/engine: core code, wasm surface, rebuild web+node, TS adapter, fixtures. |
| `oel-file-kind` | Adding or changing a desk kind end to end (engine → kind module → workspace → server kind). |
| `oel-editor-feature` | A feature inside Docs/Sheets/Forms: model → Yjs → UI (emboss, Iconoir, fr-CA) → export → tests. |
| `oel-collab-backend` | Server work: an endpoint/domain in `apps/collab`, replacing a `TODO(backend)`. |
| `oel-verify` | The definition of done: commands to run and what to check in the browser. |

Skills describe *current* touchpoints. When the restructure plan moves something, the
same step updates the matching skill (each plan phase lists which).

## 9. The legacy tools site

`vite-outilsenligne-ca-frontend` (Astro, ~SEO tool pages, `src/tools/registry.ts`) is the
traffic source; `oel-studio` is the product. Keep them separate until the editor ships, then
move the tools into `apps/tools` (or `apps/web/src/pages/outils/[slug].astro`) on
`@oel/emboss`, so the tools and the Bureau share the kit, the engines (`oelimg` for image
tools) and the domain. Its own editor (PixiJS + legacy `DocxController`) is retired, not ported.

## 10. Non-goals for now

- No microservices, no separate calc/render servers.
- No native-UI app (SwiftUI/Compose); revisit only if Tauri mobile fails a real test.
- No publishing of `@oel/*` packages; they ship TS source to the app's Vite.
- No Tiptap Pro; no switch away from Yjs.
