# Bottom bar and full-screen menu (Figma M) — implementation plan

Figma: section **M · Barre du bas et menu**, page « Editor — Behaviors »
(https://www.figma.com/design/Y3vDuuW4jfyTOjreIwDp6P/OutilsEnLigne.ca?node-id=196-11354). Decisions: M4, 5 Oct 2026.
Overview and order of work across K–N: `docs/plans/2026-10-k-to-n-overview.md`.

## Behaviour (from M0–M4)

- The sidebar (`Sidebar` / `NavItem` in `BureauApp`) is removed.
- Bottom bar, centred: **logo round button (menu)** on the left · Note · Importer · Ranger ▾ · Étaler · **small round
  « + »** on the right (opens the Nouveau menu: Document, Présentation, Tableur, Formulaire, Galerie vide, modèles).
  The five per-type buttons, « Nouveau », « À l’arrivée » and « Fils » leave the bar. Zoom + minimap stay bottom right.
- Empty desk (no item): six big cards in the centre — Document, Présentation, Tableur, Formulaire, Note, Importer — and
  « Ou partir d’un modèle → ». They disappear with the first item.
- Creating on a non-empty desk: « + », menu > Nouveau, right-click on the desk background > Nouveau ▸, `Alt + N`.
  `N` still creates a note.
- **Ranger ▾** (permanent, with Annuler): Par type · Par date de modification · Par nom · Par personne · Par fils
  (linked items together); `Alt + 1…5`. Papers glide to their places (300 ms, none with reduced motion); toast
  « Bureau rangé par type · Annuler ». Switch « Ranger aussi les fichiers qui arrivent » (former « À l’arrivée » ›
  sortByType). Stuck notes travel with their item; gallery children stay inside their planche.
- **Étaler** (`E`, temporary, nothing moves): the desk fades, every item of the project is laid out in a grid at screen
  scale with its name; typing filters by name; arrows + Entrée or click closes the grid and centres the desk on that item;
  Échap or `E` restores the exact previous view.
- **Menu (logo)**: full-screen modal, slides from the logo (240 ms). Rail: Accueil, Nouveau, Ouvrir et importer,
  Projets | Partager et inviter, Paramètres du projet, Fils du bureau (Ctrl + Maj + L) | Affichage, Raccourcis clavier,
  Aide, Compte | Retour au bureau · Échap. Accueil = Nouveau row, Récents dans ce projet, Vos projets (+ Nouveau
  projet). Focus goes to the rail; Échap, the logo or « Retour au bureau » close it.
- Project pill stays top-left (click → menu on Projets); Partager stays top-right; theme and shortcuts move to
  Affichage (`?` still opens shortcuts). OCR and « Lier les tableaux importés » move to Paramètres du projet › Import (N).
  « Composants » leaves the app (link in Aide, dev builds only). A late link puts a dot on the logo.

## Phases (each ends with typecheck + tests + a commit)

### M-1 · Bottom bar
- `BottomBar` replaces `Dock` in `apps/web/src/bureau/Chrome.tsx`: `MenuButton` (round, logo, `aria-haspopup="dialog"`,
  late-links dot), Note, Importer (FileTrigger, Ctrl + O), `RangerMenu`, Étaler toggle, round « + » with the Nouveau
  `Menu`. Remove `Sidebar` from `BureauApp`; move the arrival rules state into project settings (temporary local
  state until N-1).
- `Alt + N` opens the « + » menu.

### M-2 · Empty desk
- `DeskCanvas` gets `renderEmpty` (generic slot); the app renders the six cards (kit `Button`/card styles), drop zone
  copy unchanged.

### M-3 · Ranger
- `@oel/desk` core: pure `arrange(nodes, groups, opts) → Map<id, {x,y}>` (rows per group, wrap to a target width,
  gaps), and `store.arrange(positions, label)` in one history entry with an `animating` flag the canvas turns into a CSS
  transform transition. Attached notes / container children move with their parent (K-1, L-5).
- App supplies the grouping keys: kind, `updatedAt` (add `updatedAt` + `updatedBy` to `PaperData`, set on commit),
  title (fr-CA collation), person, link clusters (connected components of desk threads).
- vitest: arrange is deterministic, no overlaps, attached nodes follow, undo restores.

### M-4 · Étaler
- `DeskCanvas` overlay mode `expose`: pure `exposeLayout(nodes, screen, filter) → rects`; FLIP animation from each
  paper's current screen rect; thumbnails reuse the `Paper` renderer at scale; search field, roving focus grid
  (`role="grid"`), Entrée → close + `store.reveal(id)`; Échap restores the saved viewport. Key `E` on the desk.

### M-5 · Full-screen menu
- `AppMenu` (react-aria `Modal` + `Dialog`, labelled « Menu »): rail + content panes; Accueil (Nouveau cards, recent
  items from `updatedAt`, projects list from N-1), Nouveau (types + templates placeholder), Ouvrir et importer, Projets,
  Partager et inviter, Paramètres du projet (N-5; placeholder until then), Fils du bureau (opens the existing
  `LinksUI` panel and closes the menu), Affichage (theme, list view, minimap, threads visible), Raccourcis (existing
  `ShortcutsDialog` content), Aide, Compte.
- Reusable pieces that aren't app-specific (`RailNav`, large choice cards) go to `@oel/emboss` with a `/composants` demo.
- Desk background context menu gains « Nouveau ▸ ».

## Verification
- vitest: arrange/expose layouts; `ShortcutsDialog` lists E, Alt+N, Alt+1…5.
- Browser (one attempt): bar at 1440/1024/720; empty desk cards; Ranger each mode + Annuler; Étaler filter + Entrée +
  Échap; menu open/close by logo, Échap, Retour; keyboard only; reduced motion.

## Status (2026-10-05, branch `feat/bottom-bar`)

- **M-1 done** — `BottomBar` replaces `Dock` (`apps/web/src/bureau/Chrome.tsx`); sidebar removed; « + » is an ink
  sphere (radial light + the toast seal's inner relief) with the Nouveau menu, `Alt + N` opens it; Ranger and Étaler
  are in the bar, greyed « Bientôt » until M-3/M-4. Until M-5 the logo opens a short menu: Accueil, Fils du bureau,
  À l’arrivée… (the old rules popover), Raccourcis clavier. Icon `sort` (Iconoir Sort) added to `@oel/emboss`.
- **M-2 done** — `DeskCanvas` has a generic `renderEmpty` slot (centred, `data-desk-ui`, replaces the « vide » line);
  the app renders `EmptyDesk` (`Chrome.tsx`): « Ce bureau est vide », six raised sheet cards (Document, Présentation,
  Tableur, Formulaire with their kind colours, Note, Importer) and « Ou partir d’un modèle → », greyed « Bientôt »
  until templates exist. Sizes are Figma M1 · 4 at 2× (the mockup is 960 wide). Formulaire uses the `form` icon like
  the « + » menu, not the File icon of the mockup.
- Not yet: browser check for M-1 and M-2 (test browser couldn't reach or capture the page in either session).
