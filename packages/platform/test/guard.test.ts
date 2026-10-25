import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'test' ? [] : sources(p);
    return /\.(ts|tsx|astro)$/.test(e.name) ? [p] : [];
  });
}

describe('platform seam guard', () => {
  it('only @oel/platform saves files by clicking a download link', () => {
    // A download link does nothing in the desktop app's webviews (plan 2026-10-desktop, D-0):
    // call `saveFile` from @oel/platform instead.
    const dirs = [join(root, 'apps/web/src'), ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'src'))];
    const offenders = dirs
      .flatMap((d) => { try { return sources(d); } catch { return []; } })
      .filter((f) => !f.includes(join('packages', 'platform')))
      .filter((f) => /\.download\s*=|\bdownload:\s*\w|<a[^>]*\sdownload[\s=>]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
