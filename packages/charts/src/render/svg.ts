/** Scene → SVG markup (editors, print, PDF export, desk thumbnails). */
import type { Mark, Paint, Scene, Stroke } from '../types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

export function toSVG(scene: Scene, opts: { id?: string; title?: boolean } = {}): string {
  const uid = opts.id ?? `c${Math.random().toString(36).slice(2, 8)}`;
  const defs: string[] = [];
  let gi = 0;
  const paint = (p: Paint | undefined): string => {
    if (p == null) return 'none';
    if (typeof p === 'string') return p;
    const id = `${uid}g${gi++}`;
    const stops = p.stops.map((s) => `<stop offset="${n(s.pos)}" stop-color="${esc(s.color)}"/>`).join('');
    if (p.kind === 'radial') defs.push(`<radialGradient id="${id}" cx="35%" cy="35%" r="75%">${stops}</radialGradient>`);
    else {
      const a = (p.angle * Math.PI) / 180;
      const x = Math.cos(a) / 2;
      const y = Math.sin(a) / 2;
      defs.push(`<linearGradient id="${id}" x1="${n(0.5 - x)}" y1="${n(0.5 - y)}" x2="${n(0.5 + x)}" y2="${n(0.5 + y)}">${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  };
  const stroke = (s: Stroke | undefined) => (s ? ` stroke="${esc(s.color)}" stroke-width="${n(s.width)}"${s.dash ? ` stroke-dasharray="${s.dash.map(n).join(' ')}"` : ''}` : '');
  const common = (m: Mark) => `${m.id ? ` data-el="${esc(m.id)}"` : ''}${m.opacity != null ? ` opacity="${n(m.opacity)}"` : ''}`;
  const body: string[] = [];
  for (const m of scene.marks) {
    switch (m.t) {
      case 'rect':
        body.push(`<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(Math.max(0, m.w))}" height="${n(Math.max(0, m.h))}"${m.r ? ` rx="${n(m.r)}"` : ''} fill="${paint(m.fill)}"${stroke(m.stroke)}${common(m)}/>`);
        break;
      case 'path':
        body.push(`<path d="${m.d}" fill="${paint(m.fill)}"${stroke(m.stroke)} stroke-linejoin="round"${common(m)}/>`);
        break;
      case 'circle':
        body.push(`<circle cx="${n(m.cx)}" cy="${n(m.cy)}" r="${n(m.r)}" fill="${paint(m.fill)}"${stroke(m.stroke)}${common(m)}/>`);
        break;
      case 'image':
        body.push(`<image href="${esc(m.href)}" x="${n(m.x)}" y="${n(m.y)}" width="${n(m.w)}" height="${n(m.h)}" preserveAspectRatio="xMidYMid meet"${common(m)}/>`);
        break;
      case 'text': {
        const anchor = m.anchor === 'start' ? 'start' : m.anchor === 'end' ? 'end' : 'middle';
        const base = m.baseline === 'top' ? 'hanging' : m.baseline === 'bottom' ? 'alphabetic' : 'central';
        const dy = m.baseline === 'bottom' ? -m.size * 0.2 : 0;
        const rot = m.rot ? ` transform="rotate(${n(m.rot)} ${n(m.x)} ${n(m.y)})"` : '';
        body.push(
          `<text x="${n(m.x)}" y="${n(m.y + dy)}" font-family="${esc(m.font)}" font-size="${n(m.size)}" fill="${esc(m.color)}" text-anchor="${anchor}" dominant-baseline="${base}"${m.bold ? ' font-weight="bold"' : ''}${m.italic ? ' font-style="italic"' : ''}${rot}${common(m)}>${esc(m.text)}</text>`,
        );
        break;
      }
    }
  }
  const title = opts.title !== false ? `<title>${esc(scene.label)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(scene.w)} ${n(scene.h)}" width="${n(scene.w)}" height="${n(scene.h)}" role="img" aria-label="${esc(scene.label)}">${title}${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
}

export function toDataURL(scene: Scene): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSVG(scene, { title: false }))}`;
}
