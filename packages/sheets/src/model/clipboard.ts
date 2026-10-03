/**
 * Clipboard formats. Copies write tab-separated text and an HTML table (what
 * Excel, Sheets and LibreOffice read); pastes read the HTML when there is one
 * (keeps bold, italic, colours) and fall back to the text.
 */

export interface ClipCell {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
}

/** Tab-separated text; fields with tabs, newlines or quotes are quoted (Excel). */
export function toTSV(rows: string[][]): string {
  const q = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join('\t')).join('\r\n');
}

export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const t = text.replace(/\r\n?/g, '\n');
  while (i < t.length) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toHTML(rows: ClipCell[][]): string {
  const td = (c: ClipCell) => {
    const css = [c.bold && 'font-weight:bold', c.italic && 'font-style:italic', c.underline && 'text-decoration:underline', c.color && `color:${c.color}`, c.fill && `background:${c.fill}`].filter(Boolean).join(';');
    return `<td${css ? ` style="${css}"` : ''}>${esc(c.text).replace(/\n/g, '<br>')}</td>`;
  };
  return `<meta charset="utf-8"><table>${rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')}</table>`;
}

/** First table of an HTML clipboard payload; `null` when there is none. Browser only (DOMParser). */
export function parseHTML(html: string): ClipCell[][] | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const out: ClipCell[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const row: ClipCell[] = [];
    tr.querySelectorAll('td,th').forEach((cell) => {
      const el = cell as HTMLElement;
      const st = el.style;
      const b = el.querySelector('b,strong') || /bold|[6-9]00/.test(st.fontWeight);
      const text = (el.innerText ?? el.textContent ?? '').replace(/\u00a0/g, ' ');
      row.push({
        text: text.replace(/\n$/, ''),
        ...(b ? { bold: true } : {}),
        ...(el.querySelector('i,em') || st.fontStyle === 'italic' ? { italic: true } : {}),
        ...(el.querySelector('u') || st.textDecoration.includes('underline') ? { underline: true } : {}),
        ...(st.color ? { color: st.color } : {}),
        ...(st.backgroundColor ? { fill: st.backgroundColor } : {}),
      });
      // Merged cells arrive as colspan: keep the columns aligned (rowspans are flattened).
      for (let k = 1; k < Number(el.getAttribute('colspan') ?? 1); k++) row.push({ text: '' });
    });
    out.push(row);
  });
  return out;
}

/** CSS colour (`rgb(…)`, `#abc`) → `#RRGGBB`, or null. */
export function cssHex(color: string | undefined): string | null {
  if (!color) return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join('') : m[1]!;
    return `#${h.toUpperCase()}`;
  }
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color);
  if (rgb && (rgb[4] == null || Number(rgb[4]) > 0)) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return null;
}
