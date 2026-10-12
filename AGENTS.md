# AGENTS.md — working in oel-studio

Guide for AI coding agents (and people) changing this repository. Read it before any change; then read the matching
skill in `.claude/skills/` (plain Markdown, any agent can follow it).

## What this is

The Bureau: a multimodal editor where every file of a project lies on a desk (documents, spreadsheets,
presentations, images, notes). Rust crates handle file formats and computation and run as WebAssembly in a Web
Worker; TypeScript packages are the editors and the desk; `apps/web` (Astro) is the site, the docs and `/bureau`.
Overview and repository map: `README.md`. Layer rules and reasoning: `ARCHITECTURE.md`. Each package in detail:
`docs/packages.md`.

## Commands

```bash
npm install
npm run dev            # single-user site + Bureau, http://localhost:4321 (rebuilds stale WASM first)
npm run dev:equipe     # team edition: web + collab server on :8787 (POSIX shells)
npm test               # cargo test --workspace, then vitest
npm run typecheck      # regenerates generated TS types, then tsc per package
npm run build          # static site; PUBLIC_EDITION=equipe npm run build for the team build
npm run build:wasm     # rebuild every crate's WASM into packages/wasm/ (git-ignored)
bash scripts/build-site.sh   # hosting build (DigitalOcean: .do/app.yaml): Rust if missing, WASM_TARGETS=web, site
npx tsc -p apps/web --noEmit   # app typecheck: `astro check` cannot run under TypeScript 7
cargo test -p <crate>  # one crate; crates are oel-opc, oel-docx, oel-xlsx, oel-pptx, oel-chart, oel-img
```

A stale `packages/wasm/` is the usual cause of "works in Rust, broken in the app": run `npm run build:wasm` after a
crate change, and restart a running dev server when a package's `exports` change.

## Where a change goes

| Change | Layer | Skill |
|---|---|---|
| Parse or write a file format, compute something heavy | `crates/*` (Rust), exposed through `packages/engine` | `oel-rust-engine` |
| New file kind on the desk, or how a kind is imported, previewed, opened, saved | `apps/web/src/bureau/*`, `packages/engine` | `oel-file-kind` |
| Feature inside the document, spreadsheet, slides or forms editor | `packages/{docs,sheets,slides,forms}` | `oel-editor-feature` |
| Charts (reading, drawing, editing, writing) | `crates/oel-chart`, `packages/charts` | `oel-charts` |
| Server, accounts, sharing, uploads | `apps/collab`, `packages/collab-client` | `oel-collab-backend` |
| Not sure | — | `oel-architecture` |

Dependencies point down only: crates → engine contract → shared UI and infra (`emboss`, `desk`, `collab-client`,
`fonts`, `img`) → editors → `apps/web`. A package never imports `apps/*`; `@oel/desk` and `@oel/emboss` know nothing
about file types.

## Rules

- **Lossless codecs.** Unknown XML is kept raw; untouched package parts are copied byte for byte. A codec change comes
  with a round-trip test on the fixtures (`fixtures/`).
- **Yjs is the live model**, files are import/export. Offline (IndexedDB) must keep working.
- **Editions.** `apps/web/src/edition.ts` (`PUBLIC_EDITION=solo|equipe`, default `solo`) decides whether collaboration,
  forms and members show. Hide team features behind `features.*` in the app and a prop in packages
  (`collab={features.collab}`); never delete them, and never read the env var from a package.
- **Saved desk.** The desk is one Y.Doc per project in IndexedDB (`bureau/persist.ts`). A new `PaperData` field holding
  an object URL or anything tab-only is dropped in `storedPaper` and rebuilt in `bureau/restore.ts`.
- **Copy and language.** Bureau UI copy is French (fr-CA); spreadsheet formulas are English (`,` between arguments,
  `.` decimal). The site (`apps/web/src/site/`) is bilingual: every French string needs its English one (typed).
- **UI.** Components and tokens from `@oel/emboss` (`--emboss-*`), never raw colours in components; new icons from
  Iconoir (`iconoir-react`), never hand-drawn. Tools that can't act stay visible with `unavailableReason`; nothing may
  pretend to work (no simulated progress, no fake results).
- **Behaviour** follows the Figma file `Y3vDuuW4jfyTOjreIwDp6P`, page « Editor — Behaviors ». If code must differ
  from the spec, say so.
- **Platform seams.** Anything a desktop app would replace (file pickers, downloads, IndexedDB, worker creation,
  collab URL) goes through one small function, not inline in an editor.
- `apps/web` stays static (`output: 'static'`, editors as `client:only` islands).
- Don't run prettier on the repository (there is no config; it rewrites quotes). Match the surrounding style.

## Verify

Every change ends with the `oel-verify` skill: the commands above that apply, and the browser checks for the areas
touched. Report real results; if a check can't run (tooling blocked), say which and move on rather than building a
workaround.

## Git

- Work on a branch, never on `main`; don't push or open a pull request unless asked.
- Commit as you go, one logical step per commit (one plan step, one feature slice, one fix), each building and
  passing tests on its own. One concern per commit: no refactor mixed with a behaviour change; generated output
  (`packages/engine/src/generated/`, lockfiles) goes with the change that produced it.
- Message: imperative subject ≤ 72 characters, prefixed with the area or plan phase (`S-2: …`, `oel-xlsx: …`,
  `docs: …`), blank line, then what changed and why (not a file list).
- Never rewrite or discard the working tree to reshape history (no `reset --hard`, `checkout .`, `clean`). Leave
  changes you didn't make out of your commits (stage the exact content you mean to commit).

## Plans

Work in flight is planned in `docs/plans/` (one file per plan, with a « Status » section ticked as phases land). Check
a plan's status before relying on it, and update the skills in the same change when a phase changes a layout they
describe. Current release plan: `docs/plans/2026-10-solo-mvp.md`.
