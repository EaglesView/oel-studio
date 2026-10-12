# Notes, images, bottom bar, projects (Figma K–N) — overview

Drawn on 5 Oct 2026 on « Editor — Behaviors » (sections K, L, M, N); questions answered the same day (K3, L5, M4,
N4 — answers marked « par défaut » were not asked and follow the proposal; change them in Figma and here if needed).

| Figma | Plan | Scope |
| --- | --- | --- |
| K · Notes collées | `2026-10-notes-collees.md` | notes written in place, « Coller » split button, @mentions + notifications |
| L · Images | `2026-10-images.md` | `crates/oel-img` on wgpu, atelier Simple/Avancé, galleries, retouching inside editors |
| M · Barre du bas et menu | `2026-10-bottom-bar-and-menu.md` | new bottom bar, empty desk, Ranger, Étaler, full-screen menu (no sidebar) |
| N · Projets | `2026-10-projects.md` | project context, settings cascade, desk persistence, members/invites, routes |

## Suggested order

1. **M-1, M-2, M-5** — bar, empty desk, menu shell. Small, visible, no dependencies.
2. **N-1** — `ProjectContext` + `useSetting` (client, local stub). Members for mentions, settings for the menu.
3. **K-1 → K-5** — desk attachments, notes in place, Coller, mentions (local notifications stub).
4. **M-3, M-4** — Ranger and Étaler (use K-1 attachments).
5. **L-1 → L-4** in parallel from any point (crate + package are isolated), then **L-5** (desk resize + containers),
   **L-6** galleries, **L-7/L-8** editors and links.
6. **N-2 → N-6** once restructure Phase 5 (accounts, storage) lands; restructure Phase 3 (kind modules) is best done
   before L-6 adds the `gallery` kind.

Generic desk features introduced here stay in `@oel/desk` without file-type knowledge: attachments (K-1), arrange and
expose layouts (M-3/M-4), resize + containers (L-5). Update `oel-architecture` / `oel-file-kind` skills when they land.
