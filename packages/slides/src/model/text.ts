/**
 * Text of shapes: effective paragraph and run styles (the level defaults the
 * codec resolved, then the paragraph's and run's own properties), as CSS in
 * slide points, plus the edits the toolbar applies to whole text bodies.
 */
import type { Bullet, DeckFont, Level, Para, ParaProps, Run, RunProps, Spacing, TextBody, ThemeInfo } from './types';
import { locale } from '@oel/i18n';

export interface TextCtx {
  theme: ThemeInfo;
  fonts: DeckFont[];
  /** Number shown by slide-number fields. */
  slideNumber?: number;
}

export const DEFAULT_LEVEL: Level = {
  size: 18,
  font: '+mn-lt',
  color: '#000000',
  bold: false,
  italic: false,
  underline: 'none',
  strike: 'noStrike',
  caps: 'none',
  spacing: 0,
  align: 'l',
  marL: 0,
  indent: 0,
  line: { pct: 1 },
  before: { pts: 0 },
  after: { pts: 0 },
  bullet: { kind: 'none' },
};

export function levelOf(body: TextBody, lvl: number): Level {
  const ls = body.levels;
  return ls[Math.min(lvl, ls.length - 1)] ?? ls[ls.length - 1] ?? DEFAULT_LEVEL;
}

/** `+mj-lt` / `+mn-lt` → the theme's typeface. */
export function typeface(face: string, theme: ThemeInfo): string {
  if (face.startsWith('+mj')) return theme.major;
  if (face.startsWith('+mn')) return theme.minor;
  return face;
}

/** CSS font stack: the deck's substitutes when the codec listed the font. */
export function fontStack(face: string, ctx: TextCtx): string {
  const name = typeface(face, ctx.theme);
  return ctx.fonts.find((f) => f.name === name)?.css ?? `"${name.replace(/"/g, '')}", sans-serif`;
}

export interface ResolvedRun {
  size: number;
  font: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: string;
  strike: string;
  caps: string;
  spacing: number;
  baseline: number;
  highlight?: string;
  link?: string;
}

export function resolveRun(level: Level, p: RunProps, ctx?: TextCtx): ResolvedRun {
  const link = p.link || undefined;
  const hlink = ctx?.theme.colors.find((c) => c.name === 'hlink')?.color;
  return {
    size: p.size ?? level.size,
    font: p.font ?? level.font,
    color: link && hlink ? hlink : (p.color ?? level.color),
    bold: p.bold ?? level.bold,
    italic: p.italic ?? level.italic,
    underline: link ? (p.underline ?? 'sng') : (p.underline ?? level.underline),
    strike: p.strike ?? level.strike,
    caps: p.caps ?? level.caps,
    spacing: p.spacing ?? level.spacing,
    baseline: p.baseline ?? 0,
    highlight: p.highlight,
    link,
  };
}

export interface ResolvedPara {
  align: string;
  marL: number;
  indent: number;
  line: Spacing;
  before: Spacing;
  after: Spacing;
  bullet: Bullet;
}

export function mergeBullet(base: Bullet, over?: Bullet | null): Bullet {
  if (!over) return base;
  const out: Bullet = { ...base };
  if (over.kind) {
    out.kind = over.kind;
    out.char = over.char ?? base.char;
    out.scheme = over.scheme ?? base.scheme;
    out.start = over.start ?? base.start;
  }
  if (over.font != null) out.font = over.font || undefined;
  if (over.color != null) out.color = over.color || undefined;
  if (over.size != null) out.size = over.size;
  return out;
}

export function resolvePara(level: Level, p: ParaProps): ResolvedPara {
  return {
    align: p.align ?? level.align,
    marL: p.marL ?? level.marL,
    indent: p.indent ?? level.indent,
    line: p.line ?? level.line,
    before: p.before ?? level.before,
    after: p.after ?? level.after,
    bullet: mergeBullet(level.bullet, p.bullet),
  };
}

const ALIGN: Record<string, string> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify', justLow: 'justify', thaiDist: 'justify' };

/** Line height of single spacing, relative to the font size (PowerPoint uses the font's ascent+descent, ~1.2). */
const SINGLE = 1.2;

export interface Fit {
  fontScale: number;
  lineReduction: number;
}

const px = (v: number) => `${Math.round(v * 1000) / 1000}px`;

/** Paragraph CSS (lengths in points). `size` is the paragraph's first font size. */
export function paraCss(p: ResolvedPara, size: number, fit: Fit): Record<string, string> {
  const line = p.line.pct != null ? `${Math.max(0.1, p.line.pct * (1 - fit.lineReduction)) * SINGLE}` : px((p.line.pts ?? size * SINGLE) * (1 - fit.lineReduction));
  const space = (s: Spacing) => (s.pct != null ? s.pct * size * fit.fontScale * SINGLE : (s.pts ?? 0));
  const marL = p.marL / 12700;
  const indent = p.indent / 12700;
  return {
    margin: '0',
    paddingLeft: px(Math.max(0, marL)),
    textIndent: px(indent),
    textAlign: ALIGN[p.align] ?? 'left',
    lineHeight: line,
    paddingTop: px(space(p.before)),
    paddingBottom: px(space(p.after)),
  };
}

export function runCss(r: ResolvedRun, ctx: TextCtx, fit: Fit): Record<string, string> {
  const css: Record<string, string> = {
    fontFamily: fontStack(r.font, ctx),
    fontSize: px(r.size * fit.fontScale * (r.baseline ? 0.66 : 1)),
    color: r.color,
    fontWeight: r.bold ? '700' : '400',
    fontStyle: r.italic ? 'italic' : 'normal',
  };
  const deco = [r.underline !== 'none' && r.underline ? 'underline' : '', r.strike && r.strike !== 'noStrike' ? 'line-through' : ''].filter(Boolean);
  if (deco.length) css.textDecoration = deco.join(' ');
  if (r.underline === 'dbl') css.textDecorationStyle = 'double';
  if (r.strike === 'dblStrike') css.textDecorationStyle = 'double';
  if (r.caps === 'all') css.textTransform = 'uppercase';
  if (r.caps === 'small') css.fontVariant = 'small-caps';
  if (r.spacing) css.letterSpacing = px(r.spacing);
  if (r.baseline) css.verticalAlign = r.baseline > 0 ? 'super' : 'sub';
  if (r.highlight) css.backgroundColor = r.highlight;
  return css;
}

const ROMAN: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) (out += s), (n -= v);
  return out;
}
function alpha(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(97 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Text of an automatic number (`arabicPeriod`, `alphaUcParenR`, `romanLcPeriod`…). */
export function autoNumber(scheme: string | undefined, n: number): string {
  const s = scheme ?? 'arabicPeriod';
  const base = s.startsWith('alphaLc') ? alpha(n) : s.startsWith('alphaUc') ? alpha(n).toUpperCase() : s.startsWith('romanLc') ? roman(n) : s.startsWith('romanUc') ? roman(n).toUpperCase() : String(n);
  if (s.endsWith('ParenBoth')) return `(${base})`;
  if (s.endsWith('ParenR')) return `${base})`;
  if (s.endsWith('Plain')) return base;
  if (s.endsWith('Minus')) return `- ${base} -`;
  return `${base}.`;
}

/** Numbers of the numbered paragraphs (by index), counting like PowerPoint. */
export function numbering(body: TextBody): Map<number, number> {
  const out = new Map<number, number>();
  const counters: number[] = [];
  body.paras.forEach((p, i) => {
    const lvl = p.lvl ?? 0;
    const b = resolvePara(levelOf(body, lvl), p.props ?? {}).bullet;
    counters.length = Math.min(counters.length, lvl + 1);
    if (b.kind === 'auto' && hasText(p)) {
      const n = (counters[lvl] ?? (b.start ?? 1) - 1) + 1;
      counters[lvl] = n;
      out.set(i, n);
    } else if (hasText(p)) {
      counters.length = lvl;
    }
  });
  return out;
}

export const hasText = (p: Para) => p.runs.some((r) => r.kind === 'field' || (r.kind === 'text' && !!r.text));

export function isEmptyBody(body: TextBody | null | undefined): boolean {
  return !body || !body.paras.some(hasText);
}

export function plainText(body: TextBody | null | undefined): string {
  return (body?.paras ?? []).map((p) => p.runs.map((r) => (r.kind === 'br' ? '\n' : (r.text ?? ''))).join('')).join('\n');
}

/** Field text as shown: slide numbers and dates are computed. */
export function fieldText(r: Run, ctx: TextCtx): string {
  const f = r.field ?? '';
  if (f === 'slidenum') return ctx.slideNumber != null ? String(ctx.slideNumber) : (r.text ?? '');
  if (f.startsWith('datetime')) return new Date().toLocaleDateString(locale(), f === 'datetime1' ? undefined : { year: 'numeric', month: 'long', day: 'numeric' });
  return r.text ?? '';
}

// ---------------------------------------------------------------------------
// Whole-body edits (shape selected, not in text editing)
// ---------------------------------------------------------------------------

/** Set run properties on every run (and the paragraph ends, so new text follows). */
export function setRunProps(body: TextBody, patch: Partial<RunProps>): TextBody {
  const apply = (p: RunProps) => clean({ ...p, ...patch });
  return { ...body, paras: body.paras.map((para) => ({ ...para, runs: para.runs.map((r) => ({ ...r, props: apply(r.props ?? {}) })), end: apply(para.end ?? {}) })) };
}

export function setParaProps(body: TextBody, patch: Partial<ParaProps>, only?: (index: number) => boolean): TextBody {
  return { ...body, paras: body.paras.map((p, i) => (only && !only(i) ? p : { ...p, props: clean({ ...(p.props ?? {}), ...patch }) })) };
}

export function setLevel(body: TextBody, delta: number, only?: (index: number) => boolean): TextBody {
  return { ...body, paras: body.paras.map((p, i) => (only && !only(i) ? p : { ...p, lvl: Math.max(0, Math.min(8, (p.lvl ?? 0) + delta)) })) };
}

/** Drop `undefined` keys so the JSON matches what the codec writes. */
export function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** The value a run property has everywhere in a body (`undefined` when mixed). */
export function commonRun<K extends keyof ResolvedRun>(body: TextBody, key: K, ctx?: TextCtx): ResolvedRun[K] | undefined {
  let found: ResolvedRun[K] | undefined;
  let first = true;
  for (const p of body.paras) {
    const level = levelOf(body, p.lvl ?? 0);
    const runs = p.runs.filter((r) => r.kind !== 'br');
    for (const r of runs.length ? runs : [{ kind: 'text', text: '', props: p.end ?? {} } as Run]) {
      const v = resolveRun(level, r.props ?? {}, ctx)[key];
      if (first) (found = v), (first = false);
      else if (v !== found) return undefined;
    }
  }
  return found;
}

/** A body holding plain text in one run per paragraph (new text boxes). */
export function bodyFromText(text: string, base: TextBody): TextBody {
  return { ...base, paras: text.split('\n').map((t) => ({ lvl: 0, props: {}, runs: t ? [{ kind: 'text', text: t, props: {} }] : [], end: {} })) };
}
