#!/usr/bin/env bash
# Build the static site (home, docs, /bureau) on a host that has Node but maybe not Rust — e.g. the
# DigitalOcean App Platform image (.do/site.Dockerfile, .do/app.yaml). Run after `npm ci`; adds Rust + the
# wasm32 target when missing, builds only the browser WASM targets, then the site into apps/web/dist.
set -euo pipefail

cd "$(dirname "$0")/.."
if ! command -v cargo >/dev/null 2>&1; then
  echo "▸ Installing Rust (the version in rust-toolchain.toml, with its wasm32 target)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
# rustup reads rust-toolchain.toml from here.
if command -v rustup >/dev/null 2>&1; then
  rustup toolchain install
fi
# A system Rust without rustup (distribution packages) must already have the wasm32 standard library.

export WASM_TARGETS=web
node scripts/build-wasm.mjs
npm run build -w @oel/web
