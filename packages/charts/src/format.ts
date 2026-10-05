/**
 * Excel number formats for axis and data labels (`#,##0.00`, `0%`,
 * `[$-fr-CA]d mmm yyyy`, `"$"#,##0;[Red]-"$"#,##0`…). The grid formats its
 * cells in the calc engine; charts format their own ticks here, with the same
 * conventions as the cells (`.` decimals, `,` thousands).
 */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** `General`: up to 11 significant characters, like Excel in a narrow label. */
export function general(v: number): string {
  if (!Number.isFinite(v)) return '#NUM!';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e11 || a < 1e-9) return v.toExponential(2).replace('e+', 'E+').replace('e-', 'E-');
  const s = Number(v.toPrecision(10)).toString();
  return s.includes('e') ? v.toExponential(2).toUpperCase() : s;
}

/** Split on `;` outside quotes and brackets. */
function sections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  let br = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '\\' && !q) {
      cur += c + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') q = !q;
    else if (!q && c === '[') br = true;
    else if (!q && c === ']') br = false;
    if (c === ';' && !q && !br) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Excel serial date → parts (1900 system). */
function serialDate(v: number) {
  const ms = Math.round((v - 25569) * 86400000);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

const isDateCode = (c: string) => /(^|[^"\\])[dmyhs]/i.test(c.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''));

function formatDate(v: number, code: string): string {
  const p = serialDate(v);
  const ampm = /AM\/PM|A\/P/i.test(code);
  let out = '';
  const src = code.replace(/\[[^\]]*\]/g, '');
  let lastWasHour = false;
  for (let i = 0; i < src.length; ) {
    const rest = src.slice(i);
    const run = (ch: string) => {
      let n = 0;
      while (src[i + n]?.toLowerCase() === ch) n++;
      return n;
    };
    const c = src[i]!;
    const lc = c.toLowerCase();
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      out += src.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '\\') {
      out += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (/^AM\/PM/i.test(rest)) {
      out += p.h < 12 ? 'AM' : 'PM';
      i += 5;
      continue;
    }
    if (lc === 'y') {
      const n = run('y');
      out += n <= 2 ? String(p.y % 100).padStart(2, '0') : String(p.y);
      i += n;
      continue;
    }
    if (lc === 'd') {
      const n = run('d');
      out += n === 1 ? String(p.d) : n === 2 ? String(p.d).padStart(2, '0') : n === 3 ? DAYS[p.wd]!.slice(0, 3) + '.' : DAYS[p.wd]!;
      i += n;
      continue;
    }
    if (lc === 'h') {
      const n = run('h');
      const h = ampm ? ((p.h + 11) % 12) + 1 : p.h;
      out += n >= 2 ? String(h).padStart(2, '0') : String(h);
      i += n;
      lastWasHour = true;
      continue;
    }
    if (lc === 'm') {
      const n = run('m');
      // `m` right after an hour (or before seconds) is minutes.
      const minutes = lastWasHour || /^m+[^dmy]*s/i.test(rest);
      if (minutes) out += n >= 2 ? String(p.mi).padStart(2, '0') : String(p.mi);
      else out += n === 1 ? String(p.m + 1) : n === 2 ? String(p.m + 1).padStart(2, '0') : n === 3 ? MONTHS_SHORT[p.m]! : n === 4 ? MONTHS[p.m]! : MONTHS[p.m]![0]!;
      i += n;
      lastWasHour = false;
      continue;
    }
    if (lc === 's') {
      const n = run('s');
      out += n >= 2 ? String(p.s).padStart(2, '0') : String(p.s);
      i += n;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumber(v: number, code: string): string {
  // Literal text and the number pattern, in order.
  let pattern = '';
  const lits: { at: number; text: string }[] = [];
  let pct = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '"') {
      const end = code.indexOf('"', i + 1);
      lits.push({ at: pattern.length, text: code.slice(i + 1, end < 0 ? undefined : end) });
      i = end < 0 ? code.length : end;
    } else if (c === '\\') {
      lits.push({ at: pattern.length, text: code[i + 1] ?? '' });
      i++;
    } else if (c === '[') {
      const end = code.indexOf(']', i);
      const inner = code.slice(i + 1, end);
      const cur = /^\$([^-\]]*)/.exec(inner);
      if (cur?.[1]) lits.push({ at: pattern.length, text: cur[1] });
      i = end < 0 ? code.length : end;
    } else if (c === '_' || c === '*') {
      i++; // padding: ignored
    } else if ('0#?.,%Ee+-'.includes(c)) {
      if (c === '%') pct++;
      pattern += c;
    } else {
      lits.push({ at: pattern.length, text: c });
    }
  }
  let x = v * 100 ** pct;
  // Trailing commas scale by thousands.
  const core = pattern.replace(/%/g, '');
  const scale = /,+$/.exec(core.replace(/[Ee][+-]0+$/, ''));
  let body = core;
  if (scale) {
    x /= 1000 ** scale[0].length;
    body = core.slice(0, core.length - scale[0].length);
  }
  let text: string;
  const sci = /[Ee][+-]/.exec(body);
  if (sci) {
    const [mant] = body.split(/[Ee]/);
    const dec = (mant!.split('.')[1] ?? '').length;
    const exp = body.slice(sci.index + 2).length;
    const s = Math.abs(x).toExponential(dec);
    const [m, e] = s.split('e');
    const en = Number(e);
    text = `${m}E${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(exp, '0')}`;
  } else {
    const [intPat = '', decPat = ''] = body.split('.');
    const decimals = decPat.replace(/[^0#?]/g, '');
    const fixed = Math.abs(x).toFixed(decimals.length);
    let [int = '0', dec = ''] = fixed.split('.');
    // Optional decimals (`#`) drop trailing zeros.
    const required = (decimals.match(/0/g) ?? []).length;
    while (dec.length > required && dec.endsWith('0')) dec = dec.slice(0, -1);
    const minInt = (intPat.replace(/[^0]/g, '') || '').length;
    if (int === '0' && minInt === 0) int = '';
    int = int.padStart(minInt, '0');
    if (intPat.includes(',')) int = groupThousands(int);
    text = int + (dec ? '.' + dec : decPat.includes('.') ? '' : '');
    if (!text) text = '0';
  }
  // Put literals back around the number (prefix before the first digit, suffix after).
  const firstDigit = 0;
  let prefix = '';
  let suffix = '';
  for (const l of lits) {
    if (l.at <= firstDigit) prefix += l.text;
    else suffix += l.text;
  }
  return prefix + text + '%'.repeat(pct) + suffix;
}

/** Format a number with an Excel format code (`General` when absent). */
export function formatValue(v: number | null | undefined, code?: string | null): string {
  if (v == null || Number.isNaN(v)) return '';
  const c = (code ?? '').trim();
  if (!c || /^general$/i.test(c)) return general(v);
  const secs = sections(c);
  let sec = secs[0]!;
  let n = v;
  if (v < 0 && secs.length > 1) {
    sec = secs[1]!;
    n = -v;
  } else if (v === 0 && secs.length > 2) sec = secs[2]!;
  if (/^general$/i.test(sec.replace(/\[[^\]]*\]/g, '').trim())) return (v < 0 && secs.length > 1 ? '' : '') + general(n);
  const neg = n < 0 && secs.length < 2;
  const body = isDateCode(sec) ? formatDate(n, sec) : formatNumber(Math.abs(n), sec);
  return (neg ? '-' : '') + body;
}

/** True when the format shows dates (the axis becomes a date axis). */
export function isDateFormat(code?: string | null): boolean {
  return !!code && !/^general$/i.test(code) && isDateCode(sections(code)[0]!);
}
