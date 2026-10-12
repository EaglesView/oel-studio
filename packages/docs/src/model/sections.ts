/**
 * Sections, as Word lays them out: order, header/footer inheritance and page
 * numbering. Pure (no DOM, no Yjs): used by the page view, pagination, export
 * and tests.
 *
 * The codec gives each section only its *explicit* header/footer references;
 * Word's rules for what a page actually shows are applied here.
 */
import type { DocSettings, HeaderFooterKind, PageSetup, Section, SectionKind, StorySide } from './types';
import { DEFAULT_PAGE } from './types';
import { tr } from '@oel/i18n';

/** Id of the final section (the body's own `w:sectPr`). */
export const BODY_SECTION = 'body';

export const DEFAULT_SETTINGS: DocSettings = { evenAndOddHeaders: false, defaultTabStop: 720, mirrorMargins: false };

export function defaultSection(id: string = BODY_SECTION, page: PageSetup = DEFAULT_PAGE): Section {
  return {
    id,
    page: { ...page },
    kind: 'nextPage',
    titlePg: false,
    pgNum: { fmt: 'decimal', start: null },
    cols: { num: 1, space: 720, equalWidth: true },
    headers: {},
    footers: {},
    sectPr: null,
  };
}

/** A new section id; random so two people inserting breaks at once never collide. */
export function newSectionId(): string {
  return `s-${Math.random().toString(36).slice(2, 10)}`;
}

/** Section ids named by `section` attrs, in document order (blocks only, not table cells). */
export function sectionBreaks(doc: { content?: Array<{ type: string; attrs?: Record<string, unknown> | null; content?: unknown[] }> }): string[] {
  const out: string[] = [];
  const walk = (nodes: typeof doc.content) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph') {
        const id = n.attrs?.section;
        if (typeof id === 'string') out.push(id);
      } else if (n.type === 'sdtBlock') {
        walk(n.content as typeof doc.content);
      }
    }
  };
  walk(doc.content);
  return out;
}

/**
 * Sections in layout order: one per break in the body (first occurrence; ids
 * without a section record are skipped), then the body section. Sections no
 * break names any more (deleted with their paragraph) are left out.
 */
export function sectionOrder(breaks: string[], byId: ReadonlyMap<string, Section> | Record<string, Section>): Section[] {
  const get = (id: string) => (byId instanceof Map ? byId.get(id) : (byId as Record<string, Section>)[id]);
  const seen = new Set<string>();
  const out: Section[] = [];
  for (const id of breaks) {
    if (id === BODY_SECTION || seen.has(id)) continue;
    const s = get(id);
    if (!s) continue;
    seen.add(id);
    out.push(s);
  }
  out.push(get(BODY_SECTION) ?? defaultSection());
  return out;
}

/** Which header/footer slot a page uses (Word's rules). */
export function pageKind(indexInSection: number, pageNumber: number, section: Section, settings: DocSettings): HeaderFooterKind {
  if (section.titlePg && indexInSection === 0) return 'first';
  if (settings.evenAndOddHeaders && pageNumber % 2 === 0) return 'even';
  return 'default';
}

/**
 * Story shown in a section's slot: its own reference, else the previous
 * section's for the same slot, recursively. `null` = nothing (Word leaves the
 * zone empty: an unset first/even slot does not fall back to the default one).
 */
export function effectiveStory(sections: Section[], i: number, side: StorySide, kind: HeaderFooterKind): string | null {
  for (let k = Math.min(i, sections.length - 1); k >= 0; k--) {
    const refs = side === 'header' ? sections[k]!.headers : sections[k]!.footers;
    const id = refs[kind];
    if (id) return id;
  }
  return null;
}

/** The section whose reference `effectiveStory` used (for « Lier au précédent »), or null. */
export function storyOwner(sections: Section[], i: number, side: StorySide, kind: HeaderFooterKind): number | null {
  for (let k = Math.min(i, sections.length - 1); k >= 0; k--) {
    const refs = side === 'header' ? sections[k]!.headers : sections[k]!.footers;
    if (refs[kind]) return k;
  }
  return null;
}

/** Indexes of the sections that show `storyId` in some slot (own or inherited). */
export function sectionsUsingStory(sections: Section[], storyId: string): number[] {
  const out: number[] = [];
  sections.forEach((_, i) => {
    for (const side of ['header', 'footer'] as const) {
      for (const kind of ['default', 'first', 'even'] as const) {
        if (effectiveStory(sections, i, side, kind) === storyId && !out.includes(i)) out.push(i);
      }
    }
  });
  return out;
}

const ROMAN: Array<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) (out += s), (n -= v);
  return out;
}

/** Word's letter numbering: a…z, then aa…zz, aaa… */
function letters(n: number): string {
  if (n <= 0) return String(n);
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

/** A page number in a `w:pgNumType` format. Unknown formats fall back to decimal. */
export function formatPageNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    case 'lowerLetter':
      return letters(n);
    case 'upperLetter':
      return letters(n).toUpperCase();
    case 'decimalZero':
      return n < 10 && n >= 0 ? `0${n}` : String(n);
    case 'numberInDash':
      return `- ${n} -`;
    default:
      return String(n);
  }
}

/** Per page: its section index and the page's index inside that section. */
export interface PageSection {
  section: number;
  indexInSection: number;
}

/**
 * Page numbers for a run of pages: a section with `pgNum.start` restarts at
 * that number on its first page; otherwise numbering continues.
 */
export function pageNumbers(pages: PageSection[], sections: Section[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const p of pages) {
    const start = sections[p.section]?.pgNum.start;
    n = p.indexInSection === 0 && start != null ? start : n + 1;
    out.push(n);
  }
  return out;
}

/** Whether a section starts on a new page, and which parity it needs. */
export function startsNewPage(kind: SectionKind): { newPage: boolean; parity: 'even' | 'odd' | null } {
  switch (kind) {
    case 'continuous':
    case 'nextColumn':
      return { newPage: false, parity: null };
    case 'evenPage':
      return { newPage: true, parity: 'even' };
    case 'oddPage':
      return { newPage: true, parity: 'odd' };
    default:
      return { newPage: true, parity: null };
  }
}

/** « Section 2 » style label (1-based). */
export const sectionLabel = (i: number) => `Section ${i + 1}`;

/** « sections 3 à 5 » / « section 3 » / « sections 2, 4 » for a list of indexes. */
export function sectionsPhrase(indexes: number[]): string {
  const n = [...indexes].sort((a, b) => a - b).map((i) => i + 1);
  if (n.length === 0) return '';
  if (n.length === 1) return tr(`la section ${n[0]}`, `section ${n[0]}`);
  const contiguous = n.every((v, k) => k === 0 || v === n[k - 1]! + 1);
  return contiguous ? tr(`les sections ${n[0]} à ${n[n.length - 1]}`, `sections ${n[0]} to ${n[n.length - 1]}`) : tr(`les sections ${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}`, `sections ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
}

// ---------------------------------------------------------------------------
// Geometry (CSS px at 100 %)
// ---------------------------------------------------------------------------

const px = (tw: number) => tw / 15;

export interface PageMarginsPx {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
}

/** A section's sheet and text column, inside the frame of the widest sheet. */
export interface SectionBox {
  width: number;
  height: number;
  margins: PageMarginsPx;
  /** Sheets are centred like in Word: offset of this sheet in the frame. */
  sheetLeft: number;
  /** Text column, in frame coordinates. */
  textLeft: number;
  textWidth: number;
}

/**
 * Horizontal frame of a document: the widest sheet, the union of every text
 * column (where the body column is laid out), and each section's box. A block
 * of section *i* is narrowed by `insetLeft[i]` / `insetRight[i]` inside the union.
 */
export interface SectionFrame {
  width: number;
  textLeft: number;
  textWidth: number;
  boxes: SectionBox[];
  insetLeft: number[];
  insetRight: number[];
}

export function pageMarginsPx(p: PageSetup): PageMarginsPx {
  return { top: px(p.top), right: px(p.right), bottom: px(p.bottom), left: px(p.left + p.gutter), header: px(p.header), footer: px(p.footer) };
}

export function frameOf(sections: Section[]): SectionFrame {
  const list = sections.length ? sections : [defaultSection()];
  const width = Math.max(...list.map((s) => px(s.page.width)));
  const boxes = list.map((s): SectionBox => {
    const w = px(s.page.width);
    const margins = pageMarginsPx(s.page);
    const sheetLeft = (width - w) / 2;
    return { width: w, height: px(s.page.height), margins, sheetLeft, textLeft: sheetLeft + margins.left, textWidth: Math.max(48, w - margins.left - margins.right) };
  });
  const left = Math.min(...boxes.map((b) => b.textLeft));
  const right = Math.max(...boxes.map((b) => b.textLeft + b.textWidth));
  const r1 = (v: number) => Math.round(v * 100) / 100;
  return {
    width,
    textLeft: left,
    textWidth: right - left,
    boxes,
    insetLeft: boxes.map((b) => r1(b.textLeft - left)),
    insetRight: boxes.map((b) => r1(right - b.textLeft - b.textWidth)),
  };
}

/** One laid-out sheet. */
export interface PageInfo {
  /** Index in the ordered sections, and the section's id. */
  section: number;
  sectionId: string;
  indexInSection: number;
  /** Page number as Word counts it (restarts honoured), and as displayed. */
  number: number;
  label: string;
  /** Sheet top in the pages column (px), and the sheet's box. */
  top: number;
  width: number;
  height: number;
  sheetLeft: number;
  margins: PageMarginsPx;
  /** No content of its own (inserted so an odd/even section starts on the right side). */
  blank?: boolean;
}

/** A sheet for page `k` of `sections[section]`, placed after `prev`. */
export function makePage(sections: Section[], frame: SectionFrame, section: number, prev: PageInfo | null, gap: number): PageInfo {
  const s = sections[section] ?? sections[sections.length - 1]!;
  const box = frame.boxes[section] ?? frame.boxes[frame.boxes.length - 1]!;
  const indexInSection = prev && prev.section === section ? prev.indexInSection + 1 : 0;
  const number = indexInSection === 0 && s.pgNum.start != null ? s.pgNum.start : (prev?.number ?? 0) + 1;
  return {
    section,
    sectionId: s.id,
    indexInSection,
    number,
    label: formatPageNumber(number, s.pgNum.fmt),
    top: prev ? prev.top + prev.height + gap : 0,
    width: box.width,
    height: box.height,
    sheetLeft: box.sheetLeft,
    margins: box.margins,
  };
}
