# Single-user MVP and open-source release — plan

Goal: ship the Bureau as a **single-user, in-the-browser editor** very soon, and open the repository (apps,
packages and every Rust crate). Written 11 Oct 2026, to execute phase by phase (S-0 → S-9), each phase ending with
`oel-verify` and its own commits.

Starting point: branch `feat/images` (latest product branch; `feat/backend` B-0/B-1 is set aside and untouched).
`main` is 138 first-parent commits behind; every feature branch (`dev` → … → `feat/bottom-bar` → `feat/images`) is
one linear chain.

## Decisions (11 Oct 2026)

| # | Decision |
|---|---|
| D1 | Single user. Collaboration and forms leave the **front end only**; their code (`apps/collab`, `packages/forms`, `@oel/collab-client` share/versions UI, `/f`, `/connexion`) stays in the repo and is described in the README. |
| D2 | The desk is **saved on the device** (IndexedDB), with a demo Bureau seeded on first visit, « Réinitialiser la démo », and export/import of the whole bureau as a `.zip`. |
| D3 | Licence **MPL-2.0** for the repo and every crate (file-level copyleft: the crates can be embedded elsewhere, changes to our files stay open). |
| D4 | Home page = Figma direction **D · « Média d’abord »** (page « Site — bureau.outilsenligne.ca (explorations) », frames D1 `212:1893`, D2 `212:19294`), built from the site components (`Site/Nav` 207:9, `Site/Feature Tile` 207:84, `Site/Footer` 208:39, `Site/Desk Mock` 208:77). |
| D5 | The **site** (home + docs) is bilingual: French at `/`, English at `/en/…`. The Bureau UI itself stays fr-CA for this release (see R6). *Superseded 2026-10-12: the Bureau is French or English (`@oel/i18n`, welcome dialog, « Paramètres »).* |

Defaults taken without asking (change here if wrong): one switch `PUBLIC_EDITION=solo|equipe` rather than deleting
UI; demo content in French with English formulas; README and AGENTS.md in English; `CLAUDE.md` becomes a pointer to
`AGENTS.md`.

---

## S-0 · Release branch and housekeeping

- Branch `release/solo` from `feat/images`. L-8's remaining scope switch (« Cette copie / Style de la galerie ») stays
  on `feat/images`; nothing in this plan depends on it.
- The user's wasm-pack 0.15 bump is applied to the working tree (`package.json`); the matching lockfile diff made on
  `feat/backend` is in `git stash` « wasm-pack 0.15 bump (made on feat/backend) ». Regenerate the lockfile on this
  branch with `npm install` when the user wants it committed, in its own commit.
- Delete `apps/web/src/bureau/seedFixtures.ts` only in S-4 (it is replaced by the demo).

## S-1 · Edition switch

One place decides what the front end shows: `apps/web/src/edition.ts`.

```ts
export const EDITION = (import.meta.env.PUBLIC_EDITION ?? 'solo') as 'solo' | 'equipe';
export const features = {
  collab: EDITION === 'equipe',   // server sync, share links, presence, versions, identity
  forms: EDITION === 'equipe',    // form papers, « Formulaire » in « + », /f, /connexion
  projects: EDITION === 'equipe', // members, roles, invitations (project *settings* stay)
} as const;
```

- Layer rule: packages never read env. Editors get props instead: `DocsEditor`, `SheetsEditor`, `SlidesEditor`
  take `collab?: boolean` (default `true` so `/document` etc. keep working in `equipe`); the Bureau passes
  `features.collab`.
- `collabApi` (`bureau/docs.ts`) is `null` when `!features.collab`: `createRemoteDoc` already returns `null`
  without an api, so sessions stay `local-…` in y-indexeddb and nothing pings `:8787`.
- `npm run dev` starts only the web app in `solo` (`dev:collab` / `npm run dev:equipe` start both).
- Test: vitest on `edition.ts` + a render test that the editors hide share/versions with `collab={false}`.

## S-2 · Desk saved on the device (D2)

Today `BureauDesk` builds the desk from `SEED_PAPERS` in memory and `seedFixtures` re-imports three files on every
load, so the desk is lost on reload and every visit leaves orphan documents in IndexedDB.

- **Desk Y.Doc**, the shape the backend's B-5 / N-2 will sync later: `Y.Map papers` (id → paper JSON),
  `Y.Map threads`, `Y.Map meta` (viewport, `demoVersion`). Persisted with `y-indexeddb` as `oel-desk:<projectId>`
  (`« Mon bureau »` from the local project stub).
- Binding in `apps/web/src/bureau/persist.ts`: DeskStore → Y (debounced, one transaction per gesture end, history
  stays DeskStore's) and Y → DeskStore on load. `@oel/desk` stays free of Yjs (binding lives in the app).
- Papers keep only references (`docId`, image ids, recipe ids); file bytes already live in the editors'
  y-indexeddb + `oel-docs-files`.
- First visit (empty desk Y.Doc) → seed the demo (S-4). `navigator.storage.persist()` on the first real edit, with a
  one-time note in the menu if refused.
- Menu (Figma M) « Bureau » section: « Nouveau bureau vide », « Réinitialiser la démo » (confirm dialog), « Exporter
  le bureau (.zip) » (one Office file per paper via each kind's export + `bureau.json` for layout, notes, links,
  recipes), « Importer un bureau (.zip) ».
- Deleting a paper deletes its IndexedDB documents after the undo window (or on « Vider la corbeille » later); a
  one-shot cleanup removes `local-…` docs no paper references (the orphans left by `seedFixtures`).
- Tests: vitest round trip desk → Y.Doc → desk; zip export → import gives the same papers and links.

## S-3 · Demo files

Generated, committed, reproducible: `fixtures/demo/make_demo.py` (same venv as `fixtures/charts/make_charts.py`:
openpyxl, python-pptx, python-docx) + `fixtures/demo/README.md`. Logo: `fixtures/demo/logo.png` rasterised from
`packages/emboss/src/icons/Logo.tsx` (1024 px, transparent) and `logo.svg`.

**Tableur « Chronos — tours de piste.xlsx »** (French text, English formulas)
- Sheet `Tours`: table `Tours` (A1:D19) — `Coureur`, `Tour` (1–3), `Temps (s)`, `Date`; six fictional runners
  (Léa, Samuel, Maya, Noah, Zoé, Félix) × 3 laps, plausible 400 m times (58–75 s).
- Sheet `Résultats` (first tab, the one the desk shows): one row per runner, reading the other sheet:
  - `Meilleur tour` `=MINIFS(Tours!C:C,Tours!A:A,A2)`
  - `Moyenne` `=AVERAGEIFS(Tours!C:C,Tours!A:A,A2)`
  - `Écart au meilleur` `=B2-MIN($B$2:$B$7)`
  - `Rang` `=RANK.EQ(B2,$B$2:$B$7,1)`
  - Summary cells: `Tour le plus rapide` `=MIN(Tours!C:C)`, `Par` `=XLOOKUP(MIN(Tours!C:C),Tours!C:C,Tours!A:A)`,
    `Tours enregistrés` `=COUNTA(Tours!A2:A100)`.
  - Clustered bar chart « Meilleur tour par coureur » from `Résultats!A1:B7` (+ `Moyenne` as a second series).
- IronCalc 0.8.3 supports every function above (checked in `ironcalc_base/src/functions/mod.rs`).
- **Risk:** openpyxl writes formulas without cached values, and the chart cache is empty. Bake values by
  round-tripping through `oel-xlsx` (IronCalc evaluates, the codec writes `<v>` and the chart cache): a small
  `cargo run -p oel-xlsx --example recalc` step called by the script. Verify the desk thumbnail shows numbers
  before the sheet is opened.

**Présentation « Bienvenue dans le Bureau.pptx »** (16:9, four slides)
1. Intro: logo centred, « OutilsEnLigne · Bureau », subtitle « Tous vos fichiers sur un seul bureau ».
2. « Comment l’utiliser », three points: « Double-cliquez sur un texte pour le modifier » · « Ajoutez une diapo avec
   + dans la pellicule » · « Changez un temps dans le tableur : le graphique de la diapo 3 suit ».
3. « Résultats de la course »: placeholder that S-4 replaces by the **linked** chart from the spreadsheet.
4. « Merci ! », white text on black (`bg1` = black on that slide, not a theme change).

**Document « À propos du Bureau.docx »**: title, the logo as an inline picture (S-4 makes it a linked copy of the
image paper), three short paragraphs (what the Bureau is, that files stay in the browser, how to export), a small
« Raccourcis » table.

- Tests: `crates/*/tests/contract.rs` include the three demo files (import → export → re-import lossless); a vitest
  case loads the xlsx through the engine and checks `Résultats!B2` and the XLOOKUP cell.

## S-4 · Demo Bureau seed

`apps/web/src/bureau/demo/` replaces `seed.ts` (B1 papers) and `seedFixtures.ts`:
- `layout.ts`: the papers and their positions — spreadsheet (left), presentation (top right), document (bottom
  right), image paper « logo.png » (between doc and deck), one note collée on the spreadsheet: « Modifiez un temps
  dans l’onglet Tours : le graphique de la diapo 3 se met à jour. », a gallery is optional (skip if it crowds).
- `seedDemo(store)`: imports the files through `importInto` once, then creates the links through `LinkResolver`:
  - chart `Résultats` → slide 3. Needs a new placement `{ kind: 'slides', where: 'slide', index: 2, replace:
    '<placeholder id>' }` in `links/resolver.ts` + `links/targets/slides.ts` (today only `new-slide` / `last-slide`).
  - image paper (logo) → the document's picture (`links/sources/image.ts`, image link generalisation I): placement
    `{ kind: 'document', where: 'replace', target: '<picture id>' }`, or `start` if replacing is too much for now.
- `meta.demoVersion = 1` so a later demo update can offer « Nouvelle version de la démo » without touching user work.
- Check by hand: edit a lap time in `Tours` → `Résultats` + chart update → slide 3 copy updates within a second →
  thread pulses on the desk; retouch the logo → the doc's copy follows (L-8).

## S-5 · Collaboration out of the front end (D1)

Every surface below is hidden behind `features.collab` / `features.projects`, never deleted:

| Where | What hides in `solo` |
|---|---|
| `bureau/Chrome.tsx` | `AvatarStack` + `SharePill` « Partager », `PresenceCursors` (static demo cursors) |
| `bureau/AppMenu.tsx` | pane « Partager et inviter » (members, « Inviter par courriel »), « par qui » in history rows |
| `bureau/ContextToolbar.tsx` | multi-selection « Partager » (toast stub) |
| `bureau/Paper.tsx`, `seed` | editor initials (« JB », « MC ») on papers; `@Nom` mentions in notes (`notes.ts` assignee) |
| `project/` | members and roles UI; `ProjectProvider` keeps a single « Mon bureau » with role `owner` |
| `@oel/docs` · `@oel/sheets` · `@oel/slides` | « Partager » button + menu entry, `ShareDialog`, `Peers`, `IdentityDialog`, « Historique des versions » (server-only today), `SyncStatus` → replaced by a local status « Enregistré sur cet appareil » |
| Pages | `/document`, `/presentation`, `/tableur` (share-link landings) redirect to `/bureau` in `solo` |

- Settings that only make sense with a team (project « Collaboration », « Invitations et partage ») hide too.
- `rg -n "features\.(collab|projects)"` should list every hook; the README links to that search.
- Tests: existing collab tests unchanged (`equipe` build); add a smoke render of the Bureau chrome in `solo`.

## S-6 · Forms out of the front end (D1)

| Where | What hides in `solo` |
|---|---|
| `bureau/Chrome.tsx` `NEW_KINDS` | « Formulaire » in « + » (and the Alt+N tooltip wording « … ou formulaire ») |
| `bureau/ContextToolbar.tsx` | « Créer un formulaire » on a spreadsheet; the `form` case |
| `bureau/BureauApp.tsx` | `NewFormDialog`, `useFormSync(formsBackend)`, `createForm` |
| `bureau/OpenSheet.tsx`, `Paper.tsx` | `form` papers render as « Formulaires : bientôt disponibles » if one is ever imported from a zip |
| Pages | `/f`, `/connexion` redirect to `/` in `solo` (static meta refresh) |

`packages/forms` keeps compiling and its tests keep running; the README's « Built, not shipped yet » section
points to it and to `TODO(backend)`.

## S-7 · Release polish (recommended, see R1–R4)

- R1: write linked charts into `.pptx` / `.docx` exports (plan `2026-10-links-and-charts.md` Phase 6/9), or at least
  export the copy's last rendered picture, so exporting the demo deck keeps slide 3.
- R2: remove or relabel stubs that pretend: simulated « PDF → document » progress, disabled crop/OCR/export tools
  (keep « why unavailable » tooltips, drop fake progress).
- R3: first-run hint on the demo desk (dismissable): « Double-cliquez sur un papier pour l’ouvrir ».
- R4: `navigator.storage` estimate in the menu (« 42 Mo utilisés sur cet appareil ») next to export.

## S-8 · Site: bilingual home and docs (D4, D5)

**i18n**: Astro i18n routing, `defaultLocale: 'fr'`, `locales: ['fr', 'en']`, `prefixDefaultLocale: false`.
Strings in `apps/web/src/site/i18n/{fr,en}.ts` (typed: `en` must have every `fr` key), `Site/Nav` language switch
keeps the same page, `<link rel="alternate" hreflang>` on every page. The Bureau link goes to `/bureau` from both
languages.

**Home (direction D, `/` and `/en/`)**: rebuild `index.astro` from the D1/D2 frames: nav, hero with a real capture of
the demo Bureau, one section per capture (desk, document, deck + linked chart, spreadsheet, image retouch, links),
« Code ouvert » band listing the six crates (as in frame A's open-code block), FAQ, footer. Captures:
`apps/web/public/captures/{fr,en}/…` taken from the demo Bureau in both themes (`scripts/` note on how, by hand).
Drop the « Travaillez ensemble » / invite copy (solo). Answer the Figma brief's « À valider » items in the copy:
« traité dans votre navigateur » is now true in `solo`; « gratuit, hors ligne, sans perte » scoped per type; Word,
Excel, PowerPoint named descriptively only, no logos.

**Docs section `/docs` (`/en/docs`)**: a synthesis of the Figma « Editor — Behaviors » page in six pages,
content written for users (not specs), each page with screenshots from the demo Bureau:

| Page | Synthesises (Figma sections) |
|---|---|
| `/docs` Prise en main | A Niveaux et retour (Bureau → sur place → plein écran → présentation, Échap = Retour, Ctrl+Maj+Entrée), import (C/B8), the demo |
| `/docs/bureau` Le bureau | desk gestures, zoom limits, list view, K Notes collées, L galleries, M barre du bas et menu, saving / export zip |
| `/docs/editeurs` Les éditeurs | F Documents, slides + presenter view, sheets + H Graphiques, L image retouch, J barres d’outils |
| `/docs/liens` Fils de liaison | G + I: « Lier dans… », live / manuel / figé / rompu (colours and dashes from frame E's legend), « Appliquer à la source » |
| `/docs/clavier` Clavier et accessibilité | every shortcut, generated from the same data as `ShortcutsDialog.tsx` (move it to a shared module so they never drift); B3 tooltips; list view; reduced motion |
| `/docs/formats` Formats et confidentialité | lossless codecs, what is kept but not editable, D Cas particuliers, Known gaps, where data lives |

Excluded for now: E Formulaires, N Projets, collaboration parts of A/B/F — listed on a short « À venir » block.
Docs are Astro pages (MDX if `@astrojs/mdx` is acceptable, else `.astro` with the i18n helper), static, kit tokens.

## S-9 · README, AGENTS.md, licence

- `LICENSE` (MPL-2.0 text), `license = "MPL-2.0"` + `repository`/`description` in every `crates/*/Cargo.toml` and
  `"license"` in every `package.json`; `THIRD_PARTY.md` (IronCalc MIT/Apache-2.0, wgpu, Tiptap, Yjs, Hocuspocus,
  react-aria, Iconoir MIT, fonts and their OFL notices, fixture provenance).
- **README.md** (rewritten for newcomers): one-paragraph pitch + hero capture, « Try it » (demo link, `npm i && npm
  run dev`), what works today (table trimmed from the current one, solo-first), architecture diagram (Rust crates →
  WASM → worker → editors → Bureau), the six crates with one line each and how to use one alone, « Built, not
  shipped yet » (collab server, forms, projects; `PUBLIC_EDITION=equipe`), roadmap, contributing, licence. The current
  long per-package detail moves to `ARCHITECTURE.md` / package READMEs.
- **AGENTS.md** (new, canonical for every agent): the content of `CLAUDE.md` + layer rules summary, commands
  (`build:wasm`, `test`, `typecheck` — use `tsc -p apps/web --noEmit`, `astro check` is broken on TS 7),
  conventions (fr-CA UI, English formulas, Iconoir, emboss tokens, never run prettier), the edition switch and where
  collab/forms hooks are, skills index (`.claude/skills/oel-*`, readable by any agent), plans index. `CLAUDE.md`
  becomes `@AGENTS.md` plus Claude-only notes.
- Skills: `oel-architecture` (edition switch, desk persistence layer), `oel-collab-backend` (solo/equipe),
  `oel-file-kind` (demo seed), `oel-verify` (solo + equipe builds).
- `CONTRIBUTING.md`, `SECURITY.md`, issue templates; `.gitignore` covers `apps/collab/data/`.

## S-10 · Subtle motion on the site (added 11 Oct 2026)

Calm, paper-like motion with the kit's easing (`--ease-paper`), never in the way, and none at all with
`prefers-reduced-motion`:
- navbar links to sections scroll smoothly (sticky-nav offset kept); the link of the section in view is marked
  (`aria-current="location"`); the nav gets a soft shadow once the page scrolls; « Documentation » is marked on docs pages;
- hero: title, lead, buttons and capture rise in on load, staggered;
- bands: overline, title, lead and capture fade and rise in as they enter the view (once); captures settle from 97 %;
- tiles and buttons lift a little on hover; FAQ answers open with a height transition where the browser supports it;
- page changes within the site (home ↔ docs, docs ↔ docs) cross-fade with view transitions where supported, the nav
  staying put;
- content is never hidden without JavaScript: the hidden starting state only applies once a head script has run, and
  a timer shows everything if the reveal script never loads.

---

## Recommendations and insights

- **R5 · Before the repo goes public**: audit `fixtures/` (`Presentation 1–5.pptx`, `Document 4.docx`,
  `tesxte.docx`, `complex_sheet_graph.xlsx` look like personal or downloaded files: check content and licence, or
  replace them with generated ones), scan history for secrets (`gitleaks`), decide whether the Figma file link in
  docs is public (it is private today), and squash nothing: merge the linear chain into `main` and publish from there.
- **R6 · App translation**: UI strings are inline French across the packages. If an English Bureau is wanted after
  the site, extract strings to catalogues *before* more UI lands; the site's typed `fr`/`en` modules are a start.
- **R7 · CI** (restructure Phase 6) is still missing: GitHub Actions running `cargo test`, `vitest`, the typecheck
  and both `solo` and `equipe` builds is the minimum for outside contributors.
- **R8 · Local version history**: in `solo`, versions are hidden because they live on the server. Snapshots of the
  Y.Doc in IndexedDB (same `VersionPanel`) would be a cheap win after release.
- **R9 · Crates on crates.io**: the crates are the most reusable part (lossless OOXML in Rust is rare). Publish
  `oel-opc`, `oel-docx`, `oel-xlsx`, `oel-pptx`, `oel-chart`, `oel-img` once their APIs have doc comments and a
  README each; check name availability now.
- **R10 · Hosting the solo build**: it is fully static (`output: 'static'`), so any static host works; Canada hosting
  (backend plan) matters only when `equipe` returns. A strict CSP and `Cross-Origin-*` headers will be needed if
  WASM threads are used later.
- **R11 · Unconfirmed**: `crates/oel-img` is a rewrite of oelimg-rs rather than a move (images plan Status); say so
  in the README so the old npm package is not mistaken for it.

## Status
- **S-0 done** (11 Oct 2026): branch `release/solo` from `feat/images`. Lockfile for the wasm-pack bump not
  regenerated yet (stash kept).
- **S-1 done** (11 Oct 2026): `apps/web/src/edition.ts` (`editionFrom`, `featuresOf`, `features`), typed
  `PUBLIC_EDITION` / `PUBLIC_COLLAB_URL` in `env.d.ts`; `collabApi` is `null` in `solo`. `DocsEditor`,
  `SheetsEditor`, `SlidesEditor` take `collab?: boolean` (default `true`): it hides « Partager » (button, menu, dialog),
  `Peers`, versions (button, menu, Ctrl+Alt+Maj+H) and « Votre nom… »; `SyncStatus` takes `collab` to drop « Partagez-le
  pour le mettre en ligne ». `MenuEntry.hidden` + `visibleItems` (collab-client) tidy separators and empty submenus.
  Bureau workspaces and the standalone pages pass `features.collab`. `npm run dev` = web only; `npm run dev:equipe`
  = web + collab with `PUBLIC_EDITION=equipe` (POSIX shells). Tests: `packages/collab-client/test/edition.test.ts`,
  `apps/web/test/edition.test.ts`. No render test of a whole editor with `collab={false}` (sessions need IndexedDB,
  absent in happy-dom); checked by typecheck + both builds instead. So S-5 no longer needs the editors row.
- **S-2 done** (11 Oct 2026), not yet checked in the browser:
  - `bureau/persist.ts` (pure): desk Y.Doc `papers` + `meta` (format, order, desk-only links — threads derived from
    files are not saved —, viewport, demoVersion, trash); `storedPaper` drops object URLs and flashes,
    `restoredPaper` turns an interrupted import into an error; `bindDesk` writes only papers whose saved form changed,
    400 ms after the last change, and on `pagehide` / hidden tab.
  - `@oel/collab-client` `device.ts`: `openDeviceDoc`, `readDeviceDoc`, `writeDeviceDoc`, `deleteDeviceDoc`,
    `deviceDocNames` (the IndexedDB seam), `docDbName`; `localFiles.keys` / `remove`; `@oel/img` `originalKey`;
    `@oel/engine` `readZipBytes`.
  - `bureau/restore.ts`: thumbnails saved on the device and shown at once on the next visit (else redrawn), image
    originals and retouched renderings rebuilt; removed papers' files deleted on a later visit (trash, so undo works).
  - `bureau/deskStorage.ts` + `backup.ts`: `openDesk` (new desk → demo seed and fit; saved desk → its view),
    « Exporter le bureau (.zip) » (lossless: desk + every file's Y.Doc + binary files), « Importer un bureau »,
    « Réinitialiser la démo », « Vider le bureau ». Replacing actions are recorded and carried out on reload before any
    document opens (IndexedDB refuses to delete open databases); an unreadable backup leaves the desk untouched.
  - UI: « Ce bureau » section in the menu pane « Ouvrir et importer » (`DeskBackup.tsx`) with storage used and
    confirmations; `navigator.storage.persist()` asked on the first change of a returning visit.
  - Changed from the plan: no Office copies inside the backup (each file still downloads on its own); no automatic
    sweep of the orphan documents earlier versions left in IndexedDB (they are unreachable but not deleted: a manual
    « Nettoyer » can come with R4); image originals of removed pictures stay (shared by content hash).
  - Tests: `apps/web/test/persist.test.ts`, `apps/web/test/backup.test.ts`.
- **S-3 done** (11 Oct 2026): `fixtures/demo/` (`make_demo.py`, `README.md`, `logo.svg` = the favicon mark,
  `logo.png` 1024 px via ImageMagick). Workbook baked by the new `cargo run -p oel-xlsx --example recalc` (IronCalc
  results + chart caches): Maya 58.1 s best lap, XLOOKUP → « Maya », COUNTA 18. Deck slide 3 holds a native chart
  named « Graphique du tableur » with the same numbers (S-4 swaps it for the linked copy; until R1 lands, an exported
  deck still has a chart). The document ends with a closing paragraph (Word never ends a body on a table; the codec
  adds one otherwise). Rendered with LibreOffice and checked by eye. Tests: `crates/oel-{xlsx,pptx,docx}/tests/demo.rs`,
  desk preview in `packages/engine/test/engine.test.ts`.
- **S-4 done** (11 Oct 2026), not yet checked in the browser: `bureau/demo.ts` replaces `seed.ts` (B1 sample papers)
  and `seedFixtures.ts`. A new desk holds the workbook, the deck, the logo image and the document, imported for real,
  plus a note stuck to the workbook; then two live links are made: « Résultats »'s chart → slide 3 in place of the
  deck's chart « Graphique du tableur », and the logo image → the document's own picture (`word/media/image1.png`).
  New placements `{ kind: 'slides', where: 'replace', name }` (charts) and `{ kind: 'document', where: 'replace',
  path }` (pictures; `adoptPicture` in `@oel/docs` gives the file's picture an `oid`); other combinations say they
  aren't supported yet. `DEMO_VERSION` = 1 is written on the desk. No gallery on the demo desk (would crowd it). A
  desk saved before S-4 keeps its old papers: « Réinitialiser la démo » gives the new one.
- **S-5 done** (11 Oct 2026), not yet checked in the browser. In `solo`:
  - projects stub (`project/backend.ts`, `solo` option): one project « Mon bureau » (id `mon-bureau`, its own storage
    key), you alone in it as « Vous »; the team demo project and its people stay in `equipe`. The desk saved under the
    old `demo` project is not shown any more (a new « Mon bureau » desk gets the demo).
  - desk: no `SharePill` (avatars, « Partager », notifications), no demo `PresenceCursors`, no « Projet » badge; the
    project pill opens the menu's home; no multi-selection « Partager ».
  - menu: no « Projets », « Partager et inviter », « Compte » panes; « Bonjour » without a name; no projects column
    on the home pane; « Paramètres » instead of « Paramètres du projet »; no « par … » in file lists.
  - list view: last change date instead of the editor's initials; link popover: no « (Anonyme 123) » author.
  - `/document`, `/presentation`, `/tableur` (share-link landings) redirect to `/bureau` (Astro meta refresh).
  - Not done: a render test of the Bureau chrome in `solo` (the Bureau needs its workers); both builds and the
    typecheck cover it. Papers still record `editor` (the initials of « Vous ») for the team edition later.
- **S-6 done** (11 Oct 2026), not yet checked in the browser. In `solo`: no « Formulaire » in « + » (the Alt+N tooltip
  and the menu's « Nouveau » follow `NEW_KINDS`), no « Créer un formulaire » on a spreadsheet, no `NewFormDialog`,
  `useFormSync(…, enabled)` off; a `form` paper (only from a zip made by the team edition) opens on « Les formulaires
  arrivent avec la version en équipe… »; `/f` and `/connexion` redirect to `/`. `packages/forms` and its tests are
  untouched. Seen on the way, for S-7 (R2): the spreadsheet's desk toolbar still has B1 stubs (« Somme » of a
  « Montant » column, « Graphique » that only shows a toast).
- **S-7 done** (11 Oct 2026), not yet checked in the browser:
  - R1: `oel-pptx` writes a chart whose spec changed (a linked copy, even in a locked chart frame) to a new chart part
    and writes new chart elements as graphic frames; `oel-docx` writes editor-made chart nodes (no XML, a spec) as
    inline charts with a `word/charts` part. Untouched charts stay byte for byte; chartEx is only kept. On the way,
    `oel-chart` read negative axis ids (python-pptx writes them) as 0, so a rewritten chart lost its axes: ids now keep
    their 32 bits. Checked by rendering exports in LibreOffice (axes, values, new frames); LibreOffice also shows the
    value-axis title under the category axis of a rewritten chart although the XML has it once — check in PowerPoint.
    The link itself is not written into the file (plan links Phase 9).
  - R2: removed the B1 spreadsheet stubs (Somme, Graphique toast, sketch « Total … $ »), the simulated PDF conversion
    (`convertToEditable`, `onConvert` props) and the stand-in PDF pages; PDF tools are unavailable with a reason.
  - R3: first-run hint above the bottom bar (`FirstRunHint`, localStorage `oel-first-run-hint`).
  - R4: done in S-2 (storage used in « Ce bureau »).
- **S-8 done** (11 Oct 2026), checked with headless Firefox screenshots (home fr desktop, en phone width, a docs page):
  - i18n: Astro `i18n` (fr default, `/en`), `src/site/i18n.ts` (typed strings: `en` must match `fr`, `DOCS` list with
    per-language slugs, `href` / `docHref` / `alternatePath`), `hreflang` links, `Base.astro` takes `lang`.
  - Home (`src/site/Home.astro` + `home.ts`): Figma D2 bands — violet hero, documents (night), spreadsheets (paper),
    charts (violet), presentations (night), images (paper), linked copies (sheet), « Et tout ce qui va avec » tiles,
    open-source band with the six crates, FAQ, violet call to action, footer. Left out for the single-user release:
    forms band, « Se connecter », the « Ensemble » tile; copy answers the brief's open items (no account, files on this
    device, intact formats, MPL-2.0, Office names descriptive only).
  - Captures: `src/site/captures.ts` lists the seven screenshots to take of the demo Bureau (2400 × 1500, light theme)
    and where to put them (`public/captures/<lang>/<id>.webp`); until then `Capture.astro` draws a plain placeholder
    (« Capture à venir »). **The user takes the captures** (no browser driving here).
  - Docs (`/docs`, `/en/docs`): six pages per language from the Figma « Editor — Behaviors » sections (A levels, B/K/L/M
    desk, F/H/L/J editors, G/I links, B3 keyboard, formats/limits), `DocsLayout.astro` (pages list, prev/next). The
    keyboard page reads `bureau/shortcuts.ts`, now the one bilingual list behind the Bureau's « ? » dialog too.
  - `SITE.repo` is null: the « Code source » links appear once the repository URL is set.
  - The Bureau's « Aide » pane links to /docs. Test: `apps/web/test/site.test.ts`.
  - Captures (11 Oct 2026, by the user): seven 1680 × 1050 PNGs in `public/captures/<id>.png` (one set for both
    languages); `Capture.astro` reads each file's real size. They still show the Astro dev toolbar in a corner (the user
    keeps it for now). Phone-sized captures wait for the mobile layout.
- **S-9 done** (11 Oct 2026):
  - `LICENSE` (MPL-2.0 text), `license = "MPL-2.0"` in the Cargo workspace (each crate `license.workspace = true`) and
    `"license": "MPL-2.0"` in every package.json, with the lockfile's workspace entries patched to match (no
    `npm install`: the user's uncommitted wasm-pack bump stays out). Crate descriptions of `oel-opc` and `oel-img`
    brought up to date. `repository` left unset until the URL is known (also `SITE.repo` on the site).
  - `README.md` rewritten for newcomers: pitch and capture, highlights, try it, editions, repository map, Mermaid
    architecture, the crates, status and next steps, a section for AI agents, contributing and licence. The previous
    per-package detail moved verbatim to `docs/packages.md` (with a note on editions).
  - `AGENTS.md` (canonical guide for any agent: commands, where a change goes, rules incl. editions and the saved desk,
    verify, git, plans); `CLAUDE.md` is now `@AGENTS.md` plus two Claude notes.
  - `THIRD_PARTY.md` (direct Rust and npm dependencies, fonts, own material), `CONTRIBUTING.md`, `SECURITY.md` (GitHub
    private vulnerability reporting), `.github/ISSUE_TEMPLATE/{bug,idea}.md`.
  - Skills: `oel-architecture` (Product and Site layers), `oel-collab-backend` (edition note), `oel-verify` (saved
    desk and site checks, team-only pages, docs to update).
  - Still to decide before publishing (R5): fixture provenance (`fixtures/pptx/Presentation *.pptx`,
    `fixtures/docx/Document 4.docx`, `tesxte.docx`, `fixtures/xlsx/complex_sheet_graph.xlsx`), a secrets scan of the
    history, the repository URL, and merging the branch chain into `main`.
- **S-10 done** (11 Oct 2026): `src/site/motion.ts` (reveal on view, active section in the nav, nav shadow once
  scrolled), a head script in `SiteLayout.astro` that enables motion only without `prefers-reduced-motion` (and shows
  everything after 3 s if the script never runs), `data-reveal` with staggered `--d` delays on the home page, smooth
  scrolling and cross-document view transitions in `site.css`, hover lifts, FAQ height transition
  (`::details-content`, Chromium). Built and checked that the script runs (headless screenshot shows the first
  frame of the hero); the finished motion is to be checked by eye in a browser.
