# Toolbars (Figma J) — implementation plan

Figma: section **J · Barres d'outils**, page « Editor — Behaviors »
(https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=173-10495). Decisions: J6 and the J3 rework,
recorded in `docs/plans/2026-10-editor-ux-issues.md` § 2.

## Behaviour (from J0–J6)

- Tools come in named groups with a priority 1–5. When space runs out, whole groups fold into « Plus +N », highest
  priority number first, right to left; priority 1 never folds. No horizontal scrolling anywhere.
- « Plus » pushes the page: the folded groups open under the first row as a **grid of named sections** (three columns,
  wide groups span two; one column under 560 px). « Moins » closes it. Height animates 200 ms ease-out
  (`cubic-bezier(0.2, 0, 0, 1)`), none with `prefers-reduced-motion`.
- « Ancrer en bas » docks the whole bar at the bottom of the editor, groups in the grid if they don't fit; a ✕ puts it
  back at the top, folded. Under 600 px or on touch-only screens the bar is docked by default (no ✕).
- Expanded / docked are remembered per editor (`localStorage`, per-viewer convenience).
- Keyboard: one Tab stop, arrows move across rows; Alt+Maj+↓ expands/folds, Alt+Maj+B docks/undocks; the expansion is
  announced (« 4 sections affichées »).
- Objects keep their floating bars; the top bar holds text and insertion tools.

## Phases (each ends with typecheck + tests + a commit)

### J-1 · `@oel/emboss` `AdaptiveToolbar`
- `groups: { id, label, priority, wide?, content }[]`, `trailing` (outside the folding, e.g. « Présenter »), `docked`,
  `onDockedChange`, `storageKey`.
- Measures each group (ResizeObserver, widths cached while folded) and folds by the pure `foldGroups(widths, priorities,
  available)` (unit-tested). Renders row + grid inside one RAC `Toolbar` (roving focus across both).
- Icons: `dock-bottom` (Iconoir AlignBottomBox) and `presenter` (Presentation) added to the kit's icon map.

### J-2 · Document bar (J1/J4)
Historique 1 · Style 1 · Police 3 · Texte 1 · Paragraphe 2 (wide) · Insertion 4 · Outils 5 · Plus de texte 5. Imprimer and
the zoom leave the bar (Fichier, barre d'état); Barré and Liste de contrôle go to « Plus de texte ». Docked bar renders
under the page area.

### J-3 · Sheet bar (J4)
Historique 1 · Nombre 2 · Police 3 · Texte 1 · Cellules 2 (wide) · Données 3 · Insertion 4. The formula bar stays.

### J-4 · Slides bar (J4)
Historique 1 · Diapo 2 · Insertion 1 · Texte 3 (greyed until a text box is selected; a click explains) · Organiser 4;
trailing « Présenter » split button: main part starts the last used mode, arrow offers Présenter / Mode présentateur.

## Verification
- vitest: `foldGroups` (priorities, order, nothing folds when it fits, priority 1 never folds), storage round-trip.
- Browser (one attempt): widths 1440/1024/720 for each editor, expand/fold, dock/undock, keyboard shortcuts.
