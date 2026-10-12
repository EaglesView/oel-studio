/**
 * Every chart of the fixtures goes through the real codecs (WASM, node
 * build) and the renderer: it must lay out without falling back to the
 * error label. Set CHART_SVG_DIR to also write each chart as an SVG file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellResolver, renderChart, toSVG, type ChartSpec, type Resolver } from '../src';

const require = createRequire(import.meta.url);
const root = join(__dirname, '../../../fixtures');
const out = process.env.CHART_SVG_DIR;
if (out) mkdirSync(out, { recursive: true });

function check(name: string, spec: ChartSpec, resolve?: Resolver, w = 640, h = 400) {
  const scene = renderChart(spec, { width: w, height: h, resolve });
  const texts = scene.marks.filter((m) => m.t === 'text').map((m) => (m.t === 'text' ? m.text : ''));
  expect(texts, name).not.toContain('Graphique non affiché');
  expect(scene.marks.length, name).toBeGreaterThan(5);
  if (out) writeFileSync(join(out, `${name.replace(/[^\w.-]+/g, '_')}.svg`), toSVG(scene));
  return scene;
}

describe('fixture charts render', () => {
  it('pptx charts (python-pptx, every 2-D type)', () => {
    const codec = require('oelpptx-node') as { pptx_to_deck(b: Uint8Array): { json: string } };
    const deck = JSON.parse(codec.pptx_to_deck(readFileSync(join(root, 'charts/generated-charts.pptx'))).json);
    let n = 0;
    for (const [i, slide] of deck.slides.entries()) {
      for (const el of slide.elements) {
        if (!el.chart) continue;
        const title = slide.elements.find((e: { text?: { paras: { runs: { text: string }[] }[] } }) => e.text)?.text?.paras?.[0]?.runs?.[0]?.text ?? `slide${i}`;
        check(`pptx-${String(i + 1).padStart(2, '0')}-${title}`, el.chart);
        n++;
      }
    }
    expect(n).toBe(29);
  });

  it('xlsx charts (openpyxl, 3-D, stock, surface, radar…)', () => {
    const codec = require('oelxlsx-node') as { xlsx_to_model(b: Uint8Array): string };
    for (const file of ['charts/generated-charts.xlsx', 'xlsx/complex_sheet_graph.xlsx', 'xlsx/rich.xlsx']) {
      const wb = JSON.parse(codec.xlsx_to_model(readFileSync(join(root, file))));
      type Cell = { r: number; c: number; v?: unknown };
      const cell = (sheet: string | null, r: number, c: number, own: string) => (wb.sheets.find((s: { name: string }) => s.name === (sheet ?? own))?.cells as Cell[] | undefined)?.find((x) => x.r === r && x.c === c);
      for (const sheet of wb.sheets) {
        const resolve = cellResolver({
          num: (s, r, c) => (typeof cell(s, r, c, sheet.name)?.v === 'number' ? (cell(s, r, c, sheet.name)!.v as number) : null),
          text: (s, r, c) => (cell(s, r, c, sheet.name)?.v != null ? String(cell(s, r, c, sheet.name)!.v) : null),
        });
        for (const d of sheet.drawings ?? []) {
          if (!d.chart) continue;
          check(`xlsx-${file.split('/')[1]!.replace('.xlsx', '')}-${sheet.name}`, d.chart, resolve);
        }
      }
    }
  });

  it('docx charts', () => {
    const codec = require('oeldocx-node') as { docx_to_pm(b: Uint8Array): { json: string } | string };
    const r = codec.docx_to_pm(readFileSync(join(root, 'charts/generated-charts.docx')));
    const json = JSON.parse(typeof r === 'string' ? r : r.json);
    const found: ChartSpec[] = [];
    const walk = (n: { type?: string; attrs?: { chart?: ChartSpec }; content?: unknown[] }) => {
      if (n.attrs?.chart) found.push(n.attrs.chart);
      for (const c of (n.content ?? []) as (typeof n)[]) walk(c);
    };
    walk(json.doc);
    expect(found.length).toBe(3);
    found.forEach((c, i) => check(`docx-${i + 1}`, c));
  });
});
