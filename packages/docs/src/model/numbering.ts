/**
 * Word list numbering, computed in the editor: paragraphs carry `numId`/`ilvl`
 * (as in OOXML, no nested <ul>), and markers come from the definitions the
 * codec extracted, plus lists created here ("synthetic", written on export).
 */
import type { ListLevel, NumberingDefs, PMNode, SyntheticListKind } from './types';

/** Same levels as `template::abstract_num` in the codec. */
export function syntheticLevels(kind: SyntheticListKind): ListLevel[] {
  return Array.from({ length: 9 }, (_, l) => {
    let fmt = 'bullet';
    let text: string;
    if (kind === 'decimal') {
      fmt = ['decimal', 'lowerLetter', 'lowerRoman'][l % 3]!;
      text = `%${l + 1}.`;
    } else if (kind === 'check') text = '☐';
    else if (kind === 'checked') text = '☑';
    else text = ['●', '○', '■'][l % 3]!;
    return { fmt, text, start: 1, indLeft: 720 * (l + 1), hanging: 360, font: null };
  });
}

export interface ListDefs {
  get(numId: number): { key: string; levels: ListLevel[]; kind: SyntheticListKind | 'imported' } | undefined;
}

export function listDefs(imported: NumberingDefs | null | undefined, synthetic: Map<number, SyntheticListKind>): ListDefs {
  return {
    get(numId) {
      const kind = synthetic.get(numId);
      if (kind) return { key: `s${numId}`, levels: syntheticLevels(kind), kind };
      const n = imported?.nums[String(numId)];
      if (!n) return undefined;
      // Word continues numbering across nums sharing an abstract, unless overridden.
      return { key: n.restart ? `n${numId}` : `a${n.abstractId}`, levels: n.levels, kind: 'imported' };
    },
  };
}

function roman(n: number): string {
  const map: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function letters(n: number): string {
  // Word repeats the letter: a…z, aa…zz, aaa…
  const idx = (n - 1) % 26;
  const reps = Math.floor((n - 1) / 26) + 1;
  return String.fromCharCode(97 + idx).repeat(reps);
}

export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'decimal': return String(n);
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'ordinal': return `${n}${n === 1 ? 'er' : 'e'}`;
    case 'none': return '';
    case 'bullet': return '';
    default: return String(n);
  }
}

/** Marker for each numbered paragraph, in document order. */
export class ListCounter {
  private counters = new Map<string, number[]>();
  constructor(private defs: ListDefs) {}

  next(numId: number, ilvl: number): { marker: string; level: ListLevel } | null {
    const def = this.defs.get(numId);
    if (!def || numId === 0) return null;
    const lvl = Math.max(0, Math.min(8, ilvl));
    const level = def.levels[lvl];
    if (!level) return null;
    let c = this.counters.get(def.key);
    if (!c) {
      c = def.levels.map((l) => l.start - 1);
      this.counters.set(def.key, c);
    }
    c[lvl] = (c[lvl] ?? 0) + 1;
    for (let d = lvl + 1; d < c.length; d++) c[d] = (def.levels[d]?.start ?? 1) - 1;
    if (level.fmt === 'bullet') return { marker: level.text, level };
    const marker = level.text.replace(/%([1-9])/g, (_, k: string) => {
      const i = Number(k) - 1;
      const l = def.levels[i];
      return l ? formatNumber(Math.max(c![i] ?? 1, l.start), i === lvl ? level.fmt : l.fmt) : '';
    });
    return { marker, level };
  }
}

/** Kind of list a paragraph is in, for toolbar state. */
export function listKindOf(defs: ListDefs, numId: number | null | undefined, ilvl = 0): 'bullet' | 'numbered' | 'check' | null {
  if (numId == null || numId === 0) return null;
  const d = defs.get(numId);
  if (!d) return null;
  if (d.kind === 'check' || d.kind === 'checked') return 'check';
  return d.levels[ilvl]?.fmt === 'bullet' ? 'bullet' : 'numbered';
}

/** A numId nobody else will pick (collaborators may create lists concurrently). */
export function newNumId(taken: Iterable<number>): number {
  const used = new Set(taken);
  for (;;) {
    const id = 1000 + Math.floor(Math.random() * 1_000_000);
    if (!used.has(id)) return id;
  }
}

/** Walk paragraphs in order (including inside tables and content controls). */
export function walkParagraphs(node: PMNode, fn: (p: PMNode) => void) {
  if (node.type === 'paragraph') fn(node);
  for (const c of node.content ?? []) walkParagraphs(c, fn);
}
