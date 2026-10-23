# Contributing

Thank you for helping. The Bureau is young; issues and small, focused pull requests are the best way in.

## Before you start

- Read [`AGENTS.md`](AGENTS.md): commands, conventions and where each kind of change goes. It is written for people
  as much as for AI agents.
- For anything larger than a fix, open an issue first to agree on the approach. Behaviour follows the Figma specs
  (« Editor — Behaviors »); a change that departs from them needs a word about why.

## Setting up

```bash
rustup target add wasm32-unknown-unknown
npm install
npm run dev     # http://localhost:4321/bureau
npm test
```

## Making a change

- One concern per pull request, split into commits that each build and pass tests (see AGENTS.md « Git » for the
  message format).
- A codec change comes with a round-trip test on a fixture; a UI change with a vitest test where the logic allows, and
  a note of what you checked in the browser.
- Interface text is French (fr-CA): write it in French, or leave an English placeholder and say so in the pull
  request. Site and docs text (`apps/web/src/site/`) needs both French and English.
- Accessibility is part of done: every pointer gesture has a keyboard path, every tool a label, nothing relies on
  colour alone.
- Before opening the pull request: `npm test`, `npm run typecheck`, `npm run build`. CI runs the same checks on
  every pull request (`.github/workflows/ci.yml`); a red run needs fixing before review.

## Licence

By contributing, you agree that your contribution is licensed under the [MPL-2.0](LICENSE), like the rest of the
repository.
