---
name: oel-collab-backend
description: Server-side work for OutilsEnLigne in apps/collab (Hocuspocus/Yjs + Hono + SQLite) — new HTTP endpoints, document kinds, share tokens/roles, versions, media, exports, and replacing TODO(backend) / TODO(anti-abuse) stubs such as the forms backend, magic-link accounts, uploads and Turnstile.
---

# Server work (`apps/collab`)

> Edition note: the server only runs in the **team edition** (`PUBLIC_EDITION=equipe`, `npm run dev:equipe`). The
> default single-user build (`solo`) never contacts it: `collabApi` is null and every document stays in IndexedDB.
> Front-end parts of a server feature hide behind `features.collab` / `features.forms` / `features.projects`
> (`apps/web/src/edition.ts`) and an editor prop, never deleted (AGENTS.md « Rules »).

> Layout note: plan Phase 5 splits `src/server.ts` into `src/domains/*` with a `storage/`
> interface and a `kinds.ts` table. If `apps/collab/src/domains/` exists, add code there
> and update this skill.

## Today

- `src/main.ts` — config (`COLLAB_SECRET`, `COLLAB_PUBLIC_URL`, `COLLAB_DATA_DIR`, port 8787).
- `src/server.ts` — Hono routes + Hocuspocus (`onAuthenticate` checks share tokens; viewers read-only). Server-side exports use `exportJsonFromYDoc` (`@oel/docs/model`) / `SheetDoc` (`@oel/sheets/model`) and the Node WASM builds (`oeldocx-node`, `oelxlsx-node`).
- `src/db.ts` — `Store` on `node:sqlite` (docs, links, versions, media, packages); `DocKind = 'doc' | 'sheet' | 'slides'` (mime/extension per kind in the `KINDS` table of `server.ts`; presentations export with `SlidesDoc` + `oelpptx-node`).
- Documents use Y.Doc layout version 2 (`FORMAT_VERSION` in `@oel/docs/model/ydoc.ts`: sections map + stories by id); `exportJsonFromYDoc` orders sections from the body, so server exports need nothing else. Stored dev data of an older version is not migrated: delete `apps/collab/data/` and re-import.
- `src/auth.ts` — HMAC tokens `{ d, r, l }`, `canEdit`.
- Client: `packages/collab-client/src/api.ts` (`CollabApi`) — add the matching client method there, not in an editor.

## Rules

- No accounts required to edit a shared link; accounts (magic link) are needed only to create/publish forms. Respondents never need one.
- Tokens stay in URL fragments (`#t=`), never in query strings or logs.
- Errors: JSON `{ error: '<message fr-CA>' }` with a proper status. Validate sizes with `bodyLimit`; check magic bytes on uploads.
- Server imports only `model/` entry points of editor packages (no React).
- Keep it one process + SQLite; put storage behind `Store` methods so Postgres/S3 can replace it.
- When implementing a `TODO(backend)` / `TODO(anti-abuse)`, delete the marker in the same change; list any deliberately deferred ones to the user.

## Forms backend (the next big item)

Contract: `packages/forms/src/api/backend.ts` (`FormsBackend`). Implement
`createHttpBackend(baseUrl)` in `@oel/forms`, routes in `apps/collab`, and swap it in
`apps/web/src/forms/backend.ts`. Keep `createLocalBackend` for tests. Responses must
append rows to the linked sheet's Y.Doc on the server so open spreadsheets update live.

## Steps

1. Route + store method + test in `apps/collab/test/*.test.ts` (the tests start a real server and use `@hocuspocus/provider` + `ws`).
2. Client method in `@oel/collab-client` (or the backend implementation in the editor package).
3. `npm run dev` (web + collab) and exercise it from the UI in two browser contexts (one private) for anything shared.
4. `oel-verify`.
