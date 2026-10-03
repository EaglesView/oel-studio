# oel-studio

- Architecture and layer rules: `ARCHITECTURE.md`. Structural work in flight: `docs/plans/2026-10-restructure.md` (tick steps as they land).
- Project skills in `.claude/skills/`: start with `oel-architecture`, then `oel-rust-engine`, `oel-file-kind`, `oel-editor-feature` or `oel-collab-backend`; finish with `oel-verify`. When a plan phase changes a layout a skill describes, update the skill in the same change.
- UI copy fr-CA, formulas English, icons Iconoir, components/tokens from `@oel/emboss`. Specs: Figma `Y3vDuuW4jfyTOjreIwDp6P`, page "Editor — Behaviors".
- Don't commit unless asked. When you do, commit properly and in digestible pieces:
  - Commit as you go, not at the end: one commit per logical step (one plan step, one feature slice, one fix), so each commit can be reviewed and reverted on its own. Commit when a step is green (`oel-verify`), before starting the next one.
  - One concern per commit. Don't mix a refactor or a move with a behaviour change, and keep generated output (`packages/engine/src/generated/`, lockfiles) in the same commit as the change that produced it.
  - Each commit should build and pass tests on its own; if one can't, say so in its message.
  - Message: imperative subject ≤ 72 chars, prefixed with the area or plan phase (`Phase 2: …`, `docs: …`, `oel-xlsx: …`), blank line, then a body saying what changed and why (not a file list).
  - Work on a branch, never on `main`; don't push or open a PR unless asked.
  - Never rewrite or discard the working tree to reshape history (no `reset --hard`, `checkout .`, `clean`); if a split needs that, stage hunks instead or ask.
