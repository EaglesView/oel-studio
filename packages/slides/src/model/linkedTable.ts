/**
 * Linked tables on slides (`@oel/links`, plan I-4, Figma I2): a table element
 * built from a `LinkedTable`, fitted to its frame. A table taller than its
 * frame follows the link's view (I6 §3): `truncate` keeps the rows that fit
 * (the frame's name says « 9 lignes sur 40 »), `all` shrinks the text until
 * everything fits.
 */
import type { LinkedTable, LinkTheme, Overflow } from '@oel/links';
import type { Element, Paint, Table, TableCell } from './types';
import type { DeckInfo } from './ydoc';
import { newId } from './ops';

const EMU_PER_PT = 12700;
/** Linked tables start at 12 pt (sheet sizes read too small on a slide, theirs too large). */
const BASE_PT = 12;
const MIN_PT = 6;
const ROW_FACTOR = 1.9;

const solid = (color: string): Paint => ({ type: 'solid', color: color.toUpperCase() });

function cell(c: LinkedTable['rows'][number][number], theme: LinkTheme, size: number, font?: string): TableCell {
  const props: Record<string, unknown> = { size };
  if (c.bold) props.bold = true;
  if (c.italic) props.italic = true;
  if (theme === 'source' && c.color) props.color = c.color.toUpperCase();
  if (theme === 'source' && font) props.font = font;
  const out: TableCell = {
    text: {
      body: { anchor: 'ctr', l: 64008, t: 22860, r: 64008, b: 22860, wrap: true, autofit: 'none', fontScale: 1, lineReduction: 0, vert: 'horz' },
      levels: [],
      paras: [{ lvl: 0, props: { align: c.align === 'right' ? 'r' : c.align === 'center' ? 'ctr' : 'l' }, runs: c.text ? [{ kind: 'text', text: c.text, props }] : [], end: { size } }],
    } as unknown as TableCell['text'],
  };
  if (c.colSpan && c.colSpan > 1) out.gridSpan = c.colSpan;
  if (c.rowSpan && c.rowSpan > 1) out.rowSpan = c.rowSpan;
  if (c.merged) out.hMerge = true;
  if (theme === 'source' && c.fill) out.fill = solid(c.fill);
  return out;
}

/** The table and the frame's name for this box; the box itself (position, size) is the copy's own. */
export function linkedTableContent(table: LinkedTable, theme: LinkTheme, overflow: Overflow, box: { cx: number; cy: number }): { table: Table; name: string } {
  const total = table.rows.length;
  let size = theme === 'source' && table.font?.size ? Math.min(table.font.size + 1, 18) : BASE_PT;
  let rows = table.rows;
  const rowH = (pt: number) => Math.round(pt * ROW_FACTOR * EMU_PER_PT);
  const fit = Math.max(1, Math.floor(box.cy / rowH(size)));
  if (total > fit) {
    if (overflow === 'all') size = Math.max(MIN_PT, Math.floor(((box.cy / total / ROW_FACTOR / EMU_PER_PT) * 10)) / 10);
    else rows = table.rows.slice(0, fit);
  }
  const sum = table.widths.reduce((a, b) => a + b, 0) || 1;
  const cols = table.widths.map((w) => Math.round((w / sum) * box.cx));
  const font = theme === 'source' ? table.font?.family : undefined;
  const h = rowH(size);
  return {
    table: { cols, rows: rows.map((r) => ({ h, cells: r.map((c) => cell(c, theme, size, font)) })) },
    name: rows.length < total ? `Tableau lié · ${rows.length} lignes sur ${total}` : 'Tableau lié',
  };
}

/** A new linked table element in `box` (its height grows to the rows when they fit). */
export function linkedTableFrame(info: DeckInfo, table: LinkedTable, theme: LinkTheme, overflow: Overflow, box: { x: number; y: number; cx: number; cy: number }): Element {
  void info;
  const content = linkedTableContent(table, theme, overflow, box);
  const needed = content.table.rows.reduce((a, r) => a + r.h, 0);
  return { id: newId('t'), kind: 'table', name: content.name, ...box, cy: Math.min(box.cy, needed), table: content.table } as Element;
}
