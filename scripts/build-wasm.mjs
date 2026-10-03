#!/usr/bin/env node
/**
 * Builds every crate in `crates/` that has a `wasm` feature into
 * `packages/wasm/<crate>/{web,node}` (web: engine + calc workers; node: collab
 * server and vitest). Module names stay `oeldocx_rs` / `oelxlsx_rs`.
 *
 *   node scripts/build-wasm.mjs           build all
 *   node scripts/build-wasm.mjs --if-stale  skip crates whose outputs are newer than their sources
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ifStale = process.argv.includes('--if-stale');

/** Generated module name per crate (what the JS adapters import). */
const OUT_NAME = { 'oel-docx': 'oeldocx_rs', 'oel-xlsx': 'oelxlsx_rs' };
const TARGETS = [['web', 'web'], ['nodejs', 'node']];

function newest(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(st.mtimeMs, ...readdirSync(path).map((f) => newest(join(path, f))));
}

const crates = readdirSync(join(root, 'crates')).filter((c) =>
  /^\s*wasm\s*=/m.test(readFileSync(join(root, 'crates', c, 'Cargo.toml'), 'utf8')),
);
// A crate is stale if it or any path dependency (oel-opc) changed after its outputs.
const sourcesTime = (c) =>
  Math.max(newest(join(root, 'crates', c)), newest(join(root, 'crates', 'oel-opc')), newest(join(root, 'Cargo.toml')));

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
      ['build', join('crates', c), '--release', '--target', target, '--out-dir', out, '--out-name', outName, '--', '--features', 'wasm'],
      { cwd: root, stdio: 'inherit' },
    );
    if (r.error) console.error(`wasm-pack introuvable : npm install (${r.error.message})`);
    if (r.status !== 0) failed = true;
  }
}
process.exit(failed ? 1 : 0);
