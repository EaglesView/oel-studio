import type { Preview } from '@oel/engine';
import { plainText } from './text';
import type { SlidesDoc } from './ydoc';
import { paintColor } from './ops';

/** Desk preview: titles and first lines, slide shape, first slide's colours. */
export function toPreview(d: SlidesDoc): Extract<Preview, { kind: 'slides' }> {
  const info = d.info();
  const ids = d.slideIds();
  const slides = ids.slice(0, 40).map((id, i) => {
    const s = d.slide(id)!;
    const title = s.elements.find((e) => e.ph && /title/i.test(e.ph.type));
    const lines = s.elements.filter((e) => e !== title && e.text).flatMap((e) => plainText(e.text).split('\n')).map((l) => l.trim()).filter(Boolean);
    const t = plainText(title?.text).replace(/\s+/g, ' ').trim();
    return { title: t || lines[0] || `Diapositive ${i + 1}`, body: lines.slice(t ? 0 : 1, 3).join(' · ') || undefined };
  });
  const first = ids[0] ? d.slide(ids[0]) : null;
  const layout = first ? d.layout(first.layout) : undefined;
  const background = paintColor(first?.background ?? layout?.background);
  const ink = first?.elements.find((e) => e.ph && /title/i.test(e.ph.type))?.text?.levels[0]?.color;
  return { kind: 'slides', slides, size: { width: info.width, height: info.height }, ...(background ? { background } : {}), ...(ink ? { ink } : {}) };
}
