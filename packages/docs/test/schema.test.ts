import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docsSchema } from '../src/extensions';
import { exportJsonFromYDoc, plainText, seedYDoc } from '../src/model/ydoc';
import { toPreview } from '../src/model/preview';
import type { DocxJson } from '../src/model/types';
import { CODEC_VOCABULARY } from '@oel/engine/generated/oeldocx';

const require = createRequire(import.meta.url);
const codec = require('oeldocx-node') as {
  docx_to_pm(b: Uint8Array): { json: string; media: Array<{ path: string; mime: string; bytes: Uint8Array }> };
  new_document_pm(): { json: string };
  pm_to_docx(json: string, original: Uint8Array | null, media: unknown[]): Uint8Array;
};
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/docx/${name}`, import.meta.url)));
const studioFixture = readFileSync(fileURLToPath(new URL('../../../fixtures/docx/tesxte.docx', import.meta.url)));

const schema = docsSchema();
const load = (bytes: Uint8Array) => JSON.parse(codec.docx_to_pm(bytes).json) as DocxJson;

describe('codec JSON fits the editor schema', () => {
  for (const [name, bytes] of [
    ['tesxte.docx', studioFixture],
    ['rich.docx', fixture('rich.docx')],
    ['basic_text.docx', fixture('basic_text.docx')],
  ] as const) {
    it(name, () => {
      const j = load(bytes);
      const doc = schema.nodeFromJSON(j.doc);
      doc.check();
      for (const kind of ['footnote', 'endnote'] as const) for (const n of Object.values(j.notes[kind])) schema.nodeFromJSON(n).check();
      for (const s of Object.values(j.stories)) schema.nodeFromJSON(s!.doc).check();
    });
  }

  it('new document', () => {
    const j = JSON.parse(codec.new_document_pm().json) as DocxJson;
    schema.nodeFromJSON(j.doc).check();
    expect(j.styles.some((s) => s.role === 'heading1')).toBe(true);
  });
});

/**
 * Editor-side differences from the codec vocabulary (`crates/oel-docx/src/contract.rs`),
 * each with its reason. Anything else that differs fails the test.
 */
const EDITOR_ONLY = {
  /** Header cells are written exactly like `tableCell` (the writer walks row content). */
  nodes: { tableHeader: 'tableCell' } as Record<string, string>,
  attrs: {
    tableCell: ['align'], // Tiptap's own cell attr; Word alignment lives in the paragraphs.
    tableHeader: ['align'],
    link: ['target', 'rel', 'class', 'title'], // render-only; the codec keeps href.
  } as Record<string, string[]>,
};

describe('Tiptap schema ↔ codec vocabulary', () => {
  const editor = {
    nodes: Object.fromEntries(Object.entries(schema.nodes).map(([n, t]) => [n, Object.keys(t.spec.attrs ?? {})])),
    marks: Object.fromEntries(Object.entries(schema.marks).map(([n, t]) => [n, Object.keys(t.spec.attrs ?? {})])),
  };
  const codecName = (n: string) => EDITOR_ONLY.nodes[n] ?? n;

  for (const kind of ['nodes', 'marks'] as const) {
    it(`every editor ${kind.slice(0, -1)} has a codec counterpart with the same attrs`, () => {
      for (const [name, attrs] of Object.entries(editor[kind])) {
        const codec = CODEC_VOCABULARY[kind][kind === 'nodes' ? codecName(name) : name];
        expect(codec, `${name} is not in the codec`).toBeDefined();
        const own = attrs.filter((a) => !(EDITOR_ONLY.attrs[name] ?? []).includes(a));
        expect([...own].sort(), name).toEqual([...codec!].sort());
      }
    });

    it(`every codec ${kind.slice(0, -1)} exists in the editor schema`, () => {
      const names = new Set(Object.keys(editor[kind]).map((n) => (kind === 'nodes' ? codecName(n) : n)));
      for (const name of Object.keys(CODEC_VOCABULARY[kind])) expect(names.has(name), `${name} is missing from the Tiptap schema`).toBe(true);
    });
  }
});

describe('Y.Doc layout', () => {
  it('seeds once and exports a docx the codec accepts', () => {
    const original = fixture('rich.docx');
    const j = load(original);
    const ydoc = new Y.Doc();
    expect(seedYDoc(ydoc, j, schema)).toBe(true);
    expect(seedYDoc(ydoc, j, schema)).toBe(false);
    const out = exportJsonFromYDoc(ydoc);
    expect(plainText(out.doc)).toContain('Rapport d’essai');
    expect(Object.keys(out.notes.footnote)).toHaveLength(1);
    const body = out.sections[out.sections.length - 1]!;
    expect(out.stories[body.headers.default!]?.part).toBe('word/header1.xml');
    const bytes = codec.pm_to_docx(JSON.stringify(out), original, []);
    const back = load(bytes);
    expect(back.doc).toEqual(j.doc);
    expect(back.notes).toEqual(j.notes);
  });

  it('survives a Yjs sync between two peers', () => {
    const a = new Y.Doc();
    seedYDoc(a, load(studioFixture), schema);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(exportJsonFromYDoc(b).doc).toEqual(exportJsonFromYDoc(a).doc);
  });

  it('builds a desk preview', () => {
    const p = toPreview(load(fixture('rich.docx')).doc);
    expect(p.blocks[0]).toEqual({ type: 'heading', text: 'Rapport d’essai' });
    expect(p.wordCount).toBeGreaterThan(20);
  });
});
