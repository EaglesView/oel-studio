#!/usr/bin/env bash
# Build the static site (home, docs, /bureau) on a host that has Node but maybe not Rust — e.g. the
# DigitalOcean App Platform image (.do/site.Dockerfile, .do/app.yaml). Run after `npm ci`; adds Rust + the
# wasm32 target when missing, builds only the browser WASM targets, then the site into apps/web/dist.
set -euo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "▸ Installing Rust (minimal profile, wasm32 target)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
elif command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-unknown-unknown
fi
# A system Rust without rustup (distribution packages) must already have the wasm32 standard library.

export WASM_TARGETS=web
node scripts/build-wasm.mjs
npm run build -w @oel/web
