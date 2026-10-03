---
name: oel-file-kind
description: Add a new file/paper kind to the OutilsEnLigne Bureau (e.g. slides/pptx, PDF editing, a new OEL-native type) or change how an existing kind is detected, imported, previewed on the desk, opened in place / full screen, collaborated on, or exported. Lists every touchpoint from detection to server export.
---

# Adding or changing a kind

> Layout note: `docs/plans/2026-10-restructure.md` Phase 3 replaces the scattered
> touchpoints below with one `KindModule` per kind in `apps/web/src/kinds/<kind>/`.
> If `apps/web/src/kinds/` exists, follow that layout and rewrite this section to match.

## Touchpoints today (in order)

1. **Detection** — `packages/engine/src/detect.ts` (`detectKind`, extension + magic bytes), `KIND_LABEL` / `ACCEPTED_EXTENSIONS` in the same file, `FileKind` in `packages/engine/src/types.ts`.
2. **Preview** — add the `Preview` variant in `packages/engine/src/types.ts`; make the JS preview engine (`packages/engine/src/engines/preview.ts`) produce it as a fallback.
3. **Engine** (if the kind parses files) — a Rust codec (see `oel-rust-engine`), an adapter `create<Name>Engine` in `packages/engine/src/engines/wasm.ts` with `accepts`, `run`, `export`, `create`, a payload type with a versioned `format`, and registration in `packages/engine/src/worker/engine.worker.ts` (later registrations win).
4. **Desk model** — `apps/web/src/bureau/model.ts`: `PaperKind`, `KIND_ICON` (Iconoir via `@oel/emboss` `IconName`), `kindLabel`, `PAPER_SIZE`, `blankPaper` titles + preview. Use `paperSizeFor(kind, preview)` for a paper's size: documents take the shape of their first page (`Preview.page`, twips; set at import and on each editor preview), `PAPER_SIZE.document` is only the default for blank documents.
5. **Thumbnail** — `apps/web/src/bureau/Paper.tsx` `Content` switch (+ `paper--<kind>` styles in `bureau.css`). Thumbnails must stay cheap: they re-render every 15 s when zoomed out.
6. **Contextual toolbar (B2)** — `apps/web/src/bureau/ContextToolbar.tsx`. Unavailable tools stay visible with `unavailableReason` instead of disappearing.
7. **Open in place / full screen (B4, levels 2–3)** — workspace component in `apps/web/src/bureau/workspaces/`, wired in `OpenSheet.tsx`. Respect Esc one level at a time (inner layers `stopPropagation`) and a URL per level.
8. **Import glue** — `apps/web/src/bureau/importFiles.ts` (payload → collab doc → `docId` on the paper), plus a `bureau/<kind>.ts` helper like `docs.ts` / `sheets.ts`.
9. **Standalone page** (optional) — `apps/web/src/pages/<route>.astro` mounting a page component (`document.astro` / `tableur.astro` are the patterns).
10. **Collaboration** (optional) — editor package `packages/<kind>` with `model/` (pure, Yjs) + `ui/`, session built on `@oel/collab-client`; server kind in `apps/collab/src/db.ts` (`DocKind`) and the `kind === 'sheet' ? …` branches in `apps/collab/src/server.ts` (create, mime, export).
11. **Docs** — README "What's real and what's stubbed" table and the Figma ↔ code table.

## Checklist

- [ ] Kind with no engine still imports (preview engine) and shows a read-only reason.
- [ ] Desk stays file-type agnostic: nothing added to `packages/desk`.
- [ ] Copy in fr-CA; icons from Iconoir.
- [ ] Tests: detection + import in `packages/engine/test/engine.test.ts`; model tests in the editor package; server round trip in `apps/collab/test` if collaborative.
- [ ] `oel-verify`, including the browser walkthrough for the kind.
