#!/usr/bin/env node
/**
 * Builds every crate in `crates/` that has a `wasm` feature into
 * `packages/wasm/<crate>/{web,node}` (web: engine, calc and image workers; node: collab
 * server and vitest). Module names stay `oeldocx_rs` / `oelxlsx_rs` / `oelpptx_rs` / `oelimg`.
 *
 *   node scripts/build-wasm.mjs           build all
 *   node scripts/build-wasm.mjs --if-stale  skip crates whose outputs are newer than their sources
 *
 * WASM_TARGETS=web builds only the browser targets (what the static site needs; hosting builds use it,
 * see scripts/build-site.sh). Default: web,node.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ifStale = process.argv.includes('--if-stale');

/** Generated module name per crate (what the JS adapters import). */
const OUT_NAME = { 'oel-docx': 'oeldocx_rs', 'oel-xlsx': 'oelxlsx_rs', 'oel-pptx': 'oelpptx_rs', 'oel-img': 'oelimg' };
/** Cargo features per crate and target dir (default: `wasm`). The image engine's GPU view is browser-only. */
const FEATURES = { 'oel-img': { web: 'wasm,gpu', node: 'wasm' } };
const WANTED = (process.env.WASM_TARGETS ?? 'web,node').split(',').map((t) => t.trim());
const TARGETS = [['web', 'web'], ['nodejs', 'node']].filter(([, dir]) => WANTED.includes(dir));

function newest(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(st.mtimeMs, ...readdirSync(path).map((f) => newest(join(path, f))));
}

const crates = readdirSync(join(root, 'crates')).filter((c) =>
  /^\s*wasm\s*=/m.test(readFileSync(join(root, 'crates', c, 'Cargo.toml'), 'utf8')),
);
// A crate is stale if it or any shared path dependency (oel-opc, oel-chart) changed after its outputs.
const SHARED = ['oel-opc', 'oel-chart'];
const sourcesTime = (c) =>
  Math.max(newest(join(root, 'crates', c)), ...SHARED.map((d) => newest(join(root, 'crates', d))), newest(join(root, 'Cargo.toml')));

const wasmPack = join(root, 'node_modules', '.bin', 'wasm-pack');
let failed = false;
for (const c of crates) {
  const outName = OUT_NAME[c] ?? c.replace(/-/g, '_');
  for (const [target, dir] of TARGETS) {
    const out = join(root, 'packages', 'wasm', c, dir);
    const marker = join(out, `${outName}_bg.wasm`);
    if (ifStale && existsSync(marker) && statSync(marker).mtimeMs >= sourcesTime(c)) continue;
    console.log(`\n▸ ${c} → packages/wasm/${c}/${dir}`);
    const r = spawnSync(
      existsSync(wasmPack) ? wasmPack : 'wasm-pack',
      ['build', join('crates', c), '--release', '--target', target, '--out-dir', out, '--out-name', outName, '--', '--features', FEATURES[c]?.[dir] ?? 'wasm'],
      { cwd: root, stdio: 'inherit' },
    );
    if (r.error) console.error(`wasm-pack introuvable : npm install (${r.error.message})`);
    if (r.status !== 0) failed = true;
  }
}
process.exit(failed ? 1 : 0);
