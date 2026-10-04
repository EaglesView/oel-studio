---
name: oel-rust-engine
description: Change an OutilsEnLigne Rust engine (oel-docx DOCX codec, oel-xlsx XLSX/CSV codec + IronCalc calc, oel-opc package plumbing, oelimg image ops) and carry the change through the WASM builds, the TypeScript adapters in @oel/engine / @oel/sheets / @oel/docs, and the round-trip tests. Use for any edit under crates/ (or the legacy oeldocx_rs, oelimg-rs repos).
---

# Changing a Rust engine

The crates live in the oel-studio Cargo workspace (`Cargo.toml` at the root, `crates/*`).
`../oeldocx_rs` is the **legacy** repo kept for the old tools site (its `controller/`,
`commands/`, `convert/`, `render/` editor) — do not extend it; the live codec is
`crates/oel-docx`. `../oelimg-rs` moves in as `crates/oel-img` in plan Phase 8.

## Where things are

| Crate (lib name) | Core | WASM surface (`feature = "wasm"`) | JS consumers |
|---|---|---|---|
| `crates/oel-opc` (`oel_opc`) | `src/xml.rs` (lossless DOM), `src/package.rs` (zip, rels, content types), `src/color.rs` (DrawingML colours), `src/fonts.rs` (open substitutes, embedded-font de-obfuscation) | none | via docx/xlsx crates |
| `crates/oel-docx` (`oeldocx`) | `src/lib.rs` (import/export entry points), `read.rs`, `write.rs`, `styles.rs`, `theme.rs` (theme colours → CSS), `tables.rs` (Word table look → CSS), `drawing.rs` (floating objects → `anchor`), `numbering.rs`, `template.rs`; **`contract.rs`** (declared JSON shape + node/mark vocabulary, checked by `tests/contract.rs`); `package.rs`/`xml.rs` re-export `oel-opc` | `src/wasm.rs`: `docx_to_pm`, `new_document_pm`, `pm_to_docx` | `packages/engine/src/engines/wasm.ts` (`OeldocxModule`), `apps/collab` + vitest (`oeldocx-node`) |
| `crates/oel-pptx` (`oelpptx`) | `read.rs` (masters → layouts → slides, placeholder inheritance resolved for display), `text.rs` (list-style levels, paragraphs/runs), `table.rs` (table styles), `theme.rs` (colours, style refs), `write.rs` (patches changed facets only; slide add/copy/delete/reorder, notes), `template.rs`; model in `model.rs` (explicit values vs inherited `look`/`levels`) | `src/wasm.rs`: `pptx_to_deck`, `new_deck`, `deck_to_pptx` | `packages/engine/src/engines/wasm.ts` (`OelpptxModule`), `apps/collab` + vitest (`oelpptx-node`) |
| `crates/oel-xlsx` (`oelxlsx`) | `read.rs`, `write.rs`, `csv.rs`, `model.rs`, `styles.rs`, `refs.rs`, `engine.rs` (IronCalc — keep its types inside this file) | `src/wasm.rs`: codec fns + stateful `WasmCalc` | `packages/engine/src/engines/wasm.ts` (`OelxlsxModule`), `packages/sheets/src/calc/*` (calc worker), `apps/collab` + vitest (`oelxlsx-node`) |

WASM outputs (git-ignored) land in `packages/wasm/<crate>/{web,node}` with stable module
names `oeldocx_rs` / `oelxlsx_rs` / `oelpptx_rs`; npm packages alias them as `oeldocx-rs` / `oelxlsx-rs`
(web) and `oeldocx-node` / `oelxlsx-node` (nodejs) via `file:` dependencies.

Fixtures for every crate and for vitest live in `fixtures/{docx,xlsx,csv}` at the root
(Rust: `concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/…")`).

**Contract types are generated.** `npm run gen:types` (also run by `npm run typecheck`) runs the
ts-rs exports (`--features <crate>/ts`) into `packages/engine/src/generated/{oeldocx,oelxlsx}/`
— committed, never edited by hand. `@oel/sheets` and `@oel/docs` re-export them from
`src/model/types.ts`; `@oel/engine` imports them directly. Wasm function signatures come from
the wasm-bindgen `.d.ts` (`typeof import('oelxlsx-rs')`), not hand-written interfaces.

## Rules

1. Core code is pure Rust: no `wasm_bindgen`, `js_sys`, `web_sys` outside `src/wasm.rs`, and those deps are optional behind the `wasm` feature. Bindings are thin: bytes/JSON strings in, bytes/JSON strings out, errors as fr-CA messages.
2. Lossless: anything you don't model is kept raw and written back unchanged. Never regenerate a part you didn't edit.
3. JSON shape changes are contract changes. xlsx: change the serde types in `model.rs`/`engine.rs` (new fields need the `cfg_attr(feature = "ts", …)` attrs like their neighbours: `optional` for `serde(default)` fields the editor may omit). docx: change `json!` in `read.rs` **and** the matching struct in `contract.rs` (`cargo test` fails until both agree). Then `npm run gen:types` and fix what `npm run typecheck` reports. A breaking change bumps `PAYLOAD_FORMATS` in `packages/engine/src/payload.ts` (`oeldocx-pm@N`, `oelxlsx-workbook@N`, `oelpptx-deck@N`); apps read payloads through `asDocxPayload` / `asWorkbookPayload`, which refuse unknown formats.
4. A docx node/mark/attr added in the codec goes into `contract.rs` (`NODES`/`MARKS`/attrs struct) and needs its Tiptap counterpart in `packages/docs/src/extensions/` (and vice versa) — `packages/docs/test/schema.test.ts` compares the schema with `CODEC_VOCABULARY` both ways (editor-only differences are listed with a reason in `EDITOR_ONLY`).
5. Add a fixture for the case you handle (`fixtures/<ext>/`) and a round-trip assertion; new .docx fixtures are picked up by `tests/contract.rs` automatically. Small single-feature .docx fixtures are generated by `fixtures/docx/src/make_fixtures.py` (listed in `fixtures/docx/README.md`); compare rendering with LibreOffice references from `node scripts/render-reference.mjs <file.docx>`.
6. Sections (docx): `DocxJson.sections` is in document order, ids `s1…` and `body` for the final `sectPr`; the paragraph ending a section has `attrs.section = <id>` and its raw `pPr` does **not** hold the `sectPr` (it lives on `Section.sectPr`, whole element). Header/footer stories are keyed by part (`stories["footer13"]`, `side`), and sections hold only their **explicit** references; inheritance is computed by the editor. The writer leaves an unchanged section's `sectPr` exactly as read and patches only changed values (`write.rs::sect_pr`). `contract::check` verifies section ids, breaks and story references.

## Steps

1. Edit the core; add/extend a Rust test (`crates/oel-docx/tests/ooxml_roundtrip.rs`, `crates/oel-xlsx/tests/{import,roundtrip,csv}.rs`).
2. `cargo test --workspace` from the oel-studio root (covers `oel-opc` dependents).
   Check the bindings compile: `cargo check --target wasm32-unknown-unknown --features oel-docx/wasm,oel-xlsx/wasm,oel-pptx/wasm`.
3. `npm run build:wasm` (both targets of every crate with a `wasm` feature; `wasm-pack` is a root
   devDependency). `npm run dev|test|build` already rebuild stale outputs (`--if-stale`, mtime check).
4. `npm run gen:types`; update the adapter in `packages/engine/src/engines/wasm.ts` (`run`/`export`/`create`) and the editor code `npm run typecheck` flags.
5. Follow `oel-verify` (vitest covers engine, docs → LibreOffice, sheets calc, collab exports).
