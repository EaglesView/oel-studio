# Security

## Reporting a vulnerability

Please report security issues privately, through GitHub's « Report a vulnerability » (the repository's Security tab),
not in public issues. Say what is affected, how to reproduce it, and what an attacker could do. We will acknowledge the
report, keep you informed, and credit you if you wish.

## Scope

- **The single-user Bureau** runs entirely in the browser: files are parsed by WebAssembly engines in a Web Worker
  and stored in the browser's IndexedDB. Issues of interest include crafted Office files or images that crash the
  engines, escape their sandbox, or inject script or styles into the page (for example through document styles,
  links or embedded content).
- **The team edition** (`apps/collab`, not deployed yet) adds a server: share tokens, access control, uploads and
  exports are in scope once it is.
