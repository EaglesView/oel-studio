import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docsSchema } from '../src/extensions';
import {
  BODY_SECTION,
  DEFAULT_SETTINGS,
  defaultSection,
  effectiveStory,
  formatPageNumber,
  frameOf,
  makePage,
  pageKind,
  pageNumbers,
  sectionBreaks,
  sectionOrder,
  sectionsPhrase,
  sectionsUsingStory,
} from '../src/model/sections';
import { DocFormatError, FORMAT_VERSION, assertFormat, exportJsonFromYDoc, meta, sectionsMap, seedYDoc } from '../src/model/ydoc';
import type { DocxJson, Section } from '../src/model/types';

const require = createRequire(import.meta.url);
const codec = require('oeldocx-node') as {
  docx_to_pm(b: Uint8Array): { json: string };
  pm_to_docx(json: string, original: Uint8Array | null, media: unknown[]): Uint8Array;
};
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/docx/${name}`, import.meta.url)));
const load = (b: Uint8Array) => JSON.parse(codec.docx_to_pm(b).json) as DocxJson;

const section = (id: string, patch: Partial<Section> = {}): Section => ({ ...defaultSection(id), ...patch });

describe('page numbers', () => {
  it('formats like Word', () => {
    expect(formatPageNumber(4, 'lowerRoman')).toBe('iv');
    expect(formatPageNumber(14, 'upperRoman')).toBe('XIV');
    expect(formatPageNumber(1999, 'lowerRoman')).toBe('mcmxcix');
    expect(formatPageNumber(3, 'lowerLetter')).toBe('c');
    expect(formatPageNumber(28, 'upperLetter')).toBe('BB');
    expect(formatPageNumber(7, 'decimalZero')).toBe('07');
    expect(formatPageNumber(5, 'numberInDash')).toBe('- 5 -');
    expect(formatPageNumber(12, 'decimal')).toBe('12');
    expect(formatPageNumber(12, 'chicago')).toBe('12');
  });

  it('restarts where a section says so, else continues', () => {
    const sections = [section('s1', { pgNum: { fmt: 'lowerRoman', start: 1 } }), section('s2', { pgNum: { fmt: 'decimal', start: 1 } }), section(BODY_SECTION)];
    const pages = [
      { section: 0, indexInSection: 0 },
      { section: 0, indexInSection: 1 },
      { section: 1, indexInSection: 0 },
      { section: 1, indexInSection: 1 },
      { section: 2, indexInSection: 0 },
    ];
    expect(pageNumbers(pages, sections)).toEqual([1, 2, 1, 2, 3]);
  });
});

describe('header/footer inheritance', () => {
  // sections-headers.docx: s1 owns default/first/even headers and a footer; s2 nothing; body its own footer.
  const sections = [
    section('s1', { titlePg: true, headers: { default: 'h1', first: 'h2', even: 'h3' }, footers: { default: 'f1' } }),
    section('s2'),
    section(BODY_SECTION, { footers: { default: 'f2' } }),
  ];
  const settings = { ...DEFAULT_SETTINGS, evenAndOddHeaders: true };

  it('picks the slot by page', () => {
    expect(pageKind(0, 1, sections[0]!, settings)).toBe('first');
    expect(pageKind(1, 2, sections[0]!, settings)).toBe('even');
    expect(pageKind(2, 3, sections[0]!, settings)).toBe('default');
    expect(pageKind(1, 2, sections[0]!, DEFAULT_SETTINGS)).toBe('default');
    expect(pageKind(0, 1, sections[1]!, settings)).toBe('default');
  });

  it('inherits from earlier sections, slot by slot', () => {
    expect(effectiveStory(sections, 1, 'header', 'default')).toBe('h1');
    expect(effectiveStory(sections, 1, 'header', 'even')).toBe('h3');
    expect(effectiveStory(sections, 2, 'footer', 'default')).toBe('f2');
    expect(effectiveStory(sections, 2, 'footer', 'even')).toBeNull();
    expect(effectiveStory([section('a')], 0, 'header', 'default')).toBeNull();
  });

  it('knows who shares a story', () => {
    expect(sectionsUsingStory(sections, 'h1')).toEqual([0, 1, 2]);
    expect(sectionsUsingStory(sections, 'f1')).toEqual([0, 1]);
    expect(sectionsPhrase([2, 3, 4])).toBe('les sections 3 à 5');
    expect(sectionsPhrase([1, 3])).toBe('les sections 2 et 4');
    expect(sectionsPhrase([0])).toBe('la section 1');
  });
});

describe('section order', () => {
  it('follows the breaks in the body, then the body section', () => {
    const byId = new Map([
      ['b', section('b')],
      ['a', section('a')],
      [BODY_SECTION, section(BODY_SECTION)],
      ['orphan', section('orphan')],
    ]);
    const doc = {
      content: [
        { type: 'paragraph', attrs: { section: 'a' } },
        { type: 'sdtBlock', content: [{ type: 'paragraph', attrs: { section: 'b' } }] },
        { type: 'paragraph', attrs: { section: 'b' } },
        { type: 'paragraph', attrs: { section: 'ghost' } },
      ],
    };
    expect(sectionBreaks(doc)).toEqual(['a', 'b', 'b', 'ghost']);
    expect(sectionOrder(sectionBreaks(doc), byId).map((s) => s.id)).toEqual(['a', 'b', BODY_SECTION]);
  });
});

describe('geometry', () => {
  it('centres narrower sheets and insets narrower text columns', () => {
    const cover = section('s1', { page: { ...defaultSection().page, left: 720, right: 720 } });
    const chapter = section(BODY_SECTION, { page: { ...defaultSection().page, left: 2880, right: 720 } });
    const f = frameOf([cover, chapter]);
    expect(f.width).toBe(816);
    expect(f.textLeft).toBe(48);
    expect(f.textWidth).toBe(720);
    expect(f.insetLeft).toEqual([0, 144]);
    expect(f.insetRight).toEqual([0, 0]);
  });

  it('gives each sheet its own size, landscape ones wide', () => {
    const portrait = section('s1');
    const landscape = section(BODY_SECTION, { page: { ...defaultSection().page, width: 15840, height: 12240, orient: 'landscape' } });
    const sections = [portrait, landscape];
    const f = frameOf(sections);
    expect(f.width).toBe(1056);
    const p0 = makePage(sections, f, 0, null, 24);
    const p1 = makePage(sections, f, 1, p0, 24);
    expect(p0).toMatchObject({ width: 816, height: 1056, sheetLeft: 120, top: 0, number: 1, label: '1' });
    expect(p1).toMatchObject({ width: 1056, height: 816, sheetLeft: 0, top: 1080, number: 2, indexInSection: 0 });
    // Portrait text column (1" margins) sits inside the landscape one: inset by the centring offset.
    expect(f.insetLeft).toEqual([120, 0]);
  });
});

describe('Y.Doc format 2', () => {
  const schema = docsSchema();

  it('stores sections and stories by id, and exports them', () => {
    const original = fixture('complex_template.docx');
    const j = load(original);
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, j, schema);
    expect(meta(ydoc).get('formatVersion')).toBe(FORMAT_VERSION);
    expect([...sectionsMap(ydoc).keys()].sort()).toEqual(['body', 's1', 's2', 's3', 's4']);
    const out = exportJsonFromYDoc(ydoc);
    expect(out.sections.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 'body']);
    expect(out.sections[1]!.footers).toEqual({ default: 'footer13', first: 'footer22' });
    expect(out.stories.footer13?.part).toBe('word/footer13.xml');
    const back = load(codec.pm_to_docx(JSON.stringify(out), original, []));
    expect(back.sections).toEqual(j.sections);
    expect(back.doc).toEqual(j.doc);
  });

  it('drops a deleted break: its text joins the next section', () => {
    const original = fixture('sections-margins.docx');
    const j = load(original);
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, { ...j, doc: { ...j.doc, content: j.doc.content.map((n) => (n.attrs?.section === 's1' ? { ...n, attrs: { ...n.attrs, section: null } } : n)) } }, schema);
    const out = exportJsonFromYDoc(ydoc);
    expect(out.sections.map((s) => s.id)).toEqual(['s2', 'body']);
  });

  it('refuses documents of another layout version', () => {
    const ydoc = new Y.Doc();
    meta(ydoc).set('seeded', true);
    meta(ydoc).set('formatVersion', 1);
    expect(() => assertFormat(ydoc)).toThrow(DocFormatError);
    expect(() => assertFormat(ydoc)).toThrow(/Importez de nouveau le fichier \.docx/);
    expect(() => assertFormat(new Y.Doc())).not.toThrow();
  });
});
