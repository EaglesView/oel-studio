#!/usr/bin/env node
/**
 * Reference renders for page-fidelity checks: LibreOffice turns each .docx into
 * a PDF, `pdftoppm` turns the PDF into one PNG per page, under
 * `fixtures/reference/<name>/page-<n>.png` (git-ignored).
 *
 *   node scripts/render-reference.mjs fixtures/docx/complex_template.docx [more.docx…]
 *   node scripts/render-reference.mjs --all        # every fixtures/docx/*.docx
 *
 * Needs `soffice` and `pdftoppm` (poppler) on the PATH.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outRoot = join(root, 'fixtures', 'reference');
const dpi = process.env.REFERENCE_DPI ?? '72';

let files = process.argv.slice(2);
if (files.includes('--all')) {
  const dir = join(root, 'fixtures', 'docx');
  files = readdirSync(dir).filter((f) => f.endsWith('.docx')).map((f) => join(dir, f));
}
if (files.length === 0) {
  console.error('usage: render-reference.mjs <file.docx>… | --all');
  process.exit(2);
}

for (const tool of ['soffice', 'pdftoppm']) {
  if (spawnSync(tool, ['--version'], { stdio: 'ignore' }).error) {
    console.error(`${tool} introuvable : installez LibreOffice et poppler-utils.`);
    process.exit(1);
  }
}

const work = mkdtempSync(join(tmpdir(), 'oel-reference-'));
let failed = 0;
for (const file of files.map((f) => resolve(f))) {
  const name = basename(file, '.docx');
  const r = spawnSync(
    'soffice',
    ['--headless', `-env:UserInstallation=file://${join(work, 'profile')}`, '--convert-to', 'pdf', '--outdir', work, file],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const pdf = join(work, `${name}.pdf`);
  if (r.status !== 0 || !existsSync(pdf)) {
    console.error(`${name}: LibreOffice conversion failed\n${r.stderr}`);
    failed++;
    continue;
  }
  const out = join(outRoot, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const p = spawnSync('pdftoppm', ['-png', '-r', dpi, pdf, join(out, 'page')], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (p.status !== 0) {
    console.error(`${name}: pdftoppm failed\n${p.stderr}`);
    failed++;
    continue;
  }
  const pages = readdirSync(out).filter((f) => f.endsWith('.png')).length;
  console.log(`${name}: ${pages} page(s) → ${out}`);
}
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
