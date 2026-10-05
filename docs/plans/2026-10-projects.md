# Projects (Figma N) — implementation plan

Figma: section **N · Projets**, page « Editor — Behaviors »
(https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=197-11538). Decisions: N4, 5 Oct 2026.
Overview and order of work across K–N: `docs/plans/2026-10-k-to-n-overview.md`. Server parts depend on restructure
Phase 5 (`domains/accounts`, `storage/Store`).

## Model (N0, N2)

- Account → **Project** → desk (one Y.Doc per project, collab kind `desk`) + files (one Y.Doc each, `project_id`).
- Everything belongs to exactly one project: papers, notes and their attachments, galleries, links, forms, image
  styles. Moving a file to another project is an explicit action that cuts its links. Cross-project links later, via
  explicit grants.
- Four roles: propriétaire, éditeur, commentateur (can write notes now; comments later), lecteur. Roles are given on the
  project; a single-file share stays possible and is shown as an exception.
- Settings cascade: OEL defaults → account → project → file. A file overriding a project setting says so (« Thème propre
  à ce fichier »).
- Project settings sections: Général · Membres et rôles · Invitations et partage (who can invite, default role, share
  link, link expiry, allowed domains, access requests, mention outsiders) · Collaboration (presence, version history
  retention) · Apparence et valeurs par défaut (theme, accent, heading font, language, number/date formats, page size,
  slide template) · Import (OCR, link imported tables, sort arriving files) · Styles d’image · Formulaires (sign-in
  policy) · Notifications · Archiver ou supprimer.
- No « spaces » above projects in v1; keep an optional `space_id` column. Each account gets a « Mon bureau » project on
  first visit.

## Phases (each ends with typecheck + tests + a commit)

### N-1 · `ProjectContext` and settings resolution (client only)
- `apps/web/src/project/`: `ProjectContext { id, slug, name, role, members, settings }`, `useProject()`,
  `useSetting(key)` resolving file → project → account → defaults (typed keys in one `settings.ts` schema with fr-CA
  labels, reused by the settings screen).
- Replace the `PROJECT` constant and `PEOPLE` in `bureau/`; notes mentions (K-4) and Partager read members from here.
- `ProjectsBackend` interface + local stub (localStorage), `TODO(backend)` markers, same pattern as `@oel/forms`.

### N-2 · Desk persistence per project
- Collab kind `desk` in `apps/collab` (`kinds.ts` table from restructure Phase 3); `@oel/desk` ↔ Y.Doc binding in the
  app (`Y.Map` of nodes, one entry per paper; selection/viewport stay local). Replaces `SEED_PAPERS` for real projects
  (seed kept for a dev demo project). Offline via `y-indexeddb` like files.

### N-3 · Server: projects, members, invites
- Tables `projects (id, slug, name, space_id?, created_at)`, `members (project_id, account_id, role)`,
  `invites (project_id, email, role, token, expires_at, accepted_at)`, `docs.project_id`; signed share tokens carry
  project + role; every doc route checks membership or token. Mentions → `notifications` table (K-4 backend).
- Enforce invitation rules server-side (who can invite, domains, expiry, approvals).

### N-4 · Routes
- `/p/<slug>/bureau` (+ `?f=…&vue=plein-ecran` levels unchanged), `/p/<slug>/document?d=…` etc.; `/bureau` redirects to
  the last opened project. Hosting rewrite documented in README (same note as `/f/<slug>`).

### N-5 · Settings screen
- Menu (M-5) › Paramètres du projet: sections column + content; each control saves immediately with a toast
  « Réglage appliqué à tout le projet · Annuler »; read-only for non-owners. Members and invitations panes; Import pane
  takes over the old « À l’arrivée » rules.

### N-6 · Projects in the menu
- Projets pane: list, switch (navigates to `/p/<slug>/bureau`), Nouveau projet, rename/archive (owners).

## Verification
- vitest: setting resolution order, role checks in the client guard, invite rule evaluation.
- Server tests: membership/token checks on doc routes, invite expiry/domains.
- Browser (one attempt): two projects, switch, desk persists after reload, invite with restricted domain refused, viewer
  can't edit settings.

## Status
- N-1 done (2026-10-05): `apps/web/src/project/` (`settings.ts` schema + `resolveSetting`, `model.ts` roles + `can()`,
  `backend.ts` `ProjectsBackend` + local stub, `ProjectContext.tsx` `ProjectProvider`/`useProject`/`useSetting`).
  `PROJECT`/`PEOPLE` replaced in the Bureau; « Import » switches read and write project settings and are read-only for
  non-owners. Papers still record their editor as `'JB'` and the presence cursors are still demo data.
