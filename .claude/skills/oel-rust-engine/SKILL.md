---
name: oel-rust-engine
description: Change an OutilsEnLigne Rust engine (oeldocx DOCX codec, oelxlsx XLSX/CSV codec + IronCalc calc, oel-opc package plumbing, oelimg image ops) and carry the change through the WASM builds, the TypeScript adapters in @oel/engine / @oel/sheets / @oel/docs, and the round-trip tests. Use for any edit under oeldocx_rs, oelxlsx_rs, oel_opc_rs, oelimg-rs or crates/.
---

# Changing a Rust engine

> Layout note: until `docs/plans/2026-10-restructure.md` Phase 1 is done, the crates are
> sibling directories of `oel-studio` (`../oeldocx_rs`, `../oelxlsx_rs`, `../oel_opc_rs`,
> `../oelimg-rs`). After Phase 1 they are `crates/oel-docx`, `crates/oel-xlsx`,
> `crates/oel-opc`, `crates/oel-img` and `npm run build:wasm` replaces the commands below.
> Check which is true (`ls crates 2>/dev/null`) and update this skill if it is stale.

## Where things are

| Crate | Core | WASM surface | JS consumers |
|---|---|---|---|
| `oel_opc_rs` (`oel-opc`) | `src/xml.rs` (lossless DOM), `src/package.rs` (zip, rels, content types) | none | via docx/xlsx crates |
| `oeldocx_rs` | **`src/ooxml/`** (DOCX ↔ ProseMirror JSON, the live codec). `controller/`, `commands/`, `convert/`, `render/` are the **legacy** editor used only by the old tools site — do not extend them. | `src/wasm/bindings.rs`: `docx_to_pm`, `new_document_pm`, `pm_to_docx` | `packages/engine/src/engines/wasm.ts` (`OeldocxModule`), `apps/collab` (`oeldocx-node`) |
| `oelxlsx_rs` | `read.rs`, `write.rs`, `csv.rs`, `model.rs`, `styles.rs`, `refs.rs`, `engine.rs` (IronCalc — keep its types inside this file) | `src/wasm.rs`: codec fns + stateful `WasmCalc` | `packages/engine/src/engines/wasm.ts` (`OelxlsxModule`), `packages/sheets/src/calc/*` (calc worker), `apps/collab` (`oelxlsx-node`) |
| `oelimg-rs` | `src/filters`, `src/core` | `src/wasm.rs` | not wired into oel-studio yet |

## Rules

1. Core code is pure Rust: no `wasm_bindgen`, `js_sys`, `web_sys` outside the wasm module. Bindings are thin: bytes/JSON strings in, bytes/JSON strings out, errors as fr-CA messages.
2. Lossless: anything you don't model is kept raw and written back unchanged. Never regenerate a part you didn't edit.
3. JSON shape changes are contract changes: update the TS types (`packages/engine/src/types.ts`, `packages/docs/src/model/types.ts`, `packages/sheets/src/model/types.ts`) in the same change. A breaking change bumps the payload `format` (`oeldocx-pm@N`, `oelxlsx-workbook@N`).
4. A docx node/mark added in the codec needs its Tiptap counterpart in `packages/docs/src/extensions/` (and vice versa) — `packages/docs/test/schema.test.ts` checks the mapping.
5. Add a fixture for the case you handle (`tests/fixtures/*.docx|xlsx|csv`) and a round-trip assertion.

## Steps

1. Edit the core; add/extend a Rust test (`oeldocx_rs/tests/ooxml_roundtrip.rs`, `oelxlsx_rs/tests/{import,roundtrip,csv}.rs`).
2. `cargo test` in the crate (and in `oel_opc_rs` + both dependents if you touched `oel-opc`).
3. Rebuild **both** WASM targets (web for the browser worker, nodejs for collab and vitest):
   ```bash
   cd ../oeldocx_rs && wasm-pack build --release --target web --out-dir pkg --out-name oeldocx_rs \
     && wasm-pack build --release --target nodejs --out-dir pkg-node --out-name oeldocx_rs
   cd ../oelxlsx_rs && npm run build:all
   ```
   (The `build:nodejs` script in `oeldocx_rs/package.json` writes to `pkg/`, not `pkg-node/` — use the explicit command.)
4. Update the adapter in `packages/engine/src/engines/wasm.ts` (module interface + `run`/`export`/`create`) and any editor types.
5. In `oel-studio`: `npm install` if a package.json `file:` target changed, then follow `oel-verify` (vitest covers engine, docs → LibreOffice, sheets calc, collab exports).
