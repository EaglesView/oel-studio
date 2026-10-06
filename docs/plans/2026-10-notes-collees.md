# Sticky notes that stick (Figma K) — implementation plan

Figma: section **K · Notes collées**, page « Editor — Behaviors »
(https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=192-11059). Decisions: K3, 5 Oct 2026.
Overview and order of work across K–N: `docs/plans/2026-10-k-to-n-overview.md`.

## Behaviour (from K0–K3)

- A note never opens. Double-click, Enter or typing on a selected note enters its text **on the desk**; a click anywhere
  outside the note, or Échap, leaves the text and keeps the note selected. No OpenSheet, no level 2/3 for notes.
- « Assigner » is removed. Typing `@` in a note proposes the project's members; the mentioned person gets a notification
  (« JB vous mentionne dans une note sur « Rapport annuel 2026 » ») that opens the desk centred on the note, which pulses
  once. The notification is sent **once, when the author leaves the text**, only for mentions added in that session.
  An e-mail address after `@` proposes « Inviter et prévenir » when the project's invitation rules allow it (N).
- A note can be **stuck** to a whole desk item (paper, gallery, form). v1 does not stick inside files (cells, slides,
  paragraphs = comments, designed later).
- « Coller » is a **split button** like « Présenter »:
  - main part (`P`): sticks the note to the item it overlaps, where it is (largest overlap wins);
  - arrow (`Maj + P`): « Coller à… » pick mode — pin cursor, hovered item ringed in accent, dashed line from the note,
    click to stick, Échap cancels; Tab/Maj+Tab cycle nearby items, Entrée sticks.
  - When the note overlaps nothing, the main part starts « Coller à… ».
- Also: Alt + drop a note on an item sticks it. Dropping without Alt only lays it on top (today's behaviour).
- A stuck note follows its item: move, nudge, align, distribute, Ranger, Étaler. It sits at the item's edge, slightly
  tilted, under a pin. Several notes on one item are staggered down its right edge.
- « Décoller » (`P` on a stuck note, toolbar, right-click) or dragging the note more than 24 px away (slight resistance)
  unsticks it. Deleting the item (or moving it to another project) unsticks its notes in place; toast « 2 notes
  décollées · Annuler ».
- Item open in place / full screen: a « 2 notes » tab on the sheet's edge shows its notes as a stack, readable and
  writable there.
- List view: stuck notes are listed under their item, indented.
- Migration: notes with an `assignee` get `@Name ` prepended to their text, without notification.

## Phases (each ends with typecheck + tests + a commit)

### K-1 · `@oel/desk` attachments (generic, no file-type knowledge)
- `DeskNode.attach?: { to: string; dx: number; dy: number }` — offset in the target's unrotated frame.
- Store: `attach(id, to, at?)`, `detach(ids)`, `attachedTo(id)`, `overlapping(id)` (largest-overlap node, used by the
  split button's main part). `moveBy`, `nudge`, `align`, `distribute`, `bringToFront` carry attached nodes with their
  target; `remove(target)` detaches its children in place and returns their ids; `ordered()` draws attached nodes just
  above their target. All inside one history entry.
- `DeskCanvas`: drag of an attached node past 24 px detaches (rubber-band resistance below that); `pickTarget` mode
  (`{ from, filter, onPick, onCancel }`) with hover ring, dashed guide, Tab cycling, Enter/Esc, announcements.
- vitest: attach/detach, carry on move/align/distribute, remove target, undo/redo round trip, overlap choice.

### K-2 · Notes written in place
- Remove `NoteWorkspace` and the note branch of `OpenSheet`; `open(note)` becomes « enter text ».
- `Paper.tsx` note: editing state renders a `textarea` (auto-height, same paper look); `BureauApp` keeps `editingNoteId`;
  pointerdown outside / Échap commits through `store.update(…, { label: 'Note' })`. Typing a printable key on a selected
  note enters editing with that character.
- Remove `assignee` from `PaperData`, « Assigner » from `ContextToolbar`; migration in `seed.ts` / desk load.

### K-3 · « Coller » split button and gestures
- Note toolbar: Couleur · « Coller ▾ » (reuse the J-4 split button from `@oel/emboss`) · Supprimer; stuck note shows
  « Décoller » in place of « Coller ».
- Keys `P` / `Maj + P` on a selected note (desk `onKeyDown`, next to `N`); context menu entries; Alt + drop.
- Stuck rendering: pin (Iconoir `Pin`, kit icon `pin`), −4° tilt, stagger; toast « Note collée à « … » · Annuler ».
- Icons to add to `@oel/emboss`: `pin`, `pin-slash`, `at-sign`, `bell` (already in the Figma Icons frame).

### K-4 · Mentions and notifications
- Note text keeps plain text; mentions are stored as `@[Marie-Claude](mc)` tokens and rendered as chips when not
  editing. Mention popover = emboss `ComboBox`/listbox anchored at the caret (members from `ProjectContext`, N-1;
  `PEOPLE` until then).
- `apps/web/src/notifications/`: `NotificationsBackend` interface + local stub (localStorage + BroadcastChannel, same
  pattern as `@oel/forms`), all server work marked `TODO(backend)`. `NotificationsButton` lists items; « Voir la note »
  calls `store.reveal(id)` + a one-shot pulse class.
- Send on leaving the text: diff of mention tokens before/after the edit session.

### K-5 · Around a stuck note
- OpenSheet « N notes » edge tab (stack, editable), list view nesting, delete-target toast, Ranger/Étaler integration
  (M-3/M-4 treat attached nodes as part of their target).

## Verification
- vitest: K-1 store tests; mention token parse/serialise; mention diff.
- Browser (one attempt): create note → write → click outside; stick with `P` over a document; `Maj + P` to another
  item; move the item; drag the note away; delete the item + Annuler; `@Ma` → notification in a second tab.

## Status
- K-1 done (2026-10-05): `DeskNode.attach`, store `attach`/`detach`/`attachedTo`/`canAttach`/`overlapping`, carry on
  `moveBy`/`nudge`/`update`/`align`/`distribute`/`bringToFront`, `remove` frees stuck nodes in place and returns their ids;
  `DeskCanvas` `pickTarget` (ring, dashed guide, Tab/Maj+Tab nearest first, Entrée, Échap or click on empty to cancel)
  and drag-off with 24 px rubber band (`onDetach`). One level only (a target is never itself stuck; a node with notes
  can't be stuck). Nothing uses it in the Bureau yet: K-3 wires « Coller », K-5 the delete toast.
- K-2 done (2026-10-05): notes are written on the desk (`NoteEditor` in `Paper.tsx`, one undo step per writing
  session via `store.begin/end`), new notes start in writing, typing a printable key on a selected note starts with that
  character (`notes.ts` reserves P, N, ?, /, zoom keys and Space). `NoteWorkspace` and « Assigner » are gone;
  `migrateNote` turns an old assignee into a leading `@Nom`. The toolbar shows « Écrire » for a note until K-3.
