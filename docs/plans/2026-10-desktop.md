# Desktop app (Tauri 2) — plan

Goal: ship the Bureau as an **installable, offline desktop app on Windows, macOS and Linux**, built from the same
front end as the site. Written 24 Oct 2026. Why now: in the last week, 10 of the 30 users who sent feedback asked
for an app they can use offline, across all three platforms. The `solo` edition already runs fully in the browser
(no server), so the app wraps what exists. It doesn't need a rewrite.

Execute phase by phase (D-0 → D-7). Each phase ends with `oel-verify` and its own commits on a `desktop/…` branch.
D-0 is a go/no-go gate: if a webview can't run the editors, stop and rethink before going further.

Replaces restructure Phase 7 (« Desktop spike ») and the backlog Tier 4 line « Desktop app ». Takes in restructure
Phase 4 (platform seam), limited to what the app needs.

## Starting point (checked 24 Oct 2026)

What already helps:
- `apps/web` is static (`output: 'static'`, editors as `client:only` islands). Tauri can serve `apps/web/dist` as it is.
- Engines are WASM in Web Workers, created through one function (`namedWorker` in `apps/web/src/lang.ts`).
- `solo` contacts no server. The desk and every file are Y.Docs in IndexedDB behind `@oel/collab-client`
  `device.ts` / `local.ts`. Export and import of the whole desk as a `.zip` (`bureau/backup.ts`) already exist.
- `analytics.ts` is marked as a platform seam ("the desktop app replaces this module").
- No `SharedArrayBuffer` / cross-origin isolation is needed.

What doesn't exist yet:
- No `@oel/platform` (restructure Phase 4 unticked). Downloads are scattered over about 15 sites, for example
  `docs/ui/actions.ts` `download`, `slides/ui/SlidesEditor.tsx` `download`, `bureau/images.ts` `saveFile`,
  `sheets/ui/SheetsEditor.tsx` and `forms/ui/qr.ts`. File pickers are `<input type=file>` in about 10 UIs.
- The language lives in a cookie (`oel-lang`, read in `Base.astro`'s head script and in `lang.ts`).
- Nothing in the Figma spec covers desktop behaviour (save to the original file, file changed on disk, updates).
- Tier 1 verification debt (backlog). For the app the important rows are T1-1 (saved desk), T1-4 (exports open in
  Office) and T1-12 (edit-then-export round trips). They matter more here because the app will write over people's
  own files.

## Decisions

Defaults chosen without asking. Change them here if they're wrong. Rows marked **user** need your answer before the
phase that names them.

| # | Decision | Why |
|---|---|---|
| D1 | **v1 runs the same WASM engines in the webview.** No native Rust crates and no `invoke` engine transport. | Everything already works this way and offline. A native transport adds an IPC copy of every file, a second code path for each codec, and calc state outside the worker. Measure first (D-7) and go native only where a webview is shown to be too slow. This departs from restructure Phase 7 and ARCHITECTURE §7, which assumed native engines. |
| D2 | **v1 keeps the desk in the webview's IndexedDB**, with automatic zip backups of the desk to the app data folder (D-4). | No storage rewrite, and the browser and the app keep the same data model. The backups guard against webview storage being wiped or moved. Keeping the desk as files in a folder on disk is a separate product decision (D-7). |
| D3 | **Desktop = `solo` edition only.** | There is no team server for the public yet. The `equipe` hooks stay and can be turned on in the app later. |
| D4 | **A file opened from disk remembers its path.** « Enregistrer » writes it back in place; « Exporter » stays « save a copy ». Every overwrite first keeps the previous bytes in the app data folder (the last 5 per file). | This is the main thing an app gives over the browser. Keeping the old bytes is a safety net while T1-4 / T1-12 are still open. |
| D5 | *Changed 2026-10-24: detected at run time instead (`apps/web/src/platform.ts` checks the webview's `isTauri`), so one build serves both and no environment variable has to be set in a way that also works on Windows.* Was: **new build-time switch `PUBLIC_PLATFORM=web\|desktop`** in `apps/web/src/platform.ts`, shaped like `edition.ts`. Packages never read it: they get the seam's implementation passed in. The desktop implementation is loaded with a dynamic `import()`, so `@tauri-apps/api` never reaches the web build. | Same rule as editions. |
| D6 | **`apps/desktop/src-tauri` stays out of the Cargo workspace in v1** (`exclude`, its own `Cargo.lock`). | Otherwise `cargo test --workspace` and CI would need WebKitGTK dev packages on every run. It joins the workspace if native engines come (D-7). |
| D7 | **The webview origin and the app identifier are permanent from the first public build.** | IndexedDB is keyed by origin. Changing the identifier, or the Windows `useHttpsScheme` setting, silently gives people an empty desk. Tauri 1 → 2 did exactly this to other apps. |
| D8 | **No analytics in the app.** Aide gets « Copier les informations de diagnostic » (version, OS, webview version, GPU path `webgpu/webgl2/cpu`), so feedback can include it by hand. | The welcome text promises nothing leaves the device. |
| U1 | **user** — Code signing: Apple Developer ID (US$99/yr, needed for notarisation) and Windows signing (Azure Trusted Signing, about US$10/month, or an OV certificate). | Unsigned builds work but show scary warnings: macOS says the app is « damaged » or from an « unidentified developer », and Windows shows SmartScreen. Recommendation: the closed beta for the 10 users may ship unsigned with written instructions. A public release must be signed. |
| U2 | **user** — Where builds are published: GitHub Releases (needs the public repo, T0-8) or our own host. | The updater and the site's download page point there. Recommendation: GitHub Releases, plus a download page on the site. |
| U3 | **Decided 2026-10-24:** identifier `ca.outilsenligne.bureau` (permanent, D7). Window and product name « Bureau » for now. | |
| U4 | **user** — Oldest OS versions supported. Proposal: Windows 10 22H2+, macOS 13+, Linux with WebKitGTK 4.1 (Ubuntu 22.04+, Fedora 38+, Debian 12+). | macOS 13 is the oldest that receives a Safari 17+ WebKit (OffscreenCanvas + WebGL2 in workers). D-0 confirms. |
| U5 | **user** — Should the app register as an « Ouvrir avec » handler only (proposed), or ask to become the default app for .docx / .xlsx / .pptx? | |
| U6 | **user + design** — Figma frames for the desktop behaviours: Enregistrer vs Exporter, unsaved marker on a paper, « Le fichier a changé sur le disque », update prompt, native menu. | AGENTS.md: behaviour follows the spec. Until the frames exist, D-3 follows this plan and says where it guessed. |

## D-0 · Spike and webview matrix (gate) — M, ~2–3 days

`apps/desktop` (npm workspace `@oel/desktop`) with Tauri 2:
- `tauri.conf.json`: `build.frontendDist: ../web/dist`, `devUrl: http://localhost:4321/bureau`,
  `beforeBuildCommand` = the root build with `PUBLIC_PLATFORM=desktop PUBLIC_EDITION=solo`. Start page `/bureau`
  (check that Tauri resolves `bureau/index.html`).
- Window: `dragDropEnabled: false`. Tauri's drop handler otherwise swallows HTML5 file drops, and the desk's
  drag-to-import would stop working on Windows. Keep the window size and position (`window-state`).
- Scripts: `npm run dev:desktop`, `npm run build:desktop`.

Run the demo desk on **Linux (WebKitGTK)**, **Windows (WebView2)** and **macOS (WKWebView)**. Linux runs on the dev
machine. Windows and macOS run from CI artifacts on a borrowed machine or VM, or by a beta user (see U1 for unsigned
macOS). Record the matrix in this plan:

| Check | Why it can break |
|---|---|
| WASM loads in each worker (MIME `application/wasm` from the custom protocol, `instantiateStreaming`) | Custom protocol headers |
| Module workers, `OffscreenCanvas`, image GPU path (`webgpu` → `webgl2` → `cpu`) | WebKitGTK has no WebGPU. Older WKWebView has no WebGL in workers |
| Fonts of opened files (`@oel/fonts` `fetch` + `FileReader`) | `fetch` on the custom scheme |
| IndexedDB persists across app restarts; storage estimate | Quotas and data folders differ per webview |
| `oel-lang` cookie persists | Cookies on `tauri://localhost` (macOS / Linux) aren't reliable |
| `<a download>` / blob downloads | Do nothing in WKWebView and WebKitGTK, so every download needs the seam (D-1) |
| `<input type=file>`, drag-and-drop import, clipboard (12 `navigator.clipboard` sites) | Permissions and prompts differ |
| Tiptap editing with an IME, the sheets canvas grid, slides, retouching | Differences between engines |
| Mac shortcuts: Cmd+C/V/Z need an Edit menu. Cmd+Q/W/H/M belong to the OS | WKWebView only copies and pastes through the menu |
| Startup time and memory with the demo desk | — |

Known Linux issue to try first if the window is blank or flickers: the WebKitGTK DMA-BUF renderer on NVIDIA
(`WEBKIT_DISABLE_DMABUF_RENDERER=1`).

**Gate:** each webview opens, edits and exports the three demo files and keeps the desk across a restart.
Otherwise, list what failed and decide with the user before D-1.

## D-1 · Platform seam — M, ~2–3 days

Restructure Phase 4, limited to what the app needs. `packages/platform` (`@oel/platform`), React-free:

```ts
export interface FileAccess {
  /** Ask for files to open. `path` is set only where the platform has real paths (desktop). */
  open(opts: { accept: string[]; multiple?: boolean }): Promise<{ name: string; bytes: Uint8Array; path?: string }[]>;
  /** Save a copy (« Exporter », « Télécharger »): web downloads, desktop shows a save dialog. */
  saveAs(name: string, data: Blob | Uint8Array, mime: string): Promise<{ path?: string } | null>;
  /** Write back to a known path (desktop only; web: undefined). */
  save?(path: string, data: Uint8Array): Promise<void>;
}
export interface Platform {
  files: FileAccess;
  prefs: { get(key: string): string | null; set(key: string, value: string): void }; // language, etc.
  openExternal(url: string): void;
  kind: 'web' | 'desktop';
}
```

- `web` implementation: today's code, moved without changing behaviour.
- Route every download and picker through it, in the packages and in `apps/web`. Editors get the platform as a
  prop or context, the same way as `collab`. They never import `@oel/platform/desktop`.
- Language: `lang.ts` reads and writes through `prefs`. The `Base.astro` head script also checks `localStorage`, so
  the page loads in the right language without the cookie.
- Engine transport and `OfflineStore` stay as they are in v1 (D1, D2). `device.ts` remains the storage seam.
- Guard test (vitest that greps the sources): no `URL.createObjectURL` + `download`, no `<input type=file>` handling,
  no `document.cookie` outside `@oel/platform/web` and `lang.ts`.
- Done when the web build behaves exactly as before (oel-verify, both editions) and the guard passes.

## D-2 · Desktop shell — M, ~3 days

- `@oel/platform/desktop` uses the Tauri plugins `dialog`, `fs` and `opener`. Its `saveAs` opens the native save
  dialog and writes the file.
- **Closing the window must not lose the last gesture.** `persist.ts` saves 400 ms after a change, and on `pagehide`
  or when the tab is hidden. A native close may fire neither. Handle `CloseRequested`: tell the front end to flush,
  wait for the desk and the open sessions to say they're written (with a timeout), then close. Test it on all three
  OSes; it's T1-1 for the app.
- Native menu in both languages, rebuilt when the language changes: Fichier (Ouvrir…, Enregistrer, Exporter…,
  Fermer), Édition (required on macOS), Affichage, Aide. Shortcuts follow `bureau/shortcuts.ts`. Add `Mod`
  wherever the Bureau assumes Ctrl. Per the title bar design, Windows and Linux show no menu bar: the logo in the
  title bar opens the Bureau menu (M2), and the native menu only provides the shortcuts.
- **Title bar (decided 24 Oct 2026):** Figma, page « Editor — Behaviors », section « P · Application de bureau —
  barre de titre » (components `Desktop/Title bar` and `Desktop/Window button`). The app draws its own 40 px bar
  in kit colours on all three OSes. A native Tauri primitive comes before a drawn one:
  - macOS: `titleBarStyle: Overlay` with the title hidden, so the native traffic lights sit inside our bar.
  - Windows and Linux: `decorations: false`, with the Windows 10 layout (logo and title on the left; Minimize,
    Maximize, Close on the right) drawn as embossed kit buttons. On Windows, keep Snap Layouts on Maximize (native
    hit-test), the shadow and the system menu. On Linux, our bar always: no system-bar setting, and resizing goes
    through `startResizeDragging`.

  Empty areas use `data-tauri-drag-region`. The title shows Bureau › open file, with a dot for unsaved changes.
  Nothing else sits on the right. The window-button glyphs mimic Windows rather than Iconoir, as decided. Merging
  the editor row into the title bar (P5) is design only for now: see the backlog.
- `single-instance`: opening a file while the app is already running sends it to the open window.
- Links outside the app (GitHub, the site's home) open in the system browser through `openExternal`. `/docs` stays
  inside the app (it's bundled, so it works offline).
- Security: a strict CSP (`script-src 'self' 'wasm-unsafe-eval'`, `connect-src` for the custom protocol only).
  Capabilities limited to dialog, `fs` on the paths the dialogs grant plus the app data folder, opener, updater. No
  shell. DevTools only in debug builds.
- Analytics module swapped for a no-op (D8). Welcome text: no « mesure d'audience » paragraph in the app.

## D-3 · Real files on disk — L, ~4–5 days (needs U5, U6)

- `PaperData.sourcePath?: string`. It persists, so it stays in `storedPaper`. Set it when the file comes from the
  desktop `open`, from a drop that carries a path (Tauri drag-drop event), or from « Ouvrir avec ».
- **« Enregistrer » (Ctrl/Cmd+S)** on a paper with a path:
  1. Export through the kind's existing export.
  2. Compare the file on disk with the hash and modification time recorded at open or at the last save. If it
     changed, show « Le fichier a changé sur le disque » with Remplacer / Enregistrer sous… / Annuler.
  3. Copy the previous bytes to `appData/saves/<hash of path>/` and keep the last 5 (D4).
  4. Write to a temporary file in the same folder, then rename it over the original (atomic on all three OSes).
- Papers with no path: « Enregistrer » acts as « Enregistrer sous… », and the paper takes the new path.
- A paper with changes not yet written to its file gets a marker (design needed, U6). Closing the app with such
  papers is fine: the desk keeps everything, as in the browser. The marker tells people their file on disk is
  behind.
- File associations (`bundle.fileAssociations`) for `.docx .xlsx .pptx .csv`, and images if U5 says so. On macOS
  the file arrives through `RunEvent::Opened`; on Windows and Linux through argv and `single-instance`. The file is
  imported onto the desk through `importInto`. A path already on the desk focuses that paper rather than importing
  it twice.
- « Récents » in the « Ouvrir et importer » pane (paths that still exist).
- Tests: vitest for the save decision logic (path known, file changed, write refused), and a Rust unit test for the
  atomic write and the rotation of old copies.
- **Before turning on overwrite for everyone:** T1-4 and T1-12 done. Until then the first beta ships with the
  overwrite behind a setting, « Enregistrer remplace le fichier d'origine », off by default.

## D-4 · Desk safety — S, ~1–2 days

- Automatic desk backup: the `backup.ts` zip, written to `appData/backups/` at startup if the last one is older than
  a day, and before « Réinitialiser la démo », « Vider le bureau » or « Importer un bureau ». Keep 7 daily and
  4 weekly.
- « Ce bureau » pane: « Ouvrir le dossier des sauvegardes », « Restaurer une sauvegarde… » (same path as « Importer
  un bureau »).
- Move from the browser: « Exporter le bureau (.zip) » on the site, then « Importer un bureau » in the app. Write it
  up in `/docs` as « Passer à l'application ».

## D-5 · Webview fixes and verification — M–L, depends on D-0

- Fix what the D-0 matrix found, behind the platform seam or with feature detection. No `if (desktop)` in editors.
- Run the Tier 1 rows that touch the app (T1-1, T1-2, T1-6, T1-9) in each webview and record the results in the
  backlog.
- CI: a Playwright WebKit job over the Bureau's smoke checks, as a cheap stand-in for WKWebView and WebKitGTK. Plus
  `tauri-driver` WebDriver smoke tests on Linux and Windows (it doesn't support macOS, which stays manual).

## D-6 · Packaging, updates, release CI — M, ~3 days (needs U1–U4)

- `.github/workflows/desktop.yml` on tags `desktop-v*`, using `tauri-action` with a matrix:
  - Windows x64: NSIS `.exe` + `.msi`. WebView2 is installed by a bootstrapper if missing.
  - macOS: universal `.dmg`, notarised if U1.
  - Linux x64: `.AppImage`, `.deb`, `.rpm`, built on the oldest supported distro image so glibc stays compatible.
  - Rust toolchain pinned as in T0-7.
- `updater` plugin: signed updates (keep the private key in CI secrets, never in the repo) and a manifest on GitHub
  Releases (U2). Check at startup and once a day; ask before installing, never install mid-edit. Linux packages from
  .deb or .rpm say « Une mise à jour est disponible » and link to the download, since only the AppImage can update
  itself.
- Version: the app has its own semver (`apps/desktop/package.json` = `tauri.conf.json`), shown in Aide and in the
  diagnostic info.
- Site: a « Télécharger » page in fr and en (`/telecharger`, `/en/download`) that detects the visitor's OS, with
  unsigned-build instructions while U1 is open. Home call to action « Installer l'application ».
- `THIRD_PARTY.md`: Tauri and its plugins, WebView2 redistributable notice.

## D-7 · Beta, then later

- **Closed beta** with the 10 users who asked, on all three OSes. Unsigned builds are acceptable here (U1). Collect
  feedback by email or a GitHub issue template « Application » that asks for the diagnostic info. Fix, then go
  public once signed.
- **Later (separate decisions, not in v1):**
  - Native engines over `invoke` (restructure Phase 7), only where D-0 / beta measurements show the webview is too
    slow. The strongest case: `oel-img` on Linux, where WebKitGTK has no WebGPU.
  - A desk kept as a folder on disk (files are the source of truth, the Y.Doc a cache): the step after D-3.
  - Team edition in the app (`equipe` against a public server; Tier 2 first).
  - Mobile (Tauri iOS / Android): wait for the touch plan (T1-10).

## Order and size

D-0 (gate) → D-1 → D-2 → D-3 and D-4 in parallel → D-5 → D-6 → beta. That's about 4 to 5 weeks of focused work for
one person, more if D-0 turns up webview problems. D-5 is the uncertain part. A first unsigned build for the beta
users is possible after D-2 + D-4 + D-6 (about 2.5 weeks), with D-3's overwrite turned off.

Skills to update as phases land: `oel-architecture` (Shells row, platform seam), `oel-editor-feature` (use
`@oel/platform` for files), `oel-file-kind` (`sourcePath`, save), `oel-verify` (desktop checks per OS), AGENTS.md
(commands).

## Status

- 2026-10-24: plan written. U3 decided (`ca.outilsenligne.bureau`). CSP stays off in D-0 and is set in D-2.
- D-0 in progress (branch `desktop/d0`): `apps/desktop` (Tauri 2.12.4, own Cargo workspace), `scripts/probe.mjs`
  (WebDriver probe through `tauri-driver`), `.github/workflows/desktop.yml` (unsigned test builds, by hand; not run
  yet). Release build on Fedora 44: `.deb` / `.rpm` 8.7 MB, AppImage 115 MB (carries WebKitGTK), about 2 min.

### D-0 matrix

| Check | Linux · WebKitGTK 2.54.1 (Fedora 44, Wayland) | Windows · WebView2 | macOS · WKWebView |
|---|---|---|---|
| Demo desk seeded: 4 files imported by the WASM engines, thumbnails, chart, both live links | ✅ | | |
| WASM served (`application/wasm`, `compileStreaming` works) | ✅ | | |
| Routes `/bureau`, `/bureau/`, `/docs/bureau`, `/en/docs` (directory `index.html` resolved) | ✅ | | |
| Origin, secure context | `tauri://localhost`, secure | | |
| IndexedDB and localStorage survive a restart (same desk, no reseed) | ✅ (`~/.local/share/ca.outilsenligne.bureau`) | | |
| `oel-lang` cookie | ❌ not kept, not even read back in the same page: choosing English would not stick | | |
| `navigator.storage` (estimate, persist) | ❌ absent. Calls are already guarded (`restore.ts`), so « Ce bureau » shows no size and nothing breaks | | |
| WebGPU | ❌ absent (main thread and workers) | | |
| WebGL2: page canvas / OffscreenCanvas on the page / OffscreenCanvas in a worker | ✅ / ✅ / ❌ | | |
| Image retouching | ✅ on the CPU path, with the honest « Aperçu ralenti : processeur graphique indisponible » | | |
| Clipboard API (`read`, `write`) | present; prompts not checked | | |
| File System Access API | absent (as expected; D-1 / D-2 use native dialogs) | | |
| Exports (`<a download>` of a blob) | ❌ nothing happens (by hand, 2026-10-24). « PDF » works: it goes through the print dialog | | |
| Dropping files from the file manager onto the desk (`dragDropEnabled: false`, HTML5 drop) | ❌ nothing happens (by hand) | | |
| Accented letters typed in a document (dead keys) | ✅ first round (by hand) | | |
| File input, internal HTML5 drags (sheet tab reorder, pictures in a document), Mac shortcuts | to check by hand | | |

Linux results feeding later phases:
- D-1: the language goes through `prefs` (localStorage), not the cookie. Required, not optional.
- D-1 / D-2: every export needs the native save dialog. Confirmed broken today, not only expected.
- D-2: file drops. HTML5 drags are also used inside the editors (sheet tabs, Tiptap), and Tauri's own drop handler
  blocks those only on Windows. So: Tauri drop events (with real paths, which D-3 wants) on Linux and macOS, the
  HTML drop on Windows. The window is then created in Rust per platform instead of in `tauri.conf.json`.
- D-2 / D-4: storage size comes from the app (size of the data folder), since `navigator.storage` is missing.
- D-5 / D-7: on Linux the image engine runs on the CPU, because WebGL2 exists only outside workers. Options: render
  on a page canvas when the worker has no GL, or native `oel-img` (D-7). Measure on a large photo first.
- **Gate, Linux: passed.** Windows and macOS need the CI builds on real machines.
- D-1 in progress (2026-10-24):
  - Language kept in localStorage as well as the cookie (`lang.ts`, `Base.astro`).
  - `@oel/platform` with `saveFile` (web: download link; app: native save dialog + `fs` write, scoped to the path the
    dialog returns). Every download goes through it; guard test `packages/platform/test/guard.test.ts`.
  - Changed from the sketch above: no `prefs` (localStorage is enough for the language) and no `open` yet. File
    pickers stay `<input type=file>` until D-3, which needs real paths; they already work in the app.
  - The desktop save dialog is the first piece of D-2 (Rust: `dialog` and `fs` plugins, permissions
    `dialog:allow-save` + `fs:allow-write-file` only).
